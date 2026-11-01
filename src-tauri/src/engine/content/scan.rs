// Recognizes mods in a modpack: asks Modrinth by sha1 and CurseForge by fingerprint. The requests contain file hashes, not file names.
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

/// Read buffer of the hash: a mod can be hundreds of megabytes, memory must not grow with it.
const HASH_BUF: usize = 256 * 1024;

fn sha1_reader<R: std::io::Read>(mut r: R) -> std::io::Result<String> {
    let mut h = Sha1::new();
    let mut buf = vec![0u8; HASH_BUF];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

fn file_sha1(path: &std::path::Path) -> Option<String> {
    match std::fs::File::open(path).and_then(sha1_reader) {
        Ok(sha1) => Some(sha1),
        Err(e) => {
            eprintln!("[scan] sha1 of {} was not computed: {e}", path.display());
            None
        }
    }
}

/// Where the file of a metadata entry lies now: enabled, or renamed to `.disabled`.
fn content_path(dir: &std::path::Path, file_name: &str) -> std::path::PathBuf {
    let on = dir.join(file_name);
    if on.exists() {
        on
    } else {
        dir.join(format!("{}.disabled", file_name))
    }
}

struct ScanPrep {
    scanned: u32,
    /// sha1 -> file name, of the files no catalog installed.
    by_hash: HashMap<String, String>,
}

/// Everything the scan does on the disk, for the blocking pool: the metadata (only new and changed
/// files are opened) and the hashes (only of files whose stored hash is gone with a change).
/// Computed hashes are kept next to the metadata, so the next scan reads nothing it has seen.
fn prepare_scan(profile: &str, kind: &str) -> ScanPrep {
    let local = scan_local_meta(profile, kind, false);
    let manifest = load_content_manifest(profile);
    let known: std::collections::HashSet<String> = manifest
        .iter()
        .filter(|e| e.kind == kind && !e.project_id.is_empty())
        .map(|e| e.file_name.clone())
        .collect();
    let dir = profile_dir(profile).join(content_dir(kind));
    let mut by_hash: HashMap<String, String> = HashMap::new();
    let mut computed: Vec<HashedFile> = Vec::new();
    for m in &local {
        if known.contains(&m.file_name) {
            continue;
        }
        if !m.sha1.is_empty() {
            by_hash.insert(m.sha1.clone(), m.file_name.clone());
            continue;
        }
        let path = content_path(&dir, &m.file_name);
        let before = file_stamp(&path);
        let Some(sha1) = file_sha1(&path) else { continue };
        // A file that changed while it was read has no hash worth keeping.
        if file_stamp(&path) == before {
            computed.push(HashedFile { file_name: m.file_name.clone(), size: before.0, mtime: before.1, sha1: sha1.clone() });
        }
        by_hash.insert(sha1, m.file_name.clone());
    }
    remember_hashes(profile, kind, &computed);
    ScanPrep { scanned: local.len() as u32, by_hash }
}

pub(crate) async fn versions_by_hash(hashes: &[String]) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for chunk in hashes.chunks(100) {
        if let Ok(found) = versions_by_hash_checked(chunk).await {
            out.extend(found);
        }
    }
    out
}

/// Same lookup for callers that must tell "Modrinth does not know this file"
/// from "Modrinth did not answer": a shared pack is refused on the first and
/// retried on the second.
pub(crate) async fn versions_by_hash_checked(hashes: &[String]) -> Result<HashMap<String, Value>, String> {
    let mut out = HashMap::new();
    for chunk in hashes.chunks(100) {
        let body = serde_json::json!({ "hashes": chunk, "algorithm": "sha1" });
        // POST to api.modrinth.com: hashes of the modpack files.
        let v = post_json("https://api.modrinth.com/v2/version_files", &body).await?;
        for (hash, ver) in v.as_object().cloned().unwrap_or_default() {
            out.insert(hash, ver);
        }
    }
    Ok(out)
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
    // Disk work (opening jars, reading and hashing mods) never on the async thread: it would hold
    // up every other request of the launcher for as long as a spinning disk takes.
    let ScanPrep { scanned, by_hash } = tauri::async_runtime::spawn_blocking(move || prepare_scan(&p, &k))
        .await
        .map_err(|e| e.to_string())?;
    let dir = profile_dir(&profile).join(content_dir(&kind));
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

/// CurseForge fingerprints of the files Modrinth did not know (sha1, file name), streamed from disk.
fn fingerprints(dir: &std::path::Path, left: &[(String, String)]) -> HashMap<u32, (String, String)> {
    let mut by_print: HashMap<u32, (String, String)> = HashMap::new();
    for (sha1, file_name) in left {
        if let Some(print) = fingerprint_file(&content_path(dir, file_name)) {
            by_print.insert(print, (sha1.clone(), file_name.clone()));
        }
    }
    by_print
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
    let (owned_left, owned_dir) = (left.to_vec(), dir.to_path_buf());
    let by_print = match tauri::async_runtime::spawn_blocking(move || fingerprints(&owned_dir, &owned_left)).await {
        Ok(map) => map,
        Err(e) => {
            eprintln!("[scan] fingerprinting was interrupted: {e}");
            return 0;
        }
    };
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The digest of a stream does not depend on how the reads are cut, and matches the known value.
    #[test]
    fn streamed_sha1_matches_the_known_digest_for_any_read_size() {
        assert_eq!(sha1_reader(std::io::Cursor::new(b"abc".to_vec())).unwrap(), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(sha1_reader(std::io::Cursor::new(Vec::new())).unwrap(), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        // Three buffers and a bit: the result must equal the digest of the same bytes in one go.
        let data: Vec<u8> = (0..(HASH_BUF * 3 + 17)).map(|i| (i * 31 % 251) as u8).collect();
        let mut h = Sha1::new();
        h.update(&data);
        let whole: String = h.finalize().iter().map(|b| format!("{:02x}", b)).collect();
        assert_eq!(sha1_reader(std::io::Cursor::new(data)).unwrap(), whole);
    }

    /// A reader that hands out at most 5 bytes at a time, as a pipe or a slow disk may.
    #[test]
    fn short_reads_do_not_change_the_hash() {
        struct Dribble(std::io::Cursor<Vec<u8>>);
        impl std::io::Read for Dribble {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                let n = buf.len().min(5);
                self.0.read(&mut buf[..n])
            }
        }
        let data = b"The quick brown fox jumps over the lazy dog".to_vec();
        assert_eq!(sha1_reader(Dribble(std::io::Cursor::new(data))).unwrap(), "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12");
    }

    #[test]
    fn a_missing_file_has_no_hash_instead_of_an_empty_one() {
        assert_eq!(file_sha1(std::path::Path::new("/definitely/not/here.jar")), None);
    }

    #[test]
    fn a_disabled_mod_is_found_under_its_disabled_name() {
        let dir = std::env::temp_dir().join(format!("millida-scan-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.jar"), b"x").unwrap();
        std::fs::write(dir.join("b.jar.disabled"), b"x").unwrap();
        assert_eq!(content_path(&dir, "a.jar"), dir.join("a.jar"));
        assert_eq!(content_path(&dir, "b.jar"), dir.join("b.jar.disabled"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
