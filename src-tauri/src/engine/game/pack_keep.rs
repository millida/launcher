use crate::engine::*;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// A paid pack that loses its access leaves the disk, the player's own things
/// do not. Worlds, screenshots, their own resource and shader packs and game
/// settings are moved aside before the pack is removed and come back when the
/// same pack is installed again.
const SHIPPED_FILE: &str = "millida-pack-files.json";

const ALWAYS_KEEP: [&str; 9] = [
    "saves",
    "screenshots",
    "schematics",
    "resourcepacks",
    "shaderpacks",
    "options.txt",
    "optionsof.txt",
    "optionsshaders.txt",
    "servers.dat",
];

/// Folders whose entries are judged one by one: the pack may ship its own
/// resource pack there, and only the player's additions are theirs to keep.
const PER_ENTRY: [&str; 2] = ["resourcepacks", "shaderpacks"];

/// The paid content itself and what carries the launch signature never leaves
/// with the player's files, whatever the pack or the player put there.
const NEVER_KEEP: [&str; 12] = [
    "libraries",
    "mods",
    "natives",
    "assets",
    "minecraft.jar",
    "logs",
    "crash-reports",
    "millida-args.txt",
    "millida-settings.json",
    ".fabric",
    ".mixin.out",
    SHIPPED_FILE,
];

/// The slug names a folder that files are moved into and back out of, so an
/// unchecked value (`..`, an absolute path) would aim those moves anywhere.
fn keep_root(slug: &str) -> Result<PathBuf, String> {
    if !catalog_slug_ok(slug) {
        return Err("Некорректный адрес сборки".into());
    }
    safe_child(&data_dir().join("pack-keep"), slug)
}

fn names_in(dir: &Path) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<String> = rd.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
    out.sort();
    out
}

/// What the pack put into its folder at install time, so everything added
/// later can be told apart from it.
pub fn record_shipped(pdir: &Path) -> Result<(), String> {
    let mut shipped = names_in(pdir);
    for folder in PER_ENTRY {
        shipped.extend(names_in(&pdir.join(folder)).into_iter().map(|n| format!("{}/{}", folder, n)));
    }
    let body = serde_json::to_vec(&shipped).map_err(|e| e.to_string())?;
    std::fs::write(pdir.join(SHIPPED_FILE), body).map_err(|e| format!("Не удалось записать состав сборки: {}", e))
}

fn read_shipped(pdir: &Path) -> Option<HashSet<String>> {
    let raw = std::fs::read(pdir.join(SHIPPED_FILE)).ok()?;
    serde_json::from_slice::<Vec<String>>(&raw).ok().map(|v| v.into_iter().collect())
}

/// Paths inside the pack folder that belong to the player. Without a record of
/// what the pack shipped (installed before it was kept) only the well-known
/// player folders are kept.
pub fn player_entries(pdir: &Path) -> Vec<String> {
    let shipped = read_shipped(pdir);
    let mut out = Vec::new();
    for name in names_in(pdir) {
        if NEVER_KEEP.contains(&name.as_str()) || name == PACK_LAUNCH_FILE {
            continue;
        }
        if PER_ENTRY.contains(&name.as_str()) {
            for child in names_in(&pdir.join(&name)) {
                let rel = format!("{}/{}", name, child);
                if shipped.as_ref().is_none_or(|s| !s.contains(&rel)) {
                    out.push(rel);
                }
            }
            continue;
        }
        let known = ALWAYS_KEEP.contains(&name.as_str());
        let added = shipped.as_ref().is_some_and(|s| !s.contains(&name));
        if known || added {
            out.push(name);
        }
    }
    out
}

fn move_path(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    if from.is_dir() {
        copy_dir_all(from, to).map_err(|e| e.to_string())?;
        std::fs::remove_dir_all(from).map_err(|e| e.to_string())
    } else {
        std::fs::copy(from, to).map_err(|e| e.to_string())?;
        std::fs::remove_file(from).map_err(|e| e.to_string())
    }
}

fn free_target(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!("{} ({})", name, stamp))
}

