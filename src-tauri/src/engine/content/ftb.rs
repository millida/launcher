// Feed The Beast modpacks from the public FTB API (api.feed-the-beast.com, no key): search and install.
// Every file of a pack version arrives with its sha512/sha1; files come only from the CurseForge, FTB and Modrinth CDNs.
use crate::engine::*;
use serde_json::Value;
use tauri::AppHandle;

const API: &str = "https://api.feed-the-beast.com/v1/modpacks/public/modpack";
const SEARCH_LIMIT: u32 = 12;
const FILE_HOSTS: [&str; 5] = ["edge.forgecdn.net", "mediafilez.forgecdn.net", "files.feed-the-beast.com", "cdn.feed-the-beast.com", "cdn.modrinth.com"];
const PARALLEL: usize = 8;

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FtbPack {
    pub id: u64,
    pub name: String,
    pub synopsis: String,
    pub icon: String,
    pub installs: u64,
    pub version: String,
    pub mc: String,
    pub loader: String,
}

fn host_ok(raw: &str) -> bool {
    url::Url::parse(raw)
        .ok()
        .filter(|u| u.scheme() == "https" && u.port().is_none() && u.username().is_empty())
        .and_then(|u| u.host_str().map(|h| FILE_HOSTS.contains(&h.to_ascii_lowercase().as_str())))
        .unwrap_or(false)
}

fn latest_release(pack: &Value) -> Option<&Value> {
    let list = pack["versions"].as_array()?;
    list.iter()
        .filter(|v| v["type"].as_str() == Some("release") && v["private"] != true)
        .max_by_key(|v| v["released"].as_u64().unwrap_or(0))
        .or_else(|| list.iter().max_by_key(|v| v["released"].as_u64().unwrap_or(0)))
}

fn target(v: &Value, kind: &str) -> Option<(String, String)> {
    v["targets"].as_array()?.iter().find(|t| t["type"].as_str() == Some(kind)).map(|t| {
        (t["name"].as_str().unwrap_or("").to_string(), t["version"].as_str().unwrap_or("").to_string())
    })
}

fn card(pack: &Value) -> FtbPack {
    let ver = latest_release(pack);
    let icon = pack["art"]
        .as_array()
        .and_then(|a| a.iter().find(|x| x["type"].as_str() == Some("square")))
        .and_then(|x| x["url"].as_str())
        .filter(|u| u.starts_with("https://"))
        .unwrap_or("")
        .to_string();
    FtbPack {
        id: pack["id"].as_u64().unwrap_or(0),
        name: pack["name"].as_str().unwrap_or("").to_string(),
        synopsis: pack["synopsis"].as_str().unwrap_or("").chars().take(200).collect(),
        icon,
        installs: pack["installs"].as_u64().unwrap_or(0),
        version: ver.and_then(|v| v["name"].as_str()).unwrap_or("").to_string(),
        mc: ver.and_then(|v| target(v, "game")).map(|t| t.1).unwrap_or_default(),
        loader: ver.and_then(|v| target(v, "modloader")).map(|t| t.0).unwrap_or_default(),
    }
}

async fn pack_card(id: u64) -> Option<FtbPack> {
    get_json(&format!("{}/{}", API, id)).await.ok().map(|p| card(&p)).filter(|c| c.id > 0 && !c.mc.is_empty())
}

pub async fn ftb_search(term: String) -> Result<Vec<FtbPack>, String> {
    let q = term.trim();
    let url = if q.is_empty() {
        format!("{}/popular/installs/{}", API, SEARCH_LIMIT)
    } else {
        format!("{}/search/{}?term={}", API, SEARCH_LIMIT, urlencode(q))
    };
    let found = get_json(&url).await.map_err(|e| format!("FTB не ответил: {}", e))?;
    let ids: Vec<u64> = found["packs"].as_array().map(|a| a.iter().filter_map(|v| v.as_u64()).collect()).unwrap_or_default();
    let packs: Vec<Option<FtbPack>> = futures::future::join_all(ids.into_iter().take(SEARCH_LIMIT as usize).map(pack_card)).await;
    Ok(packs.into_iter().flatten().collect())
}

struct FtbFile {
    rel: String,
    url: String,
    sha512: String,
    sha1: String,
    size: Option<u64>,
}

/// FTB paths look like "./mods/"; the file name is joined after the same checks
/// as any other path from outside.
fn file_of(f: &Value) -> Result<Option<FtbFile>, String> {
    if f["serveronly"] == true {
        return Ok(None);
    }
    let dir = f["path"].as_str().unwrap_or("").trim_start_matches("./").trim_matches('/');
    let name = safe_file_name(f["name"].as_str().unwrap_or(""))?;
    let rel = if dir.is_empty() { name } else { format!("{}/{}", dir, name) };
    if !rel_path_ok(&rel) {
        return Err(format!("Путь в сборке FTB выходит за её папку: {}", rel));
    }
    let sha512 = f["hashes"]["sha512"].as_str().unwrap_or("").to_ascii_lowercase();
    let sha1 = f["sha1"].as_str().or(f["hashes"]["sha1"].as_str()).unwrap_or("").to_ascii_lowercase();
    if sha512.len() != 128 && sha1.len() != 40 {
        return Err(format!("У файла {} нет контрольной суммы", rel));
    }
    let mut urls: Vec<String> = vec![];
    urls.extend(f["url"].as_str().map(str::to_string));
    urls.extend(f["mirrors"].as_array().into_iter().flatten().filter_map(|m| m.as_str().map(str::to_string)));
    let url = urls.into_iter().find(|u| host_ok(u)).ok_or_else(|| format!("Файл {} лежит на чужом адресе", rel))?;
    Ok(Some(FtbFile { rel, url, sha512, sha1, size: f["size"].as_u64() }))
}

