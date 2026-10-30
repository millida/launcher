// Modpack (profile) commands: create, copy, settings, screenshots, graphics card.
// Files only inside the launcher data folder. JVM arguments from the settings are checked before they are saved.
use crate::engine;

#[tauri::command(async)]
pub fn duplicate_profile(name: String) -> Result<Vec<engine::Profile>, String> { engine::duplicate_profile(&name) }

/// Both fields end up on a JVM command line on every launch, so they are checked
/// here as well as when the command line is built.
#[tauri::command(async)]
pub fn save_profile_settings(profile: String, jvm_args: String, width: u32, height: u32, java_path: Option<String>) -> Result<(), String> {
    if let Some(bad) = engine::rejected_jvm_arg(&jvm_args) {
        return Err(format!("Аргумент «{}» лаунчер не передаёт Java: можно память (-Xmx, -Xms), известные флаги -XX и безопасные -D", bad));
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

#[tauri::command(async)]
pub fn skin_mod_state(profile: String) -> serde_json::Value { engine::skin_mod_state(&profile) }

/// Off takes the jar out of the build now and keeps it out: the launcher used to
/// put its skin mod back on the next launch, so a build it does not fit could
/// not be fixed by removing it.
#[tauri::command(async)]
pub fn set_skin_mod(profile: String, on: bool) -> Result<serde_json::Value, String> {
    engine::set_skin_mod(&profile, on)
}

#[tauri::command(async)]
pub fn fps_boost_state(profile: String) -> engine::FpsBoostState { engine::fps_boost_state(&profile) }

#[tauri::command]
pub async fn set_fps_boost(
    app: tauri::AppHandle,
    profile: String,
    on: bool,
    keep_options: Option<bool>,
    video: Option<Vec<(String, String)>>,
    vulkan: Option<bool>,
) -> Result<engine::FpsBoostState, String> {
    engine::set_fps_boost(app, profile, on, keep_options.unwrap_or(false), video, vulkan).await
}

/// Graphics preset of a build: which one, whether it can be undone, the FPS of
/// the last sessions (counted by the core while the game ran).
#[tauri::command(async)]
pub fn gfx_preset_state(profile: String) -> engine::GfxPresetState { engine::gfx_preset_state(&profile) }

/// `preset` is one of potato/low/standard/high/epic; `video` the graphics keys
/// for this PC from src/lib/gfxPresets.ts, filtered by the core like the FPS
/// boost's; `source` "global" when the launcher-wide choice is being applied.
#[tauri::command]
pub async fn apply_gfx_preset(
    app: tauri::AppHandle,
    profile: String,
    preset: String,
    video: Option<Vec<(String, String)>>,
    source: Option<String>,
    battery: Option<bool>,
    auto: Option<bool>,
) -> Result<engine::GfxPresetState, String> {
    engine::apply_gfx_preset(app, profile, preset, video, source, battery, auto).await
}

/// A video driver Sodium does not start on, for Settings and onboarding: the "Update driver" button.
#[tauri::command(async)]
pub fn gpu_driver_issue() -> Option<engine::DriverIssue> { engine::driver_issue() }

#[tauri::command(async)]
pub fn revert_gfx_preset(profile: String) -> Result<engine::GfxPresetState, String> { engine::revert_gfx_preset(&profile) }

/// Played builds without a graphics choice: the "Optimise my builds (N)" button in Settings.
#[tauri::command(async)]
pub fn gfx_unchosen_builds() -> Vec<String> { engine::gfx_unchosen_builds() }

/// The build page's pick: saved at once, applied before the next start. `preset`
/// null follows the launcher-wide choice, "none" keeps the files as they are.
#[tauri::command(async)]
pub fn choose_gfx_preset(profile: String, preset: Option<String>) -> Result<engine::GfxPresetState, String> {
    engine::choose_gfx_preset(&profile, preset)
}

/// Brings a friend's build up to its author's last publication; `apply` off
/// only reports whether one is waiting.
#[tauri::command]
pub async fn shared_pack_sync(
    app: tauri::AppHandle,
    profile: String,
    apply: bool,
    approved: Option<Vec<String>>,
) -> Result<engine::SharedSync, String> {
    engine::shared_pack_sync(app, profile, apply, approved.unwrap_or_default()).await
}

/// Desktop shortcut to the build, or straight into one of its worlds or servers.
#[tauri::command]
pub async fn create_build_shortcut(profile: String, world: Option<String>, server: Option<String>) -> Result<String, String> {
    super::blocking(move || engine::create_build_shortcut(&profile, world, server)).await?
}

/// Whether a millida://launch link came from a shortcut made on this computer.
#[tauri::command(async)]
pub fn shortcut_trusted(key: String, profile: String, quickplay: Option<String>) -> bool {
    engine::shortcut_trusted(&key, &profile, quickplay.as_deref())
}

#[tauri::command(async)]
pub fn common_share_state(profile: String) -> engine::CommonShare { engine::common_share_state(&profile) }

/// Which of options.txt, servers.dat, resource packs and shader packs this build shares with others.
#[tauri::command]
pub async fn set_common_share(profile: String, share: engine::CommonShare) -> Result<engine::CommonShare, String> {
    super::blocking(move || engine::set_common_share(&profile, share)).await?
}

/// What a Modrinth modpack holds, for the «Состав» tab before install.
#[tauri::command]
pub async fn modpack_contents(slug: String, version_id: Option<String>) -> Result<engine::PackContents, String> {
    engine::modpack_contents(slug, version_id).await
}

/// A hosting server's uploaded client pack, checked by the sha512 and size its manifest published.
#[tauri::command]
pub async fn install_server_pack_file(
    app: tauri::AppHandle,
    server_id: String,
    sha512: String,
    size: u64,
    name: String,
) -> Result<engine::Profile, String> {
    engine::install_server_pack_file(app, server_id, sha512, size, name).await
}

/// What a Millida catalogue pack holds, from the archive index the catalogue serves.
#[tauri::command]
pub async fn catalog_pack_contents(slug: String) -> Result<engine::PackContents, String> {
    engine::catalog_pack_contents(slug).await
}

#[tauri::command(async)]
pub fn shaders_state(profile: String) -> engine::ShadersState { engine::shaders_state(&profile) }

/// Sodium + Iris + a light shader pack in one click; off removes what it added.
#[tauri::command]
pub async fn set_shaders(app: tauri::AppHandle, profile: String, on: bool) -> Result<engine::ShadersState, String> {
    engine::set_shaders(app, profile, on).await
}

#[tauri::command(async)]
pub fn load_profile_settings(profile: String) -> serde_json::Value {
    std::fs::read_to_string(engine::profile_dir(&profile).join("millida-settings.json"))
        .ok().and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(serde_json::json!({"jvmArgs":"","width":0,"height":0,"javaPath":""}))
}

#[tauri::command]
pub fn open_screenshots(profile: String) { engine::open_screenshots(&profile); }

#[tauri::command(async)]
pub fn count_screenshots(profile: String) -> usize { engine::screenshot_count(&profile) }

#[tauri::command]
pub async fn modpack_versions(slug: String) -> Result<serde_json::Value, String> { engine::modpack_versions(slug).await }

#[tauri::command]
pub async fn update_modpack(app: tauri::AppHandle, profile: String, version_id: String) -> Result<engine::Profile, String> {
    engine::snapshot_before_mod_update(&profile, "modpack").await?;
    engine::update_modpack(app, profile, version_id).await
}

#[tauri::command(async)]
pub fn modpack_info(profile: String) -> serde_json::Value { engine::modpack_info(&profile) }

/// Screenshots are the only game-root files the webview shows, and the grant is
/// per file: opening `profiles/<p>/` to `asset://` would also expose mods and
/// worlds that a compromised webview copied there.
#[tauri::command(async)]
pub fn list_screenshots(app: tauri::AppHandle, profile: String) -> Vec<String> {
    screenshot_gallery(app, profile).into_iter().map(|s| s.path).collect()
}

/// Same per-file grant as the plain list, plus the sizes and dates the gallery
/// shows. An empty profile name means every build.
#[tauri::command(async)]
pub fn screenshot_gallery(app: tauri::AppHandle, profile: String) -> Vec<engine::Screenshot> {
    use tauri::Manager;
    let shots = engine::gallery(&profile);
    let scope = app.asset_protocol_scope();
    for shot in &shots {
        let _ = scope.allow_file(&shot.path);
    }
    shots
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn set_profile_group(name: String, group: String) { engine::set_profile_group(&name, &group); }

#[tauri::command(async)]
pub fn get_profile_groups() -> serde_json::Value { engine::get_profile_groups() }

#[tauri::command(async)]
pub fn set_profile_icon(name: String, icon: String) -> Vec<engine::Profile> {
    engine::set_profile_cover(&name, Some(icon))
}

/// Returns `None` when the picker was dismissed.
#[tauri::command]
pub async fn pick_profile_cover(profile: String) -> Result<Option<Vec<engine::Profile>>, String> {
    engine::pick_profile_cover(profile).await
}

/// Cover for a build that does not exist yet: the New build dialog needs the
/// image before there is a profile to store it on. `None` — picker dismissed.
#[tauri::command]
pub async fn pick_cover_image() -> Result<Option<String>, String> {
    engine::pick_cover_image().await
}

#[tauri::command(async)]
pub fn clear_profile_cover(profile: String) -> Vec<engine::Profile> {
    engine::set_profile_cover(&profile, None)
}

#[tauri::command(async)]
// Deletes a whole modpack when the user clicks. The path is built from the profile name inside the data folder.
pub fn delete_profile(name: String) -> Result<Vec<engine::Profile>, String> { engine::delete_profile(&name) }

#[tauri::command(async)]
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
        engine::move_pack_launch_trust(&name, &nn);
    }
    for p in all.iter_mut() { if p.name == name { p.name = nn.clone(); } }
    engine::save_profiles(&all)?;
    engine::rename_profile_group(&name, &nn);
    Ok(all)
}

/// The version and the loader build become folder and file names under
/// versions/ and parts of download URLs, so the webview cannot name them freely.
fn check_version_and_loader(version: &str, loader: &str, loader_version: Option<&str>) -> Result<(), String> {
    engine::check_version_id(version)?;
    if !["vanilla", "fabric", "quilt", "forge", "neoforge", "legacyfabric"].contains(&loader) {
        return Err(format!("Неизвестный загрузчик «{}»", loader.chars().take(32).collect::<String>()));
    }
    if let Some(lv) = loader_version.map(str::trim).filter(|v| !v.is_empty()) {
        engine::check_loader_version(lv)?;
    }
    Ok(())
}

/// The loader itself is installed on the next launch.
#[tauri::command(async)]
pub fn set_profile_loader(
    name: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
) -> Result<Vec<engine::Profile>, String> {
    check_version_and_loader(&version, &loader, loader_version.as_deref())?;
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

#[tauri::command(async)]
pub fn list_profiles() -> Vec<engine::Profile> {
    engine::load_profiles()
}

#[tauri::command(async)]
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
    check_version_and_loader(&version, &lid, loader_version.as_deref())?;
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
    prep_ms: Option<u64>,
) -> Result<String, String> {
    // A running build only needs its window raised: no sign-in round trip for that.
    if let Some(outcome) = engine::bring_running_forward(&profile, false) {
        return Ok(outcome);
    }
    engine::note_launch_prep(&profile, prep_ms);
    engine::begin_launch()
        .run(async move {
            let mut p = engine::load_profiles()
                .into_iter()
                .find(|x| x.name == profile)
                .unwrap_or(engine::Profile { name: "default".into(), version: "latest".into(), fabric: false, loader: Some("vanilla".into()), loader_version: None, icon: None });
            engine::mend_profile_version(&mut p)?;
            // The account becomes a session next to the install, not before it.
            engine::launch_with_account(app, p.version, nick, p.fabric, ram_mb, p.name, auth).await
        })
        .await
}

/// The lobby shows this build and the player has left the window alone: prepare it for Play
/// without starting it (engine/game/pipeline/warm.rs). Downloads nothing; at most once in ten
/// minutes per build; never during a launch, a download or on a low battery.
#[tauri::command]
pub async fn warm_launch(app: tauri::AppHandle, profile: String, auth: Option<engine::AuthArgs>) -> engine::WarmOutcome {
    engine::warm_launch(app, profile, auth).await
}

#[tauri::command]
pub async fn install_modpack(app: tauri::AppHandle, slug: String) -> Result<engine::Profile, String> {
    engine::install_modpack(app, slug).await
}

#[tauri::command]
pub async fn install_modpack_version(app: tauri::AppHandle, slug: String, version_id: String) -> Result<engine::Profile, String> {
    engine::install_modpack_ver(app, slug, Some(version_id), None).await
}

/// Preview of a move to another game version: which mods have a build there and
/// which stay behind. Nothing is written until `migrate_profile`.
#[tauri::command]
pub async fn migrate_plan(profile: String, version: String, loader: String) -> Result<engine::MigratePlan, String> {
    engine::migrate_plan(profile, version, loader).await
}

#[tauri::command]
pub async fn migrate_profile(
    app: tauri::AppHandle,
    profile: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
    name: Option<String>,
) -> Result<engine::MigrateResult, String> {
    engine::migrate_profile(app, profile, version, loader, loader_version, name).await
}

/// Где купить ключ от платной сборки.
#[tauri::command]
pub async fn pack_buy_url(slug: String) -> Result<String, String> {
    engine::pack_buy_url(&slug).await
}

/// Активация ключа доступа к платной сборке.
#[tauri::command]
pub async fn redeem_pack_key(slug: String, code: String) -> Result<serde_json::Value, String> {
    engine::redeem_pack_key(&slug, &code).await
}

/// Наши готовые сборки — тот же список, что на сайте.
#[tauri::command]
pub async fn millida_packs() -> Result<serde_json::Value, String> {
    engine::catalog_packs().await
}

/// Ready-made pack from the Millida catalogue. The webview names only the
/// catalogue address; the file, the link and the hash are the core's business.
#[tauri::command]
pub async fn install_catalog_pack(app: tauri::AppHandle, slug: String) -> Result<engine::Profile, String> {
    engine::install_catalog_pack(app, slug, false).await
}

/// Same pack, but the version that is still waiting to be reviewed.
///
/// A separate command instead of a flag on the previous one: the review channel
/// must not be reachable by passing an extra field from the webview. The core
/// asks the API, and the API answers only reviewers.
#[tauri::command]
pub async fn install_pack_candidate(app: tauri::AppHandle, slug: String) -> Result<engine::Profile, String> {
    engine::install_catalog_pack(app, slug, true).await
}

/// The published version of a catalogue build in place of the installed one.
/// The webview names only the build: which pack, which version and which file
/// come from the build's own settings and from the catalogue.
#[tauri::command]
pub async fn update_catalog_pack(app: tauri::AppHandle, profile: String) -> Result<engine::Profile, String> {
    engine::snapshot_before_mod_update(&profile, "modpack").await?;
    engine::update_catalog_pack(app, profile).await
}

/// The catalogue card applied to an installed build: its icon and whether its
/// contents are hidden. The webview names only the build.
#[tauri::command]
pub async fn sync_catalog_pack(profile: String) -> Result<bool, String> {
    engine::sync_catalog_pack(profile).await
}

/// Builds whose author keeps the contents to themselves.
#[tauri::command(async)]
pub fn protected_builds() -> Vec<String> {
    engine::protected_builds()
}

#[tauri::command(async)]
pub fn pack_auto_update(profile: String) -> engine::PackAutoUpdate {
    engine::pack_auto_update(&profile)
}

#[tauri::command(async)]
pub fn set_pack_auto_update(profile: String, on: bool) -> Result<engine::PackAutoUpdate, String> {
    engine::set_pack_auto_update(&profile, on)
}

/// Packs whose unreviewed versions this account may install.
#[tauri::command]
pub async fn pack_review_queue() -> Result<serde_json::Value, String> {
    engine::pack_review_queue().await
}

/// Is there a version waiting for review, and what is known about it.
#[tauri::command]
pub async fn pack_review_candidate(slug: String) -> Result<serde_json::Value, String> {
    engine::pack_review_candidate(&slug).await
}

#[tauri::command]
pub async fn cf_install_modpack(app: tauri::AppHandle, mod_id: u32, file_id: Option<u64>) -> Result<engine::Profile, String> {
    engine::cf_install_modpack(app, mod_id, file_id).await
}

#[tauri::command]
pub async fn scan_imports() -> Result<Vec<engine::FoundInstance>, String> {
    super::blocking(engine::scan_imports).await
}

/// «Выбрать папку» в импорте: выбор папки и поиск сборок в ней.
/// `None` — диалог закрыли.
#[tauri::command]
pub async fn pick_import_dir() -> Result<Option<Vec<engine::FoundInstance>>, String> {
    let Some(dir) = engine::pick_folder(engine::dialog().set_title(crate::engine::ui("Папка со сборками"))).await else {
        return Ok(None);
    };
    super::blocking(move || engine::scan_import_dir(&dir)).await.map(Some)
}

/// Offline nick from TLauncher's own files, offered when the player moves over.
#[tauri::command]
pub async fn tlauncher_nick() -> Result<Option<String>, String> {
    super::blocking(engine::tlauncher_nick).await
}

#[tauri::command(async)]
pub fn import_instance(path: String, name: String, version: String, loader: String) -> Result<engine::Profile, String> {
    engine::import_instance(path, name, version, loader)
}

/// Builds of Prism, MultiMC and Modrinth App that can move into Millida whole.
#[tauri::command]
pub async fn plan_moves() -> Result<Vec<engine::MoveCandidate>, String> {
    super::blocking(engine::plan_moves).await
}

/// Copies one build from `plan_moves` into Millida; the build in the other
/// launcher is left as it was.
#[tauri::command]
pub async fn move_instance(path: String) -> Result<engine::MoveOutcome, String> {
    super::blocking(move || engine::move_instance(path)).await?
}

#[tauri::command]
pub async fn import_pack_file(app: tauri::AppHandle, path: Option<String>) -> Result<engine::Profile, String> {
    engine::import_pack_file(app, path).await
}

#[tauri::command]
pub async fn import_dropped_pack(app: tauri::AppHandle, id: u64) -> Result<engine::Profile, String> {
    let path = crate::packdrop::take(id).ok_or("Файл больше не доступен — перетащи его заново")?;
    engine::import_pack_path(app, path).await
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
pub async fn install_shared_pack(
    app: tauri::AppHandle,
    code: String,
    approved_jars: Option<Vec<String>>,
) -> Result<engine::Profile, String> {
    engine::install_shared_pack(app, code, approved_jars.unwrap_or_default()).await
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

#[tauri::command(async)]
pub fn list_build_files(profile: String, rel: String) -> Result<Vec<engine::BuildFile>, String> {
    engine::list_build_files(&profile, &rel)
}

#[tauri::command(async)]
pub fn reveal_build_file(profile: String, rel: String) -> Result<(), String> {
    engine::reveal_build_file(&profile, &rel)
}

#[tauri::command(async)]
pub fn delete_build_file(profile: String, rel: String) -> Result<(), String> {
    engine::delete_build_file(&profile, &rel)
}

#[tauri::command(async)]
pub fn dismiss_embedded_jars(profile: String) {
    engine::dismiss_embedded_jars(&profile)
}

#[tauri::command]
pub async fn pick_backups_root() -> Result<Option<String>, String> {
    engine::pick_backups_root().await
}

#[tauri::command]
pub fn reset_backups_root() -> Result<(), String> {
    engine::reset_backups_root()
}

#[tauri::command]
pub fn backups_root_dir() -> Option<String> {
    engine::backups_root_dir()
}

/// The JRE vendor for a build's pinned Java. Only a name from the fixed set
/// crosses the bridge; the runtime is fetched and checked by sha256 before the
/// choice is saved, so a build never points at a runtime that is not there.
#[tauri::command]
pub async fn set_profile_java_vendor(app: tauri::AppHandle, profile: String, vendor: String) -> Result<String, String> {
    let v = engine::JavaVendor::parse(&vendor).ok_or("Такую сборку Java лаунчер не ставит")?;
    let major = engine::profile_java_major(&profile).ok_or("Сначала выбери версию Java для сборки")?;
    let bin = engine::ensure_java_vendor(&app, major, v).await?;
    let mut patch = serde_json::Map::new();
    patch.insert("javaVendor".into(), serde_json::json!(v.id()));
    engine::merge_settings(&profile, patch);
    Ok(engine::java_version_of(&bin).unwrap_or_default())
}

#[tauri::command(async)]
pub fn horizon_state(profile: String) -> engine::HorizonState {
    engine::horizon_state(&profile)
}

#[tauri::command(async)]
pub fn horizon_state_for(version: String, loader: String) -> engine::HorizonState {
    engine::horizon_state_for(&version, &loader)
}

#[tauri::command(async)]
pub fn set_horizon(profile: String, on: bool) -> Result<engine::HorizonState, String> {
    engine::set_horizon(&profile, on)
}

#[tauri::command]
pub fn horizon_java_once(profile: String) {
    engine::horizon_java_once(&profile)
}

#[tauri::command(async)]
pub fn linux_tools_state(profile: String) -> engine::LinuxTools {
    engine::linux_tools_state(&profile)
}

#[tauri::command(async)]
pub fn set_linux_tools(profile: String, gamemode: bool, gamescope: bool) -> Result<engine::LinuxTools, String> {
    engine::set_linux_tools(&profile, gamemode, gamescope)
}

#[tauri::command(async)]
pub fn list_build_templates() -> Vec<engine::BuildTemplate> {
    engine::list_build_templates()
}

#[tauri::command(async)]
pub fn save_build_template(profile: String, name: String) -> Result<engine::BuildTemplate, String> {
    engine::save_build_template(&profile, &name)
}

#[tauri::command(async)]
pub fn delete_build_template(id: String) -> Result<(), String> {
    engine::delete_build_template(&id)
}

#[tauri::command]
pub async fn apply_build_template(app: tauri::AppHandle, id: String, profile: String) -> Result<engine::DepReport, String> {
    engine::apply_build_template(app, id, profile).await
}

/// A packwiz pack by its pack.toml link. Only the link crosses the bridge; the
/// core checks it and every file by the hashes the pack itself publishes.
#[tauri::command]
pub async fn import_packwiz(app: tauri::AppHandle, url: String) -> Result<engine::PackwizResult, String> {
    engine::import_packwiz(app, url).await
}

#[tauri::command]
pub async fn packwiz_check(profile: String) -> Result<engine::PackwizCheck, String> {
    engine::packwiz_check(profile).await
}

#[tauri::command]
pub async fn packwiz_update(app: tauri::AppHandle, profile: String) -> Result<engine::PackwizResult, String> {
    engine::packwiz_update(app, profile).await
}

#[tauri::command(async)]
pub fn set_screenshot_note(profile: String, name: String, caption: String, album: String) -> Result<engine::ShotNote, String> {
    engine::set_screenshot_note(&profile, &name, &caption, &album)
}

#[tauri::command]
pub async fn crop_screenshot(profile: String, name: String, rect: engine::CropRect) -> Result<String, String> {
    engine::crop_screenshot(profile, name, rect).await
}

/// The author's choice of who may open a shared code; the server checks ownership.
#[tauri::command]
pub async fn set_pack_visibility(code: String, visibility: String) -> Result<String, String> {
    engine::set_pack_visibility(code, visibility).await
}