/// Moves the player's files out of the pack folder. Any failure stops here and
/// the pack is not removed: losing a world is worse than a pack that stays on
/// disk but can no longer get a launch signature.
pub fn stash_player_files(profile: &str, slug: &str) -> Result<usize, String> {
    let pdir = profile_dir(profile);
    let root = keep_root(slug)?;
    let entries = player_entries(&pdir);
    for rel in &entries {
        let target = free_target(root.join(rel));
        move_path(&pdir.join(rel), &target).map_err(|e| format!("не удалось сохранить «{}»: {}", rel, e))?;
    }
    Ok(entries.len())
}

fn restore_into(from: &Path, to: &Path) {
    for name in names_in(from) {
        let src = from.join(&name);
        let dst = to.join(&name);
        if PER_ENTRY.contains(&name.as_str()) && src.is_dir() {
            restore_into(&src, &dst);
            let _ = std::fs::remove_dir(&src);
            continue;
        }
        if dst.exists() {
            continue;
        }
        if let Err(e) = move_path(&src, &dst) {
            eprintln!("[pack] не удалось вернуть «{}»: {}", name, e);
        }
    }
}

/// Puts the kept files back into a freshly installed pack. What the new
/// version ships wins a name clash, and the clashing copy stays in the keep
/// folder instead of being thrown away.
pub fn restore_player_files(pdir: &Path, slug: &str) {
    let Ok(root) = keep_root(slug) else { return };
    if !root.is_dir() {
        return;
    }
    restore_into(&root, pdir);
    let _ = std::fs::remove_dir(&root);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, b"x").unwrap();
    }

    /// layout -> kept. Keeping too little costs the player a world; keeping
    /// too much leaves the paid content on disk.
    #[test]
    fn only_the_players_own_files_leave_with_them() {
        let dir = std::env::temp_dir().join("millida-pack-keep-test");
        let _ = std::fs::remove_dir_all(&dir);
        for f in [
            "libraries/com/ijm/iku/a.jar",
            "mods/paid.jar",
            "minecraft.jar",
            "millida-args.txt",
            "millida-pack-launch.json",
            "resourcepacks/Arcania.zip",
            "config/arcania.json",
        ] {
            touch(&dir.join(f));
        }
        record_shipped(&dir).unwrap();
        for f in [
            "saves/Мир/level.dat",
            "screenshots/1.png",
            "resourcepacks/Faithful.zip",
            "shaderpacks/BSL.zip",
            "options.txt",
            "journeymap/data.bin",
            "logs/latest.log",
            "mods/stolen.jar",
        ] {
            touch(&dir.join(f));
        }

        let kept: HashSet<String> = player_entries(&dir).into_iter().collect();
        for want in ["saves", "screenshots", "resourcepacks/Faithful.zip", "shaderpacks/BSL.zip", "options.txt", "journeymap"] {
            assert!(kept.contains(want), "«{}» принадлежит игроку и обязан сохраниться", want);
        }
        for never in ["libraries", "mods", "minecraft.jar", "millida-args.txt", "millida-pack-launch.json", "resourcepacks/Arcania.zip", "config", "logs"] {
            assert!(!kept.contains(never), "«{}» — это сборка или ключ запуска, с игроком он уйти не может", never);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Installed before the record existed: the well-known player folders are
    /// still kept, anything unknown goes with the pack.
    #[test]
    fn a_pack_without_a_record_still_keeps_worlds() {
        let dir = std::env::temp_dir().join("millida-pack-keep-legacy");
        let _ = std::fs::remove_dir_all(&dir);
        for f in ["saves/w/level.dat", "resourcepacks/Own.zip", "mods/paid.jar", "config/x.json"] {
            touch(&dir.join(f));
        }
        let kept: HashSet<String> = player_entries(&dir).into_iter().collect();
        assert!(kept.contains("saves"), "миры сохраняются и у сборки, поставленной до этой версии");
        assert!(kept.contains("resourcepacks/Own.zip"), "свои ресурспаки тоже");
        assert!(!kept.contains("mods") && !kept.contains("config"), "без описи неизвестное уходит вместе со сборкой");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn keep_folder_stays_inside_pack_keep() {
        assert!(keep_root("lost-souls").is_ok());
        for bad in ["..", "../x", "/etc", "a/b", "", "A"] {
            assert!(keep_root(bad).is_err(), "{bad}");
        }
    }
}
