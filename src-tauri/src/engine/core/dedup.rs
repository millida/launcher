//! Content-addressed store shared by every build: one copy of Sodium on disk,
//! however many builds have it installed.
//!
//! Only files that the game reads and never writes are shared — mods, resource
//! packs, shaders, datapacks. Worlds, configs and options.txt keep their own
//! copy, because a hard link would carry an edit made in one build into all the
//! others.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::paths::{game_root, dir_size};

#[derive(Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DedupReport {
    pub files: u32,
    pub unique: u32,
    pub linked: u32,
    pub total_bytes: u64,
    /// What the duplicates would cost without sharing.
    pub saved_bytes: u64,
    pub store_bytes: u64,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub note: String,
}

/// Directories whose files are content-addressed. `saves` and `config` are
/// deliberately absent: the game writes into them.
pub(crate) const SHARED_DIRS: [&str; 4] = ["mods", "resourcepacks", "shaderpacks", "datapacks"];

/// Below this a hard link saves less than the directory entry costs, and tiny
/// files are usually configs that were dropped into mods/ by hand.
const MIN_SHARE_BYTES: u64 = 64 * 1024;

pub(crate) fn store_dir() -> PathBuf {
    game_root().join("objects")
}

fn sha1_ok(sum: &str) -> bool {
    sum.len() == 40 && sum.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `objects/ab/abcdef...`: the two-character shard keeps directories small
/// enough for Windows to list quickly.
pub(crate) fn object_path(sha1: &str) -> Option<PathBuf> {
    if !sha1_ok(sha1) {
        return None;
    }
    let low = sha1.to_ascii_lowercase();
    Some(store_dir().join(&low[..2]).join(&low))
}

pub(crate) fn file_sha1(path: &Path) -> Option<String> {
    use sha1::Digest as _;
    let mut file = std::fs::File::open(path).ok()?;
    let mut h = sha1::Sha1::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        match std::io::Read::read(&mut file, &mut buf) {
            Ok(0) => break,
            Ok(n) => h.update(&buf[..n]),
            Err(_) => return None,
        }
    }
    Some(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

/// Replaces `dest` with a link to the stored object. Written next to the target
/// and renamed over it, so a failure leaves the previous file untouched rather
/// than a half-installed mod.
fn link_over(object: &Path, dest: &Path) -> bool {
    let Some(dir) = dest.parent() else { return false };
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let mut tmp_name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".link");
    let tmp = dest.with_file_name(tmp_name);
    let _ = std::fs::remove_file(&tmp);
    if std::fs::hard_link(object, &tmp).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    if std::fs::rename(&tmp, dest).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return false;
    }
    true
}

/// A file already in the store needs no download: the copy on disk is proven by
/// its digest, so linking it is the same file the CDN would have sent.
pub(crate) fn link_from_store(sha1: &str, dest: &Path, size: Option<u64>) -> bool {
    let Some(object) = object_path(sha1) else { return false };
    let Ok(meta) = std::fs::metadata(&object) else { return false };
    if !meta.is_file() || meta.len() < MIN_SHARE_BYTES {
        return false;
    }
    if let Some(want) = size {
        if meta.len() != want {
            return false;
        }
    }
    link_over(&object, dest)
}

/// Puts a freshly downloaded file into the store. The object is a hard link to
/// the file itself, so nothing is copied and nothing is written twice.
pub(crate) fn adopt_to_store(path: &Path, sha1: &str) {
    let Some(object) = object_path(sha1) else { return };
    if object.exists() {
        return;
    }
    let Ok(meta) = std::fs::metadata(path) else { return };
    if !meta.is_file() || meta.len() < MIN_SHARE_BYTES {
        return;
    }
    if let Some(dir) = object.parent() {
        if std::fs::create_dir_all(dir).is_err() {
            return;
        }
    }
    let _ = std::fs::hard_link(path, &object);
}

fn shared_files(profile_dir: &Path) -> Vec<(PathBuf, u64)> {
    let mut out = vec![];
    for sub in SHARED_DIRS {
        let dir = profile_dir.join(sub);
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || meta.len() < MIN_SHARE_BYTES {
                continue;
            }
            out.push((e.path(), meta.len()));
        }
    }
    out
}

fn every_shared_file() -> Vec<(PathBuf, u64)> {
    let root = game_root().join("profiles");
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(&root) else { return out };
    for e in rd.flatten() {
        if e.path().is_dir() {
            out.extend(shared_files(&e.path()));
        }
    }
    out
}

