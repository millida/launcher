// What to keep on the player's side when a catalog modpack updates: their worlds, settings, server list, own mods.
// Works only in the folder of this modpack. Downloads and runs nothing.
use crate::engine::*;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

/// A paid pack that loses its access leaves the disk, the player's own things
/// do not. Worlds, screenshots, their own resource and shader packs and game
/// settings are moved aside before the pack is removed and come back when the
/// same pack is installed again.
const SHIPPED_FILE: &str = "millida-pack-files.json";

/// What each file the pack shipped looked like at install time. An update needs
/// three versions of a file to judge it: what the old version shipped, what the
/// player has now, what the next version ships. Only the author's edits reach
/// the player; whatever the author left alone stays as the player made it.
const SHIPPED_HASHES_FILE: &str = "millida-pack-hashes.json";

/// Larger files are pack content (encrypted blobs, bundled jars), not settings
/// or progress, and hashing them on every update would cost seconds.
const TRACKED_FILE_MAX_BYTES: u64 = 32 << 20;

type Hashes = BTreeMap<String, String>;

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
const NEVER_KEEP: [&str; 13] = [
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
    SHIPPED_HASHES_FILE,
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
    std::fs::write(pdir.join(SHIPPED_FILE), body).map_err(|e| format!("Не удалось записать состав сборки: {}", e))?;
    let hashes = serde_json::to_vec(&hash_tracked(pdir, &names_in(pdir))?).map_err(|e| e.to_string())?;
    std::fs::write(pdir.join(SHIPPED_HASHES_FILE), hashes).map_err(|e| format!("Не удалось записать состав сборки: {}", e))
}

/// Entries whose files are judged one by one on an update: settings and
/// progress the pack ships. Worlds and screenshots move whole, resource packs
/// entry by entry, and the paid content never leaves with the player.
fn tracked_entry(pdir: &Path, name: &str) -> bool {
    let whole_folder = ALWAYS_KEEP.contains(&name) && pdir.join(name).is_dir();
    !(NEVER_KEEP.contains(&name)
        || PER_ENTRY.contains(&name)
        || whole_folder
        || name == PACK_LAUNCH_FILE
        || is_launcher_service_file(name))
}

fn tracked_files(pdir: &Path, entries: &[String]) -> Vec<String> {
    fn walk(root: &Path, rel: &str, out: &mut Vec<String>) {
        let Ok(meta) = std::fs::symlink_metadata(root.join(rel)) else { return };
        if meta.is_dir() {
            for name in names_in(&root.join(rel)) {
                walk(root, &format!("{}/{}", rel, name), out);
            }
        } else if meta.is_file() && meta.len() <= TRACKED_FILE_MAX_BYTES {
            out.push(rel.to_string());
        }
    }
    let mut out = Vec::new();
    for name in entries.iter().filter(|n| tracked_entry(pdir, n)) {
        walk(pdir, name, &mut out);
    }
    out
}

fn hash_tracked(pdir: &Path, entries: &[String]) -> Result<Hashes, String> {
    tracked_files(pdir, entries)
        .into_iter()
        .map(|rel| sha256_file(&pdir.join(&rel)).map(|h| (rel, h)))
        .collect()
}

fn read_hashes(pdir: &Path) -> Option<Hashes> {
    let raw = std::fs::read(pdir.join(SHIPPED_HASHES_FILE)).ok()?;
    serde_json::from_slice(&raw).ok()
}

#[derive(Debug, PartialEq)]
enum Edit {
    /// The next version's copy stays.
    Leave,
    /// The player's copy replaces the next version's.
    Carry,
    /// The author changed what the player had changed too: the author wins and
    /// the player's copy waits in the keep folder.
    Shelve,
}

/// One file across three versions -> who wins. `was` is what the installed
/// version shipped, `None` with `recorded` set means the game or the player made
/// the file. Without a record the shipped copy is unknown, so only files the
/// next version does not ship can be told to be the player's.
fn edit_verdict(theirs: &str, was: Option<&str>, now: Option<&str>, recorded: bool) -> Edit {
    if !recorded {
        return if now.is_none() { Edit::Carry } else { Edit::Leave };
    }
    match (was, now) {
        (Some(was), _) if was == theirs => Edit::Leave,
        (Some(was), Some(now)) if was == now => Edit::Carry,
        (Some(_), _) => Edit::Shelve,
        (None, None) => Edit::Carry,
        (None, Some(now)) if now == theirs => Edit::Leave,
        (None, Some(_)) => Edit::Shelve,
    }
}

