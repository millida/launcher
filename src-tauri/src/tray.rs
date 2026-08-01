use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

/// The tray icon can fail to appear (e.g. Linux without appindicator); hiding
/// the window is gated on this flag and falls back to minimizing.
static READY: AtomicBool = AtomicBool::new(false);

pub fn available() -> bool { READY.load(Ordering::Relaxed) }

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Restoring after the game is driven by the webview, which can miss the event
/// while hidden; the native side repeats it as a safety net.
static RESTORE_ON_EXIT: AtomicBool = AtomicBool::new(true);

pub fn set_restore_on_exit(on: bool) { RESTORE_ON_EXIT.store(on, Ordering::Relaxed); }

pub fn restore_after_game(app: &AppHandle) {
    if !RESTORE_ON_EXIT.load(Ordering::Relaxed) {
        return;
    }
    if let Some(w) = app.get_webview_window("main") {
        let away = !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false);
        if away {
            show_main(app);
        }
    }
}

pub fn hide_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if available() { let _ = w.hide(); } else { let _ = w.minimize(); }
    }
}

/// Quit is delegated to the frontend, which applies a staged update on close;
/// if the webview does not answer in time we exit anyway.
fn quit(app: &AppHandle) {
    let _ = app.emit("tray-exit", ());
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        h.exit(0);
    });
}

pub fn init(app: &AppHandle) {
    let items = (
        MenuItem::with_id(app, "tray-open", "Открыть лаунчер", true, None::<&str>),
        MenuItem::with_id(app, "tray-quit", "Выход", true, None::<&str>),
    );
    let (open, exit) = match items {
        (Ok(o), Ok(e)) => (o, e),
        _ => return,
    };
    let menu = match Menu::with_items(app, &[&open, &exit]) {
        Ok(m) => m,
        Err(_) => return,
    };
    let mut b = TrayIconBuilder::with_id("main")
        .tooltip("Millida Launcher")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "tray-open" => show_main(app),
            "tray-quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        b = b.icon(icon);
    }
    if b.build(app).is_ok() {
        READY.store(true, Ordering::Relaxed);
    }
}