/// Groups the shared files by digest and, when `apply` is set, points every
/// copy at one object. The saving reported is the same number before and after:
/// it is what the duplicates weigh, not what this particular run happened to
/// change.
fn walk_store(apply: bool) -> DedupReport {
    let files = every_shared_file();
    let mut by_hash: HashMap<String, Vec<(PathBuf, u64)>> = HashMap::new();
    for (path, size) in files {
        let Some(sum) = file_sha1(&path) else { continue };
        by_hash.entry(sum).or_default().push((path, size));
    }
    let mut report = DedupReport::default();
    for (sha1, group) in &by_hash {
        let size = group.first().map(|(_, s)| *s).unwrap_or(0);
        report.files += group.len() as u32;
        report.unique += 1;
        report.total_bytes += size;
        report.saved_bytes += size * (group.len() as u64 - 1);
        if !apply {
            continue;
        }
        let Some(object) = object_path(sha1) else { continue };
        if !object.exists() {
            let Some((first, _)) = group.first() else { continue };
            adopt_to_store(first, sha1);
        }
        if !object.exists() {
            continue;
        }
        for (path, _) in group {
            if link_over(&object, path) {
                report.linked += 1;
            }
        }
    }
    report.store_bytes = dir_size(&store_dir());
    report
}

pub fn dedupe_scan() -> DedupReport {
    walk_store(false)
}

pub fn dedupe_run() -> DedupReport {
    let mut report = walk_store(true);
    if report.files > 0 && report.linked == 0 {
        report.note = "Файловая система не поддерживает жёсткие ссылки — общее хранилище не включилось".into();
    }
    report
}

/// Objects no build points at any more. Removing a mod leaves its object behind
/// — the link count is still one — so the store needs an explicit sweep.
pub fn store_gc() -> u64 {
    let alive: std::collections::HashSet<String> =
        every_shared_file().iter().filter_map(|(p, _)| file_sha1(p)).collect();
    let mut freed = 0;
    let Ok(shards) = std::fs::read_dir(store_dir()) else { return 0 };
    for shard in shards.flatten() {
        if !shard.path().is_dir() {
            continue;
        }
        let Ok(objects) = std::fs::read_dir(shard.path()) else { continue };
        for obj in objects.flatten() {
            let name = obj.file_name().to_string_lossy().to_string();
            if alive.contains(&name) {
                continue;
            }
            let size = obj.metadata().map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(obj.path()).is_ok() {
                freed += size;
            }
        }
        let _ = std::fs::remove_dir(shard.path());
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-dedup-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// digest -> path. The digest names a directory and a file inside the game
    /// root, so anything but a plain sha1 must never reach the filesystem.
    #[test]
    fn only_a_full_sha1_addresses_an_object() {
        for good in ["a".repeat(40), "0123456789abcdef0123456789abcdef01234567".into()] {
            assert!(object_path(&good).is_some(), "«{good}» is a plain sha1");
        }
        for bad in ["", "abc", &"a".repeat(41), "../../evil", &"z".repeat(40)] {
            assert!(
                object_path(bad).is_none(),
                "«{bad}» must be rejected: it becomes a path segment under objects/",
            );
        }
    }

    /// A linked file is the same bytes, and rewriting through the link is what
    /// makes worlds and configs ineligible — pinned here so the shared-directory
    /// list is never widened by accident.
    #[test]
    fn shared_dirs_never_include_writable_game_data() {
        for writable in ["saves", "config", "logs", "screenshots", "crash-reports"] {
            assert!(
                !SHARED_DIRS.contains(&writable),
                "{writable}/ is written by the game: sharing it by hard link would carry one \
                 build's edit into every other build that has the same file",
            );
        }
    }

    #[test]
    fn linking_replaces_the_file_and_keeps_its_bytes() {
        let dir = tmp("link");
        let object = dir.join("object.bin");
        let dest = dir.join("mods/sodium.jar");
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::write(&object, b"payload").unwrap();
        std::fs::write(&dest, b"stale").unwrap();

        assert!(link_over(&object, &dest), "a hard link inside one directory must succeed");
        assert_eq!(std::fs::read(&dest).unwrap(), b"payload");
        assert!(
            !dest.with_file_name("sodium.jar.link").exists(),
            "the temporary link must not survive the rename",
        );
    }
}
