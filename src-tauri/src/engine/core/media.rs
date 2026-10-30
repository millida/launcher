// Big media files (radio tracks, wallpaper clips, the Arcania page). Each is named in media/manifest.json with its
// SHA-256 and size. Where they come from is one build switch, MEDIA_REMOTE (docs/MEDIA.md):
//  - not set: the files ride inside the build (the window reads them as /media/<name>) and this module does nothing,
//    touches no network and no cache folder. The player loses nothing while the objects are not on the CDN yet;
//  - MEDIA_REMOTE=1 (the release build, after scripts/check-media-remote.mjs has found every object): the files are
//    not in the installer. The first time the window asks for one, it is downloaded from the CDN, checked against its
//    hash and kept in the data folder under that hash. The window then reads it through the asset protocol. The
//    launcher works without any of them and shows a placeholder until a file arrives.
// The manifest is compiled in: the window can only ask for names that are in it, never for an address or a hash.
use super::http::{download_checked, Sum};
use super::paths::data_dir;
use super::safepath::rel_path_ok;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

const RAW: &str = include_str!("../../../../media/manifest.json");
/// `MEDIA_REMOTE=1` at build time. vite.config.ts reads the same variable, so the window and the core always agree.
const REMOTE: bool = remote_flag(option_env!("MEDIA_REMOTE"));

/// Only the exact value `1` turns the download road on: a stray `true` or `0` must not strip media from an installer.
const fn remote_flag(value: Option<&str>) -> bool {
    match value {
        Some(v) => v.len() == 1 && v.as_bytes()[0] == b'1',
        None => false,
    }
}
/// Hosts a media file may come from. The CDN that serves updates first, GitHub releases as the second road.
const ALLOWED_HOSTS: [&str; 2] = ["launcher-storage.millida.net", "github.com"];
const PARALLEL: usize = 3;
const MAX_NAMES: usize = 600;
const MAX_FILE_BYTES: u64 = 256 << 20;
const DONE: &str = ".done";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct FileEntry {
    pub(crate) sha256: String,
    pub(crate) size: u64,
    pub(crate) bundle: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BundleEntry {
    pub(crate) sha256: String,
    pub(crate) size: u64,
}

#[derive(Debug, Default)]
pub(crate) struct Manifest {
    pub(crate) bases: Vec<String>,
    pub(crate) files: BTreeMap<String, FileEntry>,
    pub(crate) bundles: BTreeMap<String, BundleEntry>,
}

fn sha_ok(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn base_ok(b: &str) -> bool {
    url::Url::parse(b).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| ALLOWED_HOSTS.contains(&h)) && b.ends_with('/'))
}

/// Anything in the manifest that is not exactly what it should be is left out: a damaged entry costs one file, not the launcher.
pub(crate) fn parse(raw: &str) -> Manifest {
    let mut m = Manifest::default();
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(raw) else { return m };
    if doc["v"].as_u64() != Some(1) {
        return m;
    }
    m.bases = doc["bases"].as_array().into_iter().flatten().filter_map(|b| b.as_str()).filter(|b| base_ok(b)).map(String::from).collect();
    for (id, b) in doc["bundles"].as_object().into_iter().flatten() {
        let (Some(sha), Some(size)) = (b["sha256"].as_str(), b["size"].as_u64()) else { continue };
        let id_ok = !id.is_empty() && id.len() <= 32 && id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-');
        if id_ok && sha_ok(sha) && size > 0 && size <= MAX_FILE_BYTES {
            m.bundles.insert(id.clone(), BundleEntry { sha256: sha.into(), size });
        }
    }
    for (name, f) in doc["files"].as_object().into_iter().flatten() {
        let (Some(sha), Some(size)) = (f["sha256"].as_str(), f["size"].as_u64()) else { continue };
        let bundle = f["bundle"].as_str().map(String::from);
        if !rel_path_ok(name) || name.contains('\\') || !sha_ok(sha) || size > MAX_FILE_BYTES {
            continue;
        }
        if bundle.as_ref().is_some_and(|id| !m.bundles.contains_key(id)) {
            continue;
        }
        m.files.insert(name.clone(), FileEntry { sha256: sha.into(), size, bundle });
    }
    m
}

