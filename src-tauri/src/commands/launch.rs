// Commands to start the game and what goes around it: Java, logs, worlds, servers, stopping the game.
// Starting processes and the rest lives in engine/game. Here are only thin wrappers for the UI.
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
    prep_ms: Option<u64>,
) -> Result<String, String> {
    // A running build only needs its window raised: no sign-in round trip for that.
    if let Some(outcome) = engine::bring_running_forward("default", false) {
        return Ok(outcome);
    }
    engine::note_launch_prep("default", prep_ms);
    engine::begin_launch()
        .run(Box::pin(engine::launch_with_account(app, version, nick, fabric, ram_mb, "default".into(), auth)))
        .await
}

/// Play on a build that is already running: the page asks this before any preparation (update,
/// graphics care, sign-in). `Some(outcome)` means the running game's window came forward and
/// there is nothing to prepare; `None` means no such game is in memory, so Play goes the usual way.
#[tauri::command(async)]
pub fn raise_running(profile: String) -> Option<String> {
    engine::bring_running_forward(&profile, false)
}

#[tauri::command(async)]
pub fn list_logs(profile: String) -> Vec<String> { engine::list_logs(&profile) }

#[tauri::command(async)]
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
    let mut d = engine::dialog().set_title(crate::engine::ui("Файл java (java.exe / bin/java)"));
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

#[tauri::command(async)]
pub fn list_java_runtimes() -> Vec<engine::JavaRuntime> { engine::list_java_runtimes() }

#[tauri::command(async)]
pub fn remove_java_runtime(major: u32) -> Result<u64, String> { engine::remove_java_runtime(major) }

#[tauri::command(async)]
pub fn get_playtime(profile: String) -> u64 { engine::get_playtime(&profile) }

#[tauri::command(async)]
pub fn get_play_stats() -> engine::PlayStats { engine::get_play_stats() }

#[tauri::command(async)]
pub fn label_server(addr: String, name: String) { engine::label_server(&addr, &name) }

#[tauri::command]
// The game log goes to the public mclo.gs only when the user clicks. Before that the token and the home folder are cut out (engine/profiles/sharelog.rs).
pub async fn share_log(profile: String, name: String) -> Result<String, String> { engine::share_log(profile, name).await }

#[tauri::command(async)]
pub fn backup_world(profile: String, folder: String) -> Result<String, String> { engine::backup_world(profile, folder) }

#[tauri::command(async)]
pub fn list_backups(profile: String) -> Vec<String> { engine::list_backups(&profile) }

#[tauri::command(async)]
pub fn list_worlds(profile: String) -> Vec<engine::WorldEntry> { engine::list_worlds(&profile) }

#[tauri::command(async)]
// Deletes a world from the profile folder. A button in the UI calls it.
pub fn delete_world(profile: String, folder: String) -> Result<(), String> { engine::delete_world(&profile, &folder) }

#[tauri::command(async)]
pub fn list_servers(profile: String) -> Vec<engine::ServerEntry> { engine::list_servers(&profile) }

#[tauri::command(async)]
pub fn add_server(profile: String, name: String, ip: String) -> Vec<engine::ServerEntry> { engine::add_server(&profile, name, ip) }

#[tauri::command(async)]
pub fn remove_server(profile: String, ip: String) -> Vec<engine::ServerEntry> { engine::remove_server(&profile, &ip) }

