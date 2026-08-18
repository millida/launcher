use crate::engine::*;
use md5::Digest;
use serde_json::Value;
use sha1::Sha1;
use std::collections::HashMap;

#[derive(Clone, serde::Serialize)]
pub struct ScanResult {
    pub scanned: u32,
    pub identified: u32,
    /// Recognised by hash on Modrinth and by fingerprint on CurseForge. The
    /// counters stay separate because "no catalogue knows this file" and "this
    /// came from CurseForge" are different answers for the player.
    #[serde(default)]
    pub modrinth: u32,
    #[serde(default)]
    pub curseforge: u32,
    pub items: Vec<ModFile>,
}

fn file_sha1(path: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let mut h = Sha1::new();
    h.update(&bytes);
    Some(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

pub(crate) async fn versions_by_hash(hashes: &[String]) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for chunk in hashes.chunks(100) {
        let body = serde_json::json!({ "hashes": chunk, "algorithm": "sha1" });
        let Ok(v) = post_json("https://api.modrinth.com/v2/version_files", &body).await else { continue };
        for (hash, ver) in v.as_object().cloned().unwrap_or_default() {
            out.insert(hash, ver);
        }
    }
    out
}

async fn projects_by_id(ids: &[String]) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(50) {
        let list = serde_json::to_string(&chunk.to_vec()).unwrap_or_else(|_| "[]".into());
        let url = format!("https://api.modrinth.com/v2/projects?ids={}", urlencode(&list));
        let Ok(v) = get_json(&url).await else { continue };
        for p in v.as_array().cloned().unwrap_or_default() {
            if let Some(id) = p["id"].as_str() {
                out.insert(id.to_string(), p);
            }
        }
    }
    out
}

/// Reads local metadata and identifies files that were not installed through a
/// catalog (modpacks, jars added by hand). Modrinth answers by sha1;
/// CurseForge indexes nothing by hash, so what it does not recognise there is
/// asked again by its own fingerprint — otherwise every file from the larger of
/// the two catalogues stays "unknown", with no icon, no version and no update
/// check.
pub async fn scan_content(profile: String, kind: String) -> Result<ScanResult, String> {
    let p = profile.clone();
    let k = kind.clone();
    let local = tauri::async_runtime::spawn_blocking(move || scan_local_meta(&p, &k, true))
        .await
        .map_err(|e| e.to_string())?;
    let scanned = local.len() as u32;

    let manifest = load_content_manifest(&profile);
    let known: std::collections::HashSet<String> = manifest
        .iter()
        .filter(|e| e.kind == kind && !e.project_id.is_empty())
        .map(|e| e.file_name.clone())
        .collect();
    let dir = profile_dir(&profile).join(content_dir(&kind));
    let mut by_hash: HashMap<String, String> = HashMap::new();
    for m in &local {
        if known.contains(&m.file_name) {
            continue;
        }
        let on = dir.join(&m.file_name);
        let off = dir.join(format!("{}.disabled", m.file_name));
        let path = if on.exists() { on } else { off };
        if let Some(sha1) = file_sha1(&path) {
            by_hash.insert(sha1, m.file_name.clone());
        }
    }
    let mut identified = 0u32;
    let mut found: std::collections::HashSet<String> = std::collections::HashSet::new();
    if !by_hash.is_empty() {
        let hashes: Vec<String> = by_hash.keys().cloned().collect();
        let versions = versions_by_hash(&hashes).await;
        let ids: Vec<String> = versions
            .values()
            .filter_map(|v| v["project_id"].as_str().map(str::to_string))
            .collect::<std::collections::HashSet<String>>()
            .into_iter()
            .collect();
        let projects = projects_by_id(&ids).await;
        for (hash, ver) in versions {
            let Some(file_name) = by_hash.get(&hash) else { continue };
            let pid = ver["project_id"].as_str().unwrap_or("").to_string();
            if pid.is_empty() {
                continue;
            }
            let pj = projects.get(&pid);
            let file = ver["files"]
                .as_array()
                .and_then(|fs| fs.iter().find(|f| f["hashes"]["sha1"].as_str() == Some(&hash)).or_else(|| fs.first()));
            manifest_upsert(
                &profile,
                ContentEntry {
                    kind: kind.clone(),
                    file_name: file_name.clone(),
                    project_id: pid.clone(),
                    version_id: ver["id"].as_str().unwrap_or("").to_string(),
                    version_number: ver["version_number"].as_str().unwrap_or("").to_string(),
                    title: pj.and_then(|p| p["title"].as_str()).unwrap_or("").to_string(),
                    icon_url: pj.and_then(|p| p["icon_url"].as_str()).unwrap_or("").to_string(),
                    description: pj.and_then(|p| p["description"].as_str()).unwrap_or("").to_string(),
                    author: ver["author_id"].as_str().unwrap_or("").to_string(),
                    download_url: file.and_then(|f| f["url"].as_str()).unwrap_or("").to_string(),
                    sha1: hash.clone(),
                    sha512: file.and_then(|f| f["hashes"]["sha512"].as_str()).unwrap_or("").to_string(),
                    file_size: file.and_then(|f| f["size"].as_u64()).unwrap_or(0),
                },
            );
            identified += 1;
            found.insert(file_name.clone());
        }
    }
    let modrinth = identified;

    let left: Vec<(String, String)> = by_hash
        .iter()
        .filter(|(_, file_name)| !found.contains(*file_name))
        .map(|(hash, file_name)| (hash.clone(), file_name.clone()))
        .collect();
    let curseforge = identify_on_curseforge(&profile, &kind, &dir, &left).await;
    identified += curseforge;

    Ok(ScanResult {
        scanned,
        identified,
        modrinth,
        curseforge,
        items: list_content(&profile, &kind),
    })
}

