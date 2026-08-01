use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// CurseForge requests go through the backend proxy so the API key stays
/// server-side; the public keyless mirror is the fallback.
pub(crate) fn cf_base() -> String {
    format!("{}/launcher/cf", MILLIDA_API)
}

pub(crate) const CF_MIRROR: &str = "https://api.curse.tools";

pub(crate) async fn cf_get(path: &str, q: &[(String, String)]) -> Result<Value, String> {
    let via_proxy = client()
        .get(format!("{}/{}", cf_base(), path))
        .query(q)
        .send()
        .await;
    if let Ok(r) = via_proxy {
        if r.status().is_success() {
            if let Ok(j) = r.json::<Value>().await {
                if j.get("data").is_some() {
                    return Ok(j);
                }
            }
        }
    }
    let r = client()
        .get(format!("{}/{}", CF_MIRROR, path))
        .query(q)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("CurseForge ответил {}", r.status()));
    }
    r.json::<Value>().await.map_err(|e| e.to_string())
}

pub(crate) fn cf_class_id(kind: &str) -> u32 { match kind { "resourcepack" => 12, "shader" => 6552, "modpack" => 4471, "datapack" => 6945, "world" => 17, _ => 6 } }
pub(crate) fn cf_loader_type(loader: &str) -> u32 { match loader { "forge" => 1, "fabric" => 4, "quilt" => 5, "neoforge" => 6, _ => 0 } }

/// algo=1 is sha1 in the CurseForge hash list.
pub(crate) fn cf_sha1(file: &Value) -> String {
    file["hashes"].as_array()
        .and_then(|a| a.iter().find(|h| h["algo"] == 1))
        .and_then(|h| h["value"].as_str()).unwrap_or("").to_string()
}

/// `downloadUrl` is null when the author blocks third-party downloads, and the
/// edge CDN answers 403 for some files while mediafilez serves the same path.
/// File names must be percent-encoded (spaces and brackets are common).
pub(crate) fn cf_file_urls(file: &Value, fname: &str) -> Vec<String> {
    let fid = file["id"].as_u64().unwrap_or(0);
    let mut out: Vec<String> = vec![];
    if let Some(u) = file["downloadUrl"].as_str().filter(|s| !s.is_empty()) {
        out.push(u.to_string());
    }
    if fid > 0 {
        let enc = urlencode(fname);
        for host in ["https://edge.forgecdn.net", "https://mediafilez.forgecdn.net"] {
            let u = format!("{}/files/{}/{}/{}", host, fid / 1000, fid % 1000, enc);
            if !out.contains(&u) { out.push(u) }
        }
    }
    out
}

pub(crate) async fn cf_download(file: &Value, fname: &str, dest: &Path) -> Result<String, String> {
    let sha1 = cf_sha1(file);
    let sum = if sha1.is_empty() { None } else { Some(Sum::Sha1(sha1.as_str())) };
    let size = file["fileLength"].as_u64();
    let mut last = String::new();
    for u in cf_file_urls(file, fname) {
        match download_checked(&u, dest, sum, size).await {
            Ok(_) => return Ok(u),
            Err(e) => last = e,
        }
    }
    Err(if last.is_empty() { "у файла нет ни одной ссылки на загрузку".into() } else { last })
}

#[derive(serde::Serialize)]
pub struct CfHit { pub id: u32, pub name: String, pub summary: String, pub logo: String, pub downloads: u64, pub slug: String, pub website: String }

