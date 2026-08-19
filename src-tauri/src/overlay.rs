use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// A separate always-on-top window, not a Minecraft mod: the launcher blocks
/// `-javaagent` on purpose (launch.rs), and one window works for every loader
/// and every game version instead of a client mod per pair.
pub const LABEL: &str = "overlay";

const PREF_ENABLED: &str = "overlay-enabled";
const PREF_HOTKEY: &str = "overlay-hotkey";
const PREF_TOASTS: &str = "overlay-toasts";
pub const DEFAULT_HOTKEY: &str = "Alt+M";

/// Cards the webview could not receive yet: a window that has just been created
/// has no listener, and an event emitted into that gap is lost for good - the
/// overlay would then stay on screen full-size with nothing to show.
static PENDING: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());
static INTERACTIVE: AtomicBool = AtomicBool::new(false);
static NOTIFY_SEQ: AtomicU64 = AtomicU64::new(0);

/// Longest a passive card may keep the window up: the frontend hides it earlier
/// on its own, this only catches a webview that never answered.
const PASSIVE_MAX_MS: u64 = 15_000;

pub fn enabled() -> bool {
    crate::engine::ui_pref(PREF_ENABLED).as_deref() == Some("1")
}

/// Desktop toasts are on unless the user turned them off: they are the only way
/// a friend event reaches someone whose launcher sits in the tray.
pub fn toasts_enabled() -> bool {
    crate::engine::ui_pref(PREF_TOASTS).as_deref() != Some("0")
}

pub fn hotkey() -> String {
    crate::engine::ui_pref(PREF_HOTKEY)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
}

/// The bool says whether the window had to be created: a webview that only just
/// started has no listener yet, so the first event has to wait for it.
fn build(app: &AppHandle) -> Result<(tauri::WebviewWindow, bool), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok((w, false));
    }
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#overlay".into()))
        .title("Millida Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    if let Ok(Some(mon)) = win.primary_monitor() {
        let _ = win.set_position(mon.position().to_owned());
        let _ = win.set_size(mon.size().to_owned());
    }
    // Passive by default: the overlay must not eat clicks meant for the game.
    let _ = win.set_ignore_cursor_events(true);
    let handle = app.clone();
    win.on_window_event(move |e| {
        // Closing the overlay must never take the launcher down with it.
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            if let Some(w) = handle.get_webview_window(LABEL) {
                let _ = w.hide();
            }
        }
    });
    Ok((win, true))
}

/// `interactive` decides whether the window takes the pointer and the keyboard.
/// Notifications arrive passive; the hotkey is what makes it a chat.
pub fn show(app: &AppHandle, interactive: bool) -> Result<bool, String> {
    let (win, fresh) = build(app)?;
    INTERACTIVE.store(interactive, Ordering::SeqCst);
    let _ = win.set_ignore_cursor_events(!interactive);
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);
    if interactive {
        let _ = win.set_focus();
    }
    let _ = app.emit_to(LABEL, "overlay-mode", interactive);
    Ok(fresh)
}

pub fn hide(app: &AppHandle) {
    INTERACTIVE.store(false, Ordering::SeqCst);
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).clear();
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// The webview reports itself ready, and everything queued while it was booting
/// is delivered in order.
pub fn drain_pending(app: &AppHandle) {
    let queued: Vec<serde_json::Value> =
        std::mem::take(&mut *PENDING.lock().unwrap_or_else(|e| e.into_inner()));
    for payload in queued {
        let _ = app.emit_to(LABEL, "overlay-message", payload);
    }
}

/// A passive overlay outliving its cards is a full-screen always-on-top layer
/// the user cannot close, so the core takes it down even if the webview is dead.
fn arm_watchdog(app: &AppHandle) {
    let seq = NOTIFY_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(PASSIVE_MAX_MS)).await;
        if NOTIFY_SEQ.load(Ordering::SeqCst) != seq || INTERACTIVE.load(Ordering::SeqCst) {
            return;
        }
        hide(&handle);
    });
}

pub async fn notify(app: &AppHandle, payload: serde_json::Value) -> Result<(), String> {
    let fresh = show(app, false)?;
    arm_watchdog(app);
    if fresh {
        PENDING.lock().unwrap_or_else(|e| e.into_inner()).push(payload);
        return Ok(());
    }
    app.emit_to(LABEL, "overlay-message", payload).map_err(|e| e.to_string())
}

/// Rebinding drops the previous accelerator first: a changed hotkey that left
/// the old one registered would fire the overlay from two keys forever.
pub fn rebind_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !enabled() {
        return;
    }
    let combo = hotkey();
    let handle = app.clone();
    if gs
        .on_shortcut(combo.as_str(), move |_, _, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                toggle(&handle);
            }
        })
        .is_err()
    {
        // A combination another program already owns must not silently disable
        // the feature: fall back to the default one.
        let _ = gs.on_shortcut(DEFAULT_HOTKEY, move |app, _, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                toggle(app);
            }
        });
    }
}

/// Hotkey semantics: summon and focus, or dismiss if it already has the user.
pub fn toggle(app: &AppHandle) {
    if !enabled() {
        return;
    }
    let interactive_now = app
        .get_webview_window(LABEL)
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    if interactive_now {
        hide(app);
    } else {
        let _ = show(app, true);
    }
}
