// Unpacks zip: modpacks, Java, downloaded archives. Does not let files out of the target folder and limits the unpacked size. If unpacking breaks off, it removes only what it wrote itself.
use serde_json::Value;
use std::path::{Path, PathBuf};

/// A jar cut short by a dropped connection still opens and still has a
/// plausible size, so only reading its directory tells a broken mod from a
/// working one. Entry data is not inflated: that would cost minutes on a pack.
pub(crate) fn zip_readable(path: &Path) -> bool {
    let Ok(f) = std::fs::File::open(path) else { return false };
    let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(f)) else { return false };
    if zip.is_empty() {
        return false;
    }
    (0..zip.len()).all(|i| zip.by_index(i).is_ok())
}

/// Sizes in a zip are the archive's own claims, and the inflater does not stop
/// at them: an entry declared as 100 bytes can inflate to gigabytes and fill the
/// disk. So the declared total must fit under this ceiling before anything is
/// written, and no entry may write past its own declared size. 32 GiB is far
/// above any honest pack, map, import or Java archive.
pub(crate) const UNPACK_CEILING: u64 = 32 * 1024 * 1024 * 1024;

pub(crate) fn unzip_to(archive: &Path, dest: &Path) -> Result<(), String> {
    extract_zip(archive, dest, UNPACK_CEILING, whole_path, nothing_skippable, None)
}

/// Bytes unpacked so far and the total, called from whichever thread finished a file.
pub(crate) type Unpacked<'a> = dyn Fn(u64, u64) + Sync + 'a;

/// The same, reporting how much is done. A pack of three thousand small files spends its minutes in file creation
/// (an antivirus looks at every one), so the work is spread over several threads when there is enough of it.
pub(crate) fn unzip_to_progress(archive: &Path, dest: &Path, on: &Unpacked<'_>) -> Result<(), String> {
    extract_zip(archive, dest, UNPACK_CEILING, whole_path, nothing_skippable, Some(on))
}

/// Drops the archive's top-level directory (`tar --strip-components=1`), the
/// layout Adoptium JRE archives use. `skippable` names entries the caller can
/// run without: one that a lock refuses to let us write is left out instead of
/// failing the whole extraction.
pub(crate) fn unzip_strip1(archive: &Path, dest: &Path, skippable: fn(&str) -> bool) -> Result<(), String> {
    extract_zip(archive, dest, UNPACK_CEILING, below_top_folder, skippable, None)
}

fn nothing_skippable(_: &str) -> bool {
    false
}

fn whole_path(name: &Path) -> Option<String> {
    Some(name.to_string_lossy().to_string())
}

fn below_top_folder(name: &Path) -> Option<String> {
    let mut parts = name.components();
    parts.next();
    let rel = parts.as_path().to_string_lossy().to_string();
    (!rel.is_empty()).then_some(rel)
}

/// Every archive the launcher unpacks goes through here. A failed extraction
/// takes back what it wrote itself and nothing else: `dest` may already hold
/// files that were there before it.
fn extract_zip(
    archive: &Path,
    dest: &Path,
    ceiling: u64,
    place: fn(&Path) -> Option<String>,
    skippable: fn(&str) -> bool,
    progress: Option<&Unpacked<'_>>,
) -> Result<(), String> {
    let f = std::fs::File::open(archive).map_err(|e| super::io_fail("Распаковка", archive, &e))?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("Архив повреждён: {}", e))?;
    let declared = declared_total(&mut zip)?;
    if declared > ceiling {
        return Err(format!(
            "Архив распаковывается в {} — больше предела {}. Распаковку не начинали: проверь, что выбран нужный файл",
            gib(declared),
            gib(ceiling)
        ));
    }
    let mut written = Written::default();
    if parallel_worth(zip.len(), declared) {
        match extract_parallel(archive, dest, &mut zip, declared, place, skippable, progress, &mut written) {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(e) => return Err(written.take_back(e)),
        }
    }
    match extract_entries(&mut zip, dest, declared, place, skippable, &mut written, progress) {
        Ok(()) => Ok(()),
        Err(e) => Err(written.take_back(e)),
    }
}

