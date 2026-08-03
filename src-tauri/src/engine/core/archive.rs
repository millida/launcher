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
        let mut o = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut o).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            std::fs::create_dir_all(&to)?;
            copy_dir_all(&entry.path(), &to)?;
        } else {
            if let Some(p) = to.parent() { std::fs::create_dir_all(p).ok(); }
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
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
        let dest = out.join(fname);
        if let Ok(mut o) = std::fs::File::create(&dest) { let _ = std::io::copy(&mut file, &mut o); }
    }
}
