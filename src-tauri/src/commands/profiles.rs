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
        return Err(engine::java_reject_reason(std::path::Path::new(&java_path)));
    }
    let mut patch = serde_json::Map::new();
    patch.insert("jvmArgs".into(), serde_json::json!(jvm_args));
    patch.insert("width".into(), serde_json::json!(width));
    patch.insert("height".into(), serde_json::json!(height));
    patch.insert("javaPath".into(), serde_json::json!(java_path));
    // An explicit path replaces a pinned version; the empty path means "auto" and
    // must not silently unpin a version the user chose in the same panel.
    if !java_path.is_empty() {
        patch.insert("javaMajor".into(), serde_json::Value::Null);
    }
    engine::merge_settings(&profile, patch);
    Ok(())
}

/// Pins a Java version for one build and installs it. `major` is the only thing
/// the webview may name here, and it is checked against the published list
/// before it reaches an Adoptium URL and a directory name.
#[tauri::command]
pub async fn set_profile_java_major(app: tauri::AppHandle, profile: String, major: Option<u64>) -> Result<String, String> {
    let Some(major) = major else {
        let mut patch = serde_json::Map::new();
        patch.insert("javaMajor".into(), serde_json::Value::Null);
        engine::merge_settings(&profile, patch);
        return Ok(String::new());
    };
    let version = engine::ensure_java_major(&app, major).await?;
    let mut patch = serde_json::Map::new();
    patch.insert("javaMajor".into(), serde_json::json!(major));
    patch.insert("javaPath".into(), serde_json::json!(""));
    engine::merge_settings(&profile, patch);
    Ok(version)
}

/// The webview names a card, never a command line: the core owns the switches
/// that a name turns into.
#[tauri::command]
pub fn set_profile_gpu(profile: String, pref: String) -> String {
    let pref = engine::GpuPref::parse(&pref);
    let mut patch = serde_json::Map::new();
    patch.insert("gpu".into(), serde_json::json!(pref.as_str()));
    engine::merge_settings(&profile, patch);
    pref.as_str().to_string()
}

#[tauri::command]
pub fn gpu_switch_supported() -> bool { engine::gpu_switch_supported() }

#[tauri::command]
pub fn skin_mod_state(profile: String) -> serde_json::Value { engine::skin_mod_state(&profile) }

/// Off takes the jar out of the build now and keeps it out: the launcher used to
/// put its skin mod back on the next launch, so a build it does not fit could
/// not be fixed by removing it.
#[tauri::command]
pub fn set_skin_mod(profile: String, on: bool) -> Result<serde_json::Value, String> {
    engine::set_skin_mod(&profile, on)
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
pub fn count_screenshots(profile: String) -> usize { engine::screenshot_count(&profile) }

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
    screenshot_gallery(app, profile).into_iter().map(|s| s.path).collect()
}

/// Same per-file grant as the plain list, plus the sizes and dates the gallery
/// shows. An empty profile name means every build.
#[tauri::command]
pub fn screenshot_gallery(app: tauri::AppHandle, profile: String) -> Vec<engine::Screenshot> {
    use tauri::Manager;
    let shots = engine::gallery(&profile);
    let scope = app.asset_protocol_scope();
    for shot in &shots {
        let _ = scope.allow_file(&shot.path);
    }
    shots
}

#[tauri::command]
pub fn delete_screenshot(profile: String, name: String) -> Result<(), String> {
    engine::delete_screenshot(&profile, &name)
}

#[tauri::command]
pub async fn save_screenshot_as(profile: String, name: String) -> Result<Option<String>, String> {
    engine::save_screenshot_as(profile, name).await
}

#[tauri::command]
pub async fn share_screenshot(profile: String, name: String) -> Result<String, String> {
    engine::share_screenshot(profile, name).await
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
pub fn set_profile_loader(
    name: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
) -> Result<Vec<engine::Profile>, String> {
    let mut all = engine::load_profiles();
    let p = all.iter_mut().find(|p| p.name == name).ok_or("Сборка не найдена")?;
    p.version = version;
    p.fabric = loader == "fabric";
    p.loader = Some(loader);
    // empty means "recommended build": a manual change drops whatever a modpack pinned
    p.loader_version = loader_version.filter(|v| !v.trim().is_empty());
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
pub fn create_profile(
    name: String,
    version: String,
    fabric: bool,
    loader: Option<String>,
    loader_version: Option<String>,
    icon: Option<String>,
) -> Result<engine::Profile, String> {
    let mut all = engine::load_profiles();
    let lid = loader.unwrap_or_else(|| if fabric { "fabric".into() } else { "vanilla".into() });
    let fab = lid == "fabric";
    let pinned = loader_version
        .filter(|v| !v.trim().is_empty())
        .filter(|_| lid != "vanilla");
    // a repeated name must not overwrite the existing build or share its folder
    let prof = engine::Profile {
        name: engine::unique_profile_name(&name),
        version,
        fabric: fab,
        loader: Some(lid),
        loader_version: pinned,
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

#[tauri::command]
pub async fn share_profile(profile: String, summary: Option<String>) -> Result<engine::SharedPack, String> {
    engine::share_profile(profile, summary).await
}

#[tauri::command]
pub async fn unshare_profile(code: String) -> Result<(), String> {
    engine::unshare_profile(code).await
}

/// What a code points at, before anything is downloaded.
#[tauri::command]
pub async fn pack_preview(code: String) -> Result<serde_json::Value, String> {
    engine::pack_preview(code).await
}

#[tauri::command]
pub async fn install_shared_pack(app: tauri::AppHandle, code: String) -> Result<engine::Profile, String> {
    engine::install_shared_pack(app, code).await
}

#[tauri::command]
pub async fn cloud_status() -> Result<engine::CloudStatus, String> {
    engine::cloud_status().await
}

#[tauri::command]
pub async fn cloud_push() -> Result<engine::CloudStatus, String> {
    engine::cloud_push().await
}

/// `only` restores exactly the named builds, overwriting what is here;
/// without it only builds missing on this machine are installed.
#[tauri::command]
pub async fn cloud_pull(
    app: tauri::AppHandle,
    only: Option<Vec<String>>,
    apply_prefs: bool,
) -> Result<engine::PullReport, String> {
    engine::cloud_pull(app, only, apply_prefs).await
}

#[tauri::command]
pub async fn cloud_forget() -> Result<(), String> {
    engine::cloud_forget().await
}