/// Below this the threads cost more than they save.
const PARALLEL_MIN_ENTRIES: usize = 48;
const PARALLEL_MIN_BYTES: u64 = 8 * 1024 * 1024;

fn parallel_worth(entries: usize, declared: u64) -> bool {
    entries >= PARALLEL_MIN_ENTRIES && declared >= PARALLEL_MIN_BYTES && worker_count() > 1
}

/// More threads than cores on purpose: most of the time a worker waits for the file system, not for the processor.
fn worker_count() -> usize {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2);
    (cores * 2).clamp(2, 8)
}

struct Task {
    index: usize,
    out: PathBuf,
    rel: String,
    size: u64,
}

/// Spreads the files of one archive over several threads, each with its own handle on the archive. `Ok(false)` means
/// the layout asks for the one-by-one road (two entries that land on one name, where the last must win), and nothing
/// has been written. Anything it did write goes into `written`, so a failure takes back exactly that.
#[allow(clippy::too_many_arguments)]
fn extract_parallel(
    archive: &Path,
    dest: &Path,
    zip: &mut zip::ZipArchive<std::fs::File>,
    declared: u64,
    place: fn(&Path) -> Option<String>,
    skippable: fn(&str) -> bool,
    progress: Option<&Unpacked<'_>>,
    written: &mut Written,
) -> Result<bool, String> {
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex;

    let mut tasks: Vec<Task> = Vec::new();
    let mut folders: Vec<PathBuf> = Vec::new();
    let mut names = std::collections::HashSet::new();
    for i in 0..zip.len() {
        let file = zip.by_index_raw(i).map_err(|e| e.to_string())?;
        let Some(name) = file.enclosed_name() else { continue };
        let Some(rel) = place(&name) else { continue };
        let Ok(out) = crate::engine::safe_join(dest, &rel) else { continue };
        if file.is_dir() {
            folders.push(out);
            continue;
        }
        if !names.insert(out.to_string_lossy().to_lowercase()) {
            return Ok(false);
        }
        if let Some(parent) = out.parent() {
            folders.push(parent.to_path_buf());
        }
        tasks.push(Task { index: i, out, rel, size: file.size() });
    }
    folders.sort();
    folders.dedup();
    for dir in &folders {
        written.dir(dir).map_err(|e| super::io_fail("Распаковка", dir, &e))?;
    }

    let next = AtomicUsize::new(0);
    let failed = AtomicBool::new(false);
    let first_error: Mutex<Option<String>> = Mutex::new(None);
    let made: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
    let copied = AtomicU64::new(0);
    let fail = |why: String| {
        failed.store(true, Ordering::SeqCst);
        first_error.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert(why);
    };
    let work = || {
        let opened = std::fs::File::open(archive)
            .map_err(|e| super::io_fail("Распаковка", archive, &e))
            .and_then(|f| zip::ZipArchive::new(f).map_err(|e| format!("Архив повреждён: {}", e)));
        let mut mine = match opened {
            Ok(z) => z,
            Err(e) => return fail(e),
        };
        while !failed.load(Ordering::SeqCst) {
            let k = next.fetch_add(1, Ordering::SeqCst);
            let Some(task) = tasks.get(k) else { break };
            let mut file = match mine.by_index(task.index) {
                Ok(f) => f,
                Err(e) => return fail(e.to_string()),
            };
            let _ = std::fs::remove_file(&task.out);
            let mut o = match super::retry_locked(|| std::fs::File::create(&task.out)) {
                Ok(o) => o,
                Err(e) if skippable(&task.rel) && super::is_locked_error(&e) => continue,
                Err(e) => return fail(super::io_fail("Распаковка", &task.out, &e)),
            };
            made.lock().unwrap_or_else(|e| e.into_inner()).push(task.out.clone());
            match copy_at_most(&mut file, &mut o, task.size) {
                Ok(Some(n)) => {
                    let total = copied.fetch_add(n, Ordering::SeqCst) + n;
                    if let Some(report) = progress {
                        report(total, declared);
                    }
                }
                Ok(None) => {
                    return fail(format!(
                        "Архив повреждён или подделан: «{}» распаковывается больше, чем заявлено в самом архиве. Распаковку остановили и убрали то, что успело распаковаться, — возьми файл заново из источника",
                        task.rel
                    ))
                }
                Err(e) if skippable(&task.rel) && super::is_locked_error(&e) => {
                    drop(o);
                    let _ = std::fs::remove_file(&task.out);
                }
                Err(e) => return fail(super::io_fail("Распаковка", &task.out, &e)),
            }
        }
    };
    std::thread::scope(|scope| {
        for _ in 0..worker_count().min(tasks.len().max(1)) {
            scope.spawn(work);
        }
    });
    written.files.extend(made.into_inner().unwrap_or_else(|e| e.into_inner()));
    match first_error.into_inner().unwrap_or_else(|e| e.into_inner()) {
        Some(e) => Err(e),
        None => Ok(true),
    }
}

