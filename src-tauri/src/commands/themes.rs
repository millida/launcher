use crate::engine;

use super::blocking;

#[tauri::command]
pub async fn list_themes() -> Result<Vec<engine::InstalledTheme>, String> {
    blocking(engine::list_themes).await
}

#[tauri::command]
pub async fn read_theme(id: String) -> Result<engine::ThemeSource, String> {
    blocking(move || engine::read_theme(&id)).await?
}

#[tauri::command]
pub async fn delete_theme(id: String) -> Result<(), String> {
    blocking(move || engine::delete_theme(&id)).await?
}

#[tauri::command]
pub fn open_themes_folder() {
    engine::open_themes_folder();
}

/// The archive is chosen natively: an <input type=file> aborts WKWebView, and
/// letting the webview hand over a path would make the command take one.
#[tauri::command]
pub async fn import_theme(app: tauri::AppHandle) -> Result<Option<engine::InstalledTheme>, String> {
    let picked = blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Тема лаунчера", &["zip", "mtheme"])
            .set_title("Тема оформления")
            .pick_file()
    })
    .await?;
    let Some(path) = picked else { return Ok(None) };
    let installed = blocking(move || engine::install_theme_from(&path)).await??;
    // A freshly created themes directory is outside the asset scope granted at
    // startup, so its images would not load until the next launch.
    crate::allow_assets(&app);
    Ok(Some(installed))
}
