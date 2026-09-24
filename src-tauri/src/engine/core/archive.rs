use serde_json::Value;
use std::path::Path;

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

pub(crate) fn unzip_to(archive: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name blocks `..` and absolute paths, but not Windows traps
        // (device names, colons, trailing dots) — safe_join covers those.
        let Some(name) = file.enclosed_name() else { continue };
        let Ok(out) = crate::engine::safe_join(dest, &name.to_string_lossy()) else { continue };
        if file.is_dir() { std::fs::create_dir_all(&out).ok(); continue; }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
        let _ = std::fs::remove_file(&out);
        let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut o).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Drops the archive's top-level directory (`tar --strip-components=1`), the
/// layout Adoptium JRE archives use.
pub(crate) fn unzip_strip1(archive: &Path, dest: &Path) -> Result<(), String> {
    let f = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = file.enclosed_name() else { continue };
        let mut parts = name.components();
        parts.next();
        let rel = parts.as_path().to_string_lossy().to_string();
        if rel.is_empty() { continue }
        let Ok(out) = crate::engine::safe_join(dest, &rel) else { continue };
        if file.is_dir() { std::fs::create_dir_all(&out).ok(); continue }
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
        let _ = std::fs::remove_file(&out);
        let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut o).map_err(|e| e.to_string())?;
    }
    Ok(())
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
}
