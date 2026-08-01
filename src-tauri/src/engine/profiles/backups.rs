use crate::engine::*;

pub fn backup_world(profile: String, folder: String) -> Result<String, String> {
    use std::io::Write;
    // world name arrives over IPC: must resolve to a single folder inside saves/
    let name = safe_file_name(&folder)?;
    let src = safe_child(&profile_dir(&profile).join("saves"), &name)?;
    if !src.is_dir() { return Err("Мир не найден".into()); }
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let out = safe_child(&profile_dir(&profile).join("backups"), &format!("{}-{}.zip", name, ts))?;
    if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
    let f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in walk(&src) {
        let rel = match entry.strip_prefix(&src) { Ok(r) => r.to_string_lossy().replace('\\', "/"), Err(_) => continue };
        zip.start_file(rel, opts).map_err(|e| e.to_string())?;
        zip.write_all(&std::fs::read(&entry).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().to_string())
}

pub fn list_backups(profile: &str) -> Vec<String> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(profile_dir(profile).join("backups")) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".zip") { out.push(n); }
        }
    }
    out.sort(); out.reverse(); out
}

pub fn open_screenshots(profile: &str) {
    let p = profile_dir(profile).join("screenshots");
    std::fs::create_dir_all(&p).ok();
    open_path(&p.to_string_lossy());
}

pub fn count_screenshots(profile: &str) -> usize {
    std::fs::read_dir(profile_dir(profile).join("screenshots")).map(|rd|
        rd.flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".png")).count()
    ).unwrap_or(0)
}
