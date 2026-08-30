use crate::engine::*;

pub fn list_logs(profile: &str) -> Vec<String> {
    let mut out = vec![];
    for sub in ["logs", "crash-reports"] {
        if let Ok(rd) = std::fs::read_dir(profile_dir(profile).join(sub)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.ends_with(".log") || n.ends_with(".txt") { out.push(format!("{}/{}", sub, n)); }
            }
        }
    }
    out.sort(); out.reverse(); out
}

pub fn read_log(profile: &str, name: &str) -> String {
    if !is_log_path(name) { return String::new(); }
    let Ok(p) = safe_join(&profile_dir(profile), name) else { return String::new() };
    let data = std::fs::read_to_string(&p).unwrap_or_default();
    // tail only: log files can be huge
    let lines: Vec<&str> = data.lines().collect();
    let start = lines.len().saturating_sub(400);
    lines[start..].join("\n")
}

pub fn duplicate_profile(name: &str) -> Result<Vec<Profile>, String> {
    let mut all = load_profiles();
    let Some(src) = all.iter().find(|p| p.name == name).cloned() else { return Ok(all) };
    let newname = unique_profile_name(&format!("{} (копия)", name));
    let from = profile_dir(name);
    let to = profile_dir(&newname);
    if from.exists() {
        if let Err(e) = std::fs::create_dir_all(&to).and_then(|_| copy_dir_all(&from, &to)) {
            let _ = std::fs::remove_dir_all(&to);
            return Err(format!("Не удалось скопировать файлы сборки: {}", e));
        }
    }
    all.insert(0, Profile { name: newname, version: src.version, fabric: src.fabric, loader: src.loader.clone(), loader_version: src.loader_version.clone(), icon: src.icon });
    save_profiles(&all)?;
    Ok(all)
}

#[derive(serde::Serialize, Clone)]
pub struct McVersion {
    pub id: String,
    pub kind: String,
}

/// The same cached manifest an install reads: without the cache one unreachable
/// request left the version picker holding a single option — the build's current
/// version — and changing the version looked impossible with nothing said.
pub async fn list_versions_typed() -> Result<Vec<McVersion>, String> {
    let m = get_json_fresh(MANIFEST, &game_root().join("version_manifest_v2.json"), MANIFEST_TTL).await?;
    Ok(m["versions"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    Some(McVersion {
                        id: v["id"].as_str()?.to_string(),
                        kind: v["type"].as_str().unwrap_or("release").to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

pub async fn list_versions() -> Result<Vec<String>, String> {
    Ok(list_versions_typed().await?.into_iter().filter(|v| v.kind == "release").map(|v| v.id).collect())
}
