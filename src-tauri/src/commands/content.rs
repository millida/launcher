// UI commands about mods, modpacks, worlds and catalogs: install, update, delete.
// Network goes through engine (Modrinth, CurseForge, the Millida catalog). Disk: only the profile folder and the launcher data folder.
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
    engine::refuse_author_locked(&profile, "mod")?;
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
    engine::refuse_author_locked(&profile, &kind)?;
    engine::install_content(app, project, game_version, profile, kind, allow_mismatch.unwrap_or(false)).await
}

/// Read-only preview of what an install would pull in. Nothing is downloaded,
/// so the frontend may call it before every install.
#[tauri::command]
pub async fn dep_plan(
    profile: String,
    kind: String,
    source: String,
    project: String,
    version_id: Option<String>,
) -> Result<engine::DepPlan, String> {
    engine::dep_plan(profile, kind, source, project, version_id).await
}

#[tauri::command]
pub async fn install_dep_items(
    app: tauri::AppHandle,
    profile: String,
    kind: String,
    items: Vec<engine::PlanItem>,
) -> Result<engine::DepReport, String> {
    engine::refuse_author_locked(&profile, &kind)?;
    engine::install_dep_items(app, profile, kind, items).await
}

#[tauri::command]
pub async fn audit_deps(profile: String) -> Result<engine::DepAudit, String> {
    engine::audit_deps(profile).await
}

#[tauri::command(async)]
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

#[tauri::command(async)]
pub fn toggle_content(profile: String, kind: String, name: String, enable: bool) -> Result<(), String> {
    engine::toggle_content(&profile, &kind, &name, enable)
}

#[tauri::command(async)]
pub fn delete_content(profile: String, kind: String, name: String) -> Result<(), String> {
    engine::delete_content(&profile, &kind, &name)
}

#[tauri::command(async)]
pub fn list_mods(profile: String) -> Vec<engine::ModFile> { engine::list_mods(&profile) }

#[tauri::command(async)]
pub fn toggle_mod(profile: String, name: String, enable: bool) -> Result<(), String> {
    engine::toggle_mod(&profile, &name, enable)
}

#[tauri::command(async)]
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
    engine::refuse_author_locked(&profile, &kind)?;
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

/// A Millida catalogue file (free or paid) into a build. The core asks for the
/// signed address itself; the webview names only the build, item and file id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn install_catalog_file(
    app: tauri::AppHandle,
    profile: String,
    kind: String,
    slug: String,
    file_id: String,
    title: String,
    sha1: Option<String>,
) -> Result<engine::ContentInstall, String> {
    engine::refuse_author_locked(&profile, &kind)?;
    engine::install_catalog_file(app, profile, kind, slug, file_id, title, sha1).await
}

#[tauri::command(async)]
pub fn list_world_installs(profile: String) -> Vec<String> { engine::list_world_installs(&profile) }

/// Installs live in the engine and survive a webview reload; the frontend polls
/// this to restore progress rows.
#[tauri::command]
pub fn active_installs() -> Vec<engine::JobInfo> { engine::active_jobs() }

#[tauri::command]
pub fn cancel_install(key: String) -> bool { engine::cancel_job(&key) }

#[tauri::command]
pub fn pause_install(key: String, paused: bool) -> bool { engine::pause_job(&key, paused) }

#[tauri::command]
pub async fn list_versions() -> Result<Vec<String>, String> {
    engine::list_versions().await
}

#[tauri::command]
pub async fn list_versions_typed() -> Result<Vec<engine::McVersion>, String> {
    engine::list_versions_typed().await
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
    engine::snapshot_before_mod_update(&profile, &kind).await?;
    engine::update_content(profile, kind, name).await
}

#[tauri::command]
pub async fn content_versions(profile: String, kind: String, name: String) -> Result<Vec<engine::VersionChoice>, String> {
    engine::content_versions(profile, kind, name).await
}

#[tauri::command]
pub async fn set_content_version(profile: String, kind: String, name: String, version_id: String) -> Result<String, String> {
    engine::snapshot_before_mod_update(&profile, &kind).await?;
    engine::set_content_version(profile, kind, name, version_id).await
}