fn manifest() -> &'static Manifest {
    static M: OnceLock<Manifest> = OnceLock::new();
    M.get_or_init(|| parse(RAW))
}

pub(crate) fn media_dir() -> PathBuf {
    data_dir().join("media")
}

fn ext_of(name: &str) -> &str {
    let ext = name.rsplit('.').next().unwrap_or("");
    if !ext.is_empty() && ext.len() <= 5 && ext.bytes().all(|b| b.is_ascii_alphanumeric()) && name.contains('.') {
        ext
    } else {
        "bin"
    }
}

fn single_path(dir: &Path, name: &str, f: &FileEntry) -> PathBuf {
    dir.join(format!("{}.{}", f.sha256, ext_of(name)))
}

fn bundle_dir(dir: &Path, b: &BundleEntry) -> PathBuf {
    dir.join(format!("b-{}", &b.sha256[..16]))
}

/// Where the file is on disk now, if it is there.
fn present(m: &Manifest, dir: &Path, name: &str) -> Option<PathBuf> {
    let f = m.files.get(name)?;
    match &f.bundle {
        None => {
            let p = single_path(dir, name, f);
            std::fs::metadata(&p).ok().filter(|md| md.is_file() && md.len() == f.size).map(|_| p)
        }
        Some(id) => {
            let b = m.bundles.get(id)?;
            let root = bundle_dir(dir, b);
            root.join(DONE).is_file().then(|| root.join(name))
        }
    }
}

/// Every manifest file that is already on disk, name -> absolute path. Runs once a start of the window, so it also
/// sweeps what no manifest names any more (older hashes) the first time.
pub(crate) fn ready_in(m: &Manifest, dir: &Path) -> BTreeMap<String, String> {
    m.files.keys().filter_map(|n| present(m, dir, n).map(|p| (n.clone(), p.to_string_lossy().into_owned()))).collect()
}

/// Removes what the manifest does not name. A cache entry is named by its hash, so an entry of an older release is
/// exactly one nobody asks for any more.
pub(crate) fn sweep(m: &Manifest, dir: &Path) {
    let mut keep: BTreeSet<String> = BTreeSet::new();
    for (name, f) in &m.files {
        if f.bundle.is_none() {
            keep.insert(format!("{}.{}", f.sha256, ext_of(name)));
        }
    }
    for b in m.bundles.values() {
        keep.insert(format!("b-{}", &b.sha256[..16]));
        keep.insert(format!("{}.zip", b.sha256));
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if keep.contains(&name) {
            continue;
        }
        // a download in flight right now is not an orphan
        let fresh = e.metadata().and_then(|md| md.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() < 3600);
        if fresh {
            continue;
        }
        let _ = if e.path().is_dir() { std::fs::remove_dir_all(e.path()) } else { std::fs::remove_file(e.path()) };
    }
}

pub fn media_ready() -> BTreeMap<String, String> {
    if !REMOTE {
        return BTreeMap::new();
    }
    static SWEPT: OnceLock<()> = OnceLock::new();
    let (m, dir) = (manifest(), media_dir());
    SWEPT.get_or_init(|| sweep(m, &dir));
    ready_in(m, &dir)
}

