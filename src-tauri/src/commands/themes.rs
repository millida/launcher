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

/// Saving is native for the same reason importing is: the webview names the
/// theme, the dialog names the file, and the command never takes a path.
#[tauri::command]
pub async fn export_theme(id: String) -> Result<Option<String>, String> {
    let name = id.clone();
    let picked = blocking(move || {
        rfd::FileDialog::new()
            .add_filter("Тема лаунчера", &["mtheme", "zip"])
            .set_file_name(format!("{name}.mtheme"))
            .set_title("Сохранить тему")
            .save_file()
    })
    .await?;
    let Some(path) = picked else { return Ok(None) };
    let target = path.clone();
    blocking(move || engine::export_theme(&id, &target)).await??;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn save_theme(
    app: tauri::AppHandle,
    draft: engine::ThemeDraft,
) -> Result<engine::InstalledTheme, String> {
    let saved = blocking(move || engine::save_theme(draft)).await??;
    // The first save creates the folder, which the asset scope granted at
    // startup does not cover yet — without this its images stay blank.
    crate::allow_assets(&app);
    Ok(saved)
}

/// The image is chosen natively and copied by the core, so the command takes a
/// theme id instead of a path from the webview.
#[tauri::command]
pub async fn add_theme_asset(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let picked = blocking(|| {
        rfd::FileDialog::new()
            .add_filter("Картинка или шрифт", &["png", "jpg", "jpeg", "webp", "gif", "woff2", "woff", "ttf", "otf"])
            .set_title("Файл для темы")
            .pick_file()
    })
    .await?;
    let Some(path) = picked else { return Ok(None) };
    let name = blocking(move || engine::add_theme_asset(&id, &path)).await??;
    crate::allow_assets(&app);
    Ok(Some(name))
}

#[tauri::command]
pub async fn catalog_themes(query: engine::CatalogQuery) -> Result<serde_json::Value, String> {
    engine::catalog_list(query).await
}

#[tauri::command]
pub async fn catalog_my_themes() -> Result<serde_json::Value, String> {
    engine::catalog_mine().await
}

#[tauri::command]
pub async fn catalog_install_theme(
    app: tauri::AppHandle,
    slug: String,
) -> Result<engine::InstalledTheme, String> {
    let installed = engine::catalog_install(slug).await?;
    // A freshly created themes directory is outside the asset scope granted at
    // startup, so its images would not load until the next launch.
    crate::allow_assets(&app);
    Ok(installed)
}

#[tauri::command]
pub async fn catalog_publish_theme(
    id: String,
    changelog: Option<String>,
) -> Result<serde_json::Value, String> {
    engine::catalog_publish(id, changelog).await
}

#[tauri::command]
pub async fn catalog_unpublish_theme(slug: String) -> Result<serde_json::Value, String> {
    engine::catalog_unpublish(&slug).await
}

#[tauri::command]
pub async fn catalog_like_theme(slug: String) -> Result<serde_json::Value, String> {
    engine::catalog_like(&slug).await
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