#[tauri::command]
pub async fn update_all(profile: String, kind: String) -> Result<u32, String> {
    engine::snapshot_before_mod_update(&profile, &kind).await?;
    engine::update_all(profile, kind).await
}

#[tauri::command]
pub async fn add_local_file(profile: String, kind: String, path: String) -> Result<String, String> {
    engine::refuse_author_locked(&profile, &kind)?;
    engine::add_local_file(profile, kind, path).await
}

#[tauri::command]
pub async fn pick_content_files(kind: String) -> Result<Vec<String>, String> {
    engine::pick_content_files(kind).await
}

#[tauri::command]
pub async fn install_version(app: tauri::AppHandle, project: String, version_id: String, profile: String, kind: String, allow_mismatch: Option<bool>) -> Result<engine::ContentInstall, String> {
    engine::refuse_author_locked(&profile, &kind)?;
    engine::install_version(app, project, version_id, profile, kind, allow_mismatch.unwrap_or(false)).await
}

#[tauri::command]
pub async fn export_mrpack(profile: String, name: String, version: String, description: String) -> Result<String, String> {
    // Имя файла собирается только из безопасных символов — и из названия, и из
    // имени сборки, если название пустое (аудит 24.09.2026, CORE-3).
    let base = engine::export_file_stem(&name, &profile);
    let out = engine::data_dir().join("exports").join(format!("{}.mrpack", base));
    let dst = out.to_string_lossy().to_string();
    let loader_build = engine::export_loader_build(&profile).await;
    let res = super::blocking(move || engine::export_mrpack(profile, dst, name, version, description, loader_build)).await??;
    if let Some(p) = out.parent() {
        engine::open_path(&p.to_string_lossy());
    }
    Ok(res)
}

/// Потолок архива сборки для сервера хостинга (как у бесплатного тарифа на сервере).
const HOSTING_PACK_MAX_BYTES: usize = 128 * 1024 * 1024;
/// Кусок заливки: меньше потолка тела у API, чтобы обрыв стоил одного куска.
const HOSTING_PACK_CHUNK: usize = 4 * 1024 * 1024;

/// Имя архива на сервере: только `[A-Za-z0-9._-]`, с отметкой времени — принятый
/// установкой архив сервер перезаписать не даёт.
fn hosting_pack_name(profile: &str, stamp: u64) -> String {
    let stem: String = profile
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    let stem = if stem.is_empty() { "build".to_string() } else { stem };
    format!("{}-{}.mrpack", stem, stamp)
}

/// Свою сборку — на сервер хостинга: ядро собирает из неё `.mrpack` и заливает
/// кусками в корень сервера. Webview называет только сборку и сервер; ни пути
/// на диске, ни адреса API он не знает. Возвращает имя залитого архива —
/// установку по нему запускает уже обычный запрос API.
#[tauri::command]
// Sends a modpack to Millida hosting when the user clicks: packs it as .mrpack, sends it in chunks through the Millida API with the account token.
pub async fn hosting_send_build(profile: String, server_id: String) -> Result<String, String> {
    if server_id.is_empty() || server_id.len() > 64 || !server_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad server".into());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = hosting_pack_name(&profile, stamp);
    let out = engine::data_dir().join("exports").join("hosting").join(&name);
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let dst = out.to_string_lossy().to_string();
    let loader_build = engine::export_loader_build(&profile).await;
    let title = profile.clone();
    super::blocking(move || engine::export_mrpack(profile, dst, title, String::new(), String::new(), loader_build)).await??;
    let bytes = tokio::fs::read(&out).await.map_err(|e| e.to_string())?;
    // Deletes our own temporary .mrpack from exports/hosting after reading it into memory.
    let _ = tokio::fs::remove_file(&out).await;
    let total = bytes.len();
    if total == 0 {
        return Err("Сборка пустая — выгружать нечего".into());
    }
    if total > HOSTING_PACK_MAX_BYTES {
        return Err("Сборка больше 128 МБ — на сервер из лаунчера её не отправить".into());
    }
    let mut offset = 0usize;
    while offset < total {
        let end = (offset + HOSTING_PACK_CHUNK).min(total);
        let path = format!(
            "/hosting/servers/{}/files/upload?path={}&offset={}&total={}&append={}",
            server_id,
            name,
            offset,
            total,
            if offset == 0 { 0 } else { 1 }
        );
        engine::millida_post_bytes_auth(path, bytes[offset..end].to_vec()).await?;
        offset = end;
    }
    Ok(name)
}

