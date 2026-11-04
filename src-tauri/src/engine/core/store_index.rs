// What the shared store (objects/ab/<sha1>) knows about its files beyond their names: size, CRC-32 and SHA-256, kept in
// objects/index.json together with the modification time the facts were checked at. A pack index names files by
// size and hash; this is how an install finds the ones the player already has without reading the store again each time.
// No network.
use super::dedup::{link_over, sha1_ok, store_dir, MIN_SHARE_BYTES, SHARED_DIRS};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const INDEX_FILE: &str = "index.json";
const INDEX_VERSION: u64 = 1;

/// A path inside a pack that may live in the shared store: directly in mods/, resourcepacks/, shaderpacks/ or
/// datapacks/, and big enough for a link to save anything (the same rule the rest of the launcher shares files by).
pub(crate) fn shareable(rel: &str, size: u64) -> bool {
    if size < MIN_SHARE_BYTES {
        return false;
    }
    let mut parts = rel.split('/');
    matches!((parts.next(), parts.next(), parts.next()), (Some(dir), Some(file), None) if !file.is_empty() && SHARED_DIRS.contains(&dir))
}

#[derive(Clone, Debug, PartialEq)]
struct Known {
    size: u64,
    modified_ms: i64,
    crc: u32,
    sha256: String,
}

pub(crate) struct StoreIndex {
    dir: PathBuf,
    by_size: HashMap<u64, Vec<String>>,
    known: HashMap<String, Known>,
    dirty: bool,
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// SHA-1, CRC-32 and SHA-256 of a file in one read.
fn digest_file(path: &Path) -> Option<(String, u32, String)> {
    use sha1::Digest as _;
    use std::io::Read as _;
    let mut file = std::fs::File::open(path).ok()?;
    let (mut s1, mut s256, mut crc) = (sha1::Sha1::new(), sha2::Sha256::new(), flate2::Crc::new());
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        s1.update(&buf[..n]);
        s256.update(&buf[..n]);
        crc.update(&buf[..n]);
    }
    Some((hex(&s1.finalize()), crc.sum(), hex(&s256.finalize())))
}

impl StoreIndex {
    pub(crate) fn open() -> StoreIndex {
        Self::open_at(store_dir())
    }

    pub(crate) fn open_at(dir: PathBuf) -> StoreIndex {
        let mut by_size: HashMap<u64, Vec<String>> = HashMap::new();
        if let Ok(shards) = std::fs::read_dir(&dir) {
            for shard in shards.flatten() {
                if !shard.path().is_dir() {
                    continue;
                }
                let Ok(objects) = std::fs::read_dir(shard.path()) else { continue };
                for obj in objects.flatten() {
                    let name = obj.file_name().to_string_lossy().to_ascii_lowercase();
                    if !sha1_ok(&name) {
                        continue;
                    }
                    if let Ok(meta) = obj.metadata() {
                        if meta.is_file() {
                            by_size.entry(meta.len()).or_default().push(name);
                        }
                    }
                }
            }
        }
        let known = std::fs::read(dir.join(INDEX_FILE)).ok().map(|raw| parse_known(&raw)).unwrap_or_default();
        StoreIndex { dir, by_size, known, dirty: false }
    }

    fn object(&self, name: &str) -> PathBuf {
        self.dir.join(&name[..2]).join(name)
    }

    /// The object whose size, CRC-32 and SHA-256 are all these, or none. Objects of another size are not opened.
    /// An object that no longer hashes to its own name is removed on the spot: it is not what its name says.
    pub(crate) fn find(&mut self, size: u64, crc: u32, sha256: &str) -> Option<PathBuf> {
        let names = self.by_size.get(&size)?.clone();
        for name in names {
            let path = self.object(&name);
            let Ok(meta) = std::fs::metadata(&path) else { continue };
            if !meta.is_file() || meta.len() != size {
                continue;
            }
            let stamp = modified_ms(&meta);
            let known = match self.known.get(&name).filter(|k| k.size == size && k.modified_ms == stamp) {
                Some(k) => k.clone(),
                None => {
                    let Some((sha1, got_crc, got_sha256)) = digest_file(&path) else { continue };
                    if !sha1.eq_ignore_ascii_case(&name) {
                        let _ = std::fs::remove_file(&path);
                        self.known.remove(&name);
                        self.dirty = true;
                        continue;
                    }
                    let k = Known { size, modified_ms: stamp, crc: got_crc, sha256: got_sha256 };
                    self.known.insert(name.clone(), k.clone());
                    self.dirty = true;
                    k
                }
            };
            if known.crc == crc && known.sha256.eq_ignore_ascii_case(sha256) {
                return Some(path);
            }
        }
        None
    }

