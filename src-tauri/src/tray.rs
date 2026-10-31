// Tray icon: open, play the last build, quit; while the window is unloaded it is all that is left
// of the launcher on screen (background.rs). No network; reads the last build's name from ui-prefs.json.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The tray icon can fail to appear (e.g. Linux without appindicator); hiding
/// the window is gated on this flag and falls back to minimizing.
static READY: AtomicBool = AtomicBool::new(false);

pub fn available() -> bool { READY.load(Ordering::Relaxed) }

struct Items {
    open: MenuItem<Wry>,
    play: MenuItem<Wry>,
    exit: MenuItem<Wry>,
}

static ITEMS: OnceLock<Items> = OnceLock::new();
static TRAY: OnceLock<tauri::tray::TrayIcon<Wry>> = OnceLock::new();
/// What the core is waiting for before the window can go (background::park).
static STATUS: std::sync::Mutex<Option<&'static str>> = std::sync::Mutex::new(None);
static UPDATE: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// The build «Играть» starts: the one the player launched last (the page writes it).
pub const LAST_BUILD_PREF: &str = "tray-last-build";
const MAX_LABEL_CHARS: usize = 32;

fn last_build() -> Option<String> {
    crate::engine::ui_pref(LAST_BUILD_PREF).map(|b| b.trim().to_string()).filter(|b| !b.is_empty())
}

fn short(name: &str) -> String {
    if name.chars().count() <= MAX_LABEL_CHARS {
        return name.to_string();
    }
    let cut: String = name.chars().take(MAX_LABEL_CHARS - 1).collect();
    format!("{cut}…")
}

fn play_label(build: Option<&str>) -> String {
    match build {
        Some(b) => format!("{}: {}", crate::engine::ui("Играть"), short(b)),
        None => crate::engine::ui("Играть последней сборкой"),
    }
}

pub fn relabel() {
    if let Some(items) = ITEMS.get() {
        let status = *STATUS.lock().unwrap_or_else(|e| e.into_inner());
        let open = match status {
            Some(s) => format!("{} — {}", crate::engine::ui("Открыть лаунчер"), crate::engine::ui(s)),
            None => crate::engine::ui("Открыть лаунчер"),
        };
        let _ = items.open.set_text(open);
        let build = last_build();
        let _ = items.play.set_text(play_label(build.as_deref()));
        let _ = items.play.set_enabled(build.is_some());
        let _ = items.exit.set_text(crate::engine::ui("Выход"));
    }
    if let Some(tray) = TRAY.get() {
        let status = *STATUS.lock().unwrap_or_else(|e| e.into_inner());
        let update = UPDATE.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut tip = "Millida Launcher".to_string();
        if let Some(s) = status {
            tip = format!("{tip} — {}", crate::engine::ui(s));
        } else if let Some(v) = update {
            tip = format!("{tip} — {} {v}", crate::engine::ui("Вышло обновление лаунчера"));
        }
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// «Скачивается…» while the window waits to be unloaded; None clears it.
pub fn set_status(status: Option<&'static str>) {
    *STATUS.lock().unwrap_or_else(|e| e.into_inner()) = status;
    relabel();
}

pub fn set_update(version: Option<&str>) {
    *UPDATE.lock().unwrap_or_else(|e| e.into_inner()) = version.map(str::to_string);
    relabel();
}

/// The page launched a build: it becomes the tray's «Играть».
pub fn set_last_build(build: &str) -> Result<(), String> {
    let name = build.trim();
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("bad build".into());
    }
    crate::engine::set_ui_pref(LAST_BUILD_PREF.to_string(), name.to_string())?;
    relabel();
    Ok(())
}

fn play_last(app: &AppHandle) {
    let Some(build) = last_build() else {
        show_main(app);
        return;
    };
    // The launch itself (account, auth, freshening the pack) lives in the page,
    // so the window comes back for it and leaves again once the game is up.
    crate::cli::queue_launch(app, build);
    show_main(app);
}

pub fn show_main(app: &AppHandle) {
    if crate::exiting() {
        return;
    }
    if app.get_webview_window("main").is_none() {
        crate::background::reopen(app);
        return;
    }
    crate::background::unpark(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        // Windows refuses to raise a window for a process that does not own the
        // foreground: show() succeeds, the window stays behind everything else,
        // and the tray icon reads as dead. Pinning it on top for the length of
        // the focus call is the documented way around that restriction.
        let pinned = w.is_always_on_top().unwrap_or(false);
        if !pinned {
            let _ = w.set_always_on_top(true);
        }
        let _ = w.set_focus();
        if !pinned {
            let _ = w.set_always_on_top(false);
        }
        let _ = app.emit("window-visibility", true);
    }
}

/// Restoring after the game is driven by the webview, which can miss the event
/// while hidden; the native side repeats it as a safety net.
static RESTORE_ON_EXIT: AtomicBool = AtomicBool::new(true);

pub fn set_restore_on_exit(on: bool) { RESTORE_ON_EXIT.store(on, Ordering::Relaxed); }

pub fn restore_after_game(app: &AppHandle) {
    if !RESTORE_ON_EXIT.load(Ordering::Relaxed) || crate::exiting() {
        return;
    }
    match app.get_webview_window("main") {
        // Unloaded for the game: the window is rebuilt for the lobby.
        None => show_main(app),
        Some(w) => {
            let away = !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false);
            if away {
                show_main(app);
            }
        }
    }
}

