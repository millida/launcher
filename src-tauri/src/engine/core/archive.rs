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
const UNPACK_CEILING: u64 = 32 * 1024 * 1024 * 1024;

pub(crate) fn unzip_to(archive: &Path, dest: &Path) -> Result<(), String> {
    extract_zip(archive, dest, UNPACK_CEILING, whole_path)
}

/// Drops the archive's top-level directory (`tar --strip-components=1`), the
/// layout Adoptium JRE archives use.
pub(crate) fn unzip_strip1(archive: &Path, dest: &Path) -> Result<(), String> {
    extract_zip(archive, dest, UNPACK_CEILING, below_top_folder)
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
fn extract_zip(archive: &Path, dest: &Path, ceiling: u64, place: fn(&Path) -> Option<String>) -> Result<(), String> {
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
    match extract_entries(&mut zip, dest, declared, place, &mut written) {
        Ok(()) => Ok(()),
        Err(e) => Err(written.take_back(e)),
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
    written: &mut Written,
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
        let mut o = std::fs::File::create(&out).map_err(|e| super::io_fail("Распаковка", &out, &e))?;
        written.files.push(out.clone());
        let limit = file.size().min(budget);
        match copy_at_most(&mut file, &mut o, limit).map_err(|e| super::io_fail("Распаковка", &out, &e))? {
            Some(n) => budget -= n,
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
        std::fs::create_dir_all(dir)
    }

    /// Files first, then folders deepest first: a folder goes only once it is
    /// empty, so nothing this extraction did not write goes with it.
    fn take_back(self, cause: String) -> String {
        let mut stuck: Option<PathBuf> = None;
        for f in &self.files {
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

/// OS key used by the `natives` map in Mojang library entries.
pub(crate) fn natives_os_key() -> &'static str {
    if cfg!(target_os = "macos") { "osx" } else if cfg!(target_os = "windows") { "windows" } else { "linux" }
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
            let res = extract_zip(&archive, &dest, c.ceiling, place);
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
}