/// Settings and progress inside the folders the pack ships (`config/` and the
/// like) and the shipped game settings. Before this an update replaced those
/// folders whole, and every release of the pack wiped quest maps and
/// skill progress mods keep in `config/`.
fn carry_edited(from: &Path, to: &Path, keep: &Path, old: Option<&Hashes>) -> Result<usize, String> {
    let (Some(shipped), Some(now)) = (read_shipped(from), read_hashes(to)) else { return Ok(0) };
    let entries: Vec<String> = names_in(from)
        .into_iter()
        .filter(|name| shipped.contains(name))
        .filter(|name| !player_made(name) || old.is_some_and(|o| o.contains_key(name)))
        .collect();
    let mut carried = 0;
    for rel in tracked_files(from, &entries) {
        // A file too large to be tracked is still the next version's when it is on disk.
        let next = now.get(&rel).map(String::as_str).or_else(|| to.join(&rel).exists().then_some(""));
        let was = old.and_then(|o| o.get(&rel)).map(String::as_str);
        let theirs = match old {
            Some(_) => sha256_file(&from.join(&rel))?,
            None => String::new(),
        };
        let res = match edit_verdict(&theirs, was, next, old.is_some()) {
            Edit::Leave => continue,
            Edit::Carry => copy_path(&from.join(&rel), &to.join(&rel)),
            Edit::Shelve => copy_path(&from.join(&rel), &free_target(keep.join(&rel))),
        };
        res.map_err(|e| format!("не удалось перенести «{}»: {}", rel, e))?;
        carried += 1;
    }
    Ok(carried)
}

pub(crate) fn shipped_recorded_at(pdir: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(pdir.join(SHIPPED_FILE)).and_then(|m| m.modified()).ok()
}

fn read_shipped(pdir: &Path) -> Option<HashSet<String>> {
    let raw = std::fs::read(pdir.join(SHIPPED_FILE)).ok()?;
    serde_json::from_slice::<Vec<String>>(&raw).ok().map(|v| v.into_iter().collect())
}