/// Names the window asked for -> manifest names. A name ending in `/` stands for everything under it, `@id` for every
/// file of that bundle, and a file of a bundle brings its whole bundle (it comes in one download anyway).
pub(crate) fn expand(m: &Manifest, asked: &[String]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    for a in asked.iter().take(MAX_NAMES) {
        if let Some(id) = a.strip_prefix('@') {
            out.extend(m.files.iter().filter(|(_, f)| f.bundle.as_deref() == Some(id)).map(|(k, _)| k.clone()));
        } else if a.ends_with('/') {
            out.extend(m.files.keys().filter(|k| k.starts_with(a.as_str())).cloned());
        } else if let Some(f) = m.files.get(a) {
            match &f.bundle {
                Some(id) => out.extend(m.files.iter().filter(|(_, g)| g.bundle.as_ref() == Some(id)).map(|(k, _)| k.clone())),
                None => {
                    out.insert(a.clone());
                }
            }
        }
    }
    out
}

fn flight(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    static F: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let mut all = F.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    all.entry(key.to_string()).or_default().clone()
}

/// One object of the CDN (a file or a bundle's zip), tried on every base until one gives bytes that hash right.
async fn download(m: &Manifest, dest: &Path, sha256: &str, size: u64, ext: &str) -> Result<(), String> {
    let mut last = String::from("no download address");
    for base in &m.bases {
        let url = format!("{}{}.{}", base, sha256, ext);
        match download_checked(&url, dest, Some(Sum::Sha256(sha256)), Some(size)).await {
            Ok(()) => return Ok(()),
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn fetch_single(m: &Manifest, dir: &Path, name: &str) -> Result<(), String> {
    let f = &m.files[name];
    let dest = single_path(dir, name, f);
    let lock = flight(&dest.to_string_lossy());
    let _turn = lock.lock().await;
    if present(m, dir, name).is_some() {
        return Ok(());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    download(m, &dest, &f.sha256, f.size, ext_of(name)).await
}

async fn fetch_bundle(m: &Manifest, dir: &Path, id: &str) -> Result<(), String> {
    let b = &m.bundles[id];
    let root = bundle_dir(dir, b);
    let lock = flight(&root.to_string_lossy());
    let _turn = lock.lock().await;
    if root.join(DONE).is_file() {
        return Ok(());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let zip = dir.join(format!("{}.zip", b.sha256));
    download(m, &zip, &b.sha256, b.size, "zip").await?;
    let stage = dir.join(format!("b-{}.tmp", &b.sha256[..16]));
    let members: Vec<(String, u64)> = m.files.iter().filter(|(_, f)| f.bundle.as_deref() == Some(id)).map(|(n, f)| (n.clone(), f.size)).collect();
    let (zip2, root2) = (zip.clone(), root.clone());
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let _ = std::fs::remove_dir_all(&stage);
        super::archive::unzip_to(&zip2, &stage)?;
        for (name, size) in &members {
            let ok = std::fs::metadata(stage.join(name)).map(|md| md.is_file() && md.len() == *size).unwrap_or(false);
            if !ok {
                let _ = std::fs::remove_dir_all(&stage);
                return Err(format!("bundle lacks '{}' at the expected size", name));
            }
        }
        std::fs::write(stage.join(DONE), b"").map_err(|e| e.to_string())?;
        let _ = std::fs::remove_dir_all(&root2);
        std::fs::rename(&stage, &root2).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = std::fs::remove_file(&zip);
    Ok(())
}

pub(crate) async fn fetch_in(m: &Manifest, dir: &Path, asked: &[String]) -> BTreeMap<String, String> {
    use futures::StreamExt as _;
    let wanted = expand(m, asked);
    // one download per object: a bundle serves all its files
    let mut singles: Vec<String> = Vec::new();
    let mut bundles: BTreeSet<String> = BTreeSet::new();
    for name in &wanted {
        if present(m, dir, name).is_some() {
            continue;
        }
        match &m.files[name].bundle {
            Some(id) => {
                bundles.insert(id.clone());
            }
            None => singles.push(name.clone()),
        }
    }
    let jobs = singles.into_iter().map(|n| (n, None)).chain(bundles.into_iter().map(|b| (b.clone(), Some(b))));
    futures::stream::iter(jobs)
        .map(|(name, bundle)| async move {
            let res = match &bundle {
                Some(id) => fetch_bundle(m, dir, id).await,
                None => fetch_single(m, dir, &name).await,
            };
            if let Err(e) = res {
                eprintln!("[media] «{}» не скачалось: {}", name, e);
            }
        })
        .buffer_unordered(PARALLEL)
        .collect::<Vec<()>>()
        .await;
    wanted.iter().filter_map(|n| present(m, dir, n).map(|p| (n.clone(), p.to_string_lossy().into_owned()))).collect()
}

/// Downloads what is missing among `names` and answers with the paths of everything that is there now. A file that
/// could not be fetched is simply absent from the answer: the window keeps its placeholder and asks again later.
pub async fn media_fetch(names: Vec<String>) -> BTreeMap<String, String> {
    if !REMOTE {
        return BTreeMap::new();
    }
    fetch_in(manifest(), &media_dir(), &names).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("millida-media-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    /// the switch is exact: only `1` takes the files out of the installer, anything else keeps them in
    #[test]
    fn only_an_exact_one_turns_the_download_road_on() {
        for (value, want) in [(Some("1"), true), (None, false), (Some("0"), false), (Some("true"), false), (Some(""), false), (Some("11"), false), (Some(" 1"), false)] {
            assert_eq!(remote_flag(value), want, "MEDIA_REMOTE={value:?}");
        }
    }

    /// a build without the switch does no media work at all: no cache sweep, no network, nothing for the window to wait for
    #[tokio::test]
    async fn without_the_switch_the_core_neither_lists_nor_downloads() {
        if REMOTE {
            return; // a MEDIA_REMOTE=1 test build is the other road, covered by the tests below
        }
        assert!(media_ready().is_empty());
        assert!(media_fetch(vec!["music/".into(), "bg/bg1.mp4".into()]).await.is_empty());
    }

    /// the manifest shipped with the build must be readable and name real, safe files
    #[test]
    fn the_shipped_manifest_parses_and_has_every_group_the_window_asks_for() {
        let m = parse(RAW);
        assert!(!m.bases.is_empty(), "no usable download address");
        for prefix in ["music/", "bg/", "packs/arcania/"] {
            assert!(m.files.keys().any(|k| k.starts_with(prefix)), "{prefix} is missing from the manifest");
        }
        for (name, f) in &m.files {
            assert!(f.size > 0 && sha_ok(&f.sha256), "{name}");
        }
    }

    /// damaged or hostile entries are dropped one by one; the rest of the manifest stays usable
    #[test]
    fn a_damaged_entry_costs_one_file_not_the_manifest() {
        let raw = serde_json::json!({
            "v": 1,
            "bases": ["https://launcher-storage.millida.net/media/", "http://launcher-storage.millida.net/media/", "https://evil.example/media/", "https://github.com/x/y/releases/download/media/"],
            "bundles": { "art": { "sha256": B, "size": 10 }, "BAD ID": { "sha256": B, "size": 10 } },
            "files": {
                "music/a.mp3": { "sha256": A, "size": 5 },
                "../escape.mp3": { "sha256": A, "size": 5 },
                "music/short.mp3": { "sha256": "abc", "size": 5 },
                "music/upper.mp3": { "sha256": A.to_uppercase(), "size": 5 },
                "art/x.webp": { "sha256": A, "size": 5, "bundle": "art" },
                "art/y.webp": { "sha256": A, "size": 5, "bundle": "missing" }
            }
        });
        let m = parse(&raw.to_string());
        assert_eq!(m.bases, vec!["https://launcher-storage.millida.net/media/", "https://github.com/x/y/releases/download/media/"], "only https and only our hosts");
        assert_eq!(m.files.keys().cloned().collect::<Vec<_>>(), vec!["art/x.webp", "music/a.mp3"]);
        assert_eq!(m.bundles.len(), 1);
        assert_eq!(parse("{ nope").files.len(), 0);
        assert_eq!(parse(r#"{"v":2,"files":{}}"#).files.len(), 0, "an unknown version is not guessed at");
    }

    /// asked names -> manifest names: unknown names and anything outside the manifest are dropped, a trailing slash is a prefix
    #[test]
    fn only_manifest_names_survive_and_a_slash_means_everything_under_it() {
        let raw = serde_json::json!({ "v": 1, "bases": [], "bundles": {}, "files": {
            "music/a.mp3": { "sha256": A, "size": 5 }, "music/b.mp3": { "sha256": B, "size": 5 }, "bg/c.mp4": { "sha256": A, "size": 5 } } });
        let m = parse(&raw.to_string());
        let got = expand(&m, &["music/".into(), "bg/c.mp4".into(), "/etc/passwd".into(), "music/zzz.mp3".into(), "..".into()]);
        assert_eq!(got.into_iter().collect::<Vec<_>>(), vec!["bg/c.mp4", "music/a.mp3", "music/b.mp3"]);

        let raw = serde_json::json!({ "v": 1, "bases": [], "bundles": { "art": { "sha256": B, "size": 10 } }, "files": {
            "art/1.webp": { "sha256": A, "size": 5, "bundle": "art" }, "art/2.webp": { "sha256": B, "size": 5, "bundle": "art" }, "music/a.mp3": { "sha256": A, "size": 5 } } });
        let m = parse(&raw.to_string());
        assert_eq!(expand(&m, &["@art".into()]).len(), 2, "@id is the whole bundle");
        assert_eq!(expand(&m, &["art/1.webp".into()]).len(), 2, "one file of a bundle brings its mates: they arrive in one download");
        assert!(expand(&m, &["@nothing".into()]).is_empty());
    }

    fn hex(bytes: &[u8]) -> String {
        use sha2::Digest as _;
        sha2::Sha256::digest(bytes).iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// A server that has `files` (path -> bytes) and counts how many times it was asked.
    async fn serve(files: HashMap<String, Vec<u8>>) -> (u16, Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let asked = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (files, counter) = (Arc::new(files), asked.clone());
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let (files, counter) = (files.clone(), counter.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                    counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let resp = match files.get(&path) {
                        Some(body) => {
                            let mut r = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
                            r.extend_from_slice(body);
                            r
                        }
                        None => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
                    };
                    let _ = sock.write_all(&resp).await;
                });
            }
        });
        (port, asked)
    }

    /// missing files -> downloaded, checked against the manifest's hash, a bundle unpacked once and marked done;
    /// asked again -> not a single request; a server that sends other bytes -> nothing stays on disk.
    #[tokio::test]
    async fn missing_files_are_downloaded_checked_and_bundles_unpacked() {
        use std::io::Write as _;
        let song = b"audio bytes of a song".to_vec();
        let (img_a, img_b) = (b"image a".to_vec(), b"image b!".to_vec());
        let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        z.start_file("art/a.webp", opts).unwrap();
        z.write_all(&img_a).unwrap();
        z.start_file("art/sub/b.webp", opts).unwrap();
        z.write_all(&img_b).unwrap();
        let zip = z.finish().unwrap().into_inner();

        let (song_sha, zip_sha) = (hex(&song), hex(&zip));
        let (port, asked) = serve(HashMap::from([(format!("/{song_sha}.mp3"), song.clone()), (format!("/{zip_sha}.zip"), zip.clone())])).await;
        let mut m = Manifest { bases: vec![format!("http://127.0.0.1:{port}/")], ..Default::default() };
        m.bundles.insert("art".into(), BundleEntry { sha256: zip_sha.clone(), size: zip.len() as u64 });
        m.files.insert("music/song.mp3".into(), FileEntry { sha256: song_sha, size: song.len() as u64, bundle: None });
        m.files.insert("art/a.webp".into(), FileEntry { sha256: hex(&img_a), size: img_a.len() as u64, bundle: Some("art".into()) });
        m.files.insert("art/sub/b.webp".into(), FileEntry { sha256: hex(&img_b), size: img_b.len() as u64, bundle: Some("art".into()) });

        let dir = scratch("fetch");
        let got = fetch_in(&m, &dir, &["music/".into(), "art/a.webp".into()]).await;
        assert_eq!(got.len(), 3, "the bundle brought all its files, the prefix brought the song: {got:?}");
        assert_eq!(std::fs::read(&got["music/song.mp3"]).unwrap(), song);
        assert_eq!(std::fs::read(&got["art/sub/b.webp"]).unwrap(), img_b);
        assert!(!dir.join(format!("{zip_sha}.zip")).exists(), "the zip is not kept once unpacked");

        let before = asked.load(std::sync::atomic::Ordering::SeqCst);
        let again = fetch_in(&m, &dir, &["music/song.mp3".into(), "art/".into()]).await;
        assert_eq!(again.len(), 3);
        assert_eq!(asked.load(std::sync::atomic::Ordering::SeqCst), before, "everything is on disk: no request");

        // another server that sends the wrong bytes under the right name
        let (port, _) = serve(HashMap::from([(format!("/{}.mp3", hex(b"other")), b"not the song".to_vec())])).await;
        let mut bad = Manifest { bases: vec![format!("http://127.0.0.1:{port}/")], ..Default::default() };
        bad.files.insert("music/other.mp3".into(), FileEntry { sha256: hex(b"other"), size: 5, bundle: None });
        let dir2 = scratch("fetch-bad");
        assert!(fetch_in(&bad, &dir2, &["music/other.mp3".into()]).await.is_empty(), "bytes that do not hash right are never kept");
        assert!(std::fs::read_dir(&dir2).map(|rd| rd.flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".mp3"))).unwrap_or(true));
    }

    /// what is on disk -> ready list; an entry of an older release is swept, a fresh unknown file is left alone
    #[test]
    fn ready_lists_only_complete_files_and_the_sweep_leaves_what_the_manifest_names() {
        let dir = scratch("ready");
        let raw = serde_json::json!({ "v": 1, "bases": [], "bundles": { "art": { "sha256": B, "size": 10 } }, "files": {
            "music/a.mp3": { "sha256": A, "size": 4 }, "music/cut.mp3": { "sha256": B, "size": 9 }, "art/x.webp": { "sha256": A, "size": 3, "bundle": "art" } } });
        let m = parse(&raw.to_string());
        std::fs::write(dir.join(format!("{A}.mp3")), b"1234").unwrap();
        std::fs::write(dir.join(format!("{B}.mp3")), b"short").unwrap();
        let root = dir.join(format!("b-{}", &B[..16]));
        std::fs::create_dir_all(root.join("art")).unwrap();
        std::fs::write(root.join("art/x.webp"), b"xyz").unwrap();
        let ready = ready_in(&m, &dir);
        assert_eq!(ready.keys().cloned().collect::<Vec<_>>(), vec!["music/a.mp3"], "a cut file and a bundle without its marker are not ready");
        std::fs::write(root.join(DONE), b"").unwrap();
        assert!(ready_in(&m, &dir).contains_key("art/x.webp"));

        let old = dir.join(format!("{}.mp3", "c".repeat(64)));
        std::fs::write(&old, b"old").unwrap();
        let f = std::fs::OpenOptions::new().write(true).open(&old).unwrap();
        f.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(7200)).unwrap();
        drop(f);
        let fresh = dir.join("incoming.part");
        std::fs::write(&fresh, b"x").unwrap();
        sweep(&m, &dir);
        assert!(!old.exists() && fresh.exists() && dir.join(format!("{A}.mp3")).exists() && root.exists());
    }
}