#[cfg(test)]
mod hosting_pack_tests {
    use super::hosting_pack_name;

    #[test]
    fn name_is_safe_for_the_server_root() {
        let n = hosting_pack_name("Выживание с друзьями / mods..", 42);
        assert_eq!(n, "mods-42.mrpack");
        assert!(n.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_'));
    }

    #[test]
    fn empty_stem_still_gives_a_name() {
        assert_eq!(hosting_pack_name("Сборка", 7), "build-7.mrpack");
    }
}

/// Reads every jar in the build and says which files a catalogue vouches for,
/// which are unknown and which do things a mod has no business doing.
#[tauri::command]
pub async fn scan_mod_safety(profile: String) -> Result<engine::SafetyReport, String> {
    engine::scan_safety(profile).await
}

/// Checks files the player picks in a system dialog the core opens. `None` means
/// the dialog was dismissed.
#[tauri::command]
pub async fn scan_picked_files() -> Result<Option<engine::SafetyReport>, String> {
    engine::scan_picked_files().await
}

/// Turns off the files named by the report. The webview passes back file names
/// it received from the same report; the core re-checks each one.
#[tauri::command]
pub async fn quarantine_mods(profile: String, files: Vec<String>) -> Result<u32, String> {
    super::blocking(move || engine::quarantine(&profile, files)).await?
}

/// Материал каталога Millida в сборку (или модпак новой сборкой). Адрес файла
/// ядро берёт у нашего API само — из вебвью приходят только slug и id файла.
#[tauri::command]
pub async fn catalog_install(app: tauri::AppHandle, req: engine::CatalogInstallReq) -> Result<engine::CatalogInstall, String> {
    if !req.profile.is_empty() {
        engine::refuse_author_locked(&req.profile, &req.kind)?;
    }
    engine::content_catalog_install(app, req).await
}

/// Материал каталога с зависимостями — по плану, который собирает API
/// (/catalog/items/:slug/resolve). План ядро запрашивает само.
#[tauri::command]
pub async fn catalog_install_plan(app: tauri::AppHandle, req: engine::CatalogPlanReq) -> Result<engine::CatalogPlanDone, String> {
    engine::refuse_author_locked(&req.profile, &req.kind)?;
    engine::catalog_install_plan(app, req).await
}
/// Косметика Millida: подбор варианта под сборку и установка одной кнопкой.
#[tauri::command]
pub async fn millida_mod_state(profile: String) -> Result<engine::MillidaModState, String> {
    engine::millida_mod_state(profile).await
}

/// Only the build name crosses the bridge; the core checks it against its own
/// list and decides which files go.
#[tauri::command(async)]
pub fn lift_millida_mod_quarantine(profile: String) -> Result<serde_json::Value, String> {
    engine::lift_millida_mod_quarantine(&profile)?;
    Ok(engine::skin_mod_state(&profile))
}

#[tauri::command]
pub async fn millida_mod_install(
    app: tauri::AppHandle,
    profile: String,
) -> Result<engine::MillidaModState, String> {
    engine::millida_mod_install(app, profile).await
}

#[tauri::command(async)]
pub fn millida_mod_enabled() -> bool {
    engine::millida_mod_enabled()
}

#[tauri::command(async)]
pub fn set_game_telemetry(on: bool) -> Result<(), String> {
    engine::set_game_telemetry_enabled(on)
}

#[tauri::command(async)]
pub fn set_millida_mod_enabled(on: bool) -> Result<(), String> {
    engine::set_millida_mod_enabled(on)
}

#[tauri::command(async)]
pub fn pvp_hud_default() -> bool {
    engine::pvp_hud_default()
}

#[tauri::command(async)]
pub fn set_pvp_hud_default(on: bool) -> Result<(), String> {
    engine::set_pvp_hud_default(on)
}


#[tauri::command(async)]
pub fn set_content_locked(profile: String, kind: String, name: String, on: bool) -> Result<bool, String> {
    engine::set_content_locked(&profile, &kind, &name, on)
}

#[tauri::command(async)]
pub fn set_content_tags(profile: String, kind: String, name: String, tags: Vec<String>) -> Result<Vec<String>, String> {
    engine::set_content_tags(&profile, &kind, &name, tags)
}

#[tauri::command(async)]
pub fn content_tags(profile: String, kind: String) -> Vec<String> {
    engine::content_tags(&profile, &kind)
}

/// Export in the format another launcher reads. The webview names the format
/// from a fixed set; the file name is cleaned the same way as for .mrpack.
#[tauri::command]
pub async fn export_pack(profile: String, format: String, ram_mb: Option<u32>, lock_content: Option<bool>) -> Result<String, String> {
    let ext = match format.as_str() {
        "mrpack" => "mrpack",
        "curseforge" => "curseforge.zip",
        "multimc" => "multimc.zip",
        _ => return Err("Неизвестный формат выгрузки".into()),
    };
    let base = engine::export_file_stem(&profile, &profile);
    let out = engine::data_dir().join("exports").join(format!("{}.{}", base, ext));
    let dst = out.to_string_lossy().to_string();
    let loader_build = engine::export_loader_build(&profile).await;
    let author = engine::author_meta_of(&profile, ram_mb.unwrap_or(0), lock_content.unwrap_or(false));
    let res = super::blocking(move || match format.as_str() {
        "mrpack" => engine::export_mrpack_with(profile.clone(), dst, profile, String::new(), String::new(), loader_build, Some(author)),
        "curseforge" => engine::export_curseforge(profile.clone(), dst, profile, String::new(), loader_build, author),
        _ => engine::export_multimc(profile.clone(), dst, profile, loader_build, author),
    })
    .await??;
    if let Some(p) = out.parent() {
        engine::open_path(&p.to_string_lossy());
    }
    Ok(res)
}

#[tauri::command(async)]
pub fn world_datapacks(profile: String, world: String) -> Result<Vec<engine::WorldPack>, String> {
    engine::world_datapacks(&profile, &world)
}

#[tauri::command(async)]
pub fn set_world_datapack(profile: String, world: String, name: String, enable: bool) -> Result<(), String> {
    engine::set_world_datapack(&profile, &world, &name, enable)
}

#[tauri::command(async)]
pub fn delete_world_datapack(profile: String, world: String, name: String) -> Result<(), String> {
    engine::delete_world_datapack(&profile, &world, &name)
}

#[tauri::command(async)]
pub fn add_datapack_to_world(profile: String, world: String, name: String) -> Result<(), String> {
    engine::add_datapack_to_world(&profile, &world, &name)
}

/// Resource packs, shader packs, data packs and worlds read for programs hidden inside.
#[tauri::command]
pub async fn scan_pack_safety(profile: String) -> Result<engine::SafetyReport, String> {
    engine::scan_pack_safety(profile).await
}

/// Takes back keys the same report produced; the core re-checks each name.
#[tauri::command]
pub async fn quarantine_packs(profile: String, files: Vec<String>) -> Result<u32, String> {
    super::blocking(move || engine::quarantine_packs(&profile, files)).await?
}

#[tauri::command]
pub async fn ftb_search(term: String) -> Result<Vec<engine::FtbPack>, String> {
    engine::ftb_search(term).await
}

/// Only the pack id crosses the bridge; the core reads its files from the FTB API.
#[tauri::command]
pub async fn ftb_install(app: tauri::AppHandle, id: u64) -> Result<engine::Profile, String> {
    engine::ftb_install(app, id).await
}