/// Second pass: everything Modrinth did not claim is asked of CurseForge by
/// fingerprint. The digest already computed for Modrinth is reused as the
/// manifest sha1, so an update check and the shared file store keep working for
/// these files too.
async fn identify_on_curseforge(
    profile: &str,
    kind: &str,
    dir: &std::path::Path,
    left: &[(String, String)],
) -> u32 {
    if left.is_empty() {
        return 0;
    }
    let mut by_print: HashMap<u32, (String, String)> = HashMap::new();
    for (sha1, file_name) in left {
        let on = dir.join(file_name);
        let off = dir.join(format!("{}.disabled", file_name));
        let path = if on.exists() { on } else { off };
        if let Some(print) = fingerprint_file(&path) {
            by_print.insert(print, (sha1.clone(), file_name.clone()));
        }
    }
    if by_print.is_empty() {
        return 0;
    }
    let prints: Vec<u32> = by_print.keys().copied().collect();
    let mut done = 0u32;
    // The endpoint takes the whole list at once, but a huge pack would build a
    // body CurseForge rejects outright.
    for batch in prints.chunks(100) {
        let matches = cf_by_fingerprint(batch).await;
        if matches.is_empty() {
            continue;
        }
        let ids: Vec<u32> = matches
            .iter()
            .filter_map(|m| m["file"]["modId"].as_u64().map(|v| v as u32))
            .collect::<std::collections::HashSet<u32>>()
            .into_iter()
            .collect();
        let projects = cf_projects(&ids).await;
        for m in matches {
            let print = m["file"]["fileFingerprint"].as_u64().unwrap_or(0) as u32;
            let Some((sha1, file_name)) = by_print.get(&print) else { continue };
            let file = &m["file"];
            let mod_id = file["modId"].as_u64().unwrap_or(0) as u32;
            if mod_id == 0 {
                continue;
            }
            let project = projects.get(&mod_id);
            manifest_upsert(
                profile,
                ContentEntry {
                    kind: kind.to_string(),
                    file_name: file_name.clone(),
                    project_id: format!("cf:{}", mod_id),
                    version_id: file["id"].as_u64().unwrap_or(0).to_string(),
                    version_number: file["displayName"].as_str().unwrap_or("").to_string(),
                    title: project.and_then(|p| p["name"].as_str()).unwrap_or("").to_string(),
                    icon_url: project
                        .and_then(|p| p["logo"]["thumbnailUrl"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    description: project.and_then(|p| p["summary"].as_str()).unwrap_or("").to_string(),
                    author: project
                        .and_then(|p| p["authors"].as_array())
                        .and_then(|a| a.first())
                        .and_then(|a| a["name"].as_str())
                        .unwrap_or("")
                        .to_string(),
                    download_url: cf_file_urls(file, file_name).into_iter().next().unwrap_or_default(),
                    sha1: sha1.clone(),
                    sha512: String::new(),
                    file_size: file["fileLength"].as_u64().unwrap_or(0),
                },
            );
            done += 1;
        }
    }
    done
}