pub async fn cf_search(
    query: String, kind: String, game_version: String, loader: String, index: u32,
    category: u32, sort: u32,
) -> Result<Vec<CfHit>, String> {
    // CurseForge caps pageSize at 50 and rejects index + pageSize > 10000.
    let index = index.min(9950);
    let mut q: Vec<(String, String)> = vec![
        ("gameId".into(), "432".into()),
        ("classId".into(), cf_class_id(&kind).to_string()),
        ("pageSize".into(), "50".into()),
        ("index".into(), index.to_string()),
        ("sortField".into(), if sort == 0 { 2 } else { sort }.to_string()),
        ("sortOrder".into(), "desc".into()),
    ];
    if category > 0 { q.push(("categoryId".into(), category.to_string())); }
    if !query.is_empty() { q.push(("searchFilter".into(), query)); }
    if !game_version.is_empty() && game_version != "любая" { q.push(("gameVersion".into(), game_version)); }
    let lt = cf_loader_type(&loader);
    if lt > 0 && kind == "mod" { q.push(("modLoaderType".into(), lt.to_string())); }
    let resp: Value = cf_get("v1/mods/search", &q).await?;
    let mut out = vec![];
    for m in resp["data"].as_array().cloned().unwrap_or_default() {
        out.push(CfHit {
            id: m["id"].as_u64().unwrap_or(0) as u32,
            name: m["name"].as_str().unwrap_or("").to_string(),
            summary: m["summary"].as_str().unwrap_or("").to_string(),
            logo: m["logo"]["thumbnailUrl"].as_str().or_else(|| m["logo"]["url"].as_str()).unwrap_or("").to_string(),
            downloads: m["downloadCount"].as_u64().unwrap_or(0),
            slug: m["slug"].as_str().unwrap_or("").to_string(),
            website: m["links"]["websiteUrl"].as_str().unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

pub async fn cf_install(app: AppHandle, mod_id: u32, game_version: String, profile: String, kind: String, file_id: Option<u64>) -> Result<String, String> {
    let job = Job::start(job_key_content("cf", &profile, &kind, &mod_id.to_string()), format!("Файл #{}", mod_id))?;
    let res = cf_install_job(&app, &job, mod_id, game_version, profile, kind, file_id).await;
    job.finish(&app, res)
}

async fn cf_install_job(app: &AppHandle, job: &Job, mod_id: u32, game_version: String, profile: String, kind: String, file_id: Option<u64>) -> Result<String, String> {
    job.emit(app, 10.0, "CurseForge: подбираем файл…");
    let file = match file_id {
        Some(fid) => cf_get(&format!("v1/mods/{}/files/{}", mod_id, fid), &[]).await?["data"].clone(),
        None => {
            let loader_id = load_profiles().into_iter().find(|p| p.name == profile).map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
            let lt = cf_loader_type(&loader_id);
            let mut q: Vec<(String, String)> = vec![("pageSize".into(), "30".into())];
            if !game_version.is_empty() { q.push(("gameVersion".into(), game_version.clone())); }
            if lt > 0 && kind == "mod" { q.push(("modLoaderType".into(), lt.to_string())); }
            let files: Value = cf_get(&format!("v1/mods/{}/files", mod_id), &q).await?;
            files["data"].as_array().and_then(|a| a.first()).cloned().ok_or("Нет совместимого файла на CurseForge")?
        }
    };
    let file = &file;
    // remote-supplied file name: validate before it reaches a path
    let fname = safe_file_name(file["fileName"].as_str().ok_or("нет имени файла")?)?;
    let dest = safe_child(&profile_dir(&profile).join(content_dir(&kind)), &fname)?;
    let fid = file["id"].as_u64().unwrap_or(0);
    job.rename(&fname);
    job.emit(app, 40.0, &format!("Скачиваем {}…", fname));
    let sha1 = cf_sha1(file);
    let dl = cf_download(file, &fname, &dest).await
        .map_err(|e| format!("Не скачался файл с CurseForge: {}", e))?;
    let (title, icon, summary) = match cf_get(&format!("v1/mods/{}", mod_id), &[]).await {
        Ok(j) => (
            j["data"]["name"].as_str().unwrap_or("").to_string(),
            j["data"]["logo"]["thumbnailUrl"].as_str().unwrap_or("").to_string(),
            j["data"]["summary"].as_str().unwrap_or("").to_string(),
        ),
        Err(_) => (String::new(), String::new(), String::new()),
    };
    manifest_upsert(&profile, ContentEntry {
        kind: kind.clone(), file_name: fname.clone(),
        project_id: format!("cf:{}", mod_id),
        version_id: fid.to_string(),
        version_number: file["displayName"].as_str().unwrap_or("").to_string(),
        title, icon_url: icon, description: summary, author: String::new(),
        download_url: dl, sha1, sha512: String::new(),
        file_size: file["fileLength"].as_u64().unwrap_or(0),
    });
    job.emit(app, 100.0, "Установлено");
    Ok(fname)
}

// Maps install as a world folder in saves/, tracked in the manifest as kind = world.
/// `gameVersions` also carries loader and "Server Pack" tags, so keep only
/// digit-prefixed entries.
fn cf_file_mc_versions(file: &Value) -> Vec<String> {
    file["gameVersions"].as_array().map(|a| {
        a.iter().filter_map(|v| v.as_str())
            .filter(|s| s.starts_with(|c: char| c.is_ascii_digit()))
            .map(String::from).collect()
    }).unwrap_or_default()
}

/// level.dat may sit at the archive root or a couple of levels deeper.
fn find_world_root(dir: &Path, depth: u32) -> Option<PathBuf> {
    if dir.join("level.dat").is_file() { return Some(dir.to_path_buf()); }
    if depth == 0 { return None; }
    let mut subs: Vec<PathBuf> = std::fs::read_dir(dir).ok()?
        .flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    subs.sort();
    subs.iter().find_map(|s| find_world_root(s, depth - 1))
}

fn world_folder_name(title: &str) -> String {
    let cleaned: String = title.chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' })
        .collect();
    let name: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(48).collect();
    let name = name.trim().to_string();
    if name.is_empty() { "Карта".into() } else { name }
}

pub(crate) fn place_world_from_zip(saves: &Path, zip: &Path, work: &Path, title: &str) -> Result<String, String> {
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work).map_err(|e| e.to_string())?;
    unzip_to(zip, work)?;
    let Some(root) = find_world_root(work, 3) else {
        let _ = std::fs::remove_dir_all(work);
        return Err("В архиве нет мира (level.dat) — на CurseForge лежит не карта".into());
    };
    std::fs::create_dir_all(saves).map_err(|e| e.to_string())?;
    let base = world_folder_name(title);
    let mut folder = base.clone();
    let mut n = 2;
    while saves.join(&folder).exists() {
        folder = format!("{} {}", base, n);
        n += 1;
    }
    let dest = safe_child(saves, &folder)?;
    // rename fails across volumes
    if std::fs::rename(&root, &dest).is_err() {
        std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        copy_dir_all(&root, &dest).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_dir_all(work);
    Ok(folder)
}

/// Empty `folder` with non-empty `mismatch` means the map targets other game
/// versions; the caller confirms and retries with `force`.
#[derive(serde::Serialize)]
pub struct WorldInstall { pub folder: String, pub mismatch: String }

pub async fn cf_install_world(app: AppHandle, mod_id: u32, profile: String, force: bool) -> Result<WorldInstall, String> {
    let job = Job::start(job_key_content("cf", &profile, "world", &mod_id.to_string()), format!("Карта #{}", mod_id))?;
    let res = cf_install_world_job(&app, &job, mod_id, profile, force).await;
    job.finish(&app, res)
}

async fn cf_install_world_job(app: &AppHandle, job: &Job, mod_id: u32, profile: String, force: bool) -> Result<WorldInstall, String> {
    job.emit(app, 10.0, "CurseForge: подбираем файл карты…");
    let prof = load_profiles().into_iter().find(|p| p.name == profile).ok_or("Сборка не найдена")?;
    let files: Value = cf_get(&format!("v1/mods/{}/files", mod_id), &[("pageSize".to_string(), "50".to_string())]).await?;
    let list = files["data"].as_array().cloned().unwrap_or_default();
    if list.is_empty() { return Err("У карты нет файлов на CurseForge".into()); }
    let file = match list.iter().find(|f| cf_file_mc_versions(f).contains(&prof.version)) {
        Some(f) => f.clone(),
        None => {
            if !force {
                let mut vs: Vec<String> = list.iter().flat_map(cf_file_mc_versions).collect();
                vs.sort();
                vs.dedup();
                vs.truncate(8);
                return Ok(WorldInstall { folder: String::new(), mismatch: vs.join(", ") });
            }
            list[0].clone()
        }
    };
    let fid = file["id"].as_u64().unwrap_or(0);
    let fname = safe_file_name(file["fileName"].as_str().ok_or("нет имени файла")?)?;
    if !fname.to_ascii_lowercase().ends_with(".zip") {
        return Err("Файл карты не в формате zip — поставь его вручную".into());
    }
    let sha1 = cf_sha1(&file);
    let tmp = data_dir().join("tmp").join(format!("cfworld-{}-{}.zip", mod_id, fid));
    job.rename(&fname);
    job.emit(app, 35.0, &format!("Скачиваем {}…", fname));
    let dl = cf_download(&file, &fname, &tmp).await
        .map_err(|e| format!("Не скачалась карта: {}", e))?;
    let ex = data_dir().join("tmp").join(format!("cfworld-{}", mod_id));
    job.check()?;
    job.emit(app, 65.0, "Распаковываем…");
    let meta = cf_get(&format!("v1/mods/{}", mod_id), &[]).await.ok();
    let title = meta.as_ref().and_then(|j| j["data"]["name"].as_str().map(String::from))
        .unwrap_or_else(|| fname.trim_end_matches(".zip").to_string());
    let icon = meta.as_ref().and_then(|j| j["data"]["logo"]["thumbnailUrl"].as_str().map(String::from)).unwrap_or_default();
    let summary = meta.as_ref().and_then(|j| j["data"]["summary"].as_str().map(String::from)).unwrap_or_default();
    let saves = profile_dir(&profile).join("saves");
    job.emit(app, 85.0, "Переносим мир…");
    let folder = place_world_from_zip(&saves, &tmp, &ex, &title)?;
    let _ = std::fs::remove_file(&tmp);
    manifest_upsert(&profile, ContentEntry {
        kind: "world".into(), file_name: folder.clone(),
        project_id: format!("cf:{}", mod_id),
        version_id: fid.to_string(),
        version_number: file["displayName"].as_str().unwrap_or("").to_string(),
        title, icon_url: icon, description: summary, author: String::new(),
        download_url: dl, sha1, sha512: String::new(),
        file_size: file["fileLength"].as_u64().unwrap_or(0),
    });
    job.emit(app, 100.0, "Карта установлена");
    Ok(WorldInstall { folder, mismatch: String::new() })
}

/// World folders can be removed outside the launcher, so cross-check with disk.
pub fn list_world_installs(profile: &str) -> Vec<String> {
    let saves = profile_dir(profile).join("saves");
    load_content_manifest(profile).into_iter()
        .filter(|e| e.kind == "world" && saves.join(&e.file_name).is_dir())
        .map(|e| e.project_id)
        .filter(|p| !p.is_empty())
        .collect()
}

#[derive(serde::Serialize)]
pub struct CfProject {
    pub id: u32,
    pub name: String,
    pub summary: String,
    pub logo: String,
    pub downloads: u64,
    pub authors: String,
    pub categories: Vec<String>,
    pub game_versions: Vec<String>,
    pub website: String,
    pub updated: String,
    /// Raw HTML, sanitized against a tag allowlist on the frontend.
    pub description: String,
    pub gallery: Vec<CfImage>,
}

#[derive(serde::Serialize)]
pub struct CfImage { pub url: String, pub title: String }

pub async fn cf_project(mod_id: u32) -> Result<CfProject, String> {
    let j = cf_get(&format!("v1/mods/{}", mod_id), &[]).await?;
    let d = &j["data"];
    if d.is_null() { return Err("Проект не найден на CurseForge".into()) }
    let str_list = |v: &Value, key: &str| -> Vec<String> {
        v.as_array().map(|a| a.iter().filter_map(|x| x[key].as_str().map(String::from)).collect()).unwrap_or_default()
    };
    let description = cf_get(&format!("v1/mods/{}/description", mod_id), &[]).await
        .ok().and_then(|j| j["data"].as_str().map(String::from)).unwrap_or_default();
    let gallery: Vec<CfImage> = d["screenshots"].as_array().map(|a| a.iter().map(|s| CfImage {
        url: s["url"].as_str().or_else(|| s["thumbnailUrl"].as_str()).unwrap_or("").to_string(),
        title: s["title"].as_str().unwrap_or("").to_string(),
    }).filter(|i| !i.url.is_empty()).collect()).unwrap_or_default();
    let mut game_versions: Vec<String> = d["latestFilesIndexes"].as_array().map(|a| a.iter()
        .filter_map(|x| x["gameVersion"].as_str().map(String::from)).collect()).unwrap_or_default();
    game_versions.sort();
    game_versions.dedup();
    Ok(CfProject {
        id: d["id"].as_u64().unwrap_or(mod_id as u64) as u32,
        name: d["name"].as_str().unwrap_or("").to_string(),
        summary: d["summary"].as_str().unwrap_or("").to_string(),
        logo: d["logo"]["url"].as_str().or_else(|| d["logo"]["thumbnailUrl"].as_str()).unwrap_or("").to_string(),
        downloads: d["downloadCount"].as_u64().unwrap_or(0),
        authors: str_list(&d["authors"], "name").join(", "),
        categories: str_list(&d["categories"], "name"),
        game_versions,
        website: d["links"]["websiteUrl"].as_str().unwrap_or("").to_string(),
        updated: d["dateModified"].as_str().unwrap_or("").to_string(),
        description,
        gallery,
    })
}

#[derive(serde::Serialize)]
pub struct CfFileInfo {
    pub id: u64,
    pub name: String,
    pub file_name: String,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub size: u64,
    pub date: String,
    /// 1 release, 2 beta, 3 alpha
    pub release: u8,
    pub server_pack: bool,
}

pub async fn cf_files(mod_id: u32, game_version: String) -> Result<Vec<CfFileInfo>, String> {
    let mut q: Vec<(String, String)> = vec![("pageSize".into(), "50".into())];
    if !game_version.is_empty() && game_version != "любая" { q.push(("gameVersion".into(), game_version)); }
    let j = cf_get(&format!("v1/mods/{}/files", mod_id), &q).await?;
    Ok(j["data"].as_array().cloned().unwrap_or_default().iter().map(cf_file_info).collect())
}

fn cf_file_info(f: &Value) -> CfFileInfo {
    let tags: Vec<String> = f["gameVersions"].as_array().map(|a| a.iter()
        .filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
    let is_loader = |s: &String| {
        let l = s.to_ascii_lowercase();
        ["forge", "neoforge", "fabric", "quilt"].contains(&l.as_str())
    };
    CfFileInfo {
        id: f["id"].as_u64().unwrap_or(0),
        name: f["displayName"].as_str().unwrap_or("").to_string(),
        file_name: f["fileName"].as_str().unwrap_or("").to_string(),
        game_versions: tags.iter().filter(|s| s.starts_with(|c: char| c.is_ascii_digit())).cloned().collect(),
        loaders: tags.iter().filter(|s| is_loader(s)).cloned().collect(),
        size: f["fileLength"].as_u64().unwrap_or(0),
        date: f["fileDate"].as_str().unwrap_or("").to_string(),
        release: f["releaseType"].as_u64().unwrap_or(1) as u8,
        server_pack: f["isServerPack"].as_bool().unwrap_or(false),
    }
}

/// CurseForge modpack layout: pack zip → manifest.json (minecraft.version,
/// modLoaders, files[{projectID,fileID}]) → every mod fetched via the CF API
/// into mods/, then overrides/ copied over the profile.
pub async fn cf_install_modpack(app: AppHandle, mod_id: u32, file_id: Option<u64>) -> Result<Profile, String> {
    let job = Job::start(job_key_modpack_cf(mod_id), format!("Модпак #{}", mod_id))?;
    let res = cf_install_modpack_job(&app, &job, mod_id, file_id).await;
    job.finish(&app, res)
}

/// The first listed file is often a server pack, which has no manifest.json.
fn pick_modpack_file(list: &[Value]) -> Option<Value> {
    let client_only: Vec<&Value> = list.iter().filter(|f| {
        let name = f["fileName"].as_str().unwrap_or("").to_ascii_lowercase();
        !f["isServerPack"].as_bool().unwrap_or(false)
            && f["serverPackFileId"].as_u64() != f["id"].as_u64()
            && !name.contains("server")
    }).collect();
    let pool: &[&Value] = if client_only.is_empty() { return list.first().cloned() } else { &client_only };
    pool.iter().find(|f| f["releaseType"].as_u64() == Some(1)).or_else(|| pool.first()).map(|f| (*f).clone())
}

async fn cf_install_modpack_job(app: &AppHandle, job: &Job, mod_id: u32, file_id: Option<u64>) -> Result<Profile, String> {
    job.emit(app, 5.0, "CurseForge: читаем модпак…");
    let file = match file_id {
        Some(fid) => cf_get(&format!("v1/mods/{}/files/{}", mod_id, fid), &[]).await?["data"].clone(),
        None => {
            let files: Value = cf_get(&format!("v1/mods/{}/files", mod_id), &[("pageSize".to_string(), "30".to_string())]).await?;
            pick_modpack_file(&files["data"].as_array().cloned().unwrap_or_default())
                .ok_or("Файл модпака не найден")?
        }
    };
    let file = &file;
    let fid = file["id"].as_u64().unwrap_or(0);
    let fname = safe_file_name(file["fileName"].as_str().unwrap_or("pack.zip"))?;
    let tmp = data_dir().join("tmp").join(format!("cf-{}-{}.zip", mod_id, fid));
    job.emit(app, 15.0, "Скачиваем модпак…");
    let _ = std::fs::remove_file(&tmp);
    cf_download(file, &fname, &tmp).await
        .map_err(|e| format!("Не скачался архив модпака: {}", e))?;
    job.check()?;
    let ex = data_dir().join("tmp").join(format!("cf-{}", mod_id));
    let _ = std::fs::remove_dir_all(&ex);
    std::fs::create_dir_all(&ex).map_err(|e| e.to_string())?;
    unzip_to(&tmp, &ex)?;
    let man_raw = std::fs::read(ex.join("manifest.json"))
        .map_err(|_| "В архиве нет manifest.json — CurseForge отдал не клиентский модпак".to_string())?;
    let man: Value = serde_json::from_slice(&man_raw).map_err(|e| e.to_string())?;
    let mc = man["minecraft"]["version"].as_str().ok_or("Нет версии MC в манифесте")?.to_string();
    let loader_full = man["minecraft"]["modLoaders"].as_array()
        .and_then(|a| a.iter().find(|m| m["primary"] == true).or_else(|| a.first()))
        .and_then(|m| m["id"].as_str()).unwrap_or("").to_string();
    let (lid, loader_version) = split_loader_id(&loader_full);
    let pname = man["name"].as_str().unwrap_or("CurseForge Pack").to_string();
    job.rename(&pname);
    let pdir = profile_dir(&pname);
    // the pack owns mods/: leftovers from a previous install would duplicate mods
    let _ = std::fs::remove_dir_all(pdir.join("mods"));
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let list = man["files"].as_array().cloned().unwrap_or_default();
    let total = list.len().max(1);
    let mut failed: Vec<String> = vec![];
    let mut skipped: Vec<String> = vec![];
    for (i, f) in list.iter().enumerate() {
        if job.cancelled() {
            let _ = std::fs::remove_dir_all(&ex);
            return Err(CANCELLED.into());
        }
        let (pid, fid2) = (f["projectID"].as_u64().unwrap_or(0), f["fileID"].as_u64().unwrap_or(0));
        if pid == 0 || fid2 == 0 { continue }
        let required = f["required"].as_bool().unwrap_or(true);
        match cf_get(&format!("v1/mods/{}/files/{}", pid, fid2), &[]).await {
            Ok(j) => {
                let d = &j["data"];
                match safe_file_name(d["fileName"].as_str().unwrap_or("")) {
                    Ok(fn2) => {
                        let dest = safe_child(&pdir.join("mods"), &fn2)?;
                        if let Err(e) = cf_download(d, &fn2, &dest).await {
                            if required { failed.push(format!("{} ({})", fn2, e)) } else { skipped.push(fn2) }
                        }
                    }
                    Err(e) => if required { failed.push(format!("файл #{} ({})", fid2, e)) },
                }
            }
            Err(e) => if required { failed.push(format!("файл #{} ({})", fid2, e)) } else { skipped.push(format!("#{}", fid2)) },
        }
        job.emit(app, 20.0 + 55.0 * (i as f32 / total as f32), &format!("Моды {}/{}", i + 1, total));
    }
    if !failed.is_empty() {
        let _ = std::fs::remove_dir_all(&ex);
        return Err(format!("Не скачались файлы модпака: {}", failed.join("; ")));
    }
    // the overrides folder name comes from the archive manifest, hence the path check
    job.emit(app, 80.0, "Конфиги и ресурсы модпака…");
    for name in [man["overrides"].as_str().filter(|s| !s.is_empty()).unwrap_or("overrides"), "client-overrides"] {
        let ov = safe_join(&ex, name)
            .map_err(|e| format!("Манифест модпака указывает небезопасную папку overrides: {}", e))?;
        if ov.exists() { copy_dir_all(&ov, &pdir).map_err(|e| e.to_string())?; }
    }
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_dir_all(&ex);
    let fabric = matches!(lid.as_str(), "fabric" | "quilt");
    let pack_icon = cf_get(&format!("v1/mods/{}", mod_id), &[]).await.ok()
        .and_then(|j| j["data"]["logo"]["thumbnailUrl"].as_str().map(String::from))
        .unwrap_or_default();
    let prof = Profile {
        name: pname.clone(),
        version: mc,
        fabric,
        loader: Some(lid),
        loader_version,
        icon: if pack_icon.is_empty() { None } else { Some(pack_icon) },
    };
    let mut all = load_profiles();
    if let Some(p) = all.iter_mut().find(|p| p.name == prof.name) { *p = prof.clone(); }
    else { all.insert(0, prof.clone()); }
    save_profiles(&all)?;
    let mut patch = serde_json::Map::new();
    patch.insert("cfModpackId".into(), Value::from(mod_id));
    patch.insert("cfModpackFileId".into(), Value::from(fid));
    merge_settings(&pname, patch);
    let done_msg = if skipped.is_empty() { "Модпак установлен".to_string() }
        else { format!("Модпак установлен, пропущено необязательных файлов: {}", skipped.len()) };
    job.emit(app, 100.0, &done_msg);
    Ok(prof)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-world-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn takes_only_game_versions_from_file() {
        let f = serde_json::json!({ "gameVersions": ["1.20.1", "Forge", "1.12.2", "Server Pack"] });
        assert_eq!(cf_file_mc_versions(&f), vec!["1.20.1".to_string(), "1.12.2".to_string()]);
    }

    #[test]
    fn finds_world_in_root_and_deeper() {
        let root = tmp("root");
        std::fs::write(root.join("level.dat"), b"x").unwrap();
        assert_eq!(find_world_root(&root, 3).unwrap(), root);

        let nested = tmp("nested");
        let inner = nested.join("Cool Map").join("World");
        std::fs::create_dir_all(&inner).unwrap();
        std::fs::write(inner.join("level.dat"), b"x").unwrap();
        assert_eq!(find_world_root(&nested, 3).unwrap(), inner);
    }

    #[test]
    fn no_level_dat_is_not_a_world() {
        let d = tmp("plain");
        std::fs::write(d.join("pack.mcmeta"), b"{}").unwrap();
        assert!(find_world_root(&d, 3).is_none());
    }

    fn make_map_zip(path: &PathBuf) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        for (name, body) in [
            ("Cool Map v2/README.txt", "читай меня"),
            ("Cool Map v2/World/level.dat", "NBT"),
            ("Cool Map v2/World/region/r.0.0.mca", "чанки"),
        ] {
            z.start_file(name, opts).unwrap();
            std::io::Write::write_all(&mut z, body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn unpacks_map_into_saves_and_keeps_the_old_one() {
        let root = tmp("place");
        let zip_path = root.join("map.zip");
        make_map_zip(&zip_path);
        let saves = root.join("saves");

        let first = place_world_from_zip(&saves, &zip_path, &root.join("work"), "Cool Map: v2").unwrap();
        assert_eq!(first, "Cool Map v2");
        assert!(saves.join(&first).join("level.dat").is_file());
        assert!(saves.join(&first).join("region").join("r.0.0.mca").is_file());
        assert!(!saves.join(&first).join("README.txt").exists());
        assert!(!root.join("work").exists());

        let second = place_world_from_zip(&saves, &zip_path, &root.join("work"), "Cool Map: v2").unwrap();
        assert_eq!(second, "Cool Map v2 2");
        assert!(saves.join(&first).join("level.dat").is_file());
    }

    #[test]
    fn rejects_archive_without_world() {
        let root = tmp("noworld");
        let zip_path = root.join("pack.zip");
        let f = std::fs::File::create(&zip_path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        z.start_file("assets/pack.mcmeta", opts).unwrap();
        std::io::Write::write_all(&mut z, b"{}").unwrap();
        z.finish().unwrap();
        assert!(place_world_from_zip(&root.join("saves"), &zip_path, &root.join("work"), "Pack").is_err());
    }

    #[test]
    fn modpack_file_skips_server_packs() {
        let list = vec![
            serde_json::json!({ "id": 1, "fileName": "Pack-Server-1.2.zip", "isServerPack": true, "releaseType": 1 }),
            serde_json::json!({ "id": 2, "fileName": "Pack-1.3-beta.zip", "releaseType": 2 }),
            serde_json::json!({ "id": 3, "fileName": "Pack-1.2.zip", "releaseType": 1 }),
        ];
        assert_eq!(pick_modpack_file(&list).unwrap()["id"], 3);
    }

    #[test]
    fn modpack_file_falls_back_to_first() {
        let list = vec![serde_json::json!({ "id": 7, "fileName": "server-pack.zip", "isServerPack": true })];
        assert_eq!(pick_modpack_file(&list).unwrap()["id"], 7);
        assert!(pick_modpack_file(&[]).is_none());
    }

    #[test]
    fn file_urls_add_cdn_mirrors_with_encoded_name() {
        let f = serde_json::json!({ "id": 4567890, "downloadUrl": "https://edge.forgecdn.net/files/4567/890/A%20Mod.jar" });
        let urls = cf_file_urls(&f, "A Mod.jar");
        assert_eq!(urls[0], "https://edge.forgecdn.net/files/4567/890/A%20Mod.jar");
        assert!(urls.iter().any(|u| u.starts_with("https://mediafilez.forgecdn.net/files/4567/890/A%20Mod.jar")));
        let bare = serde_json::json!({ "id": 4567890, "downloadUrl": Value::Null });
        assert_eq!(cf_file_urls(&bare, "A Mod.jar").len(), 2);
    }

    #[test]
    fn folder_name_survives_curseforge_titles() {
        assert_eq!(world_folder_name("Diversity 2"), "Diversity 2");
        assert_eq!(world_folder_name("SCP: Blocktainment / Breach"), "SCP Blocktainment Breach");
        assert_eq!(world_folder_name("???"), "Карта");
        assert!(world_folder_name(&"я".repeat(200)).chars().count() <= 48);
    }
}
