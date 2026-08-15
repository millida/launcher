use crate::engine;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn launch_game(
    app: tauri::AppHandle,
    version: String,
    nick: String,
    fabric: bool,
    ram_mb: u32,
    auth: Option<engine::AuthArgs>,
) -> Result<String, String> {
    let r = engine::resolve_launch_auth(&app, auth).await;
    engine::install_and_launch(app, version, r.nick.unwrap_or(nick), fabric, ram_mb, r.auth).await
}

#[tauri::command]
pub fn list_logs(profile: String) -> Vec<String> { engine::list_logs(&profile) }

#[tauri::command]
pub fn read_log(profile: String, name: String) -> String { engine::read_log(&profile, &name) }

#[tauri::command]
pub async fn detect_java() -> Result<Vec<engine::JavaInfo>, String> {
    super::blocking(engine::detect_java).await
}

#[tauri::command]
pub async fn test_java(path: String) -> Result<String, String> {
    super::blocking(move || engine::test_java(path)).await?
}

#[tauri::command]
pub async fn pick_java_path() -> Result<Option<engine::JavaInfo>, String> {
    let mut d = engine::dialog().set_title("Файл java (java.exe / bin/java)");
    if cfg!(target_os = "windows") {
        d = d.add_filter("Java", &["exe"]);
    }
    let Some(path) = engine::pick_file(d).await else { return Ok(None) };
    let path = path.to_string_lossy().to_string();
    // Any file can be picked, so verify it actually runs and reports a version.
    // A path that passes is remembered as allowed: `test_java` and the launcher
    // only start Java binaries the core itself vouched for.
    let version = engine::accept_picked_java(path.clone())?;
    Ok(Some(engine::JavaInfo { path, version }))
}

#[tauri::command]
pub async fn default_java() -> Option<engine::JavaInfo> {
    super::blocking(engine::default_java_info).await.ok().flatten()
}

#[tauri::command]
pub async fn set_default_java(path: Option<String>) -> Result<(), String> {
    super::blocking(move || engine::set_default_java(path)).await?
}

#[tauri::command]
pub fn java_majors() -> Vec<u64> { engine::JAVA_MAJORS.to_vec() }

#[tauri::command]
pub async fn download_java_runtime(app: tauri::AppHandle, major: u64) -> Result<String, String> {
    engine::download_java_runtime(&app, major).await
}

#[tauri::command]
pub fn list_java_runtimes() -> Vec<engine::JavaRuntime> { engine::list_java_runtimes() }

#[tauri::command]
pub fn remove_java_runtime(major: u32) -> Result<u64, String> { engine::remove_java_runtime(major) }

#[tauri::command]
pub fn get_playtime(profile: String) -> u64 { engine::get_playtime(&profile) }

#[tauri::command]
pub fn get_play_stats() -> engine::PlayStats { engine::get_play_stats() }

#[tauri::command]
pub fn label_server(addr: String, name: String) { engine::label_server(&addr, &name) }

#[tauri::command]
pub async fn share_log(profile: String, name: String) -> Result<String, String> { engine::share_log(profile, name).await }

#[tauri::command]
pub fn backup_world(profile: String, folder: String) -> Result<String, String> { engine::backup_world(profile, folder) }

#[tauri::command]
pub fn list_backups(profile: String) -> Vec<String> { engine::list_backups(&profile) }

#[tauri::command]
pub fn list_worlds(profile: String) -> Vec<engine::WorldEntry> { engine::list_worlds(&profile) }

#[tauri::command]
pub fn delete_world(profile: String, folder: String) -> Result<(), String> { engine::delete_world(&profile, &folder) }

#[tauri::command]
pub fn list_servers(profile: String) -> Vec<engine::ServerEntry> { engine::list_servers(&profile) }

#[tauri::command]
pub fn add_server(profile: String, name: String, ip: String) -> Vec<engine::ServerEntry> { engine::add_server(&profile, name, ip) }

#[tauri::command]
pub fn remove_server(profile: String, ip: String) -> Vec<engine::ServerEntry> { engine::remove_server(&profile, &ip) }

#[tauri::command]
pub fn pin_server_dat(profile: String, name: String, ip: String) -> Result<(), String> {
    engine::pin_server_dat(&profile, &name, &ip)
}

#[tauri::command]
pub async fn quick_play(
    app: tauri::AppHandle,
    profile: String,
    nick: String,
    ram_mb: u32,
    world: Option<String>,
    server: Option<String>,
    auth: Option<engine::AuthArgs>,
) -> Result<String, String> {
    let r = engine::resolve_launch_auth(&app, auth).await;
    engine::quick_play(app, profile, r.nick.unwrap_or(nick), ram_mb, world, server, r.auth).await
}

#[tauri::command]
pub fn cancel_launch() { engine::cancel_launch(); }

/// Without a profile name, stops every running instance.
#[tauri::command]
pub fn stop_game(profile: Option<String>) -> Result<(), String> { engine::stop_game(profile.as_deref()) }

#[tauri::command]
pub fn running_games() -> Vec<String> { engine::running_games() }

#[tauri::command]
pub async fn ping_server(addr: String) -> Result<engine::PingResult, String> {
    tauri::async_runtime::spawn_blocking(move || engine::ping(&addr))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repair_profile(app: tauri::AppHandle, profile: String) -> Result<engine::RepairReport, String> {
    engine::repair_profile_files(app, profile).await
}