async fn fetch_file(pdir: &std::path::Path, f: &FtbFile, job: &Job) -> Result<(), String> {
    let dest = safe_join(pdir, &f.rel)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let sum = if f.sha512.len() == 128 { Sum::Sha512(&f.sha512) } else { Sum::Sha1(&f.sha1) };
    download_checked_cancellable(&f.url, &dest, Some(sum), f.size, Some(job.cancel_flag())).await
}

pub async fn ftb_install(app: AppHandle, id: u64) -> Result<Profile, String> {
    let job = Job::start(format!("ftb:{}", id), format!("FTB {}", id))?;
    let res = ftb_install_job(&app, &job, id).await;
    job.finish(&app, res)
}

async fn ftb_install_job(app: &AppHandle, job: &Job, id: u64) -> Result<Profile, String> {
    job.emit(app, 3.0, "Читаем сборку FTB…");
    let pack = get_json(&format!("{}/{}", API, id)).await.map_err(|e| format!("FTB не ответил: {}", e))?;
    let ver = latest_release(&pack).ok_or("У сборки нет версий")?.clone();
    let vid = ver["id"].as_u64().ok_or("У сборки нет версий")?;
    let manifest = get_json(&format!("{}/{}/{}", API, id, vid)).await.map_err(|e| format!("FTB не ответил: {}", e))?;
    let mc = target(&manifest, "game").map(|t| t.1).ok_or("В сборке нет версии Minecraft")?;
    check_version_id(&mc)?;
    let (loader, loader_version) = match target(&manifest, "modloader") {
        Some((name, v)) if matches!(name.as_str(), "forge" | "neoforge" | "fabric" | "quilt") => (name, Some(v)),
        Some((name, _)) => return Err(format!("Загрузчик {} лаунчер не ставит", name)),
        None => ("vanilla".to_string(), None),
    };
    if let Some(lv) = &loader_version {
        check_loader_version(lv)?;
    }
    let files: Vec<FtbFile> = manifest["files"]
        .as_array()
        .into_iter()
        .flatten()
        .map(file_of)
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .flatten()
        .collect();
    let pname = unique_profile_name(pack["name"].as_str().unwrap_or("FTB"));
    let pdir = profile_dir(&pname);
    std::fs::create_dir_all(&pdir).map_err(|e| e.to_string())?;
    let total = files.len().max(1);
    let mut failed: Option<String> = None;
    for (n, chunk) in files.chunks(PARALLEL).enumerate() {
        if let Err(e) = job.check() {
            failed = Some(e);
            break;
        }
        let results = futures::future::join_all(chunk.iter().map(|f| fetch_file(&pdir, f, job))).await;
        if let Some(e) = results.into_iter().find_map(Result::err) {
            failed = Some(e);
            break;
        }
        let got = ((n + 1) * PARALLEL).min(total);
        job.emit(app, 10.0 + 85.0 * (got as f32 / total as f32), &format!("Файлы сборки {}/{}", got, total));
    }
    if let Some(e) = failed {
        // The half-filled folder of the build that was being created.
        let _ = std::fs::remove_dir_all(&pdir);
        return Err(e);
    }
    let fabric = matches!(loader.as_str(), "fabric" | "quilt");
    let prof = Profile { name: pname.clone(), version: mc, fabric, loader: Some(loader), loader_version, icon: None };
    let mut all = load_profiles();
    all.insert(0, prof.clone());
    save_profiles(&all)?;
    let java = target(&manifest, "runtime").and_then(|t| t.1.split('.').next().and_then(|m| m.parse::<u64>().ok()));
    let ram = manifest["specs"]["recommended"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    apply_author_meta(&pname, AuthorMeta { ram_mb: ram, java_major: java, lock_content: false });
    record_pack_origin(&pname);
    job.emit(app, 100.0, "Сборка установлена");
    Ok(prof)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (file entry of an FTB version) -> placed, skipped or refused.
    #[test]
    fn files_are_placed_only_from_known_hosts_and_inside_the_build() {
        let f = |path: &str, url: &str, server: bool| {
            serde_json::json!({ "path": path, "name": "a.jar", "url": url, "mirrors": [], "serveronly": server,
                "sha1": "0123456789012345678901234567890123456789", "hashes": {} })
        };
        let ok = file_of(&f("./mods/", "https://edge.forgecdn.net/files/1/2/a.jar", false)).unwrap();
        assert_eq!(ok.map(|x| x.rel), Some("mods/a.jar".to_string()), "a client mod lands in mods/");
        assert!(file_of(&f("./mods/", "https://edge.forgecdn.net/x", true)).unwrap().is_none(), "server-only files stay out of a client build");
        assert!(file_of(&f("./mods/", "https://evil.example/a.jar", false)).is_err(), "a jar from an unknown host is refused");
        assert!(file_of(&f("../../", "https://edge.forgecdn.net/x", false)).is_err(), "a path out of the build is refused");
    }
}
