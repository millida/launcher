use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct Profile {
    pub name: String,
    pub version: String,
    pub fabric: bool,
    /// "vanilla" | "fabric" | "quilt" | "forge" | "neoforge"
    #[serde(default)]
    pub loader: Option<String>,
    /// Exact loader build pinned by a modpack ("47.2.0" for forge-47.2.0);
    /// empty means use the recommended build.
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

impl Profile {
    pub fn loader_id(&self) -> String {
        self.loader.clone().unwrap_or_else(|| if self.fabric { "fabric".into() } else { "vanilla".into() })
    }
}

/// "forge-47.2.0" -> ("forge", Some("47.2.0")): the encoding used by both the
/// CurseForge manifest and .mrpack dependencies.
pub(crate) fn split_loader_id(full: &str) -> (String, Option<String>) {
    let low = full.trim().to_ascii_lowercase();
    let id = ["neoforge", "forge", "quilt", "fabric"].into_iter()
        .find(|l| low.starts_with(l)).unwrap_or("vanilla");
    let ver = low.strip_prefix(id).map(|r| r.trim_start_matches(['-', '_']).trim().to_string())
        .filter(|v| !v.is_empty() && v.starts_with(|c: char| c.is_ascii_digit()));
    (id.to_string(), ver)
}

pub(crate) fn profiles_path() -> PathBuf { data_dir().join("profiles.json") }

fn read_profiles_file() -> Vec<Profile> {
    std::fs::read(profiles_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn dir_slug(name: &str) -> String {
    profile_dir(name).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn profile_from_dir(dir: &std::path::Path, slug: &str) -> Option<Profile> {
    let s: Value = std::fs::read(dir.join("millida-settings.json")).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let name = match s["name"].as_str() {
        Some(n) if !n.is_empty() && dir_slug(n) == slug => n.to_string(),
        _ => slug.to_string(),
    };
    let mut version = s["version"].as_str().unwrap_or("").to_string();
    let mut loader = s["loader"].as_str().unwrap_or("").to_string();
    if version.is_empty() {
        let (v, l) = detect_from_game_dir(dir)?;
        version = v;
        if loader.is_empty() { loader = l }
    }
    if loader.is_empty() || loader == "vanilla" {
        if let Some(l) = loader_from_mods_dir(dir) { loader = l }
    }
    if loader.is_empty() { loader = "vanilla".into() }
    if version.is_empty() { return None }
    Some(Profile {
        name,
        version,
        fabric: loader == "fabric",
        loader: Some(loader),
        loader_version: s["loaderVersion"].as_str().filter(|v| !v.is_empty()).map(String::from),
        icon: s["icon"].as_str().filter(|i| !i.is_empty()).map(|i| i.to_string()),
    })
}

/// Disk is a second source of truth next to profiles.json, so profiles survive
/// a game-root change or being copied back in manually.
fn adopt_disk_profiles(all: &mut Vec<Profile>) -> bool {
    let root = game_root().join("profiles");
    let Ok(rd) = std::fs::read_dir(&root) else { return false };
    let known: std::collections::HashSet<String> = all.iter().map(|p| dir_slug(&p.name)).collect();
    let mut added = false;
    for e in rd.flatten() {
        let dir = e.path();
        if !dir.is_dir() { continue }
        let slug = e.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') || known.contains(&slug) { continue }
        let Some(p) = profile_from_dir(&dir, &slug) else { continue };
        if all.iter().any(|x| x.name == p.name) { continue }
        all.push(p);
        added = true;
    }
    added
}

pub fn load_profiles() -> Vec<Profile> {
    let mut all = read_profiles_file();
    if adopt_disk_profiles(&mut all) {
        let _ = save_profiles(&all);
    }
    all
}

pub fn save_profiles(p: &[Profile]) -> Result<(), String> {
    for x in p { remember_profile(x); }
    let path = profiles_path();
    if let Err(first) = write_json_atomic(&path, &p) {
        let bytes = serde_json::to_vec_pretty(&p).map_err(|e| e.to_string())?;
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("Не удалось сохранить список сборок: {} / {}", first, e))?;
    }
    Ok(())
}

/// A name is taken if it is in the list OR its folder exists: the folder is the
/// name stripped of spaces and punctuation, so different names can collapse onto
/// the same directory.
pub(crate) fn unique_profile_name(base: &str) -> String {
    let base = base.trim();
    let base = if base.is_empty() { "Импортированная сборка" } else { base };
    let all = load_profiles();
    let mut nm = base.to_string();
    let mut i = 2;
    while all.iter().any(|p| p.name == nm) || profile_dir(&nm).exists() {
        nm = format!("{} ({})", base, i);
        i += 1;
    }
    nm
}

pub fn profile_dir(name: &str) -> PathBuf {
    let safe: String = name.chars().filter(|c| c.is_alphanumeric() || *c=='-' || *c=='_').collect();
    game_root().join("profiles").join(if safe.is_empty() { "default".into() } else { safe })
}

/// Sidecar descriptor used to restore a profile moved or copied by hand.
fn remember_profile(p: &Profile) {
    let dir = profile_dir(&p.name);
    if std::fs::create_dir_all(&dir).is_err() { return }
    let mut patch = serde_json::Map::new();
    patch.insert("name".into(), Value::String(p.name.clone()));
    patch.insert("version".into(), Value::String(p.version.clone()));
    patch.insert("loader".into(), Value::String(p.loader_id()));
    patch.insert("loaderVersion".into(), Value::String(p.loader_version.clone().unwrap_or_default()));
    // written even when empty, so a removed icon is not resurrected from disk
    patch.insert("icon".into(), Value::String(p.icon.clone().unwrap_or_default()));
    merge_settings(&p.name, patch);
}

pub(crate) fn merge_settings(profile: &str, patch: serde_json::Map<String, Value>) {
    let p = profile_dir(profile).join("millida-settings.json");
    let mut s: serde_json::Map<String, Value> = std::fs::read(&p).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    for (k, v) in patch { s.insert(k, v); }
    write_json_quiet(&p, &s);
}

/// version_id=None picks the newest .mrpack; target=Some(name) updates or rolls
/// back an existing profile and reinstalls its mods/.
pub async fn install_modpack(app: AppHandle, slug: String) -> Result<Profile, String> {
    install_modpack_ver(app, slug, None, None).await
}

pub async fn install_modpack_ver(app: AppHandle, slug: String, version_id: Option<String>, target: Option<String>) -> Result<Profile, String> {
    let job = Job::start(job_key_modpack_mr(&slug, target.as_deref()), target.clone().unwrap_or_else(|| slug.clone()))?;
    let res = install_modpack_job(&app, &job, slug, version_id, target).await;
    job.finish(&app, res)
}

async fn install_modpack_job(app: &AppHandle, job: &Job, slug: String, version_id: Option<String>, target: Option<String>) -> Result<Profile, String> {
    job.emit(app, 5.0, "Читаем модпак…");
    let versions = get_json(&format!("https://api.modrinth.com/v2/project/{}/version", slug)).await?;
    let has_mrpack = |v: &Value| v["files"].as_array().is_some_and(|fs| fs.iter().any(|f| f["filename"].as_str().unwrap_or("").ends_with(".mrpack")));
    let ver = match &version_id {
        Some(vid) => versions.as_array().and_then(|a| a.iter().find(|v| v["id"].as_str() == Some(vid.as_str()))).ok_or("Версия модпака не найдена")?,
        None => versions.as_array().and_then(|a| a.iter().find(|v| has_mrpack(v))).ok_or("mrpack не найден")?,
    };
    let vid = ver["id"].as_str().unwrap_or("").to_string();
    let file = ver["files"].as_array().and_then(|fs| fs.iter().find(|f| f["primary"]==true).or(fs.first())).ok_or("Файл модпака не найден")?;
    let tmp = data_dir().join("tmp").join(format!("{}-{}.mrpack", slug, vid));
    job.emit(app, 15.0, "Скачиваем модпак…");
    download_fresh(file["url"].as_str().ok_or("Нет ссылки на файл модпака")?, &tmp).await?;
    let ex = data_dir().join("tmp").join(&slug);
    let _ = std::fs::remove_dir_all(&ex);
    std::fs::create_dir_all(&ex).map_err(|e| e.to_string())?;
    unzip_to(&tmp, &ex)?;
    job.check()?;
    let idx_raw = std::fs::read(ex.join("modrinth.index.json"))
        .map_err(|_| "В архиве модпака нет modrinth.index.json — файл повреждён".to_string())?;
    let idx: Value = serde_json::from_slice(&idx_raw).map_err(|e| e.to_string())?;
    let deps = &idx["dependencies"];
    let mc = deps["minecraft"].as_str().ok_or("Нет версии MC в модпаке")?.to_string();
    // dependency key names the loader, its value pins the exact build the pack
    // was built against
    let (lid, fabric, dep_key) = if deps.get("neoforge").is_some() { ("neoforge", false, "neoforge") }
        else if deps.get("forge").is_some() { ("forge", false, "forge") }
        else if deps.get("quilt-loader").is_some() { ("quilt", true, "quilt-loader") }
        else if deps.get("fabric-loader").is_some() { ("fabric", true, "fabric-loader") }
        else { ("vanilla", false, "") };
    let loader_version = deps[dep_key].as_str().filter(|v| !v.is_empty()).map(String::from);
    let pname = target.clone().unwrap_or_else(|| idx["name"].as_str().unwrap_or(&slug).to_string());
    job.rename(&pname);
    let pdir = profile_dir(&pname);
    // the pack owns mods/: leftovers would duplicate classes and crash the game
    let _ = std::fs::remove_dir_all(pdir.join("mods"));
    forget_skin_mod_install(&pname);
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let files = idx["files"].as_array().cloned().unwrap_or_default();
    let total = files.len().max(1);
    for (i, f) in files.iter().enumerate() {
        if job.cancelled() {
            let _ = std::fs::remove_dir_all(&ex);
            return Err(CANCELLED.into());
        }
        // server-only files must not reach the client
        if f["env"]["client"].as_str() == Some("unsupported") { continue; }
        let Some(path) = f["path"].as_str() else { continue };
        // paths come from the pack index and are untrusted
        let dest = safe_join(&pdir, path)
            .map_err(|e| format!("Модпак содержит небезопасный путь: {}", e))?;
        let sha1 = f["hashes"]["sha1"].as_str();
        let size = f["fileSize"].as_u64();
        let mut done = false;
        if let Some(urls) = f["downloads"].as_array() {
            for u in urls {
                if let Some(u) = u.as_str() {
                    if download_verify(u, &dest, sha1, size).await.is_ok() { done = true; break; }
                }
            }
        }
        if !done { return Err(format!("Не удалось скачать файл модпака: {}", path)); }
        job.emit(app, 20.0 + 60.0*(i as f32/total as f32), &format!("Файлы модпака {}/{}", i+1, total));
    }
    for ov in ["overrides", "client-overrides"] {
        let src = ex.join(ov);
        if src.exists() { let _ = copy_dir_all(&src, &pdir); }
    }
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_dir_all(&ex);
    let (_, _, pack_icon, _) = fetch_project_meta(&slug).await;
    let prof = Profile {
        name: pname.clone(),
        version: mc,
        fabric,
        loader: Some(lid.into()),
        loader_version,
        icon: if pack_icon.is_empty() { None } else { Some(pack_icon) },
    };
    let mut all = load_profiles();
    if let Some(p) = all.iter_mut().find(|p| p.name == prof.name) { *p = prof.clone(); }
    else { all.insert(0, prof.clone()); }
    save_profiles(&all)?;
    let mut patch = serde_json::Map::new();
    patch.insert("modpackSlug".into(), Value::String(slug.clone()));
    patch.insert("modpackVersionId".into(), Value::String(vid));
    merge_settings(&pname, patch);
    job.emit(app, 100.0, "Модпак установлен");
    Ok(prof)
}

pub async fn modpack_versions(slug: String) -> Result<Value, String> {
    let versions = get_json(&format!("https://api.modrinth.com/v2/project/{}/version", slug)).await?;
    let out: Vec<Value> = versions.as_array().map(|a| a.iter()
        .filter(|v| v["files"].as_array().is_some_and(|fs| fs.iter().any(|f| f["filename"].as_str().unwrap_or("").ends_with(".mrpack"))))
        .map(|v| serde_json::json!({
            "id": v["id"], "name": v["name"], "version_number": v["version_number"],
            "date": v["date_published"], "changelog": v["changelog"], "type": v["version_type"]
        })).collect()).unwrap_or_default();
    Ok(Value::Array(out))
}

pub async fn update_modpack(app: AppHandle, profile: String, version_id: String) -> Result<Profile, String> {
    let settings: Value = std::fs::read(profile_dir(&profile).join("millida-settings.json")).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    let slug = settings["modpackSlug"].as_str().unwrap_or("").to_string();
    if slug.is_empty() { return Err("Эта сборка создана не из модпака".into()); }
    install_modpack_ver(app, slug, Some(version_id), Some(profile)).await
}

pub fn modpack_info(profile: &str) -> Value {
    let s: Value = std::fs::read(profile_dir(profile).join("millida-settings.json")).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    serde_json::json!({
        "slug": s["modpackSlug"].as_str().unwrap_or(""),
        "versionId": s["modpackVersionId"].as_str().unwrap_or("")
    })
}

pub fn list_screenshots(profile: &str) -> Vec<String> {
    let dir = profile_dir(profile).join("screenshots");
    let mut items: Vec<(std::time::SystemTime, String)> = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.to_lowercase().ends_with(".png") {
                let t = e.metadata().ok().and_then(|m| m.modified().ok()).unwrap_or(std::time::UNIX_EPOCH);
                items.push((t, e.path().to_string_lossy().to_string()));
            }
        }
    }
    items.sort_by_key(|i| std::cmp::Reverse(i.0));
    items.into_iter().map(|(_, p)| p).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_id_splits_off_the_build() {
        assert_eq!(split_loader_id("forge-47.2.0"), ("forge".into(), Some("47.2.0".into())));
        assert_eq!(split_loader_id("neoforge-21.1.73"), ("neoforge".into(), Some("21.1.73".into())));
        assert_eq!(split_loader_id("fabric-0.15.11"), ("fabric".into(), Some("0.15.11".into())));
        assert_eq!(split_loader_id("quilt"), ("quilt".into(), None));
        assert_eq!(split_loader_id(""), ("vanilla".into(), None));
        // neoforge must be matched before forge
        assert_eq!(split_loader_id("NeoForge-21.1.73").0, "neoforge");
    }

    #[test]
    fn punctuation_collapses_names_into_one_folder() {
        assert_eq!(profile_dir("Sky Factory 4"), profile_dir("SkyFactory4"));
        assert_eq!(profile_dir("Fabulously Optimized 1.21"), profile_dir("Fabulously Optimized 121"));
        assert_eq!(profile_dir("Моя сборка"), profile_dir("Моясборка"));
        assert_ne!(profile_dir("Sky Factory 4"), profile_dir("Sky Factory 4 (2)"));
    }
}
