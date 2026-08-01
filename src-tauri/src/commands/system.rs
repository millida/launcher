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
    let picked = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new().set_directory(&start).set_title("Папка игры Millida").pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
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
pub fn open_url(url: String) -> Result<(), String> {
    engine::open_external(&url)
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
    pub cpu_cores: u32,
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
        cpu_cores: sys.cpus().len() as u32,
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
pub fn cache_size() -> u64 {
    engine::cache_size()
}

#[tauri::command]
pub fn clear_cache() -> u64 {
    engine::clear_cache()
}
