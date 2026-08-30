use crate::engine::*;
use futures::StreamExt;
use md5::Digest;
use serde_json::Value;
use sha1::Sha1;
use std::path::PathBuf;

#[derive(Clone, serde::Serialize)]
pub struct UpdateInfo {
    pub file_name: String,
    pub new_version_id: String,
    pub new_version_number: String,
}

/// Resolves latest versions in one bulk sha1 request; entries without a stored
/// hash fall back to per-project lookups.
async fn latest_versions(
    entries: &[ContentEntry],
    game_version: &str,
    loaders: &[String],
    bridge: &[String],
) -> std::collections::HashMap<String, Value> {
    let mut out: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    let hashed: Vec<&ContentEntry> = entries.iter().filter(|e| !e.sha1.is_empty()).collect();
    let hashes: Vec<String> = hashed.iter().map(|e| e.sha1.to_lowercase()).collect();
    // A bridged build updates its Fabric jars too, so the bulk request must
    // name both loaders — with the build's own first, it stays the preferred
    // answer for a project that ships for both.
    let asked: Vec<String> = loaders.iter().chain(bridge.iter()).cloned().collect();
    let by_hash = bulk_latest_by_hash(&hashes, game_version, &asked).await;
    for e in &hashed {
        if let Some(v) = by_hash.get(&e.sha1.to_lowercase()) {
            out.insert(e.file_name.clone(), v.clone());
        }
    }
    let rest: Vec<(String, String)> = entries
        .iter()
        .filter(|e| !out.contains_key(&e.file_name))
        .map(|e| (e.file_name.clone(), e.project_id.clone()))
        .collect();
    if !rest.is_empty() {
        let gv = game_version.to_string();
        let ld = loaders.to_vec();
        let br = bridge.to_vec();
        let found: Vec<Option<(String, Value)>> = futures::stream::iter(rest.into_iter().map(|(fname, pid)| {
            let gv = gv.clone();
            let ld = ld.clone();
            let br = br.clone();
            async move { best_version_bridged(&pid, &gv, &ld, &br).await.ok().map(|v| (fname, v)) }
        }))
        .buffer_unordered(8)
        .collect()
        .await;
        for (fname, v) in found.into_iter().flatten() {
            out.insert(fname, v);
        }
    }
    out
}