fn declared_total(zip: &mut zip::ZipArchive<std::fs::File>) -> Result<u64, String> {
    let mut total = 0u64;
    for i in 0..zip.len() {
        let entry = zip.by_index_raw(i).map_err(|e| format!("Архив повреждён: {}", e))?;
        total = total.saturating_add(entry.size());
    }
    Ok(total)
}

fn extract_entries(
    zip: &mut zip::ZipArchive<std::fs::File>,
    dest: &Path,
    declared: u64,
    place: fn(&Path) -> Option<String>,
    skippable: fn(&str) -> bool,
    written: &mut Written,
    progress: Option<&Unpacked<'_>>,
) -> Result<(), String> {
    let mut budget = declared;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name blocks `..` and absolute paths, but not Windows traps
        // (device names, colons, trailing dots) — safe_join covers those.
        let Some(name) = file.enclosed_name() else { continue };
        let Some(rel) = place(&name) else { continue };
        let Ok(out) = crate::engine::safe_join(dest, &rel) else { continue };
        if file.is_dir() {
            written.dir(&out).map_err(|e| super::io_fail("Распаковка", &out, &e))?;
            continue;
        }
        if let Some(p) = out.parent() {
            written.dir(p).map_err(|e| super::io_fail("Распаковка", p, &e))?;
        }
        let _ = std::fs::remove_file(&out);
        let mut o = match super::retry_locked(|| std::fs::File::create(&out)) {
            Ok(o) => o,
            Err(e) if skippable(&rel) && super::is_locked_error(&e) => continue,
            Err(e) => return Err(super::io_fail("Распаковка", &out, &e)),
        };
        written.files.push(out.clone());
        let limit = file.size().min(budget);
        let copied = match copy_at_most(&mut file, &mut o, limit) {
            Err(e) if skippable(&rel) && super::is_locked_error(&e) => {
                drop(o);
                let _ = std::fs::remove_file(&out);
                continue;
            }
            other => other.map_err(|e| super::io_fail("Распаковка", &out, &e))?,
        };
        match copied {
            Some(n) => {
                budget -= n;
                if let Some(report) = progress {
                    report(declared - budget, declared);
                }
            }
            None => {
                return Err(format!(
                    "Архив повреждён или подделан: «{}» распаковывается больше, чем заявлено в самом архиве. Распаковку остановили и убрали то, что успело распаковаться, — возьми файл заново из источника",
                    rel
                ))
            }
        }
    }
    Ok(())
}

/// `None` when the stream holds more than `limit` bytes. The byte past the
/// limit is read, not assumed: reading on to the end is also what makes the
/// zip reader check the entry's CRC.
fn copy_at_most<R: std::io::Read, W: std::io::Write>(from: &mut R, to: &mut W, limit: u64) -> std::io::Result<Option<u64>> {
    let n = std::io::copy(&mut std::io::Read::take(&mut *from, limit), to)?;
    let mut probe = [0u8; 1];
    loop {
        match from.read(&mut probe) {
            Ok(0) => return Ok(Some(n)),
            Ok(_) => return Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        }
    }
}

