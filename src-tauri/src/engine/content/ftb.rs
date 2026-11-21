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
    // The launcher's own records (launch arguments, settings) are never the pack's to write.
    if rel.split('/').any(is_launcher_service_file) {
        return Ok(None);
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

/// Hashes of every client file a version lists, by path inside the build.
fn shipped_files(manifest: &Value) -> std::collections::HashMap<String, (String, String)> {
    manifest["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| file_of(f).ok().flatten())
        .map(|f| (f.rel, (f.sha1, f.sha512)))
        .collect()
}

/// Whether an update puts the new version's `rel` over what lies in the build. The pack owns
/// mods/. Elsewhere (config/, kubejs/, options.txt) a file the player already has stays theirs
/// when they made it or edited it; only an untouched copy of the old version is replaced. When
/// the old version could not be read, everything but the player's own files is replaced.
fn update_replaces(rel: &str, pdir: &std::path::Path, before: Option<&std::collections::HashMap<String, (String, String)>>) -> bool {
    if rel.starts_with("mods/") {
        return true;
    }
    let Ok(have) = safe_join(pdir, rel) else { return true };
    if !have.is_file() {
        return !have.exists();
    }
    if player_made_path(rel) {
        return false;
    }
    let Some(before) = before else { return true };
    match before.get(rel) {
        Some((sha1, sha512)) => same_content(&have, sha1, sha512),
        // The old version did not ship it: the player or the game made it.
        None => false,
    }
}

fn same_content(path: &std::path::Path, sha1: &str, sha512: &str) -> bool {
    if sha1.len() == 40 {
        return file_sha1(path).as_deref() == Some(sha1);
    }
    use sha2::Digest as _;
    let Ok(bytes) = std::fs::read(path) else { return false };
    let got: String = sha2::Sha512::digest(&bytes).iter().map(|b| format!("{:02x}", b)).collect();
    got == sha512
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
    let res = ftb_install_job(&app, &job, id, None).await;
    job.finish(&app, res)
}

/// Where a build installed from FTB came from: pack id, version id and version name, as written
/// by the install. Builds installed before 17.11.2026 have none and are not offered updates.
fn ftb_origin(settings: &Value) -> Option<(u64, u64, String)> {
    let pack = settings["ftbPackId"].as_u64().filter(|id| *id > 0)?;
    let ver = settings["ftbVersionId"].as_u64().filter(|id| *id > 0)?;
    Some((pack, ver, settings["ftbVersionName"].as_str().unwrap_or("").to_string()))
}

/// The newest release of the pack when it is newer than the installed version. Newer means a
/// later `released` time, never a comparison of names: FTB names versions freely ("1.3.0", "1.16.0").
fn update_from(pack: &Value, current: u64) -> Option<&Value> {
    let latest = latest_release(pack)?;
    if latest["id"].as_u64() == Some(current) {
        return None;
    }
    let released = |id: u64| {
        pack["versions"].as_array().and_then(|a| a.iter().find(|v| v["id"].as_u64() == Some(id))).and_then(|v| v["released"].as_u64())
    };
    let now = latest["released"].as_u64().unwrap_or(0);
    match released(current) {
        Some(was) if was >= now => None,
        _ => Some(latest),
    }
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FtbUpdate {
    pub current: String,
    pub version: String,
    pub mc: String,
}

/// A newer FTB version for a build installed from FTB (report 17.11.2026: FTB Skies 2: Aero stayed
/// on 1.3.0 while 1.16.0 was out, because nothing ever asked FTB again).
pub async fn ftb_check_update(profile: String) -> Result<Option<FtbUpdate>, String> {
    let Some((id, current, name)) = ftb_origin(&profile_settings(&profile)) else { return Ok(None) };
    let pack = get_json(&format!("{}/{}", API, id)).await.map_err(|e| format!("FTB не ответил: {}", e))?;
    Ok(update_from(&pack, current).map(|v| FtbUpdate {
        current: name,
        version: v["name"].as_str().unwrap_or("").to_string(),
        mc: target(v, "game").map(|t| t.1).unwrap_or_default(),
    }))
}

/// Puts the newest FTB version into the same build: the world, settings and mods the player added
/// stay; the pack's own mods of the old version are replaced.
pub async fn ftb_update(app: AppHandle, profile: String) -> Result<Profile, String> {
    let (id, _, _) = ftb_origin(&profile_settings(&profile)).ok_or("Эта сборка поставлена не из FTB")?;
    let job = Job::start(format!("ftb:{}", id), profile.clone())?;
    let res = ftb_install_job(&app, &job, id, Some(profile)).await;
    job.finish(&app, res)
}

async fn ftb_install_job(app: &AppHandle, job: &Job, id: u64, into: Option<String>) -> Result<Profile, String> {
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
    let updating = into.is_some();
    let pname = match into {
        Some(name) => {
            assert_not_running(&name, "обнови сборку ещё раз")?;
            name
        }
        None => unique_profile_name(pack["name"].as_str().unwrap_or("FTB")),
    };
    let pdir = profile_dir(&pname);
    // An update fetches into a folder beside the build: the installed version keeps every file
    // until the whole next one has arrived.
    let stage = if updating { pack_stage_dir(&pdir)? } else { pdir.clone() };
    if updating {
        let _ = std::fs::remove_dir_all(&stage);
    }
    let _staged = TempPaths(if updating { vec![stage.clone()] } else { vec![] });
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let total = files.len().max(1);
    let mut failed: Option<String> = None;
    for (n, chunk) in files.chunks(PARALLEL).enumerate() {
        if let Err(e) = job.check() {
            failed = Some(e);
            break;
        }
        let results = futures::future::join_all(chunk.iter().map(|f| fetch_file(&stage, f, job))).await;
        if let Some(e) = results.into_iter().find_map(Result::err) {
            failed = Some(e);
            break;
        }
        let got = ((n + 1) * PARALLEL).min(total);
        job.emit(app, 10.0 + 85.0 * (got as f32 / total as f32), &format!("Файлы сборки {}/{}", got, total));
    }
    if let Some(e) = failed {
        // The half-filled folder of the build that was being created; an update leaves the build alone.
        if !updating {
            let _ = std::fs::remove_dir_all(&pdir);
        }
        return Err(e);
    }
    if updating {
        // What the installed version shipped: a file still equal to it the player never touched.
        let before = match ftb_origin(&profile_settings(&pname)) {
            Some((_, old, _)) => get_json(&format!("{}/{}/{}", API, id, old)).await.ok().map(|m| shipped_files(&m)),
            None => None,
        };
        // Mods the old version did not ship were put there by the player (by hand or from the
        // catalogue) and stay. Without a record of the old version only catalogue mods are known.
        let keep_mods: std::collections::HashSet<String> = match not_from_pack(&pname, "mod") {
            Some(theirs) => theirs.into_iter().collect(),
            None => load_content_manifest(&pname).into_iter().filter(|e| e.kind == "mod").map(|e| e.file_name).collect(),
        };
        assert_not_running(&pname, "обнови сборку ещё раз")?;
        let listed: Vec<String> = files.iter().map(|f| f.rel.clone()).collect();
        let (stage, pdir) = (stage.clone(), pdir.clone());
        // Renames, copies and hashing of a pack of hundreds of files: off the async workers.
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let place: Vec<String> = listed.iter().filter(|rel| update_replaces(rel, &pdir, before.as_ref())).cloned().collect();
            std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
            place_pack_files(&place, &stage, &pdir, &keep_mods)
        })
        .await
        .map_err(|e| e.to_string())??;
        record_pack_origin_listed(&pname, &files.iter().map(|f| f.rel.clone()).collect::<Vec<_>>());
    }
    let fabric = matches!(loader.as_str(), "fabric" | "quilt");
    let mut all = load_profiles();
    let icon = all.iter().find(|p| p.name == pname).and_then(|p| p.icon.clone());
    let prof = Profile { name: pname.clone(), version: mc, fabric, loader: Some(loader), loader_version, icon };
    if let Some(p) = all.iter_mut().find(|p| p.name == pname) {
        *p = prof.clone();
    } else {
        all.insert(0, prof.clone());
    }
    save_profiles(&all)?;
    let java = target(&manifest, "runtime").and_then(|t| t.1.split('.').next().and_then(|m| m.parse::<u64>().ok()));
    let ram = manifest["specs"]["recommended"].as_u64().unwrap_or(0).min(u32::MAX as u64) as u32;
    if updating {
        // A newer version may need a newer Java (1.20.4 → 1.20.6 went 17 → 21); the memory stays the player's.
        apply_author_meta(&pname, AuthorMeta { ram_mb: 0, java_major: java, lock_content: false });
    } else {
        apply_author_meta(&pname, AuthorMeta { ram_mb: ram, java_major: java, lock_content: false });
        record_pack_origin(&pname);
    }
    let mut patch = serde_json::Map::new();
    patch.insert("ftbPackId".into(), Value::from(id));
    patch.insert("ftbVersionId".into(), Value::from(vid));
    patch.insert("ftbVersionName".into(), ver["name"].clone());
    merge_settings(&pname, patch);
    job.emit(app, 100.0, if updating { "Сборка обновлена" } else { "Сборка установлена" });
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

    /// A pack that lists the launcher's own files would steer the launch arguments.
    #[test]
    fn launcher_service_files_never_come_from_a_pack() {
        let f = |path: &str, name: &str| {
            serde_json::json!({ "path": path, "name": name, "url": "https://edge.forgecdn.net/files/1/2/x", "mirrors": [],
                "sha1": "0123456789012345678901234567890123456789", "hashes": {} })
        };
        for (path, name) in [("./", "millida-args.txt"), ("./", "millida-settings.json"), ("./", "MILLIDA-pack.json"), ("./millida-x.json/", "a.txt")] {
            assert!(file_of(&f(path, name)).unwrap().is_none(), "{path}{name}");
        }
        assert!(file_of(&f("./config/", "millida-ish.toml")).unwrap().is_some(), "an ordinary config of the pack still arrives");
    }

    /// (file in the build, what the old version shipped) -> replaced by the update or kept.
    #[test]
    fn an_update_keeps_what_the_player_made_or_edited() {
        let dir = std::env::temp_dir().join(format!("millida-ftb-update-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        std::fs::write(dir.join("config/untouched.toml"), b"old").unwrap();
        std::fs::write(dir.join("config/edited.toml"), b"mine").unwrap();
        std::fs::write(dir.join("config/own.toml"), b"mine").unwrap();
        std::fs::write(dir.join("options.txt"), b"fov:90").unwrap();
        std::fs::write(dir.join("mods/a.jar"), b"jar").unwrap();
        let old_sha1 = file_sha1(&dir.join("config/untouched.toml")).unwrap();
        let before: std::collections::HashMap<String, (String, String)> = [
            ("config/untouched.toml".to_string(), (old_sha1.clone(), String::new())),
            ("config/edited.toml".to_string(), (old_sha1, String::new())),
        ]
        .into_iter()
        .collect();
        let cases = [
            ("config/untouched.toml", true, "a config the player never opened follows the pack"),
            ("config/edited.toml", false, "the player's edit survives"),
            ("config/own.toml", false, "a file the old version did not ship is the player's"),
            ("config/new.toml", true, "a new file of the pack arrives"),
            ("options.txt", false, "the player's settings stay"),
            ("mods/a.jar", true, "the pack owns mods/"),
        ];
        for (rel, want, why) in cases {
            assert_eq!(update_replaces(rel, &dir, Some(&before)), want, "{why}");
        }
        assert!(update_replaces("config/edited.toml", &dir, None), "without the old version only the player's own files are kept");
        assert!(!update_replaces("options.txt", &dir, None), "options.txt is the player's either way");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// (installed version id) -> offered update. Report 17.11.2026: FTB Skies 2: Aero stayed on
    /// 1.3.0 while 1.16.0 was out; "1.3.0" sorts above "1.16.0" as text, so only release time counts.
    #[test]
    fn an_update_is_the_newest_release_by_time_not_by_name() {
        let pack = serde_json::json!({ "versions": [
            { "id": 10, "name": "1.3.0", "type": "release", "released": 100 },
            { "id": 20, "name": "1.16.0", "type": "release", "released": 300 },
            { "id": 30, "name": "1.17.0-beta", "type": "beta", "released": 400 },
        ]});
        let name = |current: u64| update_from(&pack, current).and_then(|v| v["name"].as_str()).map(str::to_string);
        assert_eq!(name(10).as_deref(), Some("1.16.0"), "an old release is offered the newest release");
        assert_eq!(name(20), None, "the newest release is up to date");
        assert_eq!(name(30), None, "a beta newer than the newest release is not downgraded");
        assert_eq!(name(99).as_deref(), Some("1.16.0"), "an unknown installed id (pulled version) is offered the newest");
    }

    /// (settings of a build) -> its FTB origin. Builds installed before the ids were written have none.
    #[test]
    fn only_a_build_with_both_ids_has_an_ftb_origin() {
        let full = serde_json::json!({ "ftbPackId": 134, "ftbVersionId": 100613, "ftbVersionName": "1.16.0" });
        assert_eq!(ftb_origin(&full), Some((134, 100613, "1.16.0".to_string())));
        assert_eq!(ftb_origin(&serde_json::json!({ "ftbPackId": 134 })), None, "no version id, nothing to compare");
        assert_eq!(ftb_origin(&serde_json::json!({})), None, "a build not from FTB");
        assert_eq!(ftb_origin(&serde_json::Value::Null), None, "no settings file");
    }
}
