// Data packs of one world: the game reads only saves/<world>/datapacks, so a pack in the build's datapacks/ does nothing until it is copied here.
// Switched-off packs wait in saves/<world>/datapacks-off, which the game never scans. Only paths inside the world folder; no network.
use crate::engine::*;
use std::path::{Path, PathBuf};

const ON_DIR: &str = "datapacks";
const OFF_DIR: &str = "datapacks-off";

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldPack {
    pub name: String,
    pub enabled: bool,
    pub size: u64,
    pub folder: bool,
}

fn world_root(profile: &str, world: &str) -> Result<PathBuf, String> {
    let name = safe_file_name(world)?;
    let dir = safe_child(&profile_dir(profile).join("saves"), &name)?;
    if !dir.is_dir() {
        return Err("Мир не найден".into());
    }
    Ok(dir)
}

/// A pack is a zip or a folder with pack.mcmeta; anything else the game skips too.
fn is_pack(path: &Path) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(m) if m.is_file() => path.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")),
        Ok(m) if m.is_dir() => path.join("pack.mcmeta").is_file(),
        _ => false,
    }
}

fn packs_in(dir: &Path, enabled: bool, out: &mut Vec<WorldPack>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !is_pack(&p) {
            continue;
        }
        let folder = p.is_dir();
        out.push(WorldPack {
            name: e.file_name().to_string_lossy().to_string(),
            enabled,
            size: if folder { dir_size(&p) } else { e.metadata().map(|m| m.len()).unwrap_or(0) },
            folder,
        });
    }
}

pub fn world_datapacks(profile: &str, world: &str) -> Result<Vec<WorldPack>, String> {
    let root = world_root(profile, world)?;
    let mut out = vec![];
    packs_in(&root.join(ON_DIR), true, &mut out);
    packs_in(&root.join(OFF_DIR), false, &mut out);
    out.sort_by_key(|p| p.name.to_lowercase());
    Ok(out)
}

fn busy(e: std::io::Error) -> String {
    format!("Файл занят другой программой — закрой игру и повтори: {}", e)
}

pub fn set_world_datapack(profile: &str, world: &str, name: &str, enable: bool) -> Result<(), String> {
    assert_not_running(profile, "переключи ещё раз")?;
    let root = world_root(profile, world)?;
    let file = safe_file_name(name)?;
    let (from_dir, to_dir) = if enable { (OFF_DIR, ON_DIR) } else { (ON_DIR, OFF_DIR) };
    let from = safe_child(&root.join(from_dir), &file)?;
    let to = safe_child(&root.join(to_dir), &file)?;
    if !from.exists() {
        return Ok(());
    }
    if to.exists() {
        return Err("В мире уже есть дата-пак с таким именем — удали лишний".into());
    }
    std::fs::create_dir_all(root.join(to_dir)).map_err(busy)?;
    std::fs::rename(&from, &to).map_err(busy)
}

pub fn delete_world_datapack(profile: &str, world: &str, name: &str) -> Result<(), String> {
    assert_not_running(profile, "удали ещё раз")?;
    let root = world_root(profile, world)?;
    let file = safe_file_name(name)?;
    for dir in [ON_DIR, OFF_DIR] {
        let p = safe_child(&root.join(dir), &file)?;
        let Ok(meta) = std::fs::symlink_metadata(&p) else { continue };
        if meta.is_dir() {
            // The player removes this data pack folder from the world's own datapacks.
            std::fs::remove_dir_all(&p).map_err(busy)?;
        } else {
            // The player removes this data pack file from the world's own datapacks.
            std::fs::remove_file(&p).map_err(busy)?;
        }
    }
    Ok(())
}

/// Copies a pack the build holds (installed from the catalogue) into one world.
/// A copy, not a move: other worlds of the build may want it too.
pub fn add_datapack_to_world(profile: &str, world: &str, name: &str) -> Result<(), String> {
    let root = world_root(profile, world)?;
    let file = safe_file_name(name)?;
    let src = safe_child(&profile_dir(profile).join(content_dir("datapack")), &file)?;
    if !is_pack(&src) {
        return Err("Дата-пак не найден в сборке — добавь его ещё раз из каталога".into());
    }
    let dst = safe_child(&root.join(ON_DIR), &file)?;
    if dst.exists() || safe_child(&root.join(OFF_DIR), &file)?.exists() {
        return Err("Этот дата-пак уже есть в мире".into());
    }
    std::fs::create_dir_all(root.join(ON_DIR)).map_err(busy)?;
    if src.is_dir() {
        copy_dir_all(&src, &dst).map_err(busy)
    } else {
        std::fs::copy(&src, &dst).map(|_| ()).map_err(busy)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (entry in datapacks/) -> does the game load it as a pack.
    #[test]
    fn only_real_packs_are_listed() {
        let dir = std::env::temp_dir().join(format!("millida-world-packs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("folder-pack")).unwrap();
        std::fs::write(dir.join("folder-pack/pack.mcmeta"), b"{}").unwrap();
        std::fs::create_dir_all(dir.join("loose-folder")).unwrap();
        std::fs::write(dir.join("zipped.zip"), b"PK").unwrap();
        std::fs::write(dir.join("readme.txt"), b"x").unwrap();
        let cases: [(&str, bool, &str); 4] = [
            ("folder-pack", true, "a folder with pack.mcmeta is a pack"),
            ("loose-folder", false, "a folder without pack.mcmeta is ignored by the game"),
            ("zipped.zip", true, "a zip is a pack"),
            ("readme.txt", false, "other files are not packs"),
        ];
        for (name, want, why) in cases {
            assert_eq!(is_pack(&dir.join(name)), want, "{}: {}", name, why);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