fn gib(bytes: u64) -> String {
    format!("{:.1} ГБ", bytes as f64 / (1u64 << 30) as f64)
}

/// What one extraction created, in creation order.
#[derive(Default)]
struct Written {
    files: Vec<PathBuf>,
    dirs: Vec<PathBuf>,
}

impl Written {
    fn dir(&mut self, dir: &Path) -> std::io::Result<()> {
        let missing: Vec<PathBuf> = dir
            .ancestors()
            .take_while(|p| !p.as_os_str().is_empty() && !p.exists())
            .map(Path::to_path_buf)
            .collect();
        // Recorded before creating: a create that fails halfway still leaves
        // folders this extraction made.
        self.dirs.extend(missing.into_iter().rev());
        super::retry_locked(|| std::fs::create_dir_all(dir))
    }

    /// Files first, then folders deepest first: a folder goes only once it is
    /// empty, so nothing this extraction did not write goes with it.
    fn take_back(self, cause: String) -> String {
        let mut stuck: Option<PathBuf> = None;
        for f in &self.files {
            // Rollback of a failed unpack: deletes only files and folders created by this same unpack.
            if let Err(e) = std::fs::remove_file(f) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    stuck.get_or_insert_with(|| f.clone());
                }
            }
        }
        for d in self.dirs.iter().rev() {
            if let Err(e) = std::fs::remove_dir(d) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    stuck.get_or_insert_with(|| d.clone());
                }
            }
        }
        match stuck {
            None => cause,
            Some(p) => format!(
                "{} (не всё распакованное удалось убрать — удали вручную: {})",
                cause,
                super::mask_home(&p.to_string_lossy())
            ),
        }
    }
}

/// Symlinks are skipped, not followed: `fs::copy` reads through a link, so a
/// link planted in an unpacked archive or an imported folder would copy any
/// file of the user (keys, browser profiles) into a game folder or an export.
pub(crate) fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    copy_dir_filtered(src, dst, &|_| true)
}

/// Launcher-owned files inside a game folder. Pack overrides and share codes
/// must never bring their own copies: these files steer the launch (arguments,
/// trusted pack-launch descriptor, settings).
pub(crate) fn is_launcher_service_file(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    (low.starts_with("millida-") && low.ends_with(".json"))
        || low == "millida-args.txt"
        || low.starts_with("servers.dat.millida")
}

/// Copy for pack overrides: same as `copy_dir_all`, minus launcher service
/// files at any depth.
pub(crate) fn copy_overrides(src: &Path, dst: &Path) -> std::io::Result<()> {
    copy_dir_filtered(src, dst, &|name: &str| !is_launcher_service_file(name))
}

/// In-place counterpart of `copy_overrides`, for an unpacked tree that becomes
/// a game folder by rename instead of by copy: launcher service files go at any
/// depth. `trusted` names the ones the caller vouches for, at this level only.
/// A link is never followed into: it could lead out of the tree.
pub(crate) fn drop_launcher_service_files(dir: &Path, trusted: &[&str]) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let kind = std::fs::symlink_metadata(entry.path())?.file_type();
        if is_launcher_service_file(&name) && !trusted.contains(&name.as_str()) {
            if kind.is_dir() {
                // Launcher service files (millida-*.json, millida-args.txt) are dropped from a foreign archive, so a modpack cannot slip in its own launch arguments. Links are not followed.
                std::fs::remove_dir_all(entry.path())?;
            } else {
                std::fs::remove_file(entry.path())?;
            }
        } else if kind.is_dir() {
            drop_launcher_service_files(&entry.path(), &[])?;
        }
    }
    Ok(())
}

fn copy_dir_filtered(src: &Path, dst: &Path, keep: &dyn Fn(&str) -> bool) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if !keep(&name.to_string_lossy()) {
            continue;
        }
        let meta = std::fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let to = dst.join(&name);
        if meta.is_dir() {
            std::fs::create_dir_all(&to)?;
            copy_dir_filtered(&entry.path(), &to, keep)?;
        } else if meta.is_file() {
            if let Some(p) = to.parent() { std::fs::create_dir_all(p).ok(); }
            copy_replacing(&entry.path(), &to)?;
        }
    }
    Ok(())
}

