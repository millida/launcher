use crate::engine::*;
use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

fn unique_name(base: &str) -> String {
    unique_profile_name(base)
}

fn commit(prof: Profile) -> Result<Profile, String> {
    let mut all = load_profiles();
    all.retain(|p| p.name != prof.name);
    all.insert(0, prof.clone());
    save_profiles(&all)?;
    Ok(prof)
}

/// mrpack: download every index entry from its mirrors, then apply overrides/.
async fn from_mrpack(app: &AppHandle, ex: &Path, name_hint: &str) -> Result<Profile, String> {
    let idx: Value = serde_json::from_slice(&std::fs::read(ex.join("modrinth.index.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let deps = &idx["dependencies"];
    let mc = deps["minecraft"].as_str().ok_or("В .mrpack нет версии Minecraft")?.to_string();
    let (lid, fabric, dep_key) = if deps.get("neoforge").is_some() { ("neoforge", false, "neoforge") }
        else if deps.get("forge").is_some() { ("forge", false, "forge") }
        else if deps.get("quilt-loader").is_some() { ("quilt", true, "quilt-loader") }
        else if deps.get("fabric-loader").is_some() { ("fabric", true, "fabric-loader") }
        else { ("vanilla", false, "") };
    let loader_version = deps[dep_key].as_str().filter(|v| !v.is_empty()).map(String::from);
    let pname = unique_name(idx["name"].as_str().unwrap_or(name_hint));
    let pdir = profile_dir(&pname);
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let files = idx["files"].as_array().cloned().unwrap_or_default();
    let total = files.len().max(1);
    for (i, f) in files.iter().enumerate() {
        if f["env"]["client"].as_str() == Some("unsupported") { continue }
        let Some(path) = f["path"].as_str() else { continue };
        let dest = match safe_join(&pdir, path) {
            Ok(d) => d,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&pdir);
                return Err(format!("Сборка содержит небезопасный путь: {}", e));
            }
        };
        let mut done = false;
        if let Some(urls) = f["downloads"].as_array() {
            for u in urls {
                if let Some(u) = u.as_str() {
                    if download_verify(u, &dest, f["hashes"]["sha1"].as_str(), f["fileSize"].as_u64()).await.is_ok() {
                        done = true;
                        break;
                    }
                }
            }
        }
        if !done {
            let _ = std::fs::remove_dir_all(&pdir);
            return Err(format!("Не удалось скачать файл сборки: {}", path));
        }
        emit(app, "mod", 20.0 + 60.0 * (i as f32 / total as f32), &format!("Файлы сборки {}/{}", i + 1, total));
    }
    for ov in ["overrides", "client-overrides"] {
        let src = ex.join(ov);
        if src.exists() { let _ = copy_dir_all(&src, &pdir); }
    }
    commit(Profile { name: pname, version: mc, fabric, loader: Some(lid.into()), loader_version, icon: None })
}

/// CurseForge manifest: mods resolved by projectID/fileID through the CF API.
async fn from_cf_manifest(app: &AppHandle, ex: &Path, name_hint: &str) -> Result<Profile, String> {
    let man: Value = serde_json::from_slice(&std::fs::read(ex.join("manifest.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mc = man["minecraft"]["version"].as_str().ok_or("В manifest.json нет версии Minecraft")?.to_string();
    let loader_full = man["minecraft"]["modLoaders"].as_array()
        .and_then(|a| a.iter().find(|m| m["primary"] == true).or_else(|| a.first()))
        .and_then(|m| m["id"].as_str()).unwrap_or("").to_string();
    let (lid, loader_version) = split_loader_id(&loader_full);
    let pname = unique_name(man["name"].as_str().unwrap_or(name_hint));
    let pdir = profile_dir(&pname);
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let list = man["files"].as_array().cloned().unwrap_or_default();
    let total = list.len().max(1);
    let mut failed: Vec<String> = vec![];
    for (i, f) in list.iter().enumerate() {
        let (pid, fid) = (f["projectID"].as_u64().unwrap_or(0), f["fileID"].as_u64().unwrap_or(0));
        if pid == 0 || fid == 0 { continue }
        let required = f["required"].as_bool().unwrap_or(true);
        if let Ok(j) = cf_get(&format!("v1/mods/{}/files/{}", pid, fid), &[]).await {
            let d = &j["data"];
            if let Ok(fname) = safe_file_name(d["fileName"].as_str().unwrap_or("")) {
                let dest = safe_child(&pdir.join("mods"), &fname)?;
                if let Err(e) = cf_download(d, &fname, &dest).await {
                    if required { failed.push(format!("{} ({})", fname, e)) }
                }
            }
        } else if required {
            failed.push(format!("файл #{} (CurseForge не ответил)", fid));
        }
        emit(app, "mod", 20.0 + 60.0 * (i as f32 / total as f32), &format!("Моды {}/{}", i + 1, total));
    }
    if !failed.is_empty() {
        let _ = std::fs::remove_dir_all(&pdir);
        return Err(format!("Не скачались файлы сборки: {}", failed.join("; ")));
    }
    for name in [man["overrides"].as_str().filter(|s| !s.is_empty()).unwrap_or("overrides"), "client-overrides"] {
        let ov = safe_join(ex, name)?;
        if ov.exists() { copy_dir_all(&ov, &pdir).map_err(|e| e.to_string())?; }
    }
    let fabric = matches!(lid.as_str(), "fabric" | "quilt");
    commit(Profile { name: pname, version: mc, fabric, loader: Some(lid), loader_version, icon: None })
}

/// Plain client folder: version and loader are detected from the game files.
fn from_plain_dir(dir: &Path, name_hint: &str) -> Result<Profile, String> {
    let game = ["minecraft", ".minecraft"].iter().map(|d| dir.join(d)).find(|p| p.exists()).unwrap_or(dir.to_path_buf());
    let (version, loader) = detect_from_game_dir(&game).unwrap_or_else(|| (String::new(), "vanilla".into()));
    if version.is_empty() {
        return Err("Не удалось определить версию Minecraft — импортируй .mrpack или zip с manifest.json".into());
    }
    let pname = unique_name(name_hint);
    vouch(&game);
    import_instance(game.to_string_lossy().to_string(), pname, version, loader)
}

fn base_name(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Сборка".into())
}

pub async fn import_pack_file(app: AppHandle, path: Option<String>) -> Result<Profile, String> {
    // The path from the webview is ignored: only a native pick may name a file,
    // so a compromised webview cannot aim the import at arbitrary files.
    let _ = path;
    let picked = pick_file(
        dialog()
            .add_filter("Сборка Minecraft", &["mrpack", "zip"])
            .set_title("Файл сборки (.mrpack или .zip)"),
    )
    .await
    .ok_or("Отменено")?;
    if picked.is_dir() { return from_plain_dir(&picked, &base_name(&picked)); }
    if !picked.exists() { return Err("Файл не найден".into()) }
    emit(&app, "mod", 10.0, "Распаковываем сборку…");
    let ex = data_dir().join("tmp").join("packfile");
    let _ = std::fs::remove_dir_all(&ex);
    std::fs::create_dir_all(&ex).map_err(|e| e.to_string())?;
    unzip_to(&picked, &ex).map_err(|e| format!("Не удалось распаковать: {}", e))?;
    // the archive may be wrapped in a single top-level folder
    let root = {
        let mut r = ex.clone();
        for _ in 0..2 {
            if r.join("modrinth.index.json").exists() || r.join("manifest.json").exists() { break }
            let mut dirs = std::fs::read_dir(&r).map_err(|e| e.to_string())?
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect::<Vec<_>>();
            if dirs.len() == 1 { r = dirs.pop().unwrap() } else { break }
        }
        r
    };
    let hint = base_name(&picked);
    let res = if root.join("modrinth.index.json").exists() {
        from_mrpack(&app, &root, &hint).await
    } else if root.join("manifest.json").exists() {
        from_cf_manifest(&app, &root, &hint).await
    } else {
        from_plain_dir(&root, &hint)
    };
    let _ = std::fs::remove_dir_all(&ex);
    if res.is_ok() { emit(&app, "mod", 100.0, "Сборка импортирована") }
    res
}
