// The «Файлы» tab of a build: one folder level at a time, revealing a file in the system file manager and deleting what the player picked.
// Only paths inside the build folder; links are listed but never followed. No network.
use crate::engine::*;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildFile {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    pub modified: u64,
    /// The launcher's own bookkeeping: shown, but not deletable from here.
    pub service: bool,
}

const LIST_CAP: usize = 2000;

pub(crate) fn service_entry(rel: &str) -> bool {
    rel.replace('\\', "/").split('/').any(|seg| seg.to_ascii_lowercase().starts_with("millida-"))
}

fn build_path(profile: &str, rel: &str) -> Result<PathBuf, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена — открой список сборок заново".into());
    }
    let base = profile_dir(profile);
    if rel.trim().is_empty() {
        return Ok(base);
    }
    safe_join(&base, rel)
}

fn modified_secs(meta: &std::fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn list_build_files(profile: &str, rel: &str) -> Result<Vec<BuildFile>, String> {
    let dir = build_path(profile, rel)?;
    let rd = match std::fs::read_dir(&dir) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(format!("Не удалось открыть папку сборки: {}", e)),
    };
    let mut out = vec![];
    for e in rd.flatten().take(LIST_CAP) {
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        let child_rel = if rel.trim().is_empty() { name.clone() } else { format!("{}/{}", rel.trim_end_matches('/'), name) };
        out.push(BuildFile {
            dir: meta.is_dir(),
            size: if meta.is_file() { meta.len() } else { 0 },
            modified: modified_secs(&meta),
            service: service_entry(&child_rel),
            name,
        });
    }
    out.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// A file is shown in its folder rather than opened: opening runs whatever
/// program the system maps to it, and a build may carry scripts and installers.
pub fn reveal_build_file(profile: &str, rel: &str) -> Result<(), String> {
    let path = build_path(profile, rel)?;
    if !path.exists() {
        return Err("Файл уже удалён — обнови список".into());
    }
    if path.is_dir() {
        std::fs::create_dir_all(&path).ok();
        open_path(&path.to_string_lossy());
        return Ok(());
    }
    tauri_plugin_opener::reveal_item_in_dir(&path).map_err(|e| format!("Не удалось открыть папку: {}", e))
}

fn delete_path(path: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.is_dir() {
        // The player picked this folder inside the build and confirmed the deletion.
        std::fs::remove_dir_all(path)
    } else {
        // The player picked this file inside the build and confirmed the deletion.
        std::fs::remove_file(path)
    }
}

pub fn delete_build_file(profile: &str, rel: &str) -> Result<(), String> {
    if rel.trim().is_empty() {
        return Err("Выбери файл или папку внутри сборки".into());
    }
    if service_entry(rel) {
        return Err("Это служебный файл лаунчера — без него сборка сломается".into());
    }
    assert_not_running(profile, "удали ещё раз")?;
    let path = build_path(profile, rel)?;
    if std::fs::symlink_metadata(&path).is_err() {
        return Ok(());
    }
    delete_path(&path).map_err(|e| format!("Файл занят другой программой — закрой игру и папку сборки, затем повтори: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (path inside the build) -> refused for deletion from the tab.
    #[test]
    fn launcher_bookkeeping_stays() {
        let cases: [(&str, bool, &str); 5] = [
            ("millida-settings.json", true, "the build's settings hold its Java and memory"),
            ("mods/millida-content.json", true, "a service name deeper down is still a service file"),
            ("Millida-pack-launch.json", true, "case does not hide a service file on Windows"),
            ("mods/sodium.jar", false, "an ordinary mod is the player's to remove"),
            ("saves/Мой мир", false, "a world is the player's to remove"),
        ];
        for (rel, want, why) in cases {
            assert_eq!(service_entry(rel), want, "{}: {}", rel, why);
        }
    }
}
