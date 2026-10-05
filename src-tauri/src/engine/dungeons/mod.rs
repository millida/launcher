//! Minecraft Dungeons and Dungeons II next to Java Edition.
//!
//! Both games come from our own storage as a Microsoft Store build; the server
//! signs the file links (trade-api `launcher/games`). Mods of the first game are
//! Unreal .pak files in `Paks/~mods`, which the engine mounts after the base paks.

use crate::engine::*;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::AppHandle;

const PARALLEL: usize = 6;
const MODS_DIR: &str = "Dungeons/Content/Paks/~mods";
const INSTALL_FILE: &str = ".millida-install.json";
const LEGACY_VERSION_FILE: &str = ".millida-version";
const LEGACY_EXE: &str = "Dungeons.exe";
const LEDGER_FILE: &str = ".millida-files.json";
const DISABLED: &str = ".disabled";

struct MirrorGame {
    slug: &'static str,
    title: &'static str,
}

const GAMES: &[MirrorGame] = &[
    MirrorGame { slug: "dungeons", title: "Minecraft Dungeons" },
    MirrorGame { slug: "dungeons-2", title: "Minecraft Dungeons II" },
];

fn mirror_game(slug: &str) -> Result<&'static MirrorGame, String> {
    GAMES.iter().find(|g| g.slug == slug).ok_or_else(|| "Такой игры нет".to_string())
}

fn game_dir(g: &MirrorGame) -> PathBuf {
    game_root().join(g.slug)
}

pub fn dungeons_dir() -> PathBuf {
    game_root().join("dungeons")
}

pub fn mirror_game_dir(slug: &str) -> Result<PathBuf, String> {
    mirror_game(slug).map(game_dir)
}

fn mods_dir() -> PathBuf {
    dungeons_dir().join(MODS_DIR)
}

