use crate::engine;

#[tauri::command]
pub fn game_dir() -> String { engine::game_root().to_string_lossy().to_string() }

/// Runs on the blocking pool: moving tens of gigabytes would otherwise freeze
/// the webview.
#[tauri::command]
pub async fn set_game_dir(app: tauri::AppHandle, path: String, move_data: bool) -> Result<String, String> {
    let out = tauri::async_runtime::spawn_blocking(move || engine::set_game_root(path, move_data))
        .await
        .map_err(|e| e.to_string())??;
    // the new game root must join the asset: scope, or its images stop loading
    crate::allow_assets(&app);
    Ok(out)
}

#[tauri::command]
pub async fn pick_game_dir() -> Result<Option<String>, String> {
    let start = engine::game_root();
    let picked =
        engine::pick_folder(engine::dialog().set_directory(&start).set_title("Папка игры Millida")).await;
    Ok(picked.map(|d| d.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_game_folder() { engine::open_game_folder(); }

#[tauri::command]
pub async fn pick_wallpaper() -> Result<Option<engine::CustomWallpaper>, String> {
    engine::pick_wallpaper().await
}

#[tauri::command]
pub async fn pick_texture() -> Result<Option<engine::PickedTexture>, String> {
    engine::pick_texture().await
}

/// Copies the picture the viewer is showing. The webview names the source, and
/// the core reads it only when it is one of ours.
#[tauri::command]
pub async fn copy_picture(app: tauri::AppHandle, src: engine::PictureRef) -> Result<(), String> {
    engine::copy_picture(app, src).await
}

/// `None` — the save dialog was dismissed.
#[tauri::command]
pub async fn save_picture_as(src: engine::PictureRef) -> Result<Option<String>, String> {
    engine::save_picture_as(src).await
}

#[tauri::command]
pub fn music_tracks() -> Vec<engine::MusicTrack> { engine::music_tracks() }

#[tauri::command]
pub fn open_music_folder() { engine::open_music_folder(); }

#[tauri::command]
pub async fn download_mc_music() -> Result<u32, String> { engine::download_mc_music().await }

#[tauri::command]
pub fn ui_sounds() -> Vec<engine::UiSound> { engine::ui_sounds() }

#[tauri::command]
pub async fn download_ui_sounds() -> Result<Vec<engine::UiSound>, String> { engine::download_ui_sounds().await }

#[tauri::command]
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    engine::open_external_anyhow(&app, &url)
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Hardware and OS facts only, nothing identifying the user.
#[derive(serde::Serialize)]
pub struct DeviceSpecs {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpu: String,
    /// Physical cores; 0 when the platform will not report them.
    pub cpu_cores: u32,
    pub cpu_threads: u32,
    pub ram_mb: u32,
}

#[tauri::command]
pub fn device_specs() -> DeviceSpecs {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::everything());

    let os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        _ => "linux",
    };
    let cpu = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_default();

    DeviceSpecs {
        os: os.to_string(),
        os_version: sysinfo::System::os_version().unwrap_or_default(),
        arch: std::env::consts::ARCH.to_string(),
        cpu,
        cpu_cores: sys.physical_core_count().unwrap_or(0) as u32,
        cpu_threads: sys.cpus().len() as u32,
        ram_mb: (sys.total_memory() / 1024 / 1024) as u32,
    }
}

/// Hiding is gated on a live tray icon, so the webview cannot hide the window
/// into nowhere.
#[tauri::command]
pub fn tray_available() -> bool { crate::tray::available() }

#[tauri::command]
pub fn hide_to_tray(app: tauri::AppHandle) { crate::tray::hide_main(&app); }

#[tauri::command]
pub fn show_from_tray(app: tauri::AppHandle) { crate::tray::show_main(&app); }

#[tauri::command]
pub fn set_restore_on_exit(on: bool) { crate::tray::set_restore_on_exit(on); }

/// Web storage is committed lazily and a tray quit tears the process down
/// before it lands, so settings the user must not lose are mirrored to disk.
#[tauri::command]
pub fn ui_prefs() -> engine::UiPrefs { engine::ui_prefs() }

#[tauri::command]
pub fn set_ui_pref(key: String, value: String) -> Result<(), String> { engine::set_ui_pref(key, value) }

/// Flatpak builds are updated by flatpak itself, so the in-app update channel
/// must be hidden there.
#[tauri::command]
pub fn is_flatpak() -> bool {
    engine::is_flatpak()
}

/// Fallback update path over the same signed latest.json, used when the updater
/// plugin can neither check nor install.
#[tauri::command]
pub async fn update_fallback_check(app: tauri::AppHandle) -> Result<Option<engine::FallbackUpdate>, String> {
    engine::fallback_check(&app).await
}

#[tauri::command]
pub async fn update_fallback_stage(app: tauri::AppHandle) -> Result<Option<engine::FallbackInstall>, String> {
    engine::fallback_stage_latest(&app).await
}

/// Notes of whatever the manifest currently publishes, newer than the running
/// build or not: the "what's new" window shows the changelog of the version
/// already installed, which the update check itself never returns.
#[tauri::command]
pub async fn update_notes(app: tauri::AppHandle) -> Result<Option<engine::FallbackUpdate>, String> {
    engine::fallback_latest(&app).await
}

#[tauri::command]
pub fn update_fallback_run(app: tauri::AppHandle, path: String) -> Result<engine::FallbackInstall, String> {
    engine::fallback_run(&app, &path)
}

/// Liveness ping from the webview; without it the self-heal path kicks in.
#[tauri::command]
pub fn frontend_ready() {
    engine::mark_frontend_ready();
}

#[tauri::command]
pub fn read_crashes() -> Vec<engine::CrashEntry> {
    engine::read_crashes()
}

#[tauri::command]
pub fn clear_crashes() {
    engine::clear_crashes();
}

#[tauri::command]
pub async fn cache_size() -> Result<u64, String> {
    super::blocking(engine::cache_size).await
}

#[tauri::command]
pub async fn clear_cache() -> Result<u64, String> {
    super::blocking(engine::clear_cache).await
}

/// Shared-store numbers for the settings screen. Scanning hashes every mod in
/// every build, so it runs off the event loop.
#[tauri::command]
pub async fn dedupe_scan() -> Result<engine::DedupReport, String> {
    super::blocking(engine::dedupe_scan).await
}

#[tauri::command]
pub async fn dedupe_run() -> Result<engine::DedupReport, String> {
    super::blocking(engine::dedupe_run).await
}

/// Drops stored objects no build points at any more — what removing a mod
/// leaves behind.
#[tauri::command]
pub async fn dedupe_gc() -> Result<u64, String> {
    super::blocking(engine::store_gc).await
}