#[tauri::command(async)]
pub fn pin_server_dat(profile: String, name: String, ip: String) -> Result<(), String> {
    engine::pin_server_dat(&profile, &name, &ip)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn quick_play(
    app: tauri::AppHandle,
    profile: String,
    nick: String,
    ram_mb: u32,
    world: Option<String>,
    server: Option<String>,
    auth: Option<engine::AuthArgs>,
    prep_ms: Option<u64>,
) -> Result<String, String> {
    if let Some(outcome) = engine::bring_running_forward(&profile, false) {
        return Ok(outcome);
    }
    engine::note_launch_prep(&profile, prep_ms);
    engine::begin_launch()
        .run(engine::quick_play(app, profile, nick, ram_mb, world, server, auth))
        .await
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
    let addr = engine::resolve_srv(&addr).await;
    tauri::async_runtime::spawn_blocking(move || engine::ping(&addr))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn repair_profile(app: tauri::AppHandle, profile: String) -> Result<engine::RepairReport, String> {
    engine::begin_launch().run(Box::pin(engine::repair_profile_files(app, profile))).await
}

#[tauri::command]
pub async fn world_details(profile: String) -> Result<Vec<engine::WorldInfo>, String> {
    super::blocking(move || engine::world_details(&profile)).await
}

#[tauri::command]
pub async fn rename_world(profile: String, folder: String, name: String) -> Result<engine::WorldInfo, String> {
    super::blocking(move || engine::rename_world(&profile, &folder, &name)).await?
}

#[tauri::command]
pub async fn duplicate_world(profile: String, folder: String) -> Result<engine::WorldInfo, String> {
    super::blocking(move || engine::duplicate_world(&profile, &folder)).await?
}

/// Returns `None` when the save dialog was dismissed.
#[tauri::command]
pub async fn export_world(profile: String, folder: String) -> Result<Option<String>, String> {
    engine::export_world(profile, folder).await
}

#[tauri::command]
pub async fn import_world(profile: String) -> Result<engine::WorldInfo, String> {
    engine::import_world(profile).await
}

#[tauri::command]
pub async fn restore_world_backup(profile: String, file: String) -> Result<engine::WorldInfo, String> {
    super::blocking(move || engine::restore_backup(&profile, &file)).await?
}

#[tauri::command(async)]
pub fn delete_world_backup(profile: String, file: String) -> Result<(), String> {
    engine::delete_backup(&profile, &file)
}

#[tauri::command]
pub fn open_world_folder(profile: String, folder: String) -> Result<(), String> {
    engine::open_world_folder(&profile, &folder)
}

/// The lag helper's advice, shown on the island of the running game.
#[tauri::command]
pub fn game_notice(profile: String, title: String, detail: String) -> bool {
    engine::post_game_notice(&profile, &title, &detail)
}

/// Everything the running game wrote since its launch, for a log view opened late.
#[tauri::command]
pub fn game_log_snapshot() -> engine::LiveLogSnapshot {
    engine::live_log_snapshot()
}

/// Memory facts checked before a launch: is the heap enough for the build.
#[tauri::command]
pub async fn ram_check(profile: String, requested: Option<u32>) -> Result<engine::RamCheck, String> {
    super::blocking(move || engine::ram_check(&profile, requested.unwrap_or(0))).await
}

/// Graphics picked for this PC, written once before a build's first start.
#[tauri::command]
pub async fn seed_video_options(profile: String, video: Option<Vec<(String, String)>>) -> Result<bool, String> {
    super::blocking(move || engine::seed_video_options(&profile, video)).await?
}

/// Performs one of the actions offered under a crash report.
#[tauri::command]
pub async fn apply_crash_fix(app: tauri::AppHandle, profile: String, kind: String, arg: String) -> Result<String, String> {
    engine::apply_crash_fix(app, profile, kind, arg).await
}

/// Memory and JVM flags the launcher would pick for this build, with the
/// reasons — shown in the build settings next to the manual slider.
#[tauri::command]
pub async fn tune_profile(profile: String) -> Result<engine::Tuning, String> {
    super::blocking(move || engine::tune_profile(&profile)).await
}

#[tauri::command]
pub fn set_auto_tune(profile: String, on: bool) { engine::set_auto_tune(&profile, on); }

/// Memory of a build in megabytes, 0 for auto: the value the launch takes.
#[tauri::command]
pub fn set_profile_ram(profile: String, mb: u32) -> Result<(), String> {
    engine::set_profile_ram(&profile, mb)
}

/// The webview names a game and passes the code from a link as is; the core
/// alone knows which games take invites and in what format.
#[tauri::command]
pub async fn set_game_invite(slug: String, code: String) -> Result<bool, String> {
    super::blocking(move || engine::set_game_invite(&slug, &code)).await?
}

#[tauri::command]
pub async fn claim_game_invites() -> Vec<String> { engine::claim_game_invites().await }

#[tauri::command]
pub fn launch_hooks(profile: String) -> engine::LaunchHooks {
    engine::launch_hooks(&profile)
}

#[tauri::command]
pub async fn set_launch_hooks(profile: String, hooks: engine::LaunchHooks) -> Result<bool, String> {
    engine::set_launch_hooks(profile, hooks).await
}