/// An unloaded window is not visible: the page that asks is a fresh one anyway.
pub fn main_visible(app: &AppHandle) -> bool {
    !crate::background::unloaded() && app.get_webview_window("main").is_some_and(|w| w.is_visible().unwrap_or(true))
}

pub fn hide_main(app: &AppHandle) {
    if crate::exiting() {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        if available() { let _ = w.hide(); } else { let _ = w.minimize(); }
        let _ = app.emit("window-visibility", false);
    }
}

/// Quit is delegated to the frontend, which applies a staged update on close;
/// if the webview does not answer in time we exit anyway.
fn quit(app: &AppHandle) {
    if crate::exiting() {
        return;
    }
    // No page to apply a staged update or flush its queue. The update the core holds on disk goes
    // in now (it lived in the window's memory and was lost with the window before), then we leave.
    // A parked window whose page was put to sleep is no better than none: the event below would reach nobody,
    // and the core exits 1.5 s later with the update still on disk.
    if crate::background::unloaded() || crate::background::page_asleep() || app.get_webview_window("main").is_none() {
        crate::mark_exiting();
        let h = app.clone();
        tauri::async_runtime::spawn(async move {
            let probe = h.clone();
            // Checking the file's signature reads the whole installer: not on the event thread.
            let started = tauri::async_runtime::spawn_blocking(move || crate::engine::install_staged_on_exit(&probe)).await;
            if let Err(e) = started {
                eprintln!("[tray] the staged update check was interrupted: {e}");
            }
            h.exit(0);
        });
        return;
    }
    let _ = app.emit("tray-exit", ());
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        // Интерфейс уже закрыл приложение сам (или ставит обновление): второй
        // выход уходит в разрушенный цикл событий и роняет tao.
        if !crate::exiting() {
            crate::mark_exiting();
            h.exit(0);
        }
    });
}

pub fn init(app: &AppHandle) {
    let build = last_build();
    let items = (
        MenuItem::with_id(app, "tray-open", crate::engine::ui("Открыть лаунчер"), true, None::<&str>),
        MenuItem::with_id(app, "tray-play", play_label(build.as_deref()), build.is_some(), None::<&str>),
        MenuItem::with_id(app, "tray-quit", crate::engine::ui("Выход"), true, None::<&str>),
    );
    let (open, play, exit) = match items {
        (Ok(o), Ok(p), Ok(e)) => (o, p, e),
        _ => return,
    };
    let Ok(sep) = PredefinedMenuItem::separator(app) else { return };
    let menu = match Menu::with_items(app, &[&open, &play, &sep, &exit]) {
        Ok(m) => m,
        Err(_) => return,
    };
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("Millida Launcher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "tray-open" => show_main(app),
            "tray-play" => play_last(app),
            "tray-quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            // Двойной клик по значку — привычка из других программ, и без него
            // часть попыток открыть лаунчер просто пропадала.
            match e {
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
                | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                    show_main(tray.app_handle());
                }
                // The pointer on the icon or the menu opening: «Играть» is one click away, so the
                // last build is prepared now (at most once in ten minutes, nothing downloaded).
                TrayIconEvent::Enter { .. } | TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Down, .. } => {
                    if let Some(build) = last_build() {
                        crate::engine::warm_in_background(tray.app_handle(), build);
                    }
                }
                _ => {}
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        b = b.icon(icon);
    }
    if let Ok(tray) = b.build(app) {
        let _ = ITEMS.set(Items { open, play, exit });
        let _ = TRAY.set(tray);
        READY.store(true, Ordering::Relaxed);
    }
}