    /// Facts about an object that was just verified (a file downloaded against its hash and linked into the store):
    /// the next install finds it without a read. The stamp is the object's own.
    fn remember(&mut self, sha1: &str, crc: u32, sha256: &str) {
        if !sha1_ok(sha1) {
            return;
        }
        let name = sha1.to_ascii_lowercase();
        let Ok(meta) = std::fs::metadata(self.object(&name)) else { return };
        if !meta.is_file() {
            return;
        }
        let k = Known { size: meta.len(), modified_ms: modified_ms(&meta), crc, sha256: sha256.to_ascii_lowercase() };
        if self.known.insert(name.clone(), k).is_none() && !self.by_size.get(&meta.len()).is_some_and(|v| v.contains(&name)) {
            self.by_size.entry(meta.len()).or_default().push(name);
        }
        self.dirty = true;
    }

    /// A file that was just downloaded and verified joins the store as a hard link, so the next pack that has it links
    /// it instead of downloading it. An object already there stays as it is.
    pub(crate) fn adopt(&mut self, file: &Path, sha1: &str, crc: u32, sha256: &str) {
        if !sha1_ok(sha1) {
            return;
        }
        let object = self.object(&sha1.to_ascii_lowercase());
        if !object.exists() {
            let Some(dir) = object.parent() else { return };
            if std::fs::create_dir_all(dir).is_err() || std::fs::hard_link(file, &object).is_err() {
                return;
            }
        }
        self.remember(sha1, crc, sha256);
    }

