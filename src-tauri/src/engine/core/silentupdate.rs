// Quiet installs of an update the core has already downloaded and checked (second review, 27.10.2026, findings С1/С2).
//
// A launcher that lives in the tray and starts with the system is never quit by its player: "Выход" is not pressed, the
// window is never closed with the update banner on it, and an update that waits for one of those waits for weeks. Two
// moments need no consent because nobody is looking:
//  - the tray: the update is on disk and verified, no game runs, nothing downloads or installs, and that has lasted ten
//    minutes. It is installed silently and the new copy comes back to the tray without a window;
//  - the start: the launcher is starting, its window has not been shown, and an update is waiting on disk. Seconds of
//    work now beat living on an old version. Not when the player started the launcher to play (a millida:// link or a
//    `--launch <build>`): those wait for nobody.
// Both stop after two tries at the same version, so an installer that cannot replace the exe (antivirus, a foreign
// folder) does not loop on every start. A patch that did not go in is remembered here, for every caller: the next
// stage takes the full installer.
//
// This module is the policy and the memory of it. The loop that watches the tray lives in background.rs, the start in
// lib.rs; the signature check and the install itself are selfupdate.rs's.
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use super::paths::data_dir;
use super::selfupdate::{self, sig_path, ver_path, Restart};

/// Nothing going on for this long, and the update goes in.
pub(crate) const TRAY_QUIET: Duration = Duration::from_secs(10 * 60);
/// How often the tray looks while an update waits on disk.
pub const TRAY_LOOK: Duration = Duration::from_secs(60);
/// Tries of one version, counted from the quiet installs only.
pub(crate) const MAX_TRIES: u32 = 2;

const STATE_FILE: &str = "silent-update.json";

/// Which version the counters are about. A new version starts from zero.
#[derive(Serialize, Deserialize, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct State {
    version: String,
    #[serde(default)]
    tries: u32,
    /// The patch for this version did not go in: take the installer.
    #[serde(default)]
    delta_bad: bool,
}

fn load_in(dir: &Path, version: &str) -> State {
    let state: State = std::fs::read_to_string(dir.join(STATE_FILE)).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default();
    if state.version == version {
        state
    } else {
        State { version: version.to_string(), ..State::default() }
    }
}

fn save_in(dir: &Path, state: &State) {
    let written = std::fs::create_dir_all(dir).and_then(|_| std::fs::write(dir.join(STATE_FILE), serde_json::to_vec(state).unwrap_or_default()));
    if let Err(e) = written {
        // Not fatal: without the note a failing install is tried once more per start, which two tries per run still bound.
        eprintln!("[update] the install note was not saved: {e}");
    }
}

pub(crate) fn tries_in(dir: &Path, version: &str) -> u32 {
    load_in(dir, version).tries
}

pub(crate) fn note_try_in(dir: &Path, version: &str) {
    let mut state = load_in(dir, version);
    state.tries += 1;
    save_in(dir, &state);
}

pub(crate) fn delta_bad_in(dir: &Path, version: &str) -> bool {
    load_in(dir, version).delta_bad
}

pub(crate) fn mark_delta_bad_in(dir: &Path, version: &str) {
    let mut state = load_in(dir, version);
    state.delta_bad = true;
    save_in(dir, &state);
}

/// The patch for this version was tried and did not go in.
pub(crate) fn delta_bad_for(version: &str) -> bool {
    delta_bad_in(&data_dir(), version)
}

/// A staged patch that could not be put in place: forget it (file, signature, version) so no caller finds it again, and
/// remember the version so the next stage downloads the installer.
pub(crate) fn delta_failed(file: &Path) {
    delta_failed_in(&data_dir(), file);
}

fn delta_failed_in(dir: &Path, file: &Path) {
    let version = std::fs::read_to_string(ver_path(file)).unwrap_or_default();
    let version = version.trim().trim_start_matches('v');
    if !version.is_empty() {
        mark_delta_bad_in(dir, version);
    }
    for path in [file.to_path_buf(), sig_path(file), ver_path(file)] {
        let _ = std::fs::remove_file(path);
    }
}

/// How long nothing has been going on. Fed with the tray's looks: `busy` resets the clock.
#[derive(Debug, Default)]
pub struct Quiet {
    since: Option<Instant>,
}

impl Quiet {
    pub fn look(&mut self, now: Instant, busy: bool) -> Duration {
        if busy {
            self.since = None;
            return Duration::ZERO;
        }
        let since = *self.since.get_or_insert(now);
        now.saturating_duration_since(since)
    }
}

/// What keeps an update from going in right now: a game, a launch on its way, an install or a download of the core's.
pub fn busy_now(staging: bool) -> bool {
    staging || !crate::engine::running_games().is_empty() || crate::engine::launch_underway() || !crate::engine::active_jobs().is_empty()
}

/// The tray's verdict: the update has waited out ten quiet minutes.
pub fn tray_install_due(quiet: Duration, tries: u32) -> bool {
    quiet >= TRAY_QUIET && tries < MAX_TRIES
}