/// `fs::copy` onto an existing file truncates and rewrites that file's inode.
/// Files in mods/, resourcepacks/… are hard links into the shared store, so
/// that would rewrite the library in every build at once (CORE-1). The copy is
/// written next to the target and renamed over it: only this directory entry
/// changes, and a failed copy leaves the old file in place.
pub(crate) fn copy_replacing(from: &Path, to: &Path) -> std::io::Result<u64> {
    let mut tmp_name = to.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".millida-copy");
    let tmp = to.with_file_name(tmp_name);
    let _ = std::fs::remove_file(&tmp);
    let n = match std::fs::copy(from, &tmp) {
        Ok(n) => n,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    };
    if let Err(e) = std::fs::rename(&tmp, to) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(n)
}

/// Extracts native libraries from a classifier jar honouring `extract.exclude`;
/// without them the game fails with UnsatisfiedLinkError on an empty
/// java.library.path.
pub(crate) fn extract_natives(jar: &Path, out: &Path, extract_rule: &Value) {
    let excludes: Vec<String> = extract_rule["exclude"].as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let Ok(f) = std::fs::File::open(jar) else { return };
    let Ok(mut zip) = zip::ZipArchive::new(f) else { return };
    std::fs::create_dir_all(out).ok();
    for i in 0..zip.len() {
        let Ok(mut file) = zip.by_index(i) else { continue };
        let name = file.name().to_string();
        if name.ends_with('/') || name.starts_with("META-INF") { continue }
        if excludes.iter().any(|e| name.starts_with(e.trim_end_matches('/'))) { continue }
        let ext = Path::new(&name).extension().and_then(|s| s.to_str()).unwrap_or("");
        if !matches!(ext, "dll" | "so" | "dylib" | "jnilib") { continue }
        let Some(fname) = Path::new(&name).file_name() else { continue };
        let Ok(fname) = crate::engine::safe_file_name(&fname.to_string_lossy()) else { continue };
        let Ok(dest) = crate::engine::safe_child(out, &fname) else { continue };
        if let Ok(mut o) = std::fs::File::create(&dest) { let _ = std::io::copy(&mut file, &mut o); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_files_are_recognised() {
        for n in ["millida-settings.json", "millida-pack-launch.json", "MILLIDA-args.txt", "millida-args.txt", "servers.dat.millida", "servers.dat.millida.bak"] {
            assert!(is_launcher_service_file(n), "{n}");
        }
        for n in ["options.txt", "servers.dat", "millida.txt", "config.json"] {
            assert!(!is_launcher_service_file(n), "{n}");
        }
    }

    #[test]
    fn overrides_copy_skips_service_files_and_symlinks() {
        let base = std::env::temp_dir().join(format!("millida-ov-test-{}", std::process::id()));
        let src = base.join("src");
        let dst = base.join("dst");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(src.join("config")).unwrap();
        std::fs::create_dir_all(&dst).unwrap();
        std::fs::write(src.join("options.txt"), "a").unwrap();
        std::fs::write(src.join("millida-args.txt"), "-Devil").unwrap();
        std::fs::write(src.join("config").join("millida-pack-launch.json"), "{}").unwrap();
        std::fs::write(src.join("config").join("x.toml"), "b").unwrap();
        std::fs::write(base.join("secret"), "s").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(base.join("secret"), src.join("link.txt")).unwrap();
        copy_overrides(&src, &dst).unwrap();
        assert!(dst.join("options.txt").exists());
        assert!(dst.join("config").join("x.toml").exists());
        assert!(!dst.join("millida-args.txt").exists());
        assert!(!dst.join("config").join("millida-pack-launch.json").exists());
        assert!(!dst.join("link.txt").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    const BIG: usize = 256 * 1024;

    fn body(len: usize) -> Vec<u8> {
        vec![b'x'; len]
    }

    fn write_zip(path: &Path, entries: &[(&str, usize)], method: zip::CompressionMethod) {
        let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default().compression_method(method);
        for (name, len) in entries {
            z.start_file(*name, opts).unwrap();
            std::io::Write::write_all(&mut z, &body(*len)).unwrap();
        }
        z.finish().unwrap();
    }

    /// Rewrites the uncompressed size one entry declares, in its central record
    /// and in its local header, and leaves the data and the CRC of the real
    /// content alone: that is what a forged archive looks like.
    fn declare_size(path: &Path, entry: &str, declared: u32) {
        let mut b = std::fs::read(path).unwrap();
        let u16_at = |b: &[u8], at: usize| u16::from_le_bytes([b[at], b[at + 1]]) as usize;
        let u32_at = |b: &[u8], at: usize| u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]]) as usize;
        let eocd = b.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        let mut at = u32_at(&b, eocd + 16);
        let mut patched = false;
        for _ in 0..u16_at(&b, eocd + 10) {
            let name_len = u16_at(&b, at + 28);
            let record = 46 + name_len + u16_at(&b, at + 30) + u16_at(&b, at + 32);
            if &b[at + 46..at + 46 + name_len] == entry.as_bytes() {
                let local = u32_at(&b, at + 42);
                b[at + 24..at + 28].copy_from_slice(&declared.to_le_bytes());
                b[local + 22..local + 26].copy_from_slice(&declared.to_le_bytes());
                patched = true;
            }
            at += record;
        }
        assert!(patched, "в архиве нет записи «{entry}» — подделывать нечего");
        std::fs::write(path, b).unwrap();
    }

    fn tree(root: &Path) -> Vec<String> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            let Ok(rd) = std::fs::read_dir(dir) else { return };
            for e in rd.flatten() {
                let p = e.path();
                out.push(p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
                if p.is_dir() {
                    walk(root, &p, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(root, root, &mut out);
        out.sort();
        out
    }

    struct Case {
        entries: &'static [(&'static str, usize)],
        lie: Option<(&'static str, u32)>,
        method: zip::CompressionMethod,
        strip: bool,
        ceiling: u64,
        player_file: bool,
        refused_with: Option<&'static str>,
        why: &'static str,
    }

    /// archive -> extracted or refused. Sizes in a zip are the archive's own
    /// claims and the inflater does not stop at them, so a forged size must stop
    /// the extraction, and a stopped extraction must take back what it wrote
    /// while the files that were already in the folder stay.
    #[test]
    fn extraction_writes_no_more_than_the_archive_declares() {
        use zip::CompressionMethod::{Deflated, Stored};
        let cases = [
            Case {
                entries: &[("mods/a.jar", 3000), ("config/empty.toml", 0), ("config/big.dat", BIG)],
                lie: None, method: Deflated, strip: false, ceiling: UNPACK_CEILING, player_file: true, refused_with: None,
                why: "честный архив распаковывается целиком рядом с файлами игрока, пустой файл тоже файл",
            },
            Case {
                entries: &[("config/x.dat", BIG)],
                lie: Some(("config/x.dat", 100)), method: Deflated, strip: false, ceiling: UNPACK_CEILING, player_file: false,
                refused_with: Some("больше, чем заявлено"),
                why: "deflate-поток длиннее заявленного размера забил бы диск; папку, которую создала распаковка, она же и убирает",
            },
            Case {
                entries: &[("mods/a.jar", 3000), ("config/x.dat", BIG)],
                lie: Some(("config/x.dat", 100)), method: Deflated, strip: false, ceiling: UNPACK_CEILING, player_file: true,
                refused_with: Some("больше, чем заявлено"),
                why: "распакованное до подделки убирается, а файлы игрока в той же папке остаются",
            },
            Case {
                entries: &[("config/x.dat", BIG)],
                lie: Some(("config/x.dat", 100)), method: Stored, strip: false, ceiling: UNPACK_CEILING, player_file: true,
                refused_with: Some("больше, чем заявлено"),
                why: "защита не зависит от сжатия: несжатая запись длиннее заявленного тоже останавливается",
            },
            Case {
                entries: &[("config/x.dat", 5000)],
                lie: Some(("config/x.dat", 4999)), method: Deflated, strip: false, ceiling: UNPACK_CEILING, player_file: false,
                refused_with: Some("больше, чем заявлено"),
                why: "лишний даже один байт — уже подделка размера",
            },
            Case {
                entries: &[("a.bin", 1000), ("b.bin", 1000), ("c.bin", 1000)],
                lie: None, method: Deflated, strip: false, ceiling: 2999, player_file: false,
                refused_with: Some("больше предела"),
                why: "заявленное больше потолка отказывается до записи первого байта",
            },
            Case {
                entries: &[("a.bin", 1000), ("b.bin", 1000), ("c.bin", 1000)],
                lie: None, method: Deflated, strip: false, ceiling: 3000, player_file: false, refused_with: None,
                why: "ровно потолок ещё распаковывается",
            },
            Case {
                entries: &[("jdk-21/bin/java", 3000), ("jdk-21/lib/modules", BIG)],
                lie: Some(("jdk-21/lib/modules", 100)), method: Deflated, strip: true, ceiling: UNPACK_CEILING, player_file: false,
                refused_with: Some("больше, чем заявлено"),
                why: "архив Java распаковывается тем же путём и с той же защитой",
            },
            Case {
                entries: &[("jdk-21/bin/java", 3000)],
                lie: None, method: Deflated, strip: true, ceiling: UNPACK_CEILING, player_file: false, refused_with: None,
                why: "у архива Java по-прежнему срезается верхняя папка",
            },
        ];
        let base = std::env::temp_dir().join(format!("millida-unzip-guard-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        for (i, c) in cases.iter().enumerate() {
            let dir = base.join(i.to_string());
            std::fs::create_dir_all(&dir).unwrap();
            let archive = dir.join("a.zip");
            let dest = dir.join("out");
            write_zip(&archive, c.entries, c.method);
            if let Some((entry, declared)) = c.lie {
                declare_size(&archive, entry, declared);
            }
            let keep = dest.join("saves").join("keep.dat");
            if c.player_file {
                std::fs::create_dir_all(keep.parent().unwrap()).unwrap();
                std::fs::write(&keep, "мир игрока").unwrap();
            }
            let place: fn(&Path) -> Option<String> = if c.strip { below_top_folder } else { whole_path };
            let res = extract_zip(&archive, &dest, c.ceiling, place, nothing_skippable, None);
            match c.refused_with {
                None => {
                    res.unwrap_or_else(|e| panic!("случай {i}: {} — а распаковка отказала: {e}", c.why));
                    for (name, len) in c.entries {
                        let rel = place(Path::new(name)).unwrap();
                        let got = std::fs::read(dest.join(&rel)).unwrap_or_else(|e| panic!("случай {i}: нет «{rel}» ({e}): {}", c.why));
                        assert_eq!(got, body(*len), "случай {i}: «{rel}» распакован не тем содержимым: {}", c.why);
                    }
                }
                Some(needle) => {
                    let err = res.expect_err(c.why);
                    assert!(err.contains(needle), "случай {i}: ждали «{needle}» в тексте отказа, а там «{err}»: {}", c.why);
                    if c.player_file {
                        assert_eq!(tree(&dest), ["saves", "saves/keep.dat"], "случай {i}: после отказа в папке остаётся только то, что было до распаковки: {}", c.why);
                    } else {
                        assert!(!dest.exists(), "случай {i}: папку создала сама распаковка, после отказа её быть не должно: {}", c.why);
                    }
                }
            }
            if c.player_file {
                assert_eq!(std::fs::read_to_string(&keep).ok().as_deref(), Some("мир игрока"), "случай {i}: файл игрока трогать нельзя: {}", c.why);
            }
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// An archive with many files goes through the threads and comes out exactly as the one-by-one road leaves it;
    /// a forged size still stops it and takes back what the threads wrote; two names that land on one path keep
    /// the old road, where the last entry wins.
    #[test]
    fn many_files_are_unpacked_in_parallel_and_guarded_the_same_way() {
        let base = std::env::temp_dir().join(format!("millida-unzip-parallel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let names: Vec<String> = (0..90).map(|i| format!("mods/lib-{i}.jar")).collect();
        let entries: Vec<(&str, usize)> = names.iter().map(|n| (n.as_str(), 120_000)).collect();
        assert!(parallel_worth(entries.len(), 90 * 120_000), "the sample must be big enough to take the parallel road");

        let archive = base.join("a.zip");
        write_zip(&archive, &entries, zip::CompressionMethod::Deflated);
        let seen = std::sync::atomic::AtomicU64::new(0);
        let dest = base.join("ok");
        unzip_to_progress(&archive, &dest, &|done, total| {
            assert!(done <= total);
            seen.fetch_max(done, std::sync::atomic::Ordering::SeqCst);
        })
        .unwrap();
        for (name, len) in &entries {
            assert_eq!(std::fs::read(dest.join(name)).unwrap(), body(*len), "{name}");
        }
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 90 * 120_000, "progress ends at the declared total");

        let forged = base.join("forged.zip");
        write_zip(&forged, &entries, zip::CompressionMethod::Deflated);
        declare_size(&forged, "mods/lib-40.jar", 100);
        let dest = base.join("forged-out");
        let err = unzip_to(&forged, &dest).expect_err("a forged size must stop the threads");
        assert!(err.contains("больше, чем заявлено"), "{err}");
        assert!(!dest.exists(), "everything the threads wrote is taken back: {:?}", tree(&dest));

        let twins = base.join("twins.zip");
        let mut dup: Vec<(&str, usize)> = entries.clone();
        dup.push(("MODS/LIB-0.JAR", 5));
        write_zip(&twins, &dup, zip::CompressionMethod::Deflated);
        let dest = base.join("twins-out");
        unzip_to(&twins, &dest).unwrap();
        assert!(dest.join("mods/lib-0.jar").exists() || dest.join("MODS/LIB-0.JAR").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A directory squatting on the entry's path makes Windows answer
    /// «Access is denied», the same error an antivirus gives when it refuses a
    /// file by name. Only entries the caller marked skippable may be left out.
    #[cfg(windows)]
    #[test]
    fn locked_entry_is_left_out_only_when_skippable() {
        fn ucrt_only(rel: &str) -> bool {
            rel.ends_with("ucrtbase.dll")
        }
        type Case = (fn(&str) -> bool, bool, &'static str);
        let cases: [Case; 2] = [
            (ucrt_only, true, "необязательный файл, который не дали записать, пропускается — остальное распаковано"),
            (nothing_skippable, false, "обязательный файл, который не дали записать, останавливает распаковку"),
        ];
        let base = std::env::temp_dir().join(format!("millida-unzip-skip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        for (i, (skippable, want_ok, why)) in cases.into_iter().enumerate() {
            let dir = base.join(i.to_string());
            std::fs::create_dir_all(&dir).unwrap();
            let archive = dir.join("a.zip");
            let dest = dir.join("out");
            write_zip(&archive, &[("jdk-21/bin/java.exe", 3000), ("jdk-21/bin/ucrtbase.dll", 3000), ("jdk-21/lib/modules", 3000)], zip::CompressionMethod::Deflated);
            std::fs::create_dir_all(dest.join("bin").join("ucrtbase.dll")).unwrap();
            let res = extract_zip(&archive, &dest, UNPACK_CEILING, below_top_folder, skippable, None);
            assert_eq!(res.is_ok(), want_ok, "случай {i}: {why} ({res:?})");
            if want_ok {
                for rel in ["bin/java.exe", "lib/modules"] {
                    assert_eq!(std::fs::read(dest.join(rel)).ok(), Some(body(3000)), "случай {i}: «{rel}» должен распаковаться: {why}");
                }
            }
        }
        let _ = std::fs::remove_dir_all(&base);
    }
}
