// packwiz packs by link: pack.toml -> index.toml -> each file, every one checked by the hash its parent names.
// The pack.toml address is the one the player pasted; mod jars come only from Modrinth, CurseForge and GitHub hosts, other files from the pack's own host.
use crate::engine::*;
use std::collections::BTreeMap;
use std::path::Path;
use tauri::AppHandle;

const TEXT_CAP: usize = 4 * 1024 * 1024;
const MAX_FILES: usize = 5000;
const STATE_FILE: &str = "millida-packwiz.json";
pub const PACKWIZ_URL_KEY: &str = "packwizUrl";
const JAR_HOSTS: [&str; 6] = ["cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net", "github.com", "objects.githubusercontent.com", "raw.githubusercontent.com"];

#[derive(serde::Deserialize, Default)]
struct PackToml {
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    versions: BTreeMap<String, String>,
    index: IndexRef,
}

#[derive(serde::Deserialize, Default)]
struct IndexRef {
    file: String,
    #[serde(rename = "hash-format")]
    hash_format: String,
    hash: String,
}

#[derive(serde::Deserialize, Default)]
struct IndexToml {
    #[serde(rename = "hash-format", default)]
    hash_format: String,
    #[serde(default)]
    files: Vec<IndexFile>,
}

#[derive(serde::Deserialize, Default, Clone)]
struct IndexFile {
    file: String,
    #[serde(default)]
    hash: String,
    #[serde(rename = "hash-format", default)]
    hash_format: String,
    #[serde(default)]
    metafile: bool,
}

#[derive(serde::Deserialize, Default)]
struct MetaToml {
    #[serde(default)]
    filename: String,
    #[serde(default)]
    side: String,
    #[serde(default)]
    download: MetaDownload,
    #[serde(default)]
    update: Option<toml::Value>,
}

#[derive(serde::Deserialize, Default)]
struct MetaDownload {
    #[serde(default)]
    url: String,
    #[serde(rename = "hash-format", default)]
    hash_format: String,
    #[serde(default)]
    hash: String,
    #[serde(default)]
    mode: String,
}

/// What the launcher placed from the pack, so an update removes only its own files.
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PackwizState {
    index_hash: String,
    version: String,
    files: BTreeMap<String, String>,
}

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackwizCheck {
    pub linked: bool,
    pub url: String,
    pub version: String,
    pub newer: bool,
}

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackwizResult {
    pub profile: String,
    pub added: u32,
    pub removed: u32,
    pub skipped: Vec<String>,
}

/// The pasted address: https only, no credentials, no local or private hosts.
pub(crate) fn pack_url_ok(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else { return false };
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    match u.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            d.contains('.') && d != "localhost" && !d.ends_with(".localhost") && !d.ends_with(".local") && !d.ends_with(".internal")
        }
        _ => false,
    }
}

fn jar_url_ok(raw: &str) -> bool {
    url::Url::parse(raw)
        .ok()
        .filter(|u| u.scheme() == "https" && u.port().is_none())
        .and_then(|u| u.host_str().map(|h| JAR_HOSTS.contains(&h.to_ascii_lowercase().as_str())))
        .unwrap_or(false)
}

fn same_host(a: &str, b: &str) -> bool {
    let host = |s: &str| url::Url::parse(s).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase));
    host(a).is_some() && host(a) == host(b)
}