/// What the start knows about itself.
#[derive(Debug, Clone, Copy, Default)]
pub struct StartFacts {
    /// The system started the launcher at login.
    pub by_os: bool,
    pub macos: bool,
    /// The player came to play: a millida:// link or a `--launch`/`--repair` flag.
    pub for_game: bool,
    /// This copy was just started by an update: its window is meant to show.
    pub just_updated: bool,
    pub tries: u32,
}

/// What to do about a waiting update while the launcher starts: `None` = leave it, otherwise how the new copy returns.
pub fn start_install(f: StartFacts) -> Option<Restart> {
    if f.for_game || f.just_updated || f.tries >= MAX_TRIES {
        return None;
    }
    // macOS tells a deep link by an Apple event that arrives after setup, so a double click cannot be told from one:
    // there the start installs only when the system started the launcher.
    if f.macos && !f.by_os {
        return None;
    }
    Some(if f.by_os { Restart::Tray } else { Restart::Show })
}

/// Whether this file can replace the running copy without asking anything or opening anything. A package manager's
/// file, a bundle under Gatekeeper translocation, an exe in a folder the player cannot write all fail the install loudly
/// (a folder opens, an installer window appears), and a quiet install must never do that.
pub(crate) fn can_replace_quietly(file: &Path) -> bool {
    can_replace_quietly_in(std::env::consts::OS, file, std::env::current_exe().ok().as_deref(), std::env::var_os("APPIMAGE").is_some())
}

fn can_replace_quietly_in(os: &str, file: &Path, exe: Option<&Path>, appimage: bool) -> bool {
    let name = file.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    match os {
        "windows" => true,
        "macos" => exe.is_some_and(|e| {
            let text = e.to_string_lossy();
            text.contains(".app/") && !text.contains("/AppTranslocation/")
        }),
        _ => appimage && name.ends_with(".appimage"),
    }
}

/// Installs the staged update now, if there is one that is verified and quiet to put in. Blocking: the signature check
/// reads the whole file. `true` = the installer or the swap is under way and this process must end.
pub fn install_staged_quietly(app: &AppHandle, restart: Restart) -> bool {
    let Some(staged) = selfupdate::staged_update(app) else { return false };
    if !can_replace_quietly(Path::new(&staged.path)) {
        return false;
    }
    let dir = data_dir();
    if tries_in(&dir, &staged.version) >= MAX_TRIES {
        eprintln!("[update] {} was tried {} times already; left for the player", staged.version, MAX_TRIES);
        return false;
    }
    note_try_in(&dir, &staged.version);
    match selfupdate::fallback_run_as(app, &staged.path, restart) {
        Ok(run) => run.started,
        Err(e) => {
            eprintln!("[update] the quiet install of {} did not start: {e}", staged.version);
            false
        }
    }
}

/// How many quiet installs of the waiting update were tried already; `None` = nothing is waiting.
pub fn waiting_tries(app: &AppHandle) -> Option<u32> {
    selfupdate::staged_hint_version(app).map(|version| tries_in(&data_dir(), &version))
}

