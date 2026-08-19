use crate::overlay;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    pub enabled: bool,
    pub toasts: bool,
    pub hotkey: String,
}

#[tauri::command]
pub fn overlay_state() -> OverlayState {
    OverlayState { enabled: overlay::enabled(), toasts: overlay::toasts_enabled(), hotkey: overlay::hotkey() }
}

#[tauri::command]
pub fn overlay_set_enabled(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    crate::engine::set_ui_pref("overlay-enabled".into(), if on { "1".into() } else { "0".into() })?;
    if on {
        overlay::show(&app, false)?;
        overlay::hide(&app);
    } else {
        overlay::hide(&app);
    }
    overlay::rebind_hotkey(&app);
    Ok(())
}

#[tauri::command]
pub fn overlay_set_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    crate::engine::set_ui_pref("overlay-hotkey".into(), hotkey)?;
    overlay::rebind_hotkey(&app);
    Ok(())
}

/// Called by the main window when a message arrives while a game is running:
/// the overlay stays passive so the click lands in Minecraft, not in the card.
#[tauri::command]
pub async fn overlay_notify(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    if !overlay::enabled() {
        return Ok(());
    }
    overlay::notify(&app, payload).await
}

#[tauri::command]
pub fn overlay_set_toasts(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    crate::engine::set_ui_pref("overlay-toasts".into(), if on { "1".into() } else { "0".into() })?;
    if !on {
        overlay::hide(&app);
    }
    Ok(())
}

/// Friend presence and messages while the launcher is not the focused window.
/// Unlike `overlay_notify` this does not need the in-game overlay: the card is a
/// desktop toast and must work with no game running at all.
#[tauri::command]
pub async fn overlay_toast(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    if !overlay::toasts_enabled() {
        return Ok(());
    }
    overlay::notify(&app, payload).await
}

#[tauri::command]
pub fn overlay_hide(app: tauri::AppHandle) {
    overlay::hide(&app);
}

/// The overlay webview says it is listening. Anything queued while it was
/// starting is only delivered now: an event sent into the gap before this is
/// lost, and the window would hang on screen with nothing on it.
#[tauri::command]
pub fn overlay_ready(app: tauri::AppHandle) {
    overlay::drain_pending(&app);
}
