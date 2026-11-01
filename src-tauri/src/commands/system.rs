// General commands: game folder, music and sounds, autostart, tray, cache, duplicates, fallback update.
// Two things use the network: downloading Minecraft music/sounds and the fallback launcher update. Hardware info is read locally and leaves only through telemetry (see TELEMETRY.md).
use crate::engine;

#[tauri::command]
pub fn ui_text_keys() -> Vec<&'static str> { engine::UI_TEXT_KEYS.to_vec() }

#[tauri::command]
pub fn set_ui_texts(texts: std::collections::HashMap<String, String>) -> usize {
    let applied = engine::set_ui_texts(texts);
    crate::tray::relabel();
    applied
}

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
        engine::pick_folder(engine::dialog().set_directory(&start).set_title(crate::engine::ui("Папка игры Millida"))).await;
    let Some(d) = picked else { return Ok(None) };
    let d = engine::game_root_from_pick(d);
    // refused at pick time, so the player sees why right away
    engine::game_root_candidate_ok(&d)?;
    engine::vouch_game_root(&d);
    Ok(Some(d.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn open_game_folder() { engine::open_game_folder(); }

#[tauri::command]
pub fn open_antivirus_settings() { engine::open_antivirus_settings(); }

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

/// Big media files already in the cache, name -> path. The names are the manifest's (media/manifest.json).
#[tauri::command]
pub async fn media_ready() -> Result<std::collections::BTreeMap<String, String>, String> {
    super::blocking(engine::media_ready).await
}

/// Downloads the named media files (or everything under a name that ends in `/`) and answers with the paths of
/// what is on disk afterwards. The window names files; addresses and hashes live in the core.
#[tauri::command]
pub async fn media_fetch(names: Vec<String>) -> std::collections::BTreeMap<String, String> {
    engine::media_fetch(names).await
}

#[tauri::command]
pub fn music_tracks() -> Vec<engine::MusicTrack> { engine::music_tracks() }

#[tauri::command]
pub fn open_music_folder() { engine::open_music_folder(); }

/// The file picker is the only way in: the webview never names a source path.
#[tauri::command]
pub async fn music_add() -> Result<engine::MusicAdded, String> {
    let d = engine::dialog().set_title(crate::engine::ui("Своя музыка")).add_filter(crate::engine::ui("Музыка"), &engine::MUSIC_EXTS);
    let Some(paths) = engine::pick_files(d).await else {
        return Ok(engine::MusicAdded { added: 0, too_big: vec![] });
    };
    super::blocking(move || engine::add_music_files(paths)).await?
}

#[tauri::command]
pub async fn music_remove(file: String) -> Result<(), String> {
    super::blocking(move || engine::remove_music_track(&file)).await?
}

#[tauri::command]
pub async fn download_mc_music() -> Result<u32, String> { engine::download_mc_music().await }

#[tauri::command]
pub fn ui_sounds() -> Vec<engine::UiSound> { engine::ui_sounds() }

#[tauri::command]
pub async fn download_ui_sounds() -> Result<Vec<engine::UiSound>, String> { engine::download_ui_sounds().await }

#[tauri::command]
// Opens a link in the system browser. The address is checked inside engine::open_external_anyhow (core/external.rs).
pub fn open_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    engine::open_external_anyhow(&app, &url)
}

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn remember_install_id(id: String) -> Result<(), String> {
    engine::remember_install_id(&id)
}

/// Флаг, с которым система запускает лаунчер при входе пользователя.
pub const AUTOSTART_ARG: &str = "--autostart";

pub fn started_by_os() -> bool {
    // A macOS login item gets no arguments: the launch Apple event says it.
    #[cfg(target_os = "macos")]
    if crate::autostart_mac::launched_as_login_item() {
        return true;
    }
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

/// Включён ли запуск вместе с системой.
#[tauri::command]
// Autostart with the system. It turns on only when the user flips the switch.
pub fn autostart_state(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    if cfg!(debug_assertions) {
        return Ok(false);
    }
    #[cfg(target_os = "macos")]
    if crate::autostart_mac::available() {
        return Ok(crate::autostart_mac::is_enabled());
    }
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Включить или выключить запуск вместе с системой; ответ — что вышло на деле.
#[tauri::command]
pub fn autostart_set(app: tauri::AppHandle, on: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    // Dev and test builds never register a login item: every rebuilt target/debug binary is a new
    // program to macOS, and each one used to pop «millida-launcher can run in the background» on
    // the owner's Mac (24.10.2026).
    if cfg!(debug_assertions) {
        return Ok(false);
    }
    #[cfg(target_os = "macos")]
    if crate::autostart_mac::available() {
        crate::autostart_mac::set_enabled(on)?;
        return Ok(crate::autostart_mac::is_enabled());
    }
    let launch = app.autolaunch();
    let now = launch.is_enabled().unwrap_or(false);
    if on && !now {
        launch.enable().map_err(|e| e.to_string())?;
    } else if !on && now {
        launch.disable().map_err(|e| e.to_string())?;
    }
    launch.is_enabled().map_err(|e| e.to_string())
}

/// Hardware and OS facts only, nothing identifying the user.
#[derive(serde::Serialize, Clone)]
pub struct DeviceSpecs {
    pub os: String,
    pub os_version: String,
    pub arch: String,
    pub cpu: String,
    /// Physical cores; 0 when the platform will not report them.
    pub cpu_cores: u32,
    pub cpu_threads: u32,
    pub ram_mb: u32,
    /// Every hardware video card; empty where the platform has no cheap way to list them.
    pub gpus: Vec<String>,
}

/// The facts never change while the process lives, and collecting them opens
/// OS performance counters, so they are read once on the blocking pool.
#[tauri::command]
// Hardware info for telemetry: CPU, cores, memory, graphics cards, OS. No nickname, no serial numbers. This function sends nothing by itself.
pub async fn device_specs() -> Result<DeviceSpecs, String> {
    static SPECS: std::sync::OnceLock<DeviceSpecs> = std::sync::OnceLock::new();
    if let Some(known) = SPECS.get() {
        return Ok(known.clone());
    }
    let specs = super::blocking(collect_device_specs).await?;
    Ok(SPECS.get_or_init(|| specs).clone())
}

fn collect_device_specs() -> DeviceSpecs {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.refresh_cpu_list(sysinfo::CpuRefreshKind::nothing());

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
        gpus: engine::adapter_names(),
    }
}

/// SSD or spinning disk under the games folder: "ssd", "hdd" or "unknown". One word for usage
/// statistics, read from the drive itself; the folder is the core's own, not the page's.
#[tauri::command]
pub async fn disk_kind() -> Result<String, String> {
    static KIND: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    if let Some(known) = KIND.get() {
        return Ok(known.clone());
    }
    let kind = super::blocking(|| engine::disk_kind(&engine::game_root()).to_string()).await?;
    Ok(KIND.get_or_init(|| kind).clone())
}

/// Hiding is gated on a live tray icon, so the webview cannot hide the window
/// into nowhere.
#[tauri::command]
pub fn tray_available() -> bool { crate::tray::available() }

#[tauri::command]
pub fn hide_to_tray(app: tauri::AppHandle) { crate::tray::hide_main(&app); }

/// A start by the OS hides the window before the webview listens, so the
/// visibility event is missed and the UI has to ask once on boot.
#[tauri::command]
pub fn main_window_visible(app: tauri::AppHandle) -> bool { crate::tray::main_visible(&app) }

#[tauri::command]
pub fn show_from_tray(app: tauri::AppHandle) { crate::tray::show_main(&app); }

#[tauri::command]
pub fn set_restore_on_exit(on: bool) { crate::tray::set_restore_on_exit(on); }

/// The page leaves the screen (tray or game): the window and its WebView2 are
/// destroyed, or parked while `hold` («install», «call») still lives in it.
#[tauri::command]
pub fn unload_main_window(app: tauri::AppHandle, reason: String, hold: Option<String>, screen: Option<String>) {
    use crate::background::{unload, Hold, Reason};
    // Destroying the window that is running this command waits for the main thread.
    let reason = Reason::parse(&reason);
    let hold = Hold::parse(hold.as_deref());
    let h = app.clone();
    let _ = app.run_on_main_thread(move || {
        unload(&h, reason, hold, screen);
    });
}

/// What a rebuilt page should come back to: the screen it left and the links that came meanwhile.
#[tauri::command]
pub fn take_window_resume() -> crate::background::WindowResume { crate::background::take_resume() }

/// The last presence beat the page sent, for the core to repeat while the game runs without a window.
#[tauri::command]
pub fn remember_beat(path: String, body: serde_json::Value) -> Result<(), String> { crate::background::remember_beat(path, body) }

#[tauri::command]
pub async fn set_tray_last_build(build: String) -> Result<(), String> {
    super::blocking(move || crate::tray::set_last_build(&build)).await?
}

/// Web storage is committed lazily and a tray quit tears the process down
/// before it lands, so settings the user must not lose are mirrored to disk.
#[tauri::command]
pub async fn ui_prefs() -> Result<engine::UiPrefs, String> { super::blocking(engine::ui_prefs).await }

/// File writes retry with sleeps while an antivirus holds the file, so they
/// must not run on the UI thread.
#[tauri::command]
pub async fn set_ui_pref(key: String, value: String) -> Result<(), String> {
    super::blocking(move || engine::set_ui_pref(key, value)).await?
}

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

/// `skip_delta` is for the retry after a patch update failed to install: the full installer then, whatever the release offers.
#[tauri::command]
pub async fn update_fallback_stage(app: tauri::AppHandle, skip_delta: Option<bool>) -> Result<Option<engine::FallbackInstall>, String> {
    engine::fallback_stage_latest(&app, skip_delta.unwrap_or(false)).await
}

/// The window found an update through the plugin; this asks whether a patch from the installed exe can replace the
/// full download. `None` means no, and the plugin downloads as before.
#[tauri::command]
pub async fn update_delta_stage(app: tauri::AppHandle) -> Result<Option<engine::DeltaStaged>, String> {
    engine::delta_stage_latest(&app).await
}

/// An update the core has already downloaded and verified. It lives on disk, so a rebuilt window
/// (tray, game) does not download it again and a quit from the tray can install it.
#[tauri::command]
pub async fn update_staged(app: tauri::AppHandle) -> Result<Option<engine::FallbackInstall>, String> {
    super::blocking(move || engine::staged_update(&app)).await
}

/// Notes of whatever the manifest currently publishes, newer than the running
/// build or not: the "what's new" window shows the changelog of the version
/// already installed, which the update check itself never returns.
#[tauri::command]
pub async fn update_notes(app: tauri::AppHandle) -> Result<Option<engine::FallbackUpdate>, String> {
    engine::fallback_latest(&app).await
}

#[tauri::command]
// Starts a downloaded and checked launcher update (fallback path if the built-in update failed). The signature is checked in core/selfupdate.rs.
pub fn update_fallback_run(
    app: tauri::AppHandle,
    path: String,
    restart: Option<bool>,
) -> Result<engine::FallbackInstall, String> {
    engine::fallback_run(&app, &path, restart.unwrap_or(true))
}

/// Called right before the player's own "Update": the relaunched build then
/// opens its window even though it inherits `--autostart`.
#[tauri::command]
pub async fn show_after_update() -> Result<(), String> {
    super::blocking(engine::mark_show_after_update).await?
}

/// Liveness ping from the webview; without it the self-heal path kicks in.
#[tauri::command]
pub fn frontend_ready(app: tauri::AppHandle) {
    engine::mark_frontend_ready();
    crate::background::replay(&app);
    // Started with the system and still in the tray a minute later: the page has
    // sent its start and checked for updates, the window is no longer needed.
    if started_by_os() && !crate::background::reopened() {
        let h = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            if crate::tray::available() && !crate::tray::main_visible(&h) && !crate::background::parked() {
                let _ = h.clone().run_on_main_thread(move || {
                    if !crate::tray::main_visible(&h) {
                        crate::background::unload(&h, crate::background::Reason::Autostart, None, None);
                    }
                });
            }
        });
    }
}

#[tauri::command]
pub async fn read_crashes() -> Result<Vec<engine::CrashEntry>, String> {
    super::blocking(engine::read_crashes).await
}

#[tauri::command]
pub async fn clear_crashes() -> Result<(), String> {
    super::blocking(engine::clear_crashes).await
}

#[tauri::command]
pub async fn cache_size() -> Result<u64, String> {
    super::blocking(engine::cache_size).await
}

#[tauri::command]
// Clears the launcher cache (the cache folder inside the launcher data, not the game folder).
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

#[tauri::command]
pub async fn minecraft_news() -> Result<Vec<engine::McNews>, String> {
    engine::minecraft_news().await
}
