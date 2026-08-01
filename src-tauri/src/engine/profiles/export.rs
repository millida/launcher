use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

pub(crate) fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() { out.extend(walk(&p)); } else { out.push(p); }
        }
    }
    out
}

pub(crate) fn zip_add_overrides(
    zip: &mut zip::ZipWriter<std::fs::File>,
    pdir: &Path, subs: &[&str],
    known: &std::collections::HashSet<String>,
    opts: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write;
    for sub in subs {
        for entry in walk(&pdir.join(sub)) {
            let name = entry.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.ends_with(".disabled") || name.starts_with("millida-") { continue }
            let rel = match entry.strip_prefix(pdir) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if known.contains(&rel) { continue }
            zip.start_file(format!("overrides/{}", rel), opts).map_err(|e| e.to_string())?;
            let data = std::fs::read(&entry).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// .mrpack layout: files known to Modrinth go into modrinth.index.json, the
/// rest (configs, local files) into overrides/.
pub fn export_mrpack(
    profile: String, out_path: String, name: String, version: String, description: String,
) -> Result<String, String> {
    use std::io::Write;
    let pdir = profile_dir(&profile);
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    let gv = prof.as_ref().map(|p| p.version.clone()).unwrap_or_default();
    let loader_id = prof.map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());

    let mut files_json = vec![];
    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in load_content_manifest(&profile) {
        if e.download_url.is_empty() || e.sha1.is_empty() || e.sha512.is_empty() { continue }
        if !pdir.join(content_dir(&e.kind)).join(&e.file_name).exists() { continue }
        let rel = format!("{}/{}", content_dir(&e.kind), e.file_name);
        known.insert(rel.clone());
        files_json.push(serde_json::json!({
            "path": rel,
            "hashes": {"sha1": e.sha1, "sha512": e.sha512},
            "downloads": [e.download_url],
            "fileSize": e.file_size,
            "env": {"client": "required", "server": "required"}
        }));
    }
    let mut deps = serde_json::Map::new();
    deps.insert("minecraft".into(), Value::String(gv));
    match loader_id.as_str() {
        "fabric" => { deps.insert("fabric-loader".into(), Value::String("*".into())); }
        "quilt" => { deps.insert("quilt-loader".into(), Value::String("*".into())); }
        "forge" => { deps.insert("forge".into(), Value::String("*".into())); }
        "neoforge" => { deps.insert("neoforge".into(), Value::String("*".into())); }
        _ => {}
    }
    let index = serde_json::json!({
        "formatVersion": 1, "game": "minecraft",
        "versionId": if version.is_empty() { "1.0.0".to_string() } else { version },
        "name": if name.is_empty() { profile.clone() } else { name },
        "summary": description,
        "files": files_json,
        "dependencies": Value::Object(deps)
    });

    if let Some(p) = Path::new(&out_path).parent() { std::fs::create_dir_all(p).ok(); }
    let f = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("modrinth.index.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&index).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    zip_add_overrides(&mut zip, &pdir, &["config", "mods", "resourcepacks", "shaderpacks", "datapacks"], &known, opts)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(out_path)
}