/// Whether the tray should keep an eye on the disk at all: an update is waiting and its tries are not spent.
pub fn tray_should_watch(app: &AppHandle) -> bool {
    selfupdate::staged_hint_version(app).is_some_and(|version| tries_in(&data_dir(), &version) < MAX_TRIES)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("millida-silent-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// The tray installs after ten quiet minutes and not a second earlier; any activity starts the count over.
    #[test]
    fn the_tray_waits_ten_quiet_minutes_and_any_activity_restarts_the_count() {
        let mut quiet = Quiet::default();
        let t0 = Instant::now();
        let at = |min: u64| t0 + Duration::from_secs(min * 60);
        assert_eq!(quiet.look(at(0), false), Duration::ZERO, "the first quiet look starts the clock");
        assert!(!tray_install_due(quiet.look(at(9), false), 0), "nine minutes is not enough");
        assert!(tray_install_due(quiet.look(at(10), false), 0), "ten quiet minutes is");
        assert_eq!(quiet.look(at(11), true), Duration::ZERO, "a game, a launch or a download wipes the count");
        assert!(!tray_install_due(quiet.look(at(20), false), 0), "the clock restarts from the first quiet look after the work");
        assert!(tray_install_due(quiet.look(at(30), false), 0));
    }

    #[test]
    fn a_version_tried_twice_is_left_alone() {
        assert!(tray_install_due(TRAY_QUIET, 0));
        assert!(tray_install_due(TRAY_QUIET, MAX_TRIES - 1));
        assert!(!tray_install_due(TRAY_QUIET, MAX_TRIES), "an installer that cannot replace the exe must not loop");
        assert!(!tray_install_due(Duration::from_secs(10 * 60 - 1), 0));
    }

    /// facts -> what the start does with a waiting update.
    #[test]
    fn the_start_installs_a_waiting_update_unless_the_player_came_to_play() {
        let plain = StartFacts::default();
        assert_eq!(start_install(plain), Some(Restart::Show), "a double click: the window comes back after the update");
        assert_eq!(start_install(StartFacts { by_os: true, ..plain }), Some(Restart::Tray), "at login: back to the tray, no window");
        assert_eq!(start_install(StartFacts { for_game: true, ..plain }), None, "a millida:// link or --launch waits for nobody");
        assert_eq!(start_install(StartFacts { for_game: true, by_os: true, ..plain }), None);
        assert_eq!(start_install(StartFacts { just_updated: true, ..plain }), None, "the copy an update just started keeps its window");
        assert_eq!(start_install(StartFacts { tries: MAX_TRIES, ..plain }), None, "two tries and no more");
        assert_eq!(start_install(StartFacts { tries: MAX_TRIES - 1, ..plain }), Some(Restart::Show));
        assert_eq!(start_install(StartFacts { macos: true, ..plain }), None, "a mac double click may be a link we cannot see yet");
        assert_eq!(start_install(StartFacts { macos: true, by_os: true, ..plain }), Some(Restart::Tray));
    }

    /// What can be replaced without a sound: only files whose install does not open a folder or an installer window.
    #[test]
    fn only_in_place_replacements_are_quiet() {
        let exe = |p: &str| Some(Path::new(p).to_path_buf());
        let setup = Path::new("Millida-Launcher_2.0.9_x64-setup.exe");
        assert!(can_replace_quietly_in("windows", setup, None, false));
        assert!(can_replace_quietly_in("windows", Path::new("millida-launcher-2.0.9.delta.exe"), None, false));
        let bundle = exe("/Applications/Millida.app/Contents/MacOS/millida-launcher");
        assert!(can_replace_quietly_in("macos", Path::new("Millida.app.tar.gz"), bundle.as_deref(), false));
        let translocated = exe("/private/var/folders/x/AppTranslocation/ABC/d/Millida.app/Contents/MacOS/millida-launcher");
        assert!(!can_replace_quietly_in("macos", Path::new("Millida.app.tar.gz"), translocated.as_deref(), false), "Gatekeeper's throwaway copy");
        assert!(!can_replace_quietly_in("macos", Path::new("Millida.app.tar.gz"), exe("/tmp/millida-launcher").as_deref(), false), "not run from a bundle");
        assert!(can_replace_quietly_in("linux", Path::new("Millida-Launcher.AppImage"), None, true));
        assert!(!can_replace_quietly_in("linux", Path::new("Millida-Launcher.AppImage"), None, false), "not run as an AppImage");
        assert!(!can_replace_quietly_in("linux", Path::new("Millida-Launcher_2.0.9_amd64.deb"), None, true), "a package needs the package manager");
    }

    /// The notes live per version: the counters of an old version never block a new one.
    #[test]
    fn tries_and_the_failed_patch_are_remembered_per_version() {
        let dir = scratch("state");
        assert_eq!(tries_in(&dir, "2.0.9"), 0);
        note_try_in(&dir, "2.0.9");
        note_try_in(&dir, "2.0.9");
        assert_eq!(tries_in(&dir, "2.0.9"), 2);
        assert_eq!(tries_in(&dir, "2.0.10"), 0, "a newer release starts clean");
        assert!(!delta_bad_in(&dir, "2.0.9"));
        mark_delta_bad_in(&dir, "2.0.9");
        assert!(delta_bad_in(&dir, "2.0.9"));
        assert_eq!(tries_in(&dir, "2.0.9"), 2, "marking the patch keeps the tries");
        assert!(!delta_bad_in(&dir, "2.0.10"));
        // the next version's note replaces the old one, as the counters are only about the version in the way
        note_try_in(&dir, "2.0.10");
        assert_eq!(tries_in(&dir, "2.0.9"), 0);
        std::fs::write(dir.join(STATE_FILE), "{ not json").unwrap();
        assert_eq!(tries_in(&dir, "2.0.10"), 0, "a damaged note is no note");
    }

    /// A patch that failed to go in leaves nothing behind that a later caller could pick up again, and its version is
    /// marked so the next stage takes the installer.
    #[test]
    fn a_failed_patch_is_forgotten_with_its_sidecars_and_its_version_is_marked() {
        let dir = scratch("failed");
        let file = dir.join("millida-launcher-2.0.9.delta.exe");
        std::fs::write(&file, b"exe").unwrap();
        std::fs::write(sig_path(&file), b"sig").unwrap();
        std::fs::write(ver_path(&file), b"2.0.9\n").unwrap();
        delta_failed_in(&dir, &file);
        assert!(!file.exists() && !sig_path(&file).exists() && !ver_path(&file).exists());
        assert!(delta_bad_in(&dir, "2.0.9"));
        assert!(!delta_bad_in(&dir, "2.0.10"));
        // no version file: nothing to mark, the files still go
        let lone = dir.join("millida-launcher-2.0.11.delta.exe");
        std::fs::write(&lone, b"exe").unwrap();
        delta_failed_in(&dir, &lone);
        assert!(!lone.exists());
    }
}