async fn fetch_text(url: &str, base: &str) -> Result<Vec<u8>, String> {
    if !pack_url_ok(url) || !same_host(url, base) {
        return Err(format!("Файл пака лежит на чужом адресе: {}", url));
    }
    let resp = client().get(url).send().await.map_err(|e| format!("Пак не ответил: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("Пак ответил {} на {}", resp.status().as_u16(), url));
    }
    if !pack_url_ok(resp.url().as_str()) {
        return Err("Пак перенаправил на недопустимый адрес".into());
    }
    let bytes = resp.bytes().await.map_err(|e| format!("Пак оборвал ответ: {}", e))?;
    if bytes.len() > TEXT_CAP {
        return Err("Файл пака слишком большой".into());
    }
    Ok(bytes.to_vec())
}

fn hex_of(algo: &str, data: &[u8]) -> Option<String> {
    use sha1::Digest;
    let hex = |b: &[u8]| b.iter().map(|x| format!("{:02x}", x)).collect::<String>();
    match algo {
        "sha1" => Some(hex(&sha1::Sha1::digest(data))),
        "sha256" => Some(hex(&sha2::Sha256::digest(data))),
        "sha512" => Some(hex(&sha2::Sha512::digest(data))),
        _ => None,
    }
}

fn verify(algo: &str, want: &str, data: &[u8], what: &str) -> Result<(), String> {
    let got = hex_of(algo, data).ok_or_else(|| format!("{}: формат хеша «{}» лаунчер не проверяет", what, algo))?;
    if !got.eq_ignore_ascii_case(want.trim()) {
        return Err(format!("{}: контрольная сумма не совпала", what));
    }
    Ok(())
}

fn sum_of<'a>(algo: &str, hash: &'a str) -> Option<Sum<'a>> {
    match algo {
        "sha1" => Some(Sum::Sha1(hash)),
        "sha256" => Some(Sum::Sha256(hash)),
        "sha512" => Some(Sum::Sha512(hash)),
        _ => None,
    }
}

fn join_url(base: &str, rel: &str) -> Result<String, String> {
    let b = url::Url::parse(base).map_err(|_| "Неверная ссылка на пак".to_string())?;
    b.join(rel).map(|u| u.to_string()).map_err(|_| format!("Неверный путь в паке: {}", rel))
}

fn loader_of(versions: &BTreeMap<String, String>) -> (String, Option<String>) {
    for (key, id) in [("neoforge", "neoforge"), ("forge", "forge"), ("quilt", "quilt"), ("fabric", "fabric")] {
        if let Some(v) = versions.get(key).filter(|v| !v.is_empty()) {
            return (id.to_string(), Some(v.clone()));
        }
    }
    ("vanilla".into(), None)
}

struct Plan {
    pack: PackToml,
    index_hash: String,
    files: Vec<IndexFile>,
    index_algo: String,
}

async fn read_pack(url: &str) -> Result<Plan, String> {
    let raw = fetch_text(url, url).await?;
    let pack: PackToml = toml::from_str(std::str::from_utf8(&raw).map_err(|_| "pack.toml не в UTF-8".to_string())?)
        .map_err(|e| format!("pack.toml не читается: {}", e))?;
    let index_url = join_url(url, &pack.index.file)?;
    let index_raw = fetch_text(&index_url, url).await?;
    verify(&pack.index.hash_format, &pack.index.hash, &index_raw, "index.toml")?;
    let index: IndexToml = toml::from_str(std::str::from_utf8(&index_raw).map_err(|_| "index.toml не в UTF-8".to_string())?)
        .map_err(|e| format!("index.toml не читается: {}", e))?;
    if index.files.len() > MAX_FILES {
        return Err("В паке слишком много файлов".into());
    }
    Ok(Plan { index_hash: pack.index.hash.clone(), index_algo: index.hash_format.clone(), files: index.files, pack })
}

/// Files the pack places: (relative path, download url, hash format, hash).
async fn resolve_files(plan: &Plan, url: &str) -> Result<(Vec<(String, String, String, String)>, Vec<String>), String> {
    let index_url = join_url(url, &plan.pack.index.file)?;
    let mut out = vec![];
    let mut skipped = vec![];
    for f in &plan.files {
        let algo = if f.hash_format.is_empty() { plan.index_algo.clone() } else { f.hash_format.clone() };
        let file_url = join_url(&index_url, &f.file)?;
        if !rel_path_ok(&f.file) {
            return Err(format!("Путь в паке выходит за папку сборки: {}", f.file));
        }
        if !f.metafile {
            out.push((f.file.clone(), file_url, algo, f.hash.clone()));
            continue;
        }
        let raw = fetch_text(&file_url, url).await?;
        verify(&algo, &f.hash, &raw, &f.file)?;
        let meta: MetaToml = toml::from_str(std::str::from_utf8(&raw).map_err(|_| format!("{} не в UTF-8", f.file))?)
            .map_err(|e| format!("{} не читается: {}", f.file, e))?;
        if meta.side == "server" {
            continue;
        }
        let dir = Path::new(&f.file).parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        let name = safe_file_name(&meta.filename)?;
        let rel = if dir.is_empty() { name } else { format!("{}/{}", dir, name) };
        let mut dl = meta.download.url.clone();
        if dl.is_empty() && meta.download.mode == "metadata:curseforge" {
            let file_id = meta
                .update
                .as_ref()
                .and_then(|u| u.get("curseforge"))
                .and_then(|c| c.get("file-id"))
                .and_then(|v| v.as_integer())
                .unwrap_or(0) as u64;
            let files = cf_files_bulk(&[file_id]).await;
            dl = files.get(&file_id).map(|v| cf_file_urls(v, &meta.filename)).and_then(|u| u.into_iter().next()).unwrap_or_default();
        }
        if dl.is_empty() || !jar_url_ok(&dl) {
            skipped.push(meta.filename.clone());
            continue;
        }
        out.push((rel, dl, meta.download.hash_format.clone(), meta.download.hash.clone()));
    }
    Ok((out, skipped))
}