    /// Writes the facts down if any changed. Objects that have left the store are forgotten.
    pub(crate) fn save(&mut self) {
        if !self.dirty {
            return;
        }
        let alive: std::collections::HashSet<&String> = self.by_size.values().flatten().collect();
        let objects: serde_json::Map<String, serde_json::Value> = self
            .known
            .iter()
            .filter(|(name, _)| alive.contains(name))
            .map(|(name, k)| (name.clone(), serde_json::json!([k.size, k.modified_ms, k.crc, k.sha256])))
            .collect();
        let doc = serde_json::json!({ "v": INDEX_VERSION, "objects": objects });
        let (path, tmp) = (self.dir.join(INDEX_FILE), self.dir.join("index.json.tmp"));
        if std::fs::create_dir_all(&self.dir).is_ok()
            && serde_json::to_vec(&doc).ok().is_some_and(|raw| std::fs::write(&tmp, raw).is_ok())
            && std::fs::rename(&tmp, &path).is_ok()
        {
            self.dirty = false;
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

fn parse_known(raw: &[u8]) -> HashMap<String, Known> {
    let mut out = HashMap::new();
    let Ok(doc) = serde_json::from_slice::<serde_json::Value>(raw) else { return out };
    if doc["v"].as_u64() != Some(INDEX_VERSION) {
        return out;
    }
    for (name, row) in doc["objects"].as_object().into_iter().flatten() {
        let Some(r) = row.as_array().filter(|r| r.len() == 4) else { continue };
        let (Some(size), Some(modified_ms), Some(crc), Some(sha256)) = (r[0].as_u64(), r[1].as_i64(), r[2].as_u64(), r[3].as_str()) else { continue };
        if !sha1_ok(name) || u32::try_from(crc).is_err() || sha256.len() != 64 {
            continue;
        }
        out.insert(name.to_ascii_lowercase(), Known { size, modified_ms, crc: crc as u32, sha256: sha256.to_ascii_lowercase() });
    }
    out
}

/// Puts the store object at `dest` as a hard link (written aside and renamed over, like every link the store makes).
pub(crate) fn link_into(object: &Path, dest: &Path) -> bool {
    link_over(object, dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("millida-store-index-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn put(store: &Path, body: &[u8]) -> (String, PathBuf) {
        let tmp = store.join("incoming.bin");
        std::fs::write(&tmp, body).unwrap();
        let (sha1, _, _) = digest_file(&tmp).unwrap();
        let object = store.join(&sha1[..2]).join(&sha1);
        std::fs::create_dir_all(object.parent().unwrap()).unwrap();
        std::fs::rename(&tmp, &object).unwrap();
        (sha1, object)
    }

    fn body(fill: u8) -> Vec<u8> {
        vec![fill; MIN_SHARE_BYTES as usize + 5]
    }

    /// path and size -> may it join the store. Pack paths are untrusted text, so only the exact shape counts.
    #[test]
    fn only_big_files_directly_in_the_shared_folders_are_shareable() {
        let big = MIN_SHARE_BYTES;
        for (rel, size, want, why) in [
            ("mods/sodium.jar", big, true, "a mod"),
            ("resourcepacks/pack.zip", big, true, "a resource pack"),
            ("mods/sodium.jar", big - 1, false, "too small for a link to save anything"),
            ("config/sodium.json", big, false, "the game writes into config"),
            ("mods/sub/lib.jar", big, false, "the store only shares what sits directly in the folder"),
            ("mods/", big, false, "a folder"),
            ("saves/w/level.dat", big, false, "worlds are written to"),
        ] {
            assert_eq!(shareable(rel, size), want, "{why}");
        }
    }

    /// size, CRC-32 and SHA-256 of an object -> found; any one of them off -> not found. The second lookup is answered
    /// from the saved facts, so it does not need the file's bytes.
    #[test]
    fn an_object_is_found_by_all_three_facts_and_remembered() {
        let dir = scratch("find");
        let data = body(1);
        let (_sha1, object) = put(&dir, &data);
        let (_, crc, sha256) = digest_file(&object).unwrap();

        let mut idx = StoreIndex::open_at(dir.clone());
        assert_eq!(idx.find(data.len() as u64, crc, &sha256), Some(object.clone()));
        assert_eq!(idx.find(data.len() as u64, crc ^ 1, &sha256), None, "another CRC");
        assert_eq!(idx.find(data.len() as u64, crc, &"0".repeat(64)), None, "another SHA-256");
        assert_eq!(idx.find(data.len() as u64 + 1, crc, &sha256), None, "another size");
        idx.save();

        let mut again = StoreIndex::open_at(dir.clone());
        assert_eq!(again.known.len(), 1, "the facts survive a restart");
        assert_eq!(again.find(data.len() as u64, crc, &sha256), Some(object));
        assert!(!again.dirty, "a second lookup learns nothing new");
    }

    /// an object edited through a link after it was checked -> its stamp changes, it is read again, no longer hashes
    /// to its name, and leaves the store instead of being linked into a build.
    #[test]
    fn an_object_changed_after_the_check_is_dropped() {
        let dir = scratch("tamper");
        let data = body(2);
        let (_sha1, object) = put(&dir, &data);
        let (_, crc, sha256) = digest_file(&object).unwrap();
        let mut idx = StoreIndex::open_at(dir.clone());
        assert!(idx.find(data.len() as u64, crc, &sha256).is_some());
        idx.save();

        let mut changed = data.clone();
        changed[10] ^= 0xff;
        std::fs::write(&object, &changed).unwrap();
        // some file systems keep the second-grained stamp; the size is equal, so move the stamp by hand
        let f = std::fs::OpenOptions::new().write(true).open(&object).unwrap();
        f.set_modified(std::time::SystemTime::now() + std::time::Duration::from_secs(5)).unwrap();
        drop(f);

        let mut again = StoreIndex::open_at(dir);
        assert_eq!(again.find(data.len() as u64, crc, &sha256), None);
        assert!(!object.exists(), "an object that is not what its name says must leave the store");
    }

    #[test]
    fn linking_gives_the_build_a_second_name_for_the_same_bytes() {
        let dir = scratch("link");
        let (_s, object) = put(&dir, &body(3));
        let dest = dir.join("profile/mods/a.jar");
        assert!(link_into(&object, &dest));
        assert_eq!(std::fs::read(&dest).unwrap(), body(3));
    }

    #[test]
    fn a_damaged_facts_file_is_ignored_not_trusted() {
        let dir = scratch("damaged");
        let data = body(4);
        let (_s, object) = put(&dir, &data);
        std::fs::write(dir.join(INDEX_FILE), b"{ not json").unwrap();
        let (_, crc, sha256) = digest_file(&object).unwrap();
        let mut idx = StoreIndex::open_at(dir);
        assert!(idx.known.is_empty());
        assert!(idx.find(data.len() as u64, crc, &sha256).is_some(), "the object is read again instead");
    }
}