#[derive(Serialize)]
pub struct DungeonsMod {
    pub name: String,
    pub enabled: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct DungeonsStatus {
    /// The games ship for Windows only; elsewhere the screen shows why.
    pub supported: bool,
    pub installed: bool,
    pub version: String,
    pub dir: String,
    pub mods: Vec<DungeonsMod>,
}

#[derive(Serialize, Deserialize)]
struct Installed {
    version: String,
    exe: String,
}

/// Installs made from Mojang's CDN before the move to our storage left only a
/// version file; their exe was always `Dungeons.exe` at the root.
fn read_installed(dir: &Path) -> Option<Installed> {
    if let Ok(text) = std::fs::read_to_string(dir.join(INSTALL_FILE)) {
        return serde_json::from_str(&text).ok();
    }
    let version = std::fs::read_to_string(dir.join(LEGACY_VERSION_FILE)).ok()?.trim().to_string();
    (!version.is_empty()).then(|| Installed { version, exe: LEGACY_EXE.into() })
}

fn installed_exe(dir: &Path) -> Option<(Installed, PathBuf)> {
    let inst = read_installed(dir)?;
    let exe = safe_join(dir, &inst.exe).ok().filter(|p| p.is_file())?;
    Some((inst, exe))
}

pub fn dungeons_status(slug: &str) -> Result<DungeonsStatus, String> {
    let g = mirror_game(slug)?;
    let dir = game_dir(g);
    let installed = installed_exe(&dir).map(|(i, _)| i);
    Ok(DungeonsStatus {
        supported: cfg!(target_os = "windows"),
        installed: installed.is_some(),
        version: installed.map(|i| i.version).unwrap_or_default(),
        dir: dir.to_string_lossy().into_owned(),
        mods: if g.slug == "dungeons" { list_mods() } else { Vec::new() },
    })
}

#[derive(Deserialize)]
struct RemoteManifest {
    version: String,
    exe: String,
    files: Vec<RemoteFile>,
}

#[derive(Deserialize)]
struct RemoteFile {
    path: String,
    size: u64,
    sha256: String,
    url: String,
    download: RemoteBlob,
}

#[derive(Deserialize)]
struct RemoteBlob {
    size: u64,
    sha256: String,
    encoding: String,
}

async fn fetch_manifest(slug: &str) -> Result<RemoteManifest, String> {
    let url = format!("{}/launcher/games/{}/manifest", MILLIDA_API, slug);
    let r = client().post(&url).send().await.map_err(|e| net_err(&e))?;
    let status = r.status();
    let text = r.text().await.map_err(|e| net_err(&e))?;
    if status.is_success() {
        return serde_json::from_str(&text)
            .map_err(|_| "Сервер прислал непонятный список файлов игры. Обновите лаунчер".to_string());
    }
    Err(api_error_message(&text).unwrap_or_else(|| format!("Сервер загрузки игр ответил {}", status.as_u16())))
}

struct FileJob {
    rel: String,
    path: PathBuf,
    size: u64,
    sha256: String,
    url: String,
    wire: u64,
    wire_sha256: String,
    gzip: bool,
}

fn is_sha256(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn in_mods(rel: &str) -> bool {
    rel.replace('\\', "/").split('/').any(|s| s.eq_ignore_ascii_case("~mods"))
}

/// Paths come from our server, but they still go through safe_join like any
/// remote path, and the player's mods folder is never ours to write.
fn plan(m: &RemoteManifest, root: &Path) -> Result<Vec<FileJob>, String> {
    if m.files.is_empty() {
        return Err("Сервер прислал пустой список файлов игры".into());
    }
    if !m.files.iter().any(|f| f.path.eq_ignore_ascii_case(&m.exe)) {
        return Err("В списке файлов игры нет файла запуска".into());
    }
    let mut jobs = Vec::with_capacity(m.files.len());
    for f in &m.files {
        if in_mods(&f.path) {
            return Err(format!("{}: файл в папке модов", f.path));
        }
        let path = safe_join(root, &f.path)?;
        let gzip = match f.download.encoding.as_str() {
            "gzip" => true,
            "identity" => false,
            other => return Err(format!("{}: неизвестное сжатие {}", f.path, other)),
        };
        if !is_sha256(&f.sha256) || !is_sha256(&f.download.sha256) {
            return Err(format!("{}: нет контрольной суммы", f.path));
        }
        jobs.push(FileJob {
            rel: f.path.clone(),
            path,
            size: f.size,
            sha256: f.sha256.to_ascii_lowercase(),
            url: f.url.clone(),
            wire: f.download.size,
            wire_sha256: f.download.sha256.to_ascii_lowercase(),
            gzip,
        });
    }
    // Largest first: the biggest paks set the finish time, so they must not
    // start last behind hundreds of small files.
    jobs.sort_by_key(|j| std::cmp::Reverse(j.wire));
    Ok(jobs)
}

/// What the last install put in place: path → hash. An update then skips a
/// matching file by its size alone instead of rehashing gigabytes. Installs
/// from Mojang's CDN recorded sha1 here; those never match and get hashed once.
fn read_ledger(root: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(root.join(LEDGER_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn sha256_file(path: &Path) -> Option<String> {
    use sha2::Digest as _;
    let mut f = std::fs::File::open(path).ok()?;
    let mut h = sha2::Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = std::io::Read::read(&mut f, &mut buf).ok()?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Some(hex(&h.finalize()))
}

fn in_place(j: &FileJob, ledger: &HashMap<String, String>) -> bool {
    let Ok(meta) = std::fs::metadata(&j.path) else { return false };
    if meta.len() != j.size {
        return false;
    }
    if ledger.get(&j.rel).is_some_and(|s| s.eq_ignore_ascii_case(&j.sha256)) {
        return true;
    }
    sha256_file(&j.path).is_some_and(|s| s.eq_ignore_ascii_case(&j.sha256))
}

struct HashingWriter<W: std::io::Write> {
    inner: W,
    h: sha2::Sha256,
    n: u64,
}

impl<W: std::io::Write> std::io::Write for HashingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        use sha2::Digest as _;
        let n = self.inner.write(buf)?;
        self.h.update(&buf[..n]);
        self.n += n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// Unpacks a downloaded .gz next to its destination, checks the result against
/// the manifest's size and sha256, and only then puts it in place.
fn unpack_gzip(src: &Path, dest: &Path, size: u64, sha256: &str) -> Result<(), String> {
    use sha2::Digest as _;
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = dest.with_file_name(format!("{}.millida-unpack", name));
    let res = (|| {
        let input = std::fs::File::open(src).map_err(|e| format!("{}: {}", src.display(), e))?;
        let mut input = flate2::read::GzDecoder::new(std::io::BufReader::with_capacity(1 << 20, input));
        let out = std::fs::File::create(&tmp).map_err(|e| format!("{}: {}", tmp.display(), e))?;
        let mut w = HashingWriter { inner: std::io::BufWriter::with_capacity(1 << 20, out), h: sha2::Sha256::new(), n: 0 };
        std::io::copy(&mut input, &mut w).map_err(|e| format!("{}: не распаковался ({})", name, e))?;
        std::io::Write::flush(&mut w).map_err(|e| e.to_string())?;
        let HashingWriter { inner, h, n } = w;
        drop(inner);
        if n != size || !hex(&h.finalize()).eq_ignore_ascii_case(sha256) {
            return Err(format!("{}: контрольная сумма не сошлась после распаковки", name));
        }
        std::fs::rename(&tmp, dest).map_err(|e| format!("{}: {}", dest.display(), e))
    })();
    let _ = std::fs::remove_file(src);
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

/// Goes through the segmented downloader: the main .ucas of Dungeons II alone is
/// 8.8 GB, and as one stream it both capped the speed and froze the bar until
/// its last byte.
async fn fetch_one(j: &FileJob, cancel: &std::sync::atomic::AtomicBool, on: &crate::engine::core::Progress<'_>) -> Result<(), String> {
    if let Some(parent) = j.path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {}", parent.display(), e))?;
    }
    if !j.gzip {
        return download_checked_progress(&j.url, &j.path, Some(Sum::Sha256(&j.sha256)), Some(j.size), Some(cancel), on).await;
    }
    let name = j.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let packed = j.path.with_file_name(format!("{}.millida-gz", name));
    download_checked_progress(&j.url, &packed, Some(Sum::Sha256(&j.wire_sha256)), Some(j.wire), Some(cancel), on).await?;
    let (dest, size, sha) = (j.path.clone(), j.size, j.sha256.clone());
    tokio::task::spawn_blocking(move || unpack_gzip(&packed, &dest, size, &sha))
        .await
        .map_err(|e| format!("распаковка прервалась: {}", e))?
}

/// Files of the previous build that the new one no longer has. An old pak left
/// behind would still be mounted by the engine, so a file that cannot be
/// removed fails the update instead of being skipped.
fn remove_stale<'a>(root: &Path, previous: impl Iterator<Item = &'a String>, keep: &HashSet<String>) -> Result<(), String> {
    for rel in previous {
        if keep.contains(&rel.to_ascii_lowercase()) || in_mods(rel) {
            continue;
        }
        let Ok(p) = safe_join(root, rel) else { continue };
        if p.is_file() {
            std::fs::remove_file(&p).map_err(|e| format!("{}: {}. Закройте игру и обновите ещё раз", p.display(), e))?;
        }
    }
    Ok(())
}

/// Installs or updates the game in place. Files already in place are kept, so
/// an update downloads only what changed, and `~mods` is never touched.
pub async fn dungeons_install(app: AppHandle, slug: String) -> Result<String, String> {
    let g = mirror_game(&slug)?;
    if !cfg!(target_os = "windows") {
        return Err(format!("{} запускается только на Windows", g.title));
    }
    let job = Job::start(g.slug, g.title)?;
    let res = install_inner(&app, &job, g).await;
    job.finish(&app, res)
}

async fn install_inner(app: &AppHandle, job: &Job, g: &MirrorGame) -> Result<String, String> {
    job.emit(app, 1.0, "Готовим загрузку");
    let manifest = fetch_manifest(g.slug).await?;
    job.check()?;

    let root = game_dir(g);
    std::fs::create_dir_all(&root).map_err(|e| format!("{}: {}", root.display(), e))?;
    let all = plan(&manifest, &root)?;

    job.emit(app, 2.0, "Проверяем файлы");
    let ledger = read_ledger(&root);
    let previous: Vec<String> = ledger.keys().cloned().collect();
    let (all, todo): (Vec<FileJob>, Vec<bool>) = tokio::task::spawn_blocking(move || {
        let todo = all.iter().map(|j| !in_place(j, &ledger)).collect::<Vec<_>>();
        (all, todo)
    })
    .await
    .map_err(|e| e.to_string())?;
    let keep: HashSet<String> = all.iter().map(|j| j.rel.to_ascii_lowercase()).collect();
    let mut record: HashMap<String, String> = all.iter().map(|j| (j.rel.clone(), j.sha256.clone())).collect();
    let jobs: Vec<FileJob> = all.into_iter().zip(todo).filter(|(_, t)| *t).map(|(j, _)| j).collect();

    if !jobs.is_empty() {
        // The build on disk stops being whole from the first replaced file on,
        // so it must not look installed until the update completes.
        let _ = std::fs::remove_file(root.join(INSTALL_FILE));
        let _ = std::fs::remove_file(root.join(LEGACY_VERSION_FILE));
    }

    let total: u64 = jobs.iter().map(|j| j.wire).sum::<u64>().max(1);
    let done = Arc::new(AtomicU64::new(0));
    let step = AtomicU64::new(u64::MAX);
    let gb = |b: u64| b as f64 / 1_073_741_824.0;
    let report = |d: u64| {
        let pct = 3.0 + 95.0 * (d.min(total) as f32 / total as f32);
        let s = (pct * 4.0) as u64;
        if step.swap(s, Ordering::Relaxed) != s {
            job.emit(app, pct, &format!("{:.2} / {:.2} ГБ", gb(d.min(total)), gb(total)));
        }
    };
    let report = &report;
    let results: Vec<(String, Result<(), String>)> = futures::stream::iter(jobs.into_iter().map(|j| {
        let done = done.clone();
        async move {
            // A retried stream reports from zero again; counting only growth past
            // the best mark keeps the total from running ahead of real bytes.
            let seen = AtomicU64::new(0);
            let on = |got: u64, _: Option<u64>| {
                let grown = got.min(j.wire).saturating_sub(seen.fetch_max(got.min(j.wire), Ordering::Relaxed));
                if grown > 0 {
                    report(done.fetch_add(grown, Ordering::Relaxed) + grown);
                }
            };
            let r = fetch_one(&j, job.cancel_flag(), &on).await;
            let rest = j.wire.saturating_sub(seen.load(Ordering::Relaxed));
            report(done.fetch_add(rest, Ordering::Relaxed) + rest);
            (j.rel.clone(), r)
        }
    }))
    .buffer_unordered(PARALLEL)
    .collect()
    .await;
    job.check()?;
    let mut first_err = None;
    for (rel, r) in results {
        if let Err(e) = r {
            record.remove(&rel);
            first_err.get_or_insert(e);
        }
    }
    write_json_quiet(&root.join(LEDGER_FILE), &record);
    if let Some(e) = first_err {
        return Err(e);
    }

    job.emit(app, 99.0, "Убираем старые файлы");
    remove_stale(&root, previous.iter(), &keep)?;
    if g.slug == "dungeons" {
        std::fs::create_dir_all(mods_dir()).map_err(|e| e.to_string())?;
    }
    let installed = Installed { version: manifest.version.clone(), exe: manifest.exe.clone() };
    let text = serde_json::to_string(&installed).map_err(|e| e.to_string())?;
    std::fs::write(root.join(INSTALL_FILE), text).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(root.join(LEGACY_VERSION_FILE));
    job.emit(app, 100.0, "Готово");
    Ok(manifest.version)
}

pub fn dungeons_launch(slug: &str) -> Result<(), String> {
    let g = mirror_game(slug)?;
    if !cfg!(target_os = "windows") {
        return Err(format!("{} запускается только на Windows", g.title));
    }
    let Some((_, exe)) = installed_exe(&game_dir(g)) else {
        return Err("Игра не установлена".into());
    };
    let mut cmd = std::process::Command::new(&exe);
    cmd.current_dir(exe.parent().unwrap_or(&game_dir(g)));
    quiet(&mut cmd).spawn().map_err(|e| format!("Не удалось запустить игру: {}", e))?;
    Ok(())
}

fn list_mods() -> Vec<DungeonsMod> {
    let Ok(rd) = std::fs::read_dir(mods_dir()) else { return Vec::new() };
    let mut out: Vec<DungeonsMod> = rd
        .flatten()
        .filter(|e| e.path().is_file())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let lower = name.to_ascii_lowercase();
            let enabled = lower.ends_with(".pak");
            if !enabled && !lower.ends_with(&format!(".pak{}", DISABLED)) {
                return None;
            }
            let base = name.strip_suffix(DISABLED).unwrap_or(&name).to_string();
            Some(DungeonsMod { name: base, enabled, size: e.metadata().map(|m| m.len()).unwrap_or(0) })
        })
        .collect();
    out.sort_by_key(|m| m.name.to_ascii_lowercase());
    out
}

fn pak_name(name: &str) -> Result<String, String> {
    let name = safe_file_name(name)?;
    if !name.to_ascii_lowercase().ends_with(".pak") {
        return Err("Мод Dungeons — это файл .pak".into());
    }
    Ok(name)
}

pub fn dungeons_add_mods(paths: Vec<PathBuf>) -> Result<usize, String> {
    let dir = mods_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    let mut added = 0;
    for src in paths {
        let name = pak_name(&src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())?;
        let dest = safe_child(&dir, &name)?;
        let _ = std::fs::remove_file(safe_child(&dir, &format!("{}{}", name, DISABLED))?);
        std::fs::copy(&src, &dest).map_err(|e| format!("{}: {}", src.display(), e))?;
        added += 1;
    }
    Ok(added)
}

pub fn dungeons_toggle_mod(name: &str, enabled: bool) -> Result<(), String> {
    let name = pak_name(name)?;
    let dir = mods_dir();
    let on = safe_child(&dir, &name)?;
    let off = safe_child(&dir, &format!("{}{}", name, DISABLED))?;
    let (from, to) = if enabled { (off, on) } else { (on, off) };
    if !from.exists() {
        return Ok(());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

pub fn dungeons_remove_mod(name: &str) -> Result<(), String> {
    let name = pak_name(name)?;
    let dir = mods_dir();
    for p in [safe_child(&dir, &name)?, safe_child(&dir, &format!("{}{}", name, DISABLED))?] {
        if p.exists() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64, wire: u64, encoding: &str) -> RemoteFile {
        RemoteFile {
            path: path.into(),
            size,
            sha256: "a".repeat(64),
            url: "https://garage.example/x".into(),
            download: RemoteBlob { size: wire, sha256: "b".repeat(64), encoding: encoding.into() },
        }
    }

    fn manifest(files: Vec<RemoteFile>) -> RemoteManifest {
        RemoteManifest { version: "1.0.0.0".into(), exe: "Dungeons.exe".into(), files }
    }

    #[test]
    fn plan_refuses_what_must_never_be_written() {
        let root = std::env::temp_dir().join("millida-mirror-plan-refuse");
        let table: [(Vec<RemoteFile>, &str); 5] = [
            (vec![file("Dungeons.exe", 1, 1, "identity"), file("../evil.exe", 1, 1, "identity")], "a path out of the game folder"),
            (vec![file("Dungeons.exe", 1, 1, "identity"), file("Dungeons/Content/Paks/~mods/x.pak", 1, 1, "identity")], "the player's mods folder"),
            (vec![file("Dungeons.exe", 1, 1, "zstd")], "an encoding the launcher cannot unpack"),
            (vec![file("Other.exe", 1, 1, "identity")], "a manifest whose exe is not among its files"),
            (vec![], "an empty manifest"),
        ];
        for (files, why) in table {
            assert!(plan(&manifest(files), &root).is_err(), "plan must refuse {}", why);
        }
    }

    #[test]
    fn plan_starts_with_the_largest_download() {
        let root = std::env::temp_dir().join("millida-mirror-plan-order");
        let m = manifest(vec![file("Dungeons.exe", 10, 10, "identity"), file("big.pak", 1000, 400, "gzip")]);
        let jobs = plan(&m, &root).unwrap();
        assert_eq!(jobs[0].rel, "big.pak", "the biggest file sets the finish time and goes first");
        assert!(jobs[0].gzip && !jobs[1].gzip);
    }

    #[test]
    fn gzip_copy_is_unpacked_and_verified() {
        use sha2::Digest as _;
        use std::io::Write as _;
        let dir = std::env::temp_dir().join("millida-mirror-gzip-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let data: Vec<u8> = (0..200_000u32).map(|i| (i % 251) as u8).collect();
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&data).unwrap();
        let packed = enc.finish().unwrap();
        let sha = hex(&sha2::Sha256::digest(&data));

        let src = dir.join("a.bin.millida-gz");
        std::fs::write(&src, &packed).unwrap();
        let dest = dir.join("a.bin");
        unpack_gzip(&src, &dest, data.len() as u64, &sha).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        assert!(!src.exists(), "the packed copy is removed after unpacking");

        std::fs::write(&src, &packed).unwrap();
        let dest2 = dir.join("b.bin");
        assert!(unpack_gzip(&src, &dest2, data.len() as u64, &"0".repeat(64)).is_err());
        assert!(!dest2.exists(), "a file that fails the checksum never lands in place");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn update_removes_old_build_files_but_never_mods() {
        let root = std::env::temp_dir().join("millida-mirror-stale");
        let _ = std::fs::remove_dir_all(&root);
        for rel in ["old.pak", "keep.pak", "Dungeons/Content/Paks/~mods/mine.pak"] {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, b"x").unwrap();
        }
        let previous = ["old.pak".to_string(), "Keep.pak".to_string(), "Dungeons/Content/Paks/~mods/mine.pak".to_string(), "../outside.txt".to_string()];
        let keep: HashSet<String> = ["keep.pak".to_string()].into_iter().collect();
        remove_stale(&root, previous.iter(), &keep).unwrap();
        assert!(!root.join("old.pak").exists(), "a pak of the old build would still be mounted");
        assert!(root.join("keep.pak").exists(), "a file of the new build stays, whatever its case");
        assert!(root.join("Dungeons/Content/Paks/~mods/mine.pak").exists(), "player mods are not ours to remove");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_mojang_install_still_counts_as_installed() {
        let root = std::env::temp_dir().join("millida-mirror-legacy");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(LEGACY_VERSION_FILE), "12688467_cert_bugfixpatch1\n").unwrap();
        assert!(installed_exe(&root).is_none(), "no exe on disk means nothing to launch");
        std::fs::write(root.join(LEGACY_EXE), b"MZ").unwrap();
        let (inst, exe) = installed_exe(&root).unwrap();
        assert_eq!(inst.version, "12688467_cert_bugfixpatch1");
        assert_eq!(exe, root.join(LEGACY_EXE));
        std::fs::write(root.join(INSTALL_FILE), r#"{"version":"1.17.0.0","exe":"../evil.exe"}"#).unwrap();
        assert!(installed_exe(&root).is_none(), "an exe outside the game folder is never launched");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn only_pak_files_are_mods() {
        assert!(pak_name("cool.pak").is_ok());
        assert!(pak_name("cool.PAK").is_ok());
        assert!(pak_name("virus.exe").is_err());
        assert!(pak_name("../x.pak").is_err());
    }
}
