// World backup as a zip into the backups folder of the modpack (or the player's own backups folder), and showing
// the screenshots folder. A snapshot of the last played world is taken before mods are updated. No network.
use crate::engine::*;
use std::path::{Path, PathBuf};

const ROOT_FILE: &str = "backups-root.txt";
const AUTO_FILE: &str = ".auto-snapshots.json";
/// Automatic snapshots kept per world; the player's own backups are never rotated.
const AUTO_KEEP: usize = 3;

/// The player's own folder for backups, chosen in a native dialog. A folder that is gone
/// (an unplugged drive) falls back to the build folder instead of failing the backup.
pub fn backups_root() -> Option<PathBuf> {
    let raw = std::fs::read_to_string(data_dir().join(ROOT_FILE)).ok()?;
    let p = PathBuf::from(raw.trim());
    (p.is_absolute() && p.is_dir()).then_some(p)
}

/// Backups of the build whose folder is `pdir`: `<root>/<build>` or `<build>/backups`.
pub fn backups_in(pdir: &Path) -> PathBuf {
    let own = backups_root().zip(pdir.file_name()).and_then(|(root, name)| safe_child(&root, &name.to_string_lossy()).ok());
    own.unwrap_or_else(|| pdir.join("backups"))
}

pub fn backups_dir(profile: &str) -> PathBuf {
    backups_in(&profile_dir(profile))
}

pub async fn pick_backups_root() -> Result<Option<String>, String> {
    let start = backups_root().unwrap_or_else(game_root);
    let Some(dir) = pick_folder(dialog().set_directory(&start).set_title(ui("Папка для бэкапов"))).await else {
        return Ok(None);
    };
    let probe = dir.join(".millida-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("В эту папку нельзя записывать: {}", e))?;
    let _ = std::fs::remove_file(&probe);
    write_bytes_atomic(&data_dir().join(ROOT_FILE), dir.to_string_lossy().as_bytes())?;
    Ok(Some(dir.to_string_lossy().into_owned()))
}

pub fn reset_backups_root() -> Result<(), String> {
    match std::fs::remove_file(data_dir().join(ROOT_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Не удалось сбросить папку бэкапов: {}", e)),
    }
}

pub fn backups_root_dir() -> Option<String> {
    backups_root().map(|p| p.to_string_lossy().into_owned())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn zip_world(src: &Path, out: &Path) -> Result<(), String> {
    use std::io::Write;
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("Не удалось создать папку бэкапов: {}", e))?;
    }
    // Written beside and renamed at the end: a cut-off zip must never look like a backup.
    let part = out.with_extension("zip.part");
    let result = (|| {
        let f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for entry in walk(src) {
            let rel = match entry.strip_prefix(src) { Ok(r) => r.to_string_lossy().replace('\\', "/"), Err(_) => continue };
            zip.start_file(rel, opts).map_err(|e| e.to_string())?;
            zip.write_all(&std::fs::read(&entry).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        std::fs::rename(&part, out).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    result
}

pub fn backup_world(profile: String, folder: String) -> Result<String, String> {
    // world name arrives over IPC: must resolve to a single folder inside saves/
    let name = safe_file_name(&folder)?;
    let src = safe_child(&profile_dir(&profile).join("saves"), &name)?;
    if !src.is_dir() { return Err("Мир не найден".into()); }
    let out = safe_child(&backups_dir(&profile), &format!("{}-{}.zip", name, now_secs()))?;
    zip_world(&src, &out)?;
    Ok(out.to_string_lossy().to_string())
}

pub fn list_backups(profile: &str) -> Vec<String> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(backups_dir(profile)) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".zip") { out.push(n); }
        }
    }
    out.sort(); out.reverse(); out
}

fn modified_secs(p: &Path) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The world played last, by its level.dat: that is the one a mod update can break.
fn last_played_world(saves: &Path) -> Option<(String, PathBuf, u64)> {
    std::fs::read_dir(saves)
        .ok()?
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let played = modified_secs(&e.path().join("level.dat"));
            (played > 0).then(|| (e.file_name().to_string_lossy().into_owned(), e.path(), played))
        })
        .max_by_key(|w| w.2)
}

/// Which snapshots were made automatically, so rotation never removes a backup the player made.
pub(crate) fn rotate_auto(mut auto: Vec<String>, world: &str, keep: usize) -> (Vec<String>, Vec<String>) {
    let prefix = format!("{}-", world);
    let mut mine: Vec<String> = auto.iter().filter(|n| n.starts_with(&prefix)).cloned().collect();
    mine.sort();
    let drop: Vec<String> = mine.iter().take(mine.len().saturating_sub(keep)).cloned().collect();
    auto.retain(|n| !drop.contains(n));
    (auto, drop)
}

/// Before mods change, the last played world is zipped once per play session: a new snapshot is
/// made only when the world was played after the previous automatic one.
pub fn snapshot_before_update(profile: &str) -> Result<Option<String>, String> {
    let saves = profile_dir(profile).join("saves");
    let Some((name, src, played)) = last_played_world(&saves) else { return Ok(None) };
    let dir = backups_dir(profile);
    let record = dir.join(AUTO_FILE);
    let auto: Vec<String> = std::fs::read_to_string(&record).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let prefix = format!("{}-", name);
    let latest = auto
        .iter()
        .filter(|n| n.starts_with(&prefix))
        .filter_map(|n| n.strip_prefix(&prefix)?.strip_suffix(".zip")?.parse::<u64>().ok())
        .max();
    if latest.is_some_and(|at| at >= played) {
        return Ok(None);
    }
    let file = format!("{}-{}.zip", name, now_secs());
    let out = safe_child(&dir, &file)?;
    zip_world(&src, &out).map_err(|e| format!("Не удалось сохранить снимок мира «{}» перед обновлением: {}", name, e))?;
    let mut auto = auto;
    auto.push(file);
    let (auto, drop) = rotate_auto(auto, &name, AUTO_KEEP);
    for old in drop {
        if let Ok(p) = safe_child(&dir, &old) {
            let _ = std::fs::remove_file(p);
        }
    }
    write_json_atomic(&record, &auto)?;
    Ok(Some(out.to_string_lossy().into_owned()))
}


/// Mods are about to change in `profile`: the zip runs off the async pool, it can take seconds.
pub async fn snapshot_before_mod_update(profile: &str, kind: &str) -> Result<(), String> {
    if kind != "mod" && kind != "modpack" {
        return Ok(());
    }
    let p = profile.to_string();
    tauri::async_runtime::spawn_blocking(move || snapshot_before_update(&p)).await.map_err(|e| e.to_string())??;
    Ok(())
}

pub fn open_screenshots(profile: &str) {
    let p = profile_dir(profile).join("screenshots");
    std::fs::create_dir_all(&p).ok();
    open_path(&p.to_string_lossy());
}

#[cfg(test)]
mod tests {
    use super::rotate_auto;

    #[test]
    fn rotation_keeps_the_newest_automatic_snapshots_of_one_world() {
        let auto = vec!["W-1.zip".to_string(), "W-2.zip".into(), "W-3.zip".into(), "W-4.zip".into(), "Other-1.zip".into()];
        let (kept, dropped) = rotate_auto(auto, "W", 3);
        assert_eq!(dropped, vec!["W-1.zip".to_string()], "only the oldest snapshot of this world goes");
        assert!(kept.contains(&"Other-1.zip".to_string()), "another world's snapshots are not touched");
        assert_eq!(kept.len(), 4);
        let (_, none) = rotate_auto(vec!["W-1.zip".into()], "W", 3);
        assert!(none.is_empty(), "under the limit nothing is removed");
    }
}
