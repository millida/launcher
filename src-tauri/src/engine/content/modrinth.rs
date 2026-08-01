use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;

pub(crate) fn content_dir(kind: &str) -> &'static str {
    match kind {
        "resourcepack" => "resourcepacks",
        "shader" => "shaderpacks",
        "datapack" => "datapacks",
        "world" => "saves",
        _ => "mods",
    }
}

/// Per-profile record of installed content (project_id + version_id + hashes),
/// stored in profile_dir/millida-content.json. Updates, install badges and
/// .mrpack export all read from it.
#[derive(Clone, serde::Serialize, serde::Deserialize, Default)]
pub struct ContentEntry {
    pub kind: String,
    /// Enabled file name, without the .disabled suffix.
    pub file_name: String,
    pub project_id: String,
    pub version_id: String,
    #[serde(default)] pub version_number: String,
    #[serde(default)] pub title: String,
    #[serde(default)] pub icon_url: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub author: String,
    #[serde(default)] pub download_url: String,
    #[serde(default)] pub sha1: String,
    #[serde(default)] pub sha512: String,
    #[serde(default)] pub file_size: u64,
}

pub(crate) fn content_manifest_path(profile: &str) -> PathBuf { profile_dir(profile).join("millida-content.json") }

pub fn load_content_manifest(profile: &str) -> Vec<ContentEntry> {
    std::fs::read(content_manifest_path(profile)).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_content_manifest(profile: &str, v: &[ContentEntry]) {
    if let Some(p) = content_manifest_path(profile).parent() { std::fs::create_dir_all(p).ok(); }
    write_json_quiet(&content_manifest_path(profile), v);
}

pub(crate) fn manifest_upsert(profile: &str, entry: ContentEntry) {
    let mut all = load_content_manifest(profile);
    all.retain(|e| !(e.kind == entry.kind && e.file_name == entry.file_name));
    all.push(entry);
    save_content_manifest(profile, &all);
}

pub(crate) fn manifest_remove(profile: &str, kind: &str, file_name: &str) {
    let mut all = load_content_manifest(profile);
    all.retain(|e| !(e.kind == kind && e.file_name == file_name));
    save_content_manifest(profile, &all);
}

/// Loader facet for version filtering; only mods depend on the loader.
pub(crate) fn modrinth_loaders(loader_id: &str, kind: &str) -> Vec<String> {
    if kind != "mod" { return vec![]; }
    match loader_id {
        "fabric" => vec!["fabric".into()],
        "quilt" => vec!["quilt".into(), "fabric".into()], // Quilt also loads Fabric mods
        "forge" => vec!["forge".into()],
        "neoforge" => vec!["neoforge".into()],
        _ => vec![],
    }
}

pub(crate) fn loaders_facet(loaders: &[String]) -> String {
    if loaders.is_empty() { return String::new(); }
    let list: Vec<String> = loaders.iter().map(|l| format!("\"{}\"", l)).collect();
    format!("&loaders=[{}]", list.join(","))
}

type MetaTriple = (String, String, String, String);
static META_CACHE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, MetaTriple>>> =
    std::sync::OnceLock::new();

fn meta_cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, MetaTriple>> {
    META_CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn meta_of(p: &Value, fallback: &str) -> MetaTriple {
    (
        p["id"].as_str().unwrap_or(fallback).to_string(),
        p["title"].as_str().unwrap_or(fallback).to_string(),
        p["icon_url"].as_str().unwrap_or("").to_string(),
        p["description"].as_str().unwrap_or("").to_string(),
    )
}

fn meta_remember(key: &str, m: &MetaTriple) {
    if let Ok(mut c) = meta_cache().lock() {
        c.insert(key.to_string(), m.clone());
        // key by canonical id too: lookups come in as both slug and id
        c.insert(m.0.clone(), m.clone());
    }
}

pub(crate) async fn fetch_project_meta(project: &str) -> MetaTriple {
    if let Ok(c) = meta_cache().lock() {
        if let Some(m) = c.get(project) {
            return m.clone();
        }
    }
    if let Ok(p) = get_json(&format!("https://api.modrinth.com/v2/project/{}", project)).await {
        let m = meta_of(&p, project);
        meta_remember(project, &m);
        return m;
    }
    (project.to_string(), project.to_string(), String::new(), String::new())
}

pub(crate) async fn warm_projects_meta(ids: &[String]) {
    let unknown: Vec<String> = {
        let Ok(c) = meta_cache().lock() else { return };
        let mut seen = std::collections::HashSet::new();
        ids.iter()
            .filter(|id| !id.is_empty() && !c.contains_key(*id) && seen.insert((*id).clone()))
            .cloned()
            .collect()
    };
    if unknown.is_empty() {
        return;
    }
    // Modrinth limits query string length, so batch the ids
    for chunk in unknown.chunks(50) {
        let list = serde_json::to_string(&chunk.to_vec()).unwrap_or_else(|_| "[]".into());
        let url = format!(
            "https://api.modrinth.com/v2/projects?ids={}",
            urlencode(&list)
        );
        let Ok(arr) = get_json(&url).await else { continue };
        for p in arr.as_array().cloned().unwrap_or_default() {
            let m = meta_of(&p, "");
            if m.0.is_empty() {
                continue;
            }
            let slug = p["slug"].as_str().unwrap_or("").to_string();
            meta_remember(&m.0.clone(), &m);
            if !slug.is_empty() {
                meta_remember(&slug, &m);
            }
        }
    }
}

pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// `version_files/update` resolves latest compatible versions for many files in
/// one request, matching by the sha1 already stored in the profile manifest.
pub(crate) async fn bulk_latest_by_hash(
    hashes: &[String],
    game_version: &str,
    loaders: &[String],
) -> std::collections::HashMap<String, Value> {
    let mut out = std::collections::HashMap::new();
    if hashes.is_empty() {
        return out;
    }
    for chunk in hashes.chunks(100) {
        let mut body = serde_json::json!({ "hashes": chunk, "algorithm": "sha1" });
        if !loaders.is_empty() {
            body["loaders"] = serde_json::json!(loaders);
        }
        if !game_version.is_empty() {
            body["game_versions"] = serde_json::json!([game_version]);
        }
        let Ok(v) = post_json("https://api.modrinth.com/v2/version_files/update", &body).await else {
            continue;
        };
        for (hash, ver) in v.as_object().cloned().unwrap_or_default() {
            out.insert(hash, ver);
        }
    }
    out
}

pub(crate) async fn best_version(project: &str, game_version: &str, loaders: &[String]) -> Result<Value, String> {
    let mut url = format!(
        "https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]",
        project, game_version
    );
    url.push_str(&loaders_facet(loaders));
    let versions = get_json(&url).await?;
    let versions = if versions.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        // fall back to the loader filter alone, then to no filters at all
        let facet = loaders_facet(loaders);
        let u2 = format!(
            "https://api.modrinth.com/v2/project/{}/version?{}",
            project, facet.trim_start_matches('&')
        );
        let v2 = get_json(&u2).await.unwrap_or(Value::Null);
        if v2.as_array().map(|a| !a.is_empty()).unwrap_or(false) { v2 }
        else { get_json(&format!("https://api.modrinth.com/v2/project/{}/version", project)).await? }
    } else { versions };
    versions.as_array().and_then(|a| a.first()).cloned().ok_or_else(|| "Нет совместимой версии".to_string())
}

pub(crate) async fn install_project_version(
    profile: &str, kind: &str, project: &str, version: &Value,
) -> Result<String, String> {
    let file = version["files"].as_array()
        .and_then(|fs| fs.iter().find(|f| f["primary"] == true).or_else(|| fs.first()))
        .ok_or("Файл не найден")?;
    let fname = safe_file_name(file["filename"].as_str().ok_or("нет имени файла")?)?;
    let dest = safe_child(&profile_dir(profile).join(content_dir(kind)), &fname)?;
    // versions carry sha512/sha1, so never download without verifying
    let sha512 = file["hashes"]["sha512"].as_str().unwrap_or("");
    let sha1 = file["hashes"]["sha1"].as_str().unwrap_or("");
    let sum = if !sha512.is_empty() { Sum::Sha512(sha512) }
        else if !sha1.is_empty() { Sum::Sha1(sha1) }
        else { return Err(format!("{}: Modrinth не дал контрольную сумму файла", fname)) };
    download_checked(file["url"].as_str().unwrap_or(""), &dest, Some(sum), file["size"].as_u64()).await?;
    let (pid, title, icon, summary) = fetch_project_meta(project).await;
    manifest_upsert(profile, ContentEntry {
        kind: kind.to_string(),
        file_name: fname.clone(),
        project_id: pid,
        version_id: version["id"].as_str().unwrap_or("").to_string(),
        version_number: version["version_number"].as_str().unwrap_or("").to_string(),
        title,
        icon_url: icon,
        description: summary,
        author: version["author_id"].as_str().unwrap_or("").to_string(),
        download_url: file["url"].as_str().unwrap_or("").to_string(),
        sha1: file["hashes"]["sha1"].as_str().unwrap_or("").to_string(),
        sha512: file["hashes"]["sha512"].as_str().unwrap_or("").to_string(),
        file_size: file["size"].as_u64().unwrap_or(0),
    });
    Ok(fname)
}

/// Installs required dependencies transitively, honouring a pinned `version_id`
/// when the dependency declares one and skipping projects already installed.
pub(crate) async fn resolve_deps(profile: &str, game_version: &str, loaders: &[String], initial: &Value) {
    use std::collections::HashSet;
    let mut visited: HashSet<String> = HashSet::new();
    for e in load_content_manifest(profile) {
        if !e.project_id.is_empty() { visited.insert(e.project_id); }
    }
    let mut queue: Vec<Value> = initial.as_array().cloned().unwrap_or_default();
    let mut guard = 0;
    while let Some(d) = queue.pop() {
        guard += 1;
        if guard > 200 { break } // cycle guard
        if d["dependency_type"].as_str() != Some("required") { continue }
        let Some(pid) = d["project_id"].as_str().map(|s| s.to_string()) else { continue };
        if pid.is_empty() || visited.contains(&pid) { continue }
        visited.insert(pid.clone());
        let dv = if let Some(vid) = d["version_id"].as_str().filter(|s| !s.is_empty()) {
            get_json(&format!("https://api.modrinth.com/v2/version/{}", vid)).await.ok()
        } else {
            best_version(&pid, game_version, loaders).await.ok()
        };
        if let Some(dv) = dv {
            let _ = install_project_version(profile, "mod", &pid, &dv).await;
            if let Some(more) = dv["dependencies"].as_array() {
                for m in more { queue.push(m.clone()); }
            }
        }
    }
}

pub async fn install_content(
    app: AppHandle,
    project: String,
    game_version: String,
    profile: String,
    kind: String,
) -> Result<String, String> {
    let job = Job::start(job_key_content("mr", &profile, &kind, &project), project.clone())?;
    let res = install_content_job(&app, &job, project, game_version, profile, kind).await;
    job.finish(&app, res)
}

async fn install_content_job(
    app: &AppHandle,
    job: &Job,
    project: String,
    game_version: String,
    profile: String,
    kind: String,
) -> Result<String, String> {
    job.emit(app, 10.0, &format!("Подбираем версию {}…", project));
    let loader_id = load_profiles().into_iter().find(|p| p.name == profile)
        .map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
    let loaders = modrinth_loaders(&loader_id, &kind);
    let ver = best_version(&project, &game_version, &loaders).await?;
    job.check()?;
    job.emit(app, 40.0, "Скачиваем…");
    let fname = install_project_version(&profile, &kind, &project, &ver).await?;
    if kind == "mod" {
        job.emit(app, 70.0, "Зависимости…");
        resolve_deps(&profile, &game_version, &loaders, &ver["dependencies"]).await;
    }
    job.emit(app, 100.0, "Установлено");
    Ok(fname)
}

pub async fn install_mod(app: AppHandle, project: String, game_version: String, profile: String) -> Result<String, String> {
    install_content(app, project, game_version, profile, "mod".into()).await
}

pub async fn install_version(
    app: AppHandle, project: String, version_id: String, profile: String, kind: String,
) -> Result<String, String> {
    let job = Job::start(job_key_content("mr", &profile, &kind, &project), project.clone())?;
    let res = install_version_job(&app, &job, project, version_id, profile, kind).await;
    job.finish(&app, res)
}

async fn install_version_job(
    app: &AppHandle, job: &Job, project: String, version_id: String, profile: String, kind: String,
) -> Result<String, String> {
    job.emit(app, 20.0, "Скачиваем версию…");
    let ver = get_json(&format!("https://api.modrinth.com/v2/version/{}", version_id)).await?;
    let fname = install_project_version(&profile, &kind, &project, &ver).await?;
    if kind == "mod" {
        let loader_id = load_profiles().into_iter().find(|p| p.name == profile)
            .map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
        let gv = ver["game_versions"].as_array().and_then(|a| a.first()).and_then(|v| v.as_str()).unwrap_or("").to_string();
        let loaders = modrinth_loaders(&loader_id, &kind);
        resolve_deps(&profile, &gv, &loaders, &ver["dependencies"]).await;
    }
    job.emit(app, 100.0, "Установлено");
    Ok(fname)
}