/// Paths inside the pack folder that belong to the player. Without a record of
/// what the pack shipped (installed before it was kept) only the well-known
/// player folders are kept. Launcher service files are never the player's: they
/// describe the mods of the version they were written for, and «Починить» would
/// download that version's mods into the next one.
pub fn player_entries(pdir: &Path) -> Vec<String> {
    let shipped = read_shipped(pdir);
    let mut out = Vec::new();
    for name in names_in(pdir) {
        if NEVER_KEEP.contains(&name.as_str()) || name == PACK_LAUNCH_FILE || is_launcher_service_file(&name) {
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
        // Move by copying and deleting the original: only when a plain rename failed (different disk).
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
    stash_into(&profile_dir(profile), &keep_root(slug)?)
}

/// A pack that stays must stay whole: what was already moved aside goes back
/// when a later entry fails, or the build would be left without those worlds.
fn stash_into(pdir: &Path, root: &Path) -> Result<usize, String> {
    let entries = player_entries(pdir);
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for rel in &entries {
        let (home, target) = (pdir.join(rel), free_target(root.join(rel)));
        if let Err(e) = move_path(&home, &target) {
            for (home, target) in moved.iter().rev() {
                if let Err(back) = move_path(target, home) {
                    eprintln!("[pack] «{}» остался в {}: {}", home.display(), target.display(), back);
                }
            }
            return Err(format!("не удалось сохранить «{}»: {}", rel, e));
        }
        moved.push((home, target));
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

/// What the player made or chose in the game: worlds, screenshots, schematics,
/// game settings and the server list. On an update their copy beats the one the
/// next version ships.
fn player_made(rel: &str) -> bool {
    ALWAYS_KEEP.contains(&rel) && !PER_ENTRY.contains(&rel)
}

/// Takes out of a pack's unpacked overrides whatever the player already has of
/// their own in the build, so copying the rest over the build leaves their
/// settings, server list and worlds as they were.
pub(crate) fn withhold_player_made(overrides: &Path, pdir: &Path) {
    for rel in ALWAYS_KEEP.into_iter().filter(|rel| player_made(rel)) {
        let (shipped, theirs) = (overrides.join(rel), pdir.join(rel));
        if !shipped.is_dir() {
            if theirs.exists() {
                // Removes the file from the unpacked modpack, not from the player: the player already has one and it matters more.
                let _ = std::fs::remove_file(&shipped);
            }
            continue;
        }
        for name in names_in(&shipped) {
            if !theirs.join(&name).exists() {
                continue;
            }
            let entry = shipped.join(&name);
            if entry.is_dir() {
                // The same for a folder: deletes the copy from the unpacked modpack archive, not the player's folder.
                let _ = std::fs::remove_dir_all(&entry);
            } else {
                let _ = std::fs::remove_file(&entry);
            }
        }
    }
}

/// Copies the player's files from the installed version of a pack into the
/// next version, unpacked beside it. Copies, not moves: until the next version
/// takes the old one's place, the old one stays whole, so a failure anywhere
/// before that leaves the player exactly what they had.
///
/// The player's own things win a clash, folders entry by entry, so a world the
/// next version adds still arrives. Everything else the player or the game
/// added yields to what the next version ships, since a repaired config must
/// not be put back to the broken one, and the player's copy goes to the keep
/// folder instead of the bin. Files the pack itself shipped are judged one by
/// one in `carry_edited`: the player's edit survives unless the author changed
/// the same file.
pub fn carry_player_files(from: &Path, to: &Path, slug: &str) -> Result<usize, String> {
    carry_into(from, to, &keep_root(slug)?)
}

fn carry_into(from: &Path, to: &Path, keep: &Path) -> Result<usize, String> {
    let old = read_hashes(from);
    let edited = carry_edited(from, to, keep, old.as_ref())?;
    let entries: Vec<String> = player_entries(from)
        .into_iter()
        .filter(|rel| !old.as_ref().is_some_and(|o| o.contains_key(rel)))
        .collect();
    for rel in &entries {
        let src = from.join(rel);
        let dst = to.join(rel);
        let real_dir = std::fs::symlink_metadata(&src).is_ok_and(|m| m.is_dir());
        let res = if player_made(rel) && real_dir {
            replace_each(&src, &dst)
        } else if player_made(rel) {
            replace_path(&src, &dst)
        } else if dst.exists() {
            copy_path(&src, &free_target(keep.join(rel)))
        } else {
            copy_path(&src, &dst)
        };
        res.map_err(|e| format!("не удалось перенести «{}»: {}", rel, e))?;
    }
    Ok(entries.len() + edited)
}

/// A link is refused rather than skipped: the new version would silently come
/// without the world behind it, and copying through it could pull in any
/// folder on the disk.
fn copy_path(from: &Path, to: &Path) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        return Err(std::io::Error::other(
            "это ссылка на другую папку — перенеси её содержимое в сборку вручную и обнови снова",
        ));
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if meta.is_dir() {
        std::fs::create_dir_all(to)?;
        copy_dir_all(from, to)
    } else {
        copy_replacing(from, to).map(|_| ())
    }
}

/// The player's entry replaces the version's one whole: a world merged file by
/// file with another world is neither of them.
fn replace_path(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Ok(meta) = std::fs::symlink_metadata(to) {
        if meta.is_dir() {
            // Replaces the old version entry with the one the player picked. The path is inside this modpack folder.
            std::fs::remove_dir_all(to)?;
        } else if from.is_dir() {
            std::fs::remove_file(to)?;
        }
    }
    copy_path(from, to)
}

fn replace_each(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.is_file() {
        std::fs::remove_file(to)?;
    }
    std::fs::create_dir_all(to)?;
    for name in names_in(from) {
        replace_path(&from.join(&name), &to.join(&name))?;
    }
    Ok(())
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
            "millida-content.json",
            "millida-local-meta.json",
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
        for service in ["millida-content.json", "millida-local-meta.json"] {
            assert!(
                !kept.contains(service),
                "«{}» появился после установки, но это запись лаунчера о модах этой версии: в другой версии «Починить» скачал бы по ней старые моды",
                service
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Installed version and next version -> what the player finds after the
    /// update. Keeping too little costs a world or the player's settings;
    /// keeping too much puts the broken version's config back over the repaired
    /// one.
    #[test]
    fn an_update_brings_the_players_files_and_keeps_the_new_version() {
        let base = std::env::temp_dir().join(format!("millida-pack-carry-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (old, new, keep) = (base.join("old"), base.join("new"), base.join("keep"));
        fn put(root: &Path, files: &[(&str, &str)]) {
            for (rel, body) in files {
                let p = root.join(rel);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, body).unwrap();
            }
        }
        put(&old, &[
            ("mods/a.jar", "old"),
            ("config/a.toml", "broken"),
            ("options.txt", "pack"),
            ("resourcepacks/Pack.zip", "old"),
            ("saves/Island/level.dat", "pack"),
        ]);
        record_shipped(&old).unwrap();
        put(&old, &[
            ("options.txt", "player"),
            ("saves/Island/level.dat", "played"),
            ("saves/Mine/level.dat", "player"),
            ("screenshots/1.png", "player"),
            ("resourcepacks/Faithful.zip", "player"),
            ("journeymap/data.bin", "player"),
            ("kubejs/a.js", "player"),
            ("millida-content.json", "old record"),
            ("logs/latest.log", "old"),
        ]);
        put(&new, &[
            ("mods/a.jar", "new"),
            ("config/a.toml", "fixed"),
            ("options.txt", "pack"),
            ("resourcepacks/Pack.zip", "new"),
            ("saves/Island/level.dat", "pack"),
            ("saves/Tutorial/level.dat", "pack"),
            ("kubejs/a.js", "new"),
        ]);
        record_shipped(&new).unwrap();

        carry_into(&old, &new, &keep).expect("перенос обычных файлов игрока не должен падать");

        let cases: &[(&str, Option<&str>, &str)] = &[
            ("options.txt", Some("player"), "настройки игры принадлежат игроку, даже если новая версия везёт свои"),
            ("saves/Island/level.dat", Some("played"), "сыгранный мир не заменяется чистой копией из сборки"),
            ("saves/Mine/level.dat", Some("player"), "свой мир игрока переезжает"),
            ("saves/Tutorial/level.dat", Some("pack"), "мир, который принесла новая версия, остаётся рядом с мирами игрока"),
            ("screenshots/1.png", Some("player"), "скриншоты переезжают"),
            ("resourcepacks/Faithful.zip", Some("player"), "свой ресурспак игрока переезжает"),
            ("resourcepacks/Pack.zip", Some("new"), "ресурспак самой сборки берётся из новой версии"),
            ("journeymap/data.bin", Some("player"), "добавленное игроком переезжает, если новой версии там нечего положить"),
            ("kubejs/a.js", Some("new"), "то, что новая версия везёт сама, не перетирается старой копией"),
            ("config/a.toml", Some("fixed"), "починенный конфиг новой версии не откатывается на сломанный"),
            ("mods/a.jar", Some("new"), "моды берутся только из новой версии"),
            ("millida-content.json", None, "запись о модах старой версии не едет в новую"),
            ("logs/latest.log", None, "логи старой версии не переезжают"),
        ];
        for (rel, want, why) in cases {
            let got = std::fs::read_to_string(new.join(rel)).ok();
            assert_eq!(got.as_deref(), *want, "«{rel}»: {why}");
        }
        assert_eq!(
            std::fs::read_to_string(old.join("saves/Island/level.dat")).ok().as_deref(),
            Some("played"),
            "до подмены старая версия обязана остаться целой: при сбое игрок играет в то, что было"
        );
        assert_eq!(
            std::fs::read_to_string(keep.join("kubejs/a.js")).ok().as_deref(),
            Some("player"),
            "копия игрока, уступившая новой версии, откладывается, а не выбрасывается"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// (player's copy, what the installed version shipped, what the next one
    /// ships, record present) -> who wins.
    #[test]
    fn a_shipped_file_follows_whoever_changed_it() {
        type Case = (&'static str, Option<&'static str>, Option<&'static str>, bool, Edit, &'static str);
        let cases: &[Case] = &[
            ("a", Some("a"), Some("b"), true, Edit::Leave, "автор поменял, игрок не трогал — у игрока новая версия автора"),
            ("p", Some("a"), Some("a"), true, Edit::Carry, "игрок поменял, автор не трогал — правка игрока переживает обновление"),
            ("p", Some("a"), Some("b"), true, Edit::Shelve, "поменяли оба — побеждает автор, копия игрока откладывается"),
            ("p", Some("a"), None, true, Edit::Shelve, "автор убрал файл, который игрок менял, — копия откладывается, а не теряется"),
            ("a", Some("a"), None, true, Edit::Leave, "автор убрал нетронутый файл — он уходит"),
            ("p", None, None, true, Edit::Carry, "прогресс, который игра записала в config, переезжает"),
            ("p", None, Some("p"), true, Edit::Leave, "автор начал возить тот же файл — копировать нечего"),
            ("p", None, Some("b"), true, Edit::Shelve, "автор начал возить свой файл на месте файла игрока — побеждает автор"),
            ("", None, None, false, Edit::Carry, "без описи файл, которого нет в новой версии, считается игрока"),
            ("", None, Some("b"), false, Edit::Leave, "без описи нельзя понять, чья правка, — остаётся версия автора"),
        ];
        for (theirs, was, now, recorded, want, why) in cases {
            assert_eq!(edit_verdict(theirs, *was, *now, *recorded), *want, "{why}");
        }
    }

    /// Arcania keeps quest map and skill progress in `config/`, and every release
    /// used to replace the folder whole: the map reset on each update.
    #[test]
    fn progress_in_config_survives_an_update_and_the_authors_edits_still_arrive() {
        let base = std::env::temp_dir().join(format!("millida-pack-edited-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (old, new, keep) = (base.join("old"), base.join("new"), base.join("keep"));
        fn put(root: &Path, files: &[(&str, &str)]) {
            for (rel, body) in files {
                let p = root.join(rel);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, body).unwrap();
            }
        }
        put(&old, &[
            ("config/quest_map.toml", "pack"),
            ("config/skills/abilities.json", "pack"),
            ("config/balance.toml", "v1"),
            ("config/tweak.toml", "v1"),
            ("options.txt", "author v1"),
            ("servers.dat", "pack"),
        ]);
        record_shipped(&old).unwrap();
        put(&old, &[
            ("config/quest_map.toml", "player progress"),
            ("config/skills/abilities.json", "player skills"),
            ("config/quest_tracked.txt", "made by the game"),
            ("config/tweak.toml", "player"),
            ("options.txt", "player keys"),
            ("servers.dat", "player servers"),
        ]);
        put(&new, &[
            ("config/quest_map.toml", "pack"),
            ("config/skills/abilities.json", "pack"),
            ("config/balance.toml", "v2"),
            ("config/tweak.toml", "v2"),
            ("options.txt", "author v2"),
            ("servers.dat", "pack"),
        ]);
        record_shipped(&new).unwrap();

        carry_into(&old, &new, &keep).expect("перенос не должен падать");

        let cases: &[(&str, &str, &str)] = &[
            ("config/quest_map.toml", "player progress", "прогресс карты квестов не сбрасывается обновлением"),
            ("config/skills/abilities.json", "player skills", "прогресс навыков во вложенной папке тоже"),
            ("config/quest_tracked.txt", "made by the game", "файл, записанный игрой, переезжает"),
            ("config/balance.toml", "v2", "правка автора доезжает до игрока"),
            ("config/tweak.toml", "v2", "поменяли оба — побеждает автор"),
            ("options.txt", "author v2", "автор обновил options.txt — он обновился у всех"),
            ("servers.dat", "player servers", "автор не трогал servers.dat — у игрока остаётся свой"),
        ];
        for (rel, want, why) in cases {
            assert_eq!(std::fs::read_to_string(new.join(rel)).ok().as_deref(), Some(*want), "«{rel}»: {why}");
        }
        for (rel, want) in [("config/tweak.toml", "player"), ("options.txt", "player keys")] {
            assert_eq!(std::fs::read_to_string(keep.join(rel)).ok().as_deref(), Some(want), "уступившая копия игрока «{rel}» откладывается");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Installed before the hashes were recorded: what the game wrote into the
    /// pack's folders and the next version does not ship still moves over.
    #[test]
    fn a_pack_without_hashes_still_keeps_what_the_game_wrote() {
        let base = std::env::temp_dir().join(format!("millida-pack-legacy-edit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (old, new, keep) = (base.join("old"), base.join("new"), base.join("keep"));
        for (root, rel, body) in [(&old, "config/a.toml", "pack"), (&new, "config/a.toml", "fixed")] {
            std::fs::create_dir_all(root.join("config")).unwrap();
            std::fs::write(root.join(rel), body).unwrap();
        }
        record_shipped(&old).unwrap();
        std::fs::remove_file(old.join(SHIPPED_HASHES_FILE)).unwrap();
        std::fs::write(old.join("config/a.toml"), "player").unwrap();
        std::fs::write(old.join("config/progress.json"), "player").unwrap();
        record_shipped(&new).unwrap();

        carry_into(&old, &new, &keep).unwrap();

        assert_eq!(std::fs::read_to_string(new.join("config/progress.json")).ok().as_deref(), Some("player"), "записанное игрой переезжает и без описи");
        assert_eq!(std::fs::read_to_string(new.join("config/a.toml")).ok().as_deref(), Some("fixed"), "без описи файл автора остаётся из новой версии");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A pack that could not be cleared stays on disk, and it used to stay
    /// without the worlds that had already been moved aside.
    #[test]
    fn a_failed_stash_puts_back_what_it_already_moved() {
        let base = std::env::temp_dir().join(format!("millida-pack-stash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (pdir, keep) = (base.join("build"), base.join("keep"));
        let mine = ["options.txt", "resourcepacks/Own.zip", "saves/Мир/level.dat"];
        for f in mine {
            touch(&pdir.join(f));
        }
        // A file where the keep folder needs a directory: the second entry fails
        // after the first one has already been moved.
        touch(&keep.join("resourcepacks"));

        assert!(stash_into(&pdir, &keep).is_err(), "перенос, оборвавшийся на середине, обязан сказать об ошибке");
        for f in mine {
            assert!(pdir.join(f).exists(), "«{f}» обязан остаться в сборке, раз сборка не удалена");
        }
        assert!(!keep.join("options.txt").exists(), "уже перенесённое возвращается, а не остаётся в стороне");

        std::fs::remove_file(keep.join("resourcepacks")).unwrap();
        assert_eq!(stash_into(&pdir, &keep), Ok(3), "без помехи перенос забирает всё своё");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A Modrinth pack ships its settings and sometimes a world as overrides,
    /// and an update copied them over whatever the player had.
    #[test]
    fn an_update_does_not_overwrite_what_the_player_made() {
        let base = std::env::temp_dir().join(format!("millida-pack-withhold-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let (ov, pdir) = (base.join("overrides"), base.join("build"));
        for f in ["options.txt", "servers.dat", "saves/Island/level.dat", "saves/Tutorial/level.dat", "config/a.toml"] {
            touch(&ov.join(f));
        }
        for f in ["options.txt", "saves/Island/level.dat", "config/a.toml"] {
            touch(&pdir.join(f));
        }

        withhold_player_made(&ov, &pdir);

        let cases: &[(&str, bool, &str)] = &[
            ("options.txt", false, "настройки игры у игрока уже свои"),
            ("saves/Island", false, "сыгранный мир не заменяется чистой копией из сборки"),
            ("saves/Tutorial/level.dat", true, "мир, которого у игрока нет, приезжает"),
            ("servers.dat", true, "списка серверов у игрока ещё не было"),
            ("config/a.toml", true, "конфиги модов берутся из новой версии"),
        ];
        for (rel, stays, why) in cases {
            assert_eq!(ov.join(rel).exists(), *stays, "«{rel}»: {why}");
        }
        let _ = std::fs::remove_dir_all(&base);
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
