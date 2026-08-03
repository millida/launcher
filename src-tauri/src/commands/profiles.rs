use crate::engine;

#[tauri::command]
pub fn duplicate_profile(name: String) -> Result<Vec<engine::Profile>, String> { engine::duplicate_profile(&name) }

/// Both fields end up on a JVM command line on every launch, so they are checked
/// here as well as when the command line is built.
#[tauri::command]
pub fn save_profile_settings(profile: String, jvm_args: String, width: u32, height: u32, java_path: Option<String>) -> Result<(), String> {
    if let Some(bad) = engine::rejected_jvm_arg(&jvm_args) {
        return Err(format!("Аргумент «{}» лаунчер не передаёт Java — он позволяет запускать сторонний код", bad));
    }
    let java_path = java_path.map(|p| p.trim().to_string()).unwrap_or_default();
    if !java_path.is_empty() && !engine::java_path_allowed(std::path::Path::new(&java_path)) {
        return Err("Путь к Java не распознан — выбери её кнопкой «Выбрать Java»".into());
    }
    let mut patch = serde_json::Map::new();
    patch.insert("jvmArgs".into(), serde_json::json!(jvm_args));
    patch.insert("width".into(), serde_json::json!(width));
    patch.insert("height".into(), serde_json::json!(height));
    patch.insert("javaPath".into(), serde_json::json!(java_path));
    engine::merge_settings(&profile, patch);
    Ok(())
}

#[tauri::command]
pub fn fps_boost_state(profile: String) -> engine::FpsBoostState { engine::fps_boost_state(&profile) }

#[tauri::command]
pub async fn set_fps_boost(app: tauri::AppHandle, profile: String, on: bool) -> Result<engine::FpsBoostState, String> {
    engine::set_fps_boost(app, profile, on).await
}

#[tauri::command]
pub fn load_profile_settings(profile: String) -> serde_json::Value {
    std::fs::read_to_string(engine::profile_dir(&profile).join("millida-settings.json"))
        .ok().and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::json!({"jvmArgs":"","width":0,"height":0,"javaPath":""}))
}

#[tauri::command]
pub fn open_screenshots(profile: String) { engine::open_screenshots(&profile); }

#[tauri::command]
pub fn count_screenshots(profile: String) -> usize { engine::count_screenshots(&profile) }

#[tauri::command]
pub async fn modpack_versions(slug: String) -> Result<serde_json::Value, String> { engine::modpack_versions(slug).await }

#[tauri::command]
pub async fn update_modpack(app: tauri::AppHandle, profile: String, version_id: String) -> Result<engine::Profile, String> {
    engine::update_modpack(app, profile, version_id).await
}

#[tauri::command]
pub fn modpack_info(profile: String) -> serde_json::Value { engine::modpack_info(&profile) }

/// Screenshots are the only game-root files the webview shows, and the grant is
/// per file: opening `profiles/<p>/` to `asset://` would also expose mods and
/// worlds that a compromised webview copied there.
#[tauri::command]
pub fn list_screenshots(app: tauri::AppHandle, profile: String) -> Vec<String> {
    use tauri::Manager;
    let shots = engine::list_screenshots(&profile);
    let scope = app.asset_protocol_scope();
    for shot in &shots {
        let _ = scope.allow_file(shot);
    }
    shots
}

#[tauri::command]
pub fn set_profile_group(name: String, group: String) { engine::set_profile_group(&name, &group); }

#[tauri::command]
pub fn get_profile_groups() -> serde_json::Value { engine::get_profile_groups() }

#[tauri::command]
pub fn set_profile_icon(name: String, icon: String) -> Vec<engine::Profile> {
    engine::set_profile_cover(&name, Some(icon))
}

/// Returns `None` when the picker was dismissed.
#[tauri::command]
pub async fn pick_profile_cover(profile: String) -> Result<Option<Vec<engine::Profile>>, String> {
    engine::pick_profile_cover(profile).await
}

#[tauri::command]
pub fn clear_profile_cover(profile: String) -> Vec<engine::Profile> {
    engine::set_profile_cover(&profile, None)
}

#[tauri::command]
pub fn delete_profile(name: String) -> Result<Vec<engine::Profile>, String> { engine::delete_profile(&name) }

