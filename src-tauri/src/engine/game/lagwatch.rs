//! Core side of the lag helper. The mod reports frames and memory every five
//! seconds over the media socket; this module adds whether the game window was
//! the one in front and hands the report to the interface, which judges it.
//! The advice travels back into the game as an island notice.

use super::now_playing::{Notices, PerfSample, PerfSink};
use serde::Serialize;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

pub const PERF_EVENT: &str = "game-perf";
const NOTICE_KIND: &str = "perf";
const MAX_NOTICE_CHARS: usize = 120;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GamePerf {
    profile: String,
    /// The window was in front: a game behind a browser draws as slowly as
    /// the system lets it, and that is not lag.
    focused: bool,
    #[serde(flatten)]
    sample: PerfSample,
}

struct Registered {
    profile: String,
    pid: u32,
    notices: Notices,
}

static GAMES: Mutex<Vec<Registered>> = Mutex::new(Vec::new());

/// The mod reports frames this often (see the module comment).
const SECONDS_PER_SAMPLE: u32 = 5;
/// Twelve hours of reports; a longer session keeps its first twelve.
const MAX_SESSION_SAMPLES: usize = 12 * 60 * 60 / SECONDS_PER_SAMPLE as usize;

/// Lives as long as one game process; dropping it forgets the game.
pub struct LagWatch {
    profile: String,
    pid: Arc<AtomicU32>,
    /// Frame reports of this session for the average shown after the game.
    /// Counted here, in the core: the interface may be unloaded while the game runs.
    frames: Arc<Mutex<Vec<u32>>>,
}

/// A report counts toward the session's FPS only when it shows the player's
/// game: in a world, window in front and not slowed down on purpose.
fn counts_for_session(focused: bool, sample: &PerfSample) -> bool {
    focused && sample.world && !sample.throttled && sample.fps > 0
}

impl LagWatch {
    /// The sink is created before the game starts, so it learns the process id later, from `bind`.
    pub fn new(app: &AppHandle, profile: &str) -> (LagWatch, PerfSink) {
        let pid = Arc::new(AtomicU32::new(0));
        let seen = pid.clone();
        let frames = Arc::new(Mutex::new(Vec::new()));
        let tally = frames.clone();
        let app = app.clone();
        let name = profile.to_string();
        let sink: PerfSink = Arc::new(move |sample: PerfSample| {
            let focused = window_in_front(seen.load(Ordering::Relaxed));
            if counts_for_session(focused, &sample) {
                let mut list = tally.lock().unwrap_or_else(|e| e.into_inner());
                if list.len() < MAX_SESSION_SAMPLES {
                    list.push(sample.fps);
                }
            }
            crate::background::emit_main(&app, PERF_EVENT, GamePerf { profile: name.clone(), focused, sample });
        });
        (LagWatch { profile: profile.to_string(), pid, frames }, sink)
    }

    pub fn bind(&self, pid: u32, notices: Option<Notices>) {
        self.pid.store(pid, Ordering::Relaxed);
        let Some(notices) = notices else { return };
        let mut games = GAMES.lock().unwrap_or_else(|e| e.into_inner());
        games.retain(|g| g.profile != self.profile);
        games.push(Registered { profile: self.profile.clone(), pid, notices });
    }
}

impl Drop for LagWatch {
    fn drop(&mut self) {
        let frames = std::mem::take(&mut *self.frames.lock().unwrap_or_else(|e| e.into_inner()));
        super::presets::record_session_fps(&self.profile, &frames, SECONDS_PER_SAMPLE);
        let pid = self.pid.load(Ordering::Relaxed);
        GAMES
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|g| !(g.profile == self.profile && g.pid == pid));
    }
}

fn clip(text: &str) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(MAX_NOTICE_CHARS).collect()
}

/// Shows the helper's advice on the island of the running game of `profile`.
/// False when that game has no connected mod to show it.
pub fn post_game_notice(profile: &str, title: &str, detail: &str) -> bool {
    let title = clip(title);
    if title.is_empty() {
        return false;
    }
    let games = GAMES.lock().unwrap_or_else(|e| e.into_inner());
    let Some(game) = games.iter().find(|g| g.profile == profile) else { return false };
    game.notices.post(NOTICE_KIND, &title, &clip(detail), false)
}

#[cfg(windows)]
fn window_in_front(pid: u32) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    if pid == 0 {
        return true;
    }
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_null() {
        return true;
    }
    let mut owner = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut owner) };
    owner == 0 || owner == pid
}

#[cfg(not(windows))]
fn window_in_front(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Text from the interface -> what reaches the island. The island has one
    /// line per field; control characters would break its layout.
    #[test]
    fn notice_text_is_one_short_line() {
        let cases: [(&str, &str, &str); 3] = [
            ("  Мало FPS  ", "Мало FPS", "padding is trimmed"),
            ("a\nb\tc", "abc", "control characters never reach the island"),
            (&"x".repeat(500), &"x".repeat(MAX_NOTICE_CHARS), "long advice is cut, not rejected"),
        ];
        for (input, want, why) in cases {
            assert_eq!(clip(input), want, "{why}");
        }
    }

    /// (focused, in a world, throttled, fps) -> counted. A menu, a game behind a
    /// browser or Dynamic FPS idling would drag the session average down.
    #[test]
    fn only_frames_of_the_game_being_played_count() {
        let sample = |world: bool, throttled: bool, fps: u32| PerfSample { fps, world, throttled, heap_mb: 0, max_mb: 0, gc_pct: -1 };
        let cases: [(bool, bool, bool, u32, bool, &str); 5] = [
            (true, true, false, 80, true, "playing in a world"),
            (false, true, false, 80, false, "window behind another one"),
            (true, false, false, 300, false, "main menu"),
            (true, true, true, 5, false, "slowed down on purpose"),
            (true, true, false, 0, false, "an empty report"),
        ];
        for (focused, world, throttled, fps, want, why) in cases {
            assert_eq!(counts_for_session(focused, &sample(world, throttled, fps)), want, "{why}");
        }
    }

    #[test]
    fn a_profile_without_a_game_gets_no_notice() {
        assert!(!post_game_notice("\u{0}no-such-build", "Лагает", ""), "advice for a closed game must report that nobody saw it");
    }
}