pub async fn check_updates(profile: String, kind: String) -> Result<Vec<UpdateInfo>, String> {
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    let gv = prof.as_ref().map(|p| p.version.clone()).unwrap_or_default();
    let loader_id = prof.map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
    let loaders = modrinth_loaders(&loader_id, &kind);
    let bridge = bridge_loaders(&profile, &loader_id, &kind);
    let entries: Vec<ContentEntry> = load_content_manifest(&profile)
        .into_iter()
        .filter(|e| e.kind == kind && !e.project_id.is_empty())
        .collect();
    if entries.is_empty() {
        return Ok(vec![]);
    }
    let latest = latest_versions(&entries, &gv, &loaders, &bridge).await;
    let mut out = vec![];
    for e in entries {
        let Some(v) = latest.get(&e.file_name) else { continue };
        let nid = v["id"].as_str().unwrap_or("");
        if !nid.is_empty() && nid != e.version_id {
            out.push(UpdateInfo {
                file_name: e.file_name,
                new_version_id: nid.to_string(),
                new_version_number: v["version_number"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    Ok(out)
}

async fn apply_update(profile: &str, kind: &str, file_name: &str, ver: &Value) -> Result<String, String> {
    let project = ver["project_id"].as_str().unwrap_or("").to_string();
    let project = if project.is_empty() {
        load_content_manifest(profile)
            .into_iter()
            .find(|e| e.kind == kind && e.file_name == file_name)
            .map(|e| e.project_id)
            .unwrap_or_default()
    } else {
        project
    };
    if project.is_empty() {
        return Err("Файл не привязан к Modrinth".into());
    }
    let dir = profile_dir(profile).join(content_dir(kind));
    let file_name = safe_file_name(file_name)?;
    let off = safe_child(&dir, &format!("{}.disabled", file_name))?;
    let on = safe_child(&dir, &file_name)?;
    let was_disabled = off.exists() && !on.exists();
    let newname = install_project_version(profile, kind, &project, ver).await?;
    if newname != file_name {
        for cand in [on, off] {
            if cand.exists() { let _ = std::fs::remove_file(&cand); }
        }
        manifest_remove(profile, kind, &file_name);
    }
    if was_disabled { let _ = toggle_content(profile, kind, &newname, false); }
    Ok(newname)
}

pub async fn update_content(profile: String, kind: String, file_name: String) -> Result<String, String> {
    let entry = load_content_manifest(&profile).into_iter()
        .find(|e| e.kind == kind && e.file_name == file_name)
        .ok_or("Запись в манифесте не найдена")?;
    if entry.project_id.is_empty() { return Err("Файл не привязан к Modrinth".into()); }
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    let gv = prof.as_ref().map(|p| p.version.clone()).unwrap_or_default();
    let loader_id = prof.map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
    let loaders = modrinth_loaders(&loader_id, &kind);
    let bridge = bridge_loaders(&profile, &loader_id, &kind);
    let ver = best_version_bridged(&entry.project_id, &gv, &loaders, &bridge).await
        .map_err(|e| format!("{}: {}", if entry.title.is_empty() { file_name.clone() } else { entry.title.clone() }, e))?;
    apply_update(&profile, &kind, &file_name, &ver).await
}

/// Resolves versions once for the whole batch instead of per file.
pub async fn update_all(profile: String, kind: String) -> Result<u32, String> {
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    let gv = prof.as_ref().map(|p| p.version.clone()).unwrap_or_default();
    let loader_id = prof.map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
    let loaders = modrinth_loaders(&loader_id, &kind);
    let bridge = bridge_loaders(&profile, &loader_id, &kind);
    let entries: Vec<ContentEntry> = load_content_manifest(&profile)
        .into_iter()
        .filter(|e| e.kind == kind && !e.project_id.is_empty())
        .collect();
    if entries.is_empty() {
        return Ok(0);
    }
    let latest = latest_versions(&entries, &gv, &loaders, &bridge).await;
    let ids: Vec<String> = entries.iter().map(|e| e.project_id.clone()).collect();
    warm_projects_meta(&ids).await;
    let mut n = 0;
    for e in entries {
        let Some(v) = latest.get(&e.file_name) else { continue };
        let nid = v["id"].as_str().unwrap_or("");
        if nid.is_empty() || nid == e.version_id {
            continue;
        }
        if apply_update(&profile, &kind, &e.file_name, v).await.is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

pub fn content_exts(kind: &str) -> &'static [&'static str] {
    match kind {
        "mod" => &["jar", "zip", "litemod"],
        _ => &["zip"],
    }
}

pub async fn pick_content_files(kind: String) -> Result<Vec<String>, String> {
    let exts = content_exts(&kind);
    let (filter, title) = match kind.as_str() {
        "mod" => ("Моды", "Выбери моды"),
        "resourcepack" => ("Ресурспаки", "Выбери ресурспаки"),
        "datapack" => ("Дата-паки", "Выбери дата-паки"),
        "shader" => ("Шейдеры", "Выбери шейдеры"),
        _ => ("Файлы", "Выбери файлы"),
    };
    let picked = pick_files(dialog().add_filter(filter, exts).set_title(title)).await;
    Ok(picked
        .unwrap_or_default()
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

pub async fn add_local_file(profile: String, kind: String, src: String) -> Result<String, String> {
    let srcp = PathBuf::from(&src);
    let fname = safe_file_name(&srcp.file_name().ok_or("нет имени файла")?.to_string_lossy())?;
    let dir = profile_dir(&profile).join(content_dir(&kind));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = safe_child(&dir, &fname)?;
    std::fs::copy(&srcp, &dest).map_err(|e| e.to_string())?;
    // sha1 lookup identifies the file on Modrinth when possible
    let bytes = std::fs::read(&dest).map_err(|e| e.to_string())?;
    let mut h = Sha1::new(); h.update(&bytes);
    let sha1hex: String = h.finalize().iter().map(|b| format!("{:02x}", b)).collect();
    if let Ok(v) = get_json(&format!("https://api.modrinth.com/v2/version_file/{}?algorithm=sha1", sha1hex)).await {
        if let Some(pid) = v["project_id"].as_str() {
            let (pidc, title, icon, summary) = fetch_project_meta(pid).await;
            let file = v["files"].as_array()
                .and_then(|fs| fs.iter().find(|f| f["hashes"]["sha1"].as_str() == Some(&sha1hex)).or_else(|| fs.first()));
            manifest_upsert(&profile, ContentEntry {
                kind: kind.clone(),
                file_name: fname.clone(),
                project_id: pidc,
                version_id: v["id"].as_str().unwrap_or("").to_string(),
                version_number: v["version_number"].as_str().unwrap_or("").to_string(),
                title, icon_url: icon, description: summary,
                author: v["author_id"].as_str().unwrap_or("").to_string(),
                download_url: file.and_then(|f| f["url"].as_str()).unwrap_or("").to_string(),
                sha1: sha1hex.clone(),
                sha512: file.and_then(|f| f["hashes"]["sha512"].as_str()).unwrap_or("").to_string(),
                file_size: file.and_then(|f| f["size"].as_u64()).unwrap_or(0),
            });
        }
    }
    Ok(fname)
}
