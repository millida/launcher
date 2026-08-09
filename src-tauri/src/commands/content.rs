use crate::engine;

#[tauri::command]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn install_mod(
    app: tauri::AppHandle,
    project: String,
    game_version: String,
    profile: String,
) -> Result<engine::ContentInstall, String> {
    engine::install_mod(app, project, game_version, profile).await
}

/// `allow_mismatch` is set only after the user confirmed installing content that
/// targets other game versions.
#[tauri::command]
pub async fn install_content(
    app: tauri::AppHandle,
    project: String,
    game_version: String,
    profile: String,
    kind: String,
    allow_mismatch: Option<bool>,
) -> Result<engine::ContentInstall, String> {
    engine::install_content(app, project, game_version, profile, kind, allow_mismatch.unwrap_or(false)).await
}

#[tauri::command]
pub fn list_content(profile: String, kind: String) -> Vec<engine::ModFile> { engine::list_content(&profile, &kind) }

#[tauri::command]
pub async fn scan_content_local(profile: String, kind: String) -> Result<Vec<engine::ModFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        engine::scan_local_meta(&profile, &kind, false);
        engine::list_content(&profile, &kind)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_content(profile: String, kind: String) -> Result<engine::ScanResult, String> {
    engine::scan_content(profile, kind).await
}

#[tauri::command]
pub fn toggle_content(profile: String, kind: String, name: String, enable: bool) -> Result<(), String> {
    engine::toggle_content(&profile, &kind, &name, enable)
}

#[tauri::command]
pub fn delete_content(profile: String, kind: String, name: String) -> Result<(), String> {
    engine::delete_content(&profile, &kind, &name)
}

#[tauri::command]
pub fn list_mods(profile: String) -> Vec<engine::ModFile> { engine::list_mods(&profile) }

#[tauri::command]
pub fn toggle_mod(profile: String, name: String, enable: bool) -> Result<(), String> {
    engine::toggle_mod(&profile, &name, enable)
}

#[tauri::command]
pub fn delete_mod(profile: String, name: String) -> Result<(), String> {
    engine::delete_mod(&profile, &name)
}

#[tauri::command]
pub async fn cf_search(
    query: String, kind: String, game_version: String, loader: String,
    index: Option<u32>, category: Option<u32>, sort: Option<u32>,
) -> Result<Vec<engine::CfHit>, String> {
    engine::cf_search(query, kind, game_version, loader, index.unwrap_or(0), category.unwrap_or(0), sort.unwrap_or(0)).await
}

#[tauri::command]
pub async fn cf_install(app: tauri::AppHandle, mod_id: u32, game_version: String, profile: String, kind: String, file_id: Option<u64>, allow_mismatch: Option<bool>) -> Result<engine::ContentInstall, String> {
    engine::cf_install(app, engine::CfInstallReq {
        mod_id,
        game_version,
        profile,
        kind,
        file_id,
        allow_mismatch: allow_mismatch.unwrap_or(false),
    }).await
}

#[tauri::command]
pub async fn cf_project(mod_id: u32) -> Result<engine::CfProject, String> {
    engine::cf_project(mod_id).await
}

#[tauri::command]
pub async fn cf_files(mod_id: u32, game_version: Option<String>) -> Result<Vec<engine::CfFileInfo>, String> {
    engine::cf_files(mod_id, game_version.unwrap_or_default()).await
}

#[tauri::command]
pub async fn cf_install_world(app: tauri::AppHandle, mod_id: u32, profile: String, force: Option<bool>) -> Result<engine::WorldInstall, String> {
    engine::cf_install_world(app, mod_id, profile, force.unwrap_or(false)).await
}

#[tauri::command]
pub fn list_world_installs(profile: String) -> Vec<String> { engine::list_world_installs(&profile) }

/// Installs live in the engine and survive a webview reload; the frontend polls
/// this to restore progress rows.
#[tauri::command]
pub fn active_installs() -> Vec<engine::JobInfo> { engine::active_jobs() }

#[tauri::command]
pub fn cancel_install(key: String) -> bool { engine::cancel_job(&key) }

#[tauri::command]
pub async fn list_versions() -> Result<Vec<String>, String> {
    engine::list_versions().await
}

#[tauri::command]
pub async fn list_loader_versions(loader: String, mc_version: String) -> Result<Vec<engine::LoaderBuild>, String> {
    engine::list_loader_versions(&loader, &mc_version).await
}

#[tauri::command]
pub async fn check_updates(profile: String, kind: String) -> Result<Vec<engine::UpdateInfo>, String> {
    engine::check_updates(profile, kind).await
}

#[tauri::command]
pub async fn update_content(profile: String, kind: String, name: String) -> Result<String, String> {
    engine::update_content(profile, kind, name).await
}

#[tauri::command]
pub async fn update_all(profile: String, kind: String) -> Result<u32, String> {
    engine::update_all(profile, kind).await
}

#[tauri::command]
pub async fn add_local_file(profile: String, kind: String, path: String) -> Result<String, String> {
    engine::add_local_file(profile, kind, path).await
}

#[tauri::command]
pub async fn install_version(app: tauri::AppHandle, project: String, version_id: String, profile: String, kind: String) -> Result<engine::ContentInstall, String> {
    engine::install_version(app, project, version_id, profile, kind).await
}

#[tauri::command]
pub async fn export_mrpack(profile: String, name: String, version: String, description: String) -> Result<String, String> {
    let safe: String = name.chars().filter(|c| c.is_alphanumeric() || *c==' ' || *c=='-' || *c=='_').collect();
    let base = if safe.trim().is_empty() { profile.clone() } else { safe.trim().to_string() };
    let out = engine::data_dir().join("exports").join(format!("{}.mrpack", base));
    let dst = out.to_string_lossy().to_string();
    let res = super::blocking(move || engine::export_mrpack(profile, dst, name, version, description)).await??;
    if let Some(p) = out.parent() {
        engine::open_path(&p.to_string_lossy());
    }
    Ok(res)
}
