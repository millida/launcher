//! Rewind: the last seconds of a running game, kept encoded in memory and
//! written to an MP4 on a hotkey. Capture lives in the launcher, outside the
//! game, so it behaves the same on every Minecraft version. Windows only:
//! Windows Graphics Capture, a hardware H.264 encoder through Media
//! Foundation, and WASAPI loopback of the game's own process.
#![cfg_attr(not(windows), allow(dead_code))]

mod clips;
mod mp4;
mod ring;
mod settings;
#[cfg(windows)]
mod win;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use tauri::{AppHandle, Emitter};

pub use clips::ClipFile;
pub use settings::{Quality, RewindSettings};

use crate::engine::Notices;

pub const STATE_EVENT: &str = "rewind-state";
pub const CLIP_EVENT: &str = "rewind-clip";
const NOTICE_KIND: &str = "clip";

#[derive(Serialize, Clone, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub recording: bool,
    pub video_problem: Option<String>,
    pub audio_problem: Option<String>,
    pub hotkey_problem: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RewindState {
    pub supported: bool,
    pub settings: RewindSettings,
    pub status: Status,
    pub folder: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipSaved {
    pub ok: bool,
    pub name: String,
    pub message: String,
}

struct Active {
    pid: u32,
    profile: String,
    seconds: u32,
    ring: Arc<Mutex<ring::Ring>>,
    #[cfg(windows)]
    recorder: Mutex<Option<win::Recorder>>,
    notices: Option<Notices>,
    saving: AtomicBool,
    status: Mutex<Status>,
}

static ACTIVE: Mutex<Vec<Weak<Active>>> = Mutex::new(Vec::new());
static BOUND: Mutex<Option<String>> = Mutex::new(None);
static HOTKEY_PROBLEM: Mutex<Option<String>> = Mutex::new(None);

pub fn supported() -> bool {
    cfg!(windows)
}

pub fn settings() -> RewindSettings {
    settings::load()
}

pub fn enabled() -> bool {
    supported() && settings::load().enabled
}

fn active() -> Vec<Arc<Active>> {
    let mut list = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    list.retain(|w| w.strong_count() > 0);
    list.iter().filter_map(Weak::upgrade).collect()
}

fn status() -> Status {
    let mut status = active().last().map(|a| a.status.lock().unwrap_or_else(|e| e.into_inner()).clone()).unwrap_or_default();
    status.hotkey_problem = HOTKEY_PROBLEM.lock().unwrap_or_else(|e| e.into_inner()).clone();
    status
}

pub fn state() -> RewindState {
    RewindState {
        supported: supported(),
        settings: settings::load(),
        status: status(),
        folder: clips::folder().to_string_lossy().into_owned(),
    }
}

fn publish(app: &AppHandle) {
    let _ = app.emit(STATE_EVENT, state());
}

pub fn save_settings(app: &AppHandle, next: RewindSettings) -> Result<RewindState, String> {
    if !supported() && next.enabled {
        return Err("Клипы пока работают только на Windows".into());
    }
    let before = settings::load();
    let stored = settings::store(next)?;
    if capture_changed(&before, &stored) {
        restart_games(app);
    }
    bind_hotkey(app);
    publish(app);
    Ok(state())
}

/// The hotkey is held only while a game records: Alt+F10 is also the default
/// of other recorders, and the launcher must not take it from them for nothing.
fn bind_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let current = settings::load();
    let want = (current.enabled && !active().is_empty()).then(|| current.hotkey.clone());
    let mut bound = BOUND.lock().unwrap_or_else(|e| e.into_inner());
    if *bound == want {
        return;
    }
    let shortcuts = app.global_shortcut();
    if let Some(old) = bound.take() {
        let _ = shortcuts.unregister(old.as_str());
    }
    let mut problem = None;
    if let Some(combo) = want {
        let registered = shortcuts.on_shortcut(combo.as_str(), |app, _, event| {
            if event.state() == ShortcutState::Pressed {
                save_now(app);
            }
        });
        match registered {
            Ok(()) => *bound = Some(combo),
            Err(_) => problem = Some(format!("Сочетание {} занято другой программой — выбери другое", combo)),
        }
    }
    *HOTKEY_PROBLEM.lock().unwrap_or_else(|e| e.into_inner()) = problem;
}

