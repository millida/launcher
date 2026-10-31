// The launcher is starting and an update it already downloaded and checked waits on disk (second review, 27.10.2026,
// finding С1). Installing it now takes seconds, with no network, before the window has been shown; living on the old
// version until the player happens to press «Выход» took weeks for anyone who keeps the launcher in the tray.
//
// Not when the player came to play (a millida:// link, `--launch`, `--repair`): that start waits for nobody. Not for the
// copy an update has just started, not in a debug build, and not after two tries at the same version (silentupdate.rs).
// A start at login comes back to the tray; any other start comes back with its window.
use tauri::{AppHandle, Manager};

/// The start was for a game: a deep link, or a flag that launches or repairs a build.
fn for_game(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with("millida:")) || crate::cli::parse(args).is_some()
}

/// Called once from `setup`. Hides the window at once when an install is going to be tried, so nothing flashes before
/// the process ends; shows it again if the install did not start.
pub fn run(app: &AppHandle, just_updated: bool) {
    if cfg!(debug_assertions) {
        return;
    }
    let Some(tries) = crate::engine::waiting_tries(app) else { return };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let by_os = crate::commands::system::started_by_os();
    let facts = crate::engine::StartFacts { by_os, macos: cfg!(target_os = "macos"), for_game: for_game(&args), just_updated, tries };
    let Some(restart) = crate::engine::start_install(facts) else { return };
    if let Some(w) = app.get_webview_window(crate::background::MAIN) {
        let _ = w.hide();
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let probe = app.clone();
        // The signature check reads the whole installer: not on the event thread.
        let started = tauri::async_runtime::spawn_blocking(move || crate::engine::install_staged_quietly(&probe, restart)).await;
        if started.as_ref().is_ok_and(|s| *s) {
            crate::background::send_perf(&app, vec![crate::background::install_event("start", 0)]);
            crate::mark_exiting();
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            app.exit(0);
            return;
        }
        if let Err(e) = started {
            eprintln!("[update] the install at start was interrupted: {e}");
        }
        // Started at login the window was meant to stay hidden anyway; otherwise the player is waiting for it.
        if !by_os {
            let h = app.clone();
            let queued = app.run_on_main_thread(move || crate::tray::show_main(&h));
            if let Err(e) = queued {
                eprintln!("[update] the window was not shown after the install did not start: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// args -> did the player come to play.
    #[test]
    fn a_link_or_a_launch_flag_is_a_start_for_a_game() {
        assert!(for_game(&args(&["millida://join/abc"])));
        assert!(for_game(&args(&["--autostart", "millida://pack/x"])));
        assert!(for_game(&args(&["--launch", "My pack"])));
        assert!(for_game(&args(&["--repair=Survival"])));
        assert!(!for_game(&args(&[])));
        assert!(!for_game(&args(&["--autostart"])), "a start at login is not for a game");
        assert!(!for_game(&args(&["--launch"])), "a flag without a build does nothing, so it is not a game either");
    }
}
