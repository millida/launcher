use crate::engine::rewind::{self, ClipFile, RewindSettings, RewindState};

#[tauri::command]
pub async fn rewind_state() -> Result<RewindState, String> {
    super::blocking(rewind::state).await
}

#[tauri::command]
pub async fn rewind_set_settings(app: tauri::AppHandle, settings: RewindSettings) -> Result<RewindState, String> {
    super::blocking(move || rewind::save_settings(&app, settings)).await?
}

/// Clips are the only files outside the launcher's folders the webview plays,
/// and the grant is per file, the same as for screenshots.
#[tauri::command]
pub async fn rewind_clips(app: tauri::AppHandle) -> Result<Vec<ClipFile>, String> {
    use tauri::Manager;
    let clips = super::blocking(rewind::list_clips).await?;
    let scope = app.asset_protocol_scope();
    for clip in &clips {
        let _ = scope.allow_file(&clip.path);
    }
    Ok(clips)
}

#[tauri::command]
pub async fn rewind_delete_clip(name: String) -> Result<(), String> {
    super::blocking(move || rewind::delete_clip(&name)).await?
}

#[tauri::command]
pub async fn rewind_open_folder() -> Result<(), String> {
    super::blocking(rewind::open_folder).await?
}

#[tauri::command]
pub async fn rewind_reveal_clip(name: String) -> Result<(), String> {
    let path = super::blocking(move || rewind::clip_path(&name)).await??;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| format!("Не удалось открыть папку: {}", e))
}