/// Recording of one running game; dropping it stops the capture.
pub struct RewindSession {
    active: Arc<Active>,
    app: AppHandle,
}

impl Drop for RewindSession {
    fn drop(&mut self) {
        #[cfg(windows)]
        self.active.recorder.lock().unwrap_or_else(|e| e.into_inner()).take();
        ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).retain(|w| w.upgrade().is_some_and(|a| !Arc::ptr_eq(&a, &self.active)));
        bind_hotkey(&self.app);
        publish(&self.app);
    }
}

/// A game the launcher is running, recorded or not: switching clips on in the
/// middle of a session has to reach a game that was started with them off.
struct Game {
    pid: u32,
    profile: String,
    notices: Option<Notices>,
    session: Option<RewindSession>,
}

static GAMES: Mutex<Vec<Game>> = Mutex::new(Vec::new());

/// Held by the launch for the whole life of one game; dropping it stops the recording.
pub struct GameGuard {
    pid: u32,
}

impl Drop for GameGuard {
    fn drop(&mut self) {
        let gone: Vec<Game> = {
            let mut games = GAMES.lock().unwrap_or_else(|e| e.into_inner());
            let (gone, keep) = games.drain(..).partition(|g| g.pid == self.pid);
            *games = keep;
            gone
        };
        drop(gone);
    }
}

pub fn game(app: &AppHandle, pid: u32, profile: &str, notices: Option<Notices>) -> GameGuard {
    let session = start(app, pid, profile, notices.clone());
    GAMES.lock().unwrap_or_else(|e| e.into_inner()).push(Game { pid, profile: profile.to_string(), notices, session });
    GameGuard { pid }
}

/// Everything a recording was opened with; the hotkey alone is rebound in place.
fn capture_changed(before: &RewindSettings, after: &RewindSettings) -> bool {
    before.enabled != after.enabled
        || before.seconds != after.seconds
        || before.quality != after.quality
        || before.fps != after.fps
        || before.game_audio != after.game_audio
        || before.mic != after.mic
}

/// Reopens the recording of every running game with the stored settings. The
/// sessions are dropped outside the lock: their drop rebinds the hotkey.
fn restart_games(app: &AppHandle) {
    let old: Vec<RewindSession> = GAMES.lock().unwrap_or_else(|e| e.into_inner()).iter_mut().filter_map(|g| g.session.take()).collect();
    drop(old);
    let running: Vec<(u32, String, Option<Notices>)> =
        GAMES.lock().unwrap_or_else(|e| e.into_inner()).iter().map(|g| (g.pid, g.profile.clone(), g.notices.clone())).collect();
    for (pid, profile, notices) in running {
        let Some(session) = start(app, pid, &profile, notices) else { continue };
        let mut games = GAMES.lock().unwrap_or_else(|e| e.into_inner());
        match games.iter_mut().find(|g| g.pid == pid) {
            Some(game) => game.session = Some(session),
            None => {
                drop(games);
                drop(session);
            }
        }
    }
}

#[cfg(not(windows))]
fn start(_app: &AppHandle, _pid: u32, _profile: &str, _notices: Option<Notices>) -> Option<RewindSession> {
    None
}

#[cfg(windows)]
fn start(app: &AppHandle, pid: u32, profile: &str, notices: Option<Notices>) -> Option<RewindSession> {
    let current = settings::load();
    if !current.enabled {
        return None;
    }
    let cap = current.memory_cap(current.bitrate(2560, 1440));
    let active = Arc::new(Active {
        pid,
        profile: profile.to_string(),
        seconds: current.seconds,
        ring: Arc::new(Mutex::new(ring::Ring::new(current.seconds, cap))),
        recorder: Mutex::new(None),
        notices,
        saving: AtomicBool::new(false),
        status: Mutex::new(Status::default()),
    });
    let reporter = |audio: bool| -> win::Report {
        let weak = Arc::downgrade(&active);
        let app = app.clone();
        Arc::new(move |problem: Option<String>| {
            let Some(active) = weak.upgrade() else { return };
            {
                let mut status = active.status.lock().unwrap_or_else(|e| e.into_inner());
                if audio {
                    status.audio_problem = problem;
                } else {
                    status.recording = problem.is_none();
                    status.video_problem = problem;
                }
            }
            publish(&app);
        })
    };
    let recorder = win::start(pid, current, active.ring.clone(), reporter(false), reporter(true));
    *active.recorder.lock().unwrap_or_else(|e| e.into_inner()) = Some(recorder);
    ACTIVE.lock().unwrap_or_else(|e| e.into_inner()).push(Arc::downgrade(&active));
    bind_hotkey(app);
    publish(app);
    Some(RewindSession { active, app: app.clone() })
}