#[tauri::command]
pub fn rename_profile(name: String, new_name: String) -> Result<Vec<engine::Profile>, String> {
    let nn = new_name.trim().to_string();
    if nn.is_empty() { return Err("Имя не может быть пустым".into()); }
    let mut all = engine::load_profiles();
    if nn == name { return Ok(all); }
    if !all.iter().any(|p| p.name == name) { return Err("Сборка не найдена".into()); }
    if all.iter().any(|p| p.name == nn) { return Err("Сборка с таким именем уже есть".into()); }
    let old_dir = engine::profile_dir(&name);
    let new_dir = engine::profile_dir(&nn);
    if old_dir != new_dir {
        if new_dir.exists() { return Err("Папка с таким именем уже занята — выбери другое".into()); }
        if old_dir.exists() { std::fs::rename(&old_dir, &new_dir).map_err(|e| e.to_string())?; }
    }
    for p in all.iter_mut() { if p.name == name { p.name = nn.clone(); } }
    engine::save_profiles(&all)?;
    engine::rename_profile_group(&name, &nn);
    Ok(all)
}

/// The loader itself is installed on the next launch.
#[tauri::command]
pub fn set_profile_loader(name: String, version: String, loader: String) -> Result<Vec<engine::Profile>, String> {
    let mut all = engine::load_profiles();
    let p = all.iter_mut().find(|p| p.name == name).ok_or("Сборка не найдена")?;
    p.version = version;
    p.fabric = loader == "fabric";
    p.loader = Some(loader);
    // a manual loader change drops the loader build pinned by a modpack
    p.loader_version = None;
    engine::save_profiles(&all)?;
    Ok(all)
}

#[tauri::command]
pub fn open_profile_folder(name: String) { engine::open_profile_folder(&name); }

#[tauri::command]
pub fn list_profiles() -> Vec<engine::Profile> {
    engine::load_profiles()
}

#[tauri::command]
pub fn create_profile(name: String, version: String, fabric: bool, loader: Option<String>, icon: Option<String>) -> Result<engine::Profile, String> {
    let mut all = engine::load_profiles();
    let lid = loader.unwrap_or_else(|| if fabric { "fabric".into() } else { "vanilla".into() });
    let fab = lid == "fabric";
    // a repeated name must not overwrite the existing build or share its folder
    let prof = engine::Profile {
        name: engine::unique_profile_name(&name),
        version,
        fabric: fab,
        loader: Some(lid),
        loader_version: None,
        icon,
    };
    all.insert(0, prof.clone());
    engine::save_profiles(&all)?;
    Ok(prof)
}

#[tauri::command]
pub async fn launch_profile(
    app: tauri::AppHandle,
    profile: String,
    nick: String,
    ram_mb: u32,
    auth: Option<engine::AuthArgs>,
) -> Result<String, String> {
    let p = engine::load_profiles()
        .into_iter()
        .find(|x| x.name == profile)
        .unwrap_or(engine::Profile { name: "default".into(), version: "latest".into(), fabric: false, loader: Some("vanilla".into()), loader_version: None, icon: None });
    let r = engine::resolve_launch_auth(&app, auth).await;
    engine::install_and_launch_in(app, p.version, r.nick.unwrap_or(nick), p.fabric, ram_mb, p.name, r.auth).await
}

#[tauri::command]
pub async fn install_modpack(app: tauri::AppHandle, slug: String) -> Result<engine::Profile, String> {
    engine::install_modpack(app, slug).await
}

#[tauri::command]
pub async fn install_modpack_version(app: tauri::AppHandle, slug: String, version_id: String) -> Result<engine::Profile, String> {
    engine::install_modpack_ver(app, slug, Some(version_id), None).await
}

#[tauri::command]
pub async fn cf_install_modpack(app: tauri::AppHandle, mod_id: u32, file_id: Option<u64>) -> Result<engine::Profile, String> {
    engine::cf_install_modpack(app, mod_id, file_id).await
}

#[tauri::command]
pub async fn scan_imports() -> Result<Vec<engine::FoundInstance>, String> {
    super::blocking(engine::scan_imports).await
}

#[tauri::command]
pub fn import_instance(path: String, name: String, version: String, loader: String) -> Result<engine::Profile, String> {
    engine::import_instance(path, name, version, loader)
}

#[tauri::command]
pub async fn import_pack_file(app: tauri::AppHandle, path: Option<String>) -> Result<engine::Profile, String> {
    engine::import_pack_file(app, path).await
}
