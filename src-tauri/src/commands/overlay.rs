use crate::overlay;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayState {
    pub enabled: bool,
    pub hotkey: String,
}

#[tauri::command]
pub fn overlay_state() -> OverlayState {
    OverlayState { enabled: overlay::enabled(), hotkey: overlay::hotkey() }
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
pub fn overlay_hide(app: tauri::AppHandle) {
    overlay::hide(&app);
}