#[cfg(windows)]
fn target() -> Option<Arc<Active>> {
    let sessions = active();
    let focused = win::foreground_pid();
    sessions.iter().find(|a| Some(a.pid) == focused).cloned().or_else(|| sessions.last().cloned())
}

#[cfg(not(windows))]
fn target() -> Option<Arc<Active>> {
    None
}

fn stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H-%M-%S").to_string()
}

fn now() -> ring::Ticks {
    #[cfg(windows)]
    return win::now();
    #[cfg(not(windows))]
    return 0;
}

/// The hotkey's work: cut the window out of the ring at this instant and write
/// it on a worker thread, so the shortcut handler returns at once.
pub fn save_now(app: &AppHandle) {
    let Some(session) = target() else { return };
    if session.saving.swap(true, Ordering::SeqCst) {
        return;
    }
    let cut = session.ring.lock().unwrap_or_else(|e| e.into_inner()).clip(now());
    let app = app.clone();
    std::thread::spawn(move || {
        let outcome = match cut {
            None => Err(session
                .status
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .video_problem
                .clone()
                .unwrap_or_else(|| "Записи пока нет: окно игры было свёрнуто или только что открылось".into())),
            Some(clip) => clips::save(&clips::folder(), &session.profile, &stamp(), &clip, settings::AUDIO_BITRATE),
        };
        session.saving.store(false, Ordering::SeqCst);
        let saved = match outcome {
            Ok(path) => {
                if let Some(notices) = &session.notices {
                    notices.post(NOTICE_KIND, "Клип сохранён", &format!("Последние {} с · Millida Clips", session.seconds), true);
                }
                ClipSaved {
                    ok: true,
                    name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                    message: "Клип сохранён".into(),
                }
            }
            Err(why) => {
                if let Some(notices) = &session.notices {
                    notices.post(NOTICE_KIND, "Клип не сохранён", &why, false);
                }
                ClipSaved { ok: false, name: String::new(), message: why }
            }
        };
        let _ = app.emit(CLIP_EVENT, saved);
    });
}

pub fn list_clips() -> Vec<ClipFile> {
    clips::list(&clips::folder())
}

pub fn delete_clip(name: &str) -> Result<(), String> {
    clips::delete(&clips::folder(), name)
}

pub fn clip_path(name: &str) -> Result<std::path::PathBuf, String> {
    clips::resolve(&clips::folder(), name)
}

pub fn open_folder() -> Result<(), String> {
    let folder = clips::folder();
    std::fs::create_dir_all(&folder).map_err(|e| format!("Не удалось создать папку клипов: {}", e))?;
    crate::engine::open_path(&folder.to_string_lossy());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn which_changes_reopen_the_recording() {
        let base = RewindSettings { enabled: true, ..Default::default() };
        let cases: [(RewindSettings, bool, &str); 5] = [
            (RewindSettings { hotkey: "Ctrl+7".into(), ..base.clone() }, false, "a new key is rebound in place; reopening would throw away the seconds already kept"),
            (RewindSettings { enabled: false, ..base.clone() }, true, "switched off: the running recording has to stop"),
            (RewindSettings { quality: Quality::P720, ..base.clone() }, true, "the picture size is fixed when the encoder opens"),
            (RewindSettings { fps: 30, ..base.clone() }, true, "the frame rate is fixed when the encoder opens"),
            (RewindSettings { mic: true, ..base.clone() }, true, "the audio sources are chosen when the recording starts"),
        ];
        for (after, want, why) in cases {
            assert_eq!(capture_changed(&base, &after), want, "{}", why);
        }
        let off = RewindSettings { enabled: false, ..Default::default() };
        assert!(capture_changed(&off, &base), "switching clips on during a game must start recording it, not wait for the next launch");
    }
}