fn read_state(pdir: &Path) -> PackwizState {
    std::fs::read(pdir.join(STATE_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

async fn place(pdir: &Path, url: &str, plan: &Plan, job: &Job, app: &AppHandle) -> Result<PackwizResult, String> {
    let (files, skipped) = resolve_files(plan, url).await?;
    let before = read_state(pdir);
    let mut placed: BTreeMap<String, String> = BTreeMap::new();
    let mut added = 0u32;
    let total = files.len().max(1);
    for (n, (rel, dl, algo, hash)) in files.iter().enumerate() {
        job.check()?;
        job.emit(app, 10.0 + 85.0 * (n as f32 / total as f32), &format!("Файлы пака {}/{}", n + 1, total));
        let dest = safe_join(pdir, rel)?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        if before.files.get(rel) != Some(hash) || !dest.exists() {
            if !same_host(dl, url) && !jar_url_ok(dl) {
                return Err(format!("Файл пака лежит на чужом адресе: {}", rel));
            }
            let sum = sum_of(algo, hash).ok_or_else(|| format!("{}: формат хеша «{}» лаунчер не проверяет", rel, algo))?;
            download_checked_cancellable(dl, &dest, Some(sum), None, Some(job.cancel_flag())).await?;
            added += 1;
        }
        placed.insert(rel.clone(), hash.clone());
    }
    let mut removed = 0u32;
    for rel in before.files.keys().filter(|r| !placed.contains_key(*r)) {
        if let Ok(p) = safe_join(pdir, rel) {
            // The pack no longer ships a file the launcher placed from it earlier.
            if p.is_file() && std::fs::remove_file(&p).is_ok() {
                removed += 1;
            }
        }
    }
    let state = PackwizState { index_hash: plan.index_hash.clone(), version: plan.pack.version.clone(), files: placed };
    write_json_atomic(&pdir.join(STATE_FILE), &state)?;
    Ok(PackwizResult { profile: String::new(), added, removed, skipped })
}

pub async fn import_packwiz(app: AppHandle, url: String) -> Result<PackwizResult, String> {
    let url = url.trim().to_string();
    if !pack_url_ok(&url) {
        return Err("Нужна https-ссылка на pack.toml".into());
    }
    let job = Job::start(format!("packwiz:{}", hashed_name(&[&url])), "packwiz".to_string())?;
    let res = import_packwiz_job(&app, &job, &url).await;
    job.finish(&app, res)
}

async fn import_packwiz_job(app: &AppHandle, job: &Job, url: &str) -> Result<PackwizResult, String> {
    job.emit(app, 3.0, "Читаем pack.toml…");
    let plan = read_pack(url).await?;
    let mc = plan.pack.versions.get("minecraft").cloned().unwrap_or_default();
    check_version_id(&mc)?;
    let (loader, loader_version) = loader_of(&plan.pack.versions);
    if let Some(lv) = &loader_version {
        check_loader_version(lv)?;
    }
    let pname = unique_profile_name(if plan.pack.name.trim().is_empty() { "packwiz" } else { plan.pack.name.trim() });
    let pdir = profile_dir(&pname);
    std::fs::create_dir_all(&pdir).map_err(|e| e.to_string())?;
    let placed = place(&pdir, url, &plan, job, app).await;
    let mut res = match placed {
        Ok(r) => r,
        Err(e) => {
            // The half-filled folder of the build that was being created.
            let _ = std::fs::remove_dir_all(&pdir);
            return Err(e);
        }
    };
    let fabric = matches!(loader.as_str(), "fabric" | "quilt");
    let mut all = load_profiles();
    all.insert(0, Profile { name: pname.clone(), version: mc, fabric, loader: Some(loader), loader_version, icon: None });
    save_profiles(&all)?;
    let mut patch = serde_json::Map::new();
    patch.insert(PACKWIZ_URL_KEY.into(), serde_json::json!(url));
    merge_settings(&pname, patch);
    record_pack_origin(&pname);
    job.emit(app, 100.0, "Сборка установлена");
    res.profile = pname;
    Ok(res)
}

fn linked_url(profile: &str) -> Option<String> {
    profile_settings(profile)[PACKWIZ_URL_KEY].as_str().map(str::to_string).filter(|u| pack_url_ok(u))
}

pub async fn packwiz_check(profile: String) -> Result<PackwizCheck, String> {
    let Some(url) = linked_url(&profile) else { return Ok(PackwizCheck::default()) };
    let state = read_state(&profile_dir(&profile));
    let raw = fetch_text(&url, &url).await?;
    let pack: PackToml = toml::from_str(std::str::from_utf8(&raw).map_err(|_| "pack.toml не в UTF-8".to_string())?)
        .map_err(|e| format!("pack.toml не читается: {}", e))?;
    Ok(PackwizCheck { linked: true, newer: !pack.index.hash.eq_ignore_ascii_case(&state.index_hash), version: pack.version, url })
}

pub async fn packwiz_update(app: AppHandle, profile: String) -> Result<PackwizResult, String> {
    let url = linked_url(&profile).ok_or("Сборка не привязана к packwiz")?;
    assert_not_running(&profile, "обнови ещё раз")?;
    let job = Job::start(format!("packwiz-up:{}", hashed_name(&[&profile])), profile.clone())?;
    let res = async {
        let plan = read_pack(&url).await?;
        let mut r = place(&profile_dir(&profile), &url, &plan, &job, &app).await?;
        r.profile = profile.clone();
        Ok(r)
    }
    .await;
    job.finish(&app, res)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (pasted address) -> accepted as a pack link.
    #[test]
    fn only_public_https_links_are_followed() {
        let cases: [(&str, bool, &str); 6] = [
            ("https://example.org/pack/pack.toml", true, "an ordinary public pack"),
            ("http://example.org/pack.toml", false, "plain http can be swapped on the way"),
            ("https://127.0.0.1/pack.toml", false, "a loopback literal reaches services on the player's PC"),
            ("https://localhost/pack.toml", false, "localhost is the player's own machine"),
            ("https://user:pw@example.org/pack.toml", false, "credentials in a link leak into logs"),
            ("https://router.local/pack.toml", false, "local network names are not packs"),
        ];
        for (raw, want, why) in cases {
            assert_eq!(pack_url_ok(raw), want, "{}: {}", raw, why);
        }
    }

    #[test]
    fn hashes_are_checked_before_anything_is_trusted() {
        assert!(verify("sha256", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", b"hello", "x").is_ok(), "a matching sha256 passes");
        assert!(verify("sha256", "00", b"hello", "x").is_err(), "a mismatch stops the import");
        assert!(verify("murmur2", "1", b"hello", "x").is_err(), "a hash the launcher cannot check is refused, not skipped");
    }

    #[test]
    fn loader_comes_from_the_versions_table() {
        let mut v = BTreeMap::new();
        v.insert("minecraft".to_string(), "1.20.1".to_string());
        v.insert("fabric".to_string(), "0.15.11".to_string());
        assert_eq!(loader_of(&v), ("fabric".to_string(), Some("0.15.11".to_string())), "fabric pack");
        v.clear();
        assert_eq!(loader_of(&v).0, "vanilla", "no loader key means vanilla");
    }
}
