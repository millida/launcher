//! World manager: what `saves/` actually contains, and the operations a player
//! expects over it — rename, copy, export, import, restore from a backup.
//!
//! Every folder name arrives over IPC and is resolved through `safe_child`, so
//! nothing here can reach outside `saves/`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::engine::*;

use super::nbt::{read_gzip, write_gzip, Nbt};

const MAX_WORLD_NAME: usize = 64;
/// A world icon is 64x64 png; anything much larger is not the game's file.
const MAX_ICON_BYTES: u64 = 512 * 1024;

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub folder: String,
    pub name: String,
    pub last_played: u64,
    pub size_bytes: u64,
    /// data: URL of icon.png, empty when the world has none.
    pub icon: String,
    /// "survival" | "creative" | "adventure" | "spectator" | ""
    pub mode: String,
    pub hardcore: bool,
    pub cheats: bool,
    pub difficulty: String,
    pub version: String,
    pub seed: String,
    pub backups: u32,
    /// Set when level.dat could not be read: the folder is listed anyway, so a
    /// broken world can still be exported or deleted.
    pub unreadable: bool,
}

pub(crate) fn saves_dir(profile: &str) -> PathBuf {
    profile_dir(profile).join("saves")
}

fn world_dir(profile: &str, folder: &str) -> Result<PathBuf, String> {
    let name = safe_file_name(folder)?;
    let dir = safe_child(&saves_dir(profile), &name)?;
    if !dir.is_dir() {
        return Err("Мир не найден".into());
    }
    Ok(dir)
}

fn mode_name(id: i64) -> &'static str {
    match id {
        0 => "survival",
        1 => "creative",
        2 => "adventure",
        3 => "spectator",
        _ => "",
    }
}

fn difficulty_name(id: i64) -> &'static str {
    match id {
        0 => "peaceful",
        1 => "easy",
        2 => "normal",
        3 => "hard",
        _ => "",
    }
}

fn icon_data_url(dir: &Path) -> String {
    use base64::Engine as _;
    let path = dir.join("icon.png");
    let Ok(meta) = std::fs::metadata(&path) else { return String::new() };
    if !meta.is_file() || meta.len() > MAX_ICON_BYTES {
        return String::new();
    }
    let Ok(bytes) = std::fs::read(&path) else { return String::new() };
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn level_data(dir: &Path) -> Option<Nbt> {
    let bytes = std::fs::read(dir.join("level.dat")).ok()?;
    let (_, root) = read_gzip(&bytes)?;
    root.get("Data").cloned()
}

/// The seed moved into WorldGenSettings in 1.16; older worlds keep it at the
/// top level, and a hidden seed is better than a wrong one.
fn seed_of(data: &Nbt) -> String {
    data.get("WorldGenSettings")
        .and_then(|w| w.get("seed"))
        .and_then(Nbt::as_i64)
        .or_else(|| data.get("RandomSeed").and_then(Nbt::as_i64))
        .map(|s| s.to_string())
        .unwrap_or_default()
}

fn describe(profile: &str, dir: &Path, folder: String, backups: u32) -> WorldInfo {
    let size_bytes = dir_size(dir);
    let last_from_disk = dir
        .join("level.dat")
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let icon = icon_data_url(dir);
    let Some(data) = level_data(dir) else {
        return WorldInfo {
            folder: folder.clone(),
            name: folder,
            last_played: last_from_disk,
            size_bytes,
            icon,
            backups,
            unreadable: true,
            ..Default::default()
        };
    };
    let _ = profile;
    let last_played = data
        .get("LastPlayed")
        .and_then(Nbt::as_i64)
        .filter(|v| *v > 0)
        .map(|ms| (ms / 1000) as u64)
        .unwrap_or(last_from_disk);
    WorldInfo {
        name: data.get("LevelName").and_then(Nbt::as_str).unwrap_or(&folder).to_string(),
        folder,
        last_played,
        size_bytes,
        icon,
        mode: mode_name(data.get("GameType").and_then(Nbt::as_i64).unwrap_or(-1)).to_string(),
        hardcore: data.get("hardcore").and_then(Nbt::as_i64).unwrap_or(0) != 0,
        cheats: data.get("allowCommands").and_then(Nbt::as_i64).unwrap_or(0) != 0,
        difficulty: difficulty_name(data.get("Difficulty").and_then(Nbt::as_i64).unwrap_or(-1)).to_string(),
        version: data
            .get("Version")
            .and_then(|v| v.get("Name"))
            .and_then(Nbt::as_str)
            .unwrap_or_default()
            .to_string(),
        seed: seed_of(&data),
        backups,
        unreadable: false,
    }
}

fn backup_count(profile: &str, folder: &str) -> u32 {
    list_backups(profile)
        .iter()
        .filter(|b| b.starts_with(&format!("{}-", folder)))
        .count() as u32
}

pub fn world_details(profile: &str) -> Vec<WorldInfo> {
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(saves_dir(profile)) else { return out };
    for e in rd.flatten() {
        let dir = e.path();
        if !dir.is_dir() {
            continue;
        }
        let folder = e.file_name().to_string_lossy().to_string();
        if folder.starts_with('.') {
            continue;
        }
        let backups = backup_count(profile, &folder);
        out.push(describe(profile, &dir, folder, backups));
    }
    out.sort_by_key(|w| std::cmp::Reverse(w.last_played));
    out
}

/// The name the game shows lives inside level.dat, so renaming means rewriting
/// it. The previous file is kept as level.dat_old — the same fallback the game
/// itself writes and reads when the main one is unusable.
pub fn rename_world(profile: &str, folder: &str, new_name: &str) -> Result<WorldInfo, String> {
    let name: String = new_name.trim().chars().filter(|c| !c.is_control()).take(MAX_WORLD_NAME).collect();
    if name.is_empty() {
        return Err("Название мира не может быть пустым".into());
    }
    assert_world_idle(profile)?;
    let dir = world_dir(profile, folder)?;
    let path = dir.join("level.dat");
    let bytes = std::fs::read(&path).map_err(|_| "У мира нет level.dat — переименовать нечего".to_string())?;
    let (root_name, mut root) = read_gzip(&bytes).ok_or("level.dat не читается — мир повреждён")?;
    let Some(Nbt::Compound(_)) = root.get("Data") else {
        return Err("level.dat не похож на файл мира".into());
    };
    let mut data = root.get("Data").cloned().unwrap();
    data.set("LevelName", Nbt::Str(name.clone()));
    root.set("Data", data);
    let packed = write_gzip(&root_name, &root).ok_or("Не удалось собрать level.dat")?;
    // The old file is moved aside before the new one lands: an interrupted
    // write must never leave the world without any readable level.dat.
    let _ = std::fs::copy(&path, dir.join("level.dat_old"));
    write_bytes_atomic(&path, &packed)?;
    let backups = backup_count(profile, folder);
    Ok(describe(profile, &dir, folder.to_string(), backups))
}

fn assert_world_idle(profile: &str) -> Result<(), String> {
    if running_games().iter().any(|p| p == profile) {
        return Err("Сборка сейчас запущена — закрой игру и повтори".into());
    }
    Ok(())
}

fn unique_folder(saves: &Path, base: &str) -> String {
    let base = safe_file_name(base).unwrap_or_else(|_| "World".into());
    let mut name = base.clone();
    let mut i = 2;
    while saves.join(&name).exists() {
        name = format!("{}-{}", base, i);
        i += 1;
    }
    name
}

pub fn duplicate_world(profile: &str, folder: &str) -> Result<WorldInfo, String> {
    assert_world_idle(profile)?;
    let src = world_dir(profile, folder)?;
    let saves = saves_dir(profile);
    let dst_folder = unique_folder(&saves, &format!("{}-copy", folder));
    let dst = safe_child(&saves, &dst_folder)?;
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    if let Err(e) = copy_dir_all(&src, &dst) {
        let _ = std::fs::remove_dir_all(&dst);
        return Err(format!("Не удалось скопировать мир: {}", e));
    }
    // Session lock belongs to the original; a copied one confuses the game.
    let _ = std::fs::remove_file(dst.join("session.lock"));
    let copy = describe(profile, &dst, dst_folder.clone(), 0);
    let renamed = rename_world(profile, &dst_folder, &format!("{} (копия)", copy.name));
    Ok(renamed.unwrap_or(copy))
}

fn zip_dir(src: &Path, out: &Path) -> Result<(), String> {
    use std::io::Write;
    if let Some(p) = out.parent() {
        std::fs::create_dir_all(p).ok();
    }
    let f = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in walk(src) {
        let rel = match entry.strip_prefix(src) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if rel == "session.lock" {
            continue;
        }
        zip.start_file(rel, opts).map_err(|e| e.to_string())?;
        zip.write_all(&std::fs::read(&entry).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Saves the world as a zip wherever the player points the native dialog. The
/// destination never comes from the webview.
pub async fn export_world(profile: String, folder: String) -> Result<Option<String>, String> {
    let src = world_dir(&profile, &folder)?;
    let picked = save_file(
        dialog()
            .add_filter("Архив мира", &["zip"])
            .set_file_name(format!("{}.zip", folder))
            .set_title("Куда сохранить мир"),
    )
    .await;
    let Some(out) = picked else { return Ok(None) };
    let out2 = out.clone();
    tauri::async_runtime::spawn_blocking(move || zip_dir(&src, &out2))
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
    Ok(Some(out.to_string_lossy().to_string()))
}

/// Unpacks a world archive into `saves/`. The archive is untrusted input: paths
/// go through the shared unzip guard, and the result has to look like a world
/// before it is kept.
pub async fn import_world(profile: String) -> Result<WorldInfo, String> {
    assert_world_idle(&profile)?;
    let picked = pick_file(
        dialog()
            .add_filter("Архив мира", &["zip"])
            .set_title("Архив мира (.zip)"),
    )
    .await
    .ok_or("Отменено")?;
    let profile2 = profile.clone();
    tauri::async_runtime::spawn_blocking(move || import_world_zip(&profile2, &picked))
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))?
}

fn world_root(dir: &Path) -> Option<PathBuf> {
    if dir.join("level.dat").exists() {
        return Some(dir.to_path_buf());
    }
    let mut dirs = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir());
    let only = dirs.next()?;
    if dirs.next().is_some() {
        return None;
    }
    only.join("level.dat").exists().then_some(only)
}

pub(crate) fn import_world_zip(profile: &str, archive: &Path) -> Result<WorldInfo, String> {
    let tmp = data_dir().join("tmp").join("world-import");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    let cleanup = TempDir(tmp.clone());
    unzip_to(archive, &tmp).map_err(|e| format!("Не удалось распаковать архив: {}", e))?;
    let root = world_root(&tmp).ok_or("В архиве нет мира: level.dat не найден")?;
    let saves = saves_dir(profile);
    std::fs::create_dir_all(&saves).map_err(|e| e.to_string())?;
    let base = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|n| n != "world-import")
        .unwrap_or_else(|| {
            archive.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "World".into())
        });
    let folder = unique_folder(&saves, &base);
    let dst = safe_child(&saves, &folder)?;
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    if let Err(e) = copy_dir_all(&root, &dst) {
        let _ = std::fs::remove_dir_all(&dst);
        return Err(format!("Не удалось перенести мир: {}", e));
    }
    let _ = std::fs::remove_file(dst.join("session.lock"));
    drop(cleanup);
    Ok(describe(profile, &dst, folder, 0))
}

/// Removes the extracted copy on every exit, including the error paths.
struct TempDir(PathBuf);

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Restores a backup as a NEW world instead of overwriting the current one: the
/// backup is usually taken because something went wrong, and a restore that
/// destroys the only other copy leaves nothing to compare against.
pub fn restore_backup(profile: &str, file: &str) -> Result<WorldInfo, String> {
    assert_world_idle(profile)?;
    let name = safe_file_name(file)?;
    if !name.ends_with(".zip") {
        return Err("Это не файл бэкапа".into());
    }
    let path = safe_child(&profile_dir(profile).join("backups"), &name)?;
    if !path.is_file() {
        return Err("Бэкап не найден".into());
    }
    import_world_zip(profile, &path)
}

pub fn delete_backup(profile: &str, file: &str) -> Result<(), String> {
    let name = safe_file_name(file)?;
    if !name.ends_with(".zip") {
        return Err("Это не файл бэкапа".into());
    }
    let path = safe_child(&profile_dir(profile).join("backups"), &name)?;
    std::fs::remove_file(&path).map_err(|e| format!("Не удалось удалить бэкап: {}", e))
}

pub fn open_world_folder(profile: &str, folder: &str) -> Result<(), String> {
    let dir = world_dir(profile, folder)?;
    open_path(&dir.to_string_lossy());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-worlds-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn level_bytes(name: &str) -> Vec<u8> {
        let root = Nbt::Compound(vec![(
            "Data".into(),
            Nbt::Compound(vec![
                ("LevelName".into(), Nbt::Str(name.into())),
                ("GameType".into(), Nbt::Int(1)),
                ("hardcore".into(), Nbt::Byte(1)),
                ("allowCommands".into(), Nbt::Byte(1)),
                ("Difficulty".into(), Nbt::Byte(3)),
                ("LastPlayed".into(), Nbt::Long(1_700_000_000_000)),
                ("Version".into(), Nbt::Compound(vec![("Name".into(), Nbt::Str("1.21.4".into()))])),
                (
                    "WorldGenSettings".into(),
                    Nbt::Compound(vec![("seed".into(), Nbt::Long(-8_123_456_789))]),
                ),
            ]),
        )]);
        write_gzip("", &root).unwrap()
    }

    /// level.dat -> card. Every field here is one the world list shows, and a
    /// wrong game mode or a missing hardcore flag changes what the player
    /// believes about a save before they open it.
    #[test]
    fn level_dat_fills_the_world_card() {
        let dir = tmp("describe");
        std::fs::write(dir.join("level.dat"), level_bytes("Хардкор")).unwrap();
        let info = describe("p", &dir, "hardcore-run".into(), 2);
        assert_eq!(info.name, "Хардкор", "показывается имя из level.dat, а не имя папки");
        assert_eq!(info.folder, "hardcore-run");
        assert_eq!(info.mode, "creative");
        assert!(info.hardcore && info.cheats);
        assert_eq!(info.difficulty, "hard");
        assert_eq!(info.version, "1.21.4");
        assert_eq!(info.seed, "-8123456789", "сид 1.16+ лежит в WorldGenSettings");
        assert_eq!(info.last_played, 1_700_000_000, "LastPlayed в миллисекундах");
        assert_eq!(info.backups, 2);
        assert!(!info.unreadable);
    }

    /// A world whose level.dat is corrupt is still a folder the player wants to
    /// see — to export it or delete it.
    #[test]
    fn broken_world_is_listed_as_unreadable() {
        let dir = tmp("broken");
        std::fs::write(dir.join("level.dat"), b"not nbt at all").unwrap();
        let info = describe("p", &dir, "broken".into(), 0);
        assert!(info.unreadable, "битый мир должен остаться в списке, иначе его нельзя удалить из лаунчера");
        assert_eq!(info.name, "broken", "без level.dat остаётся имя папки");
    }

    #[test]
    fn old_worlds_keep_their_top_level_seed() {
        let root = Nbt::Compound(vec![(
            "Data".into(),
            Nbt::Compound(vec![("RandomSeed".into(), Nbt::Long(42))]),
        )]);
        let dir = tmp("oldseed");
        std::fs::write(dir.join("level.dat"), write_gzip("", &root).unwrap()).unwrap();
        assert_eq!(describe("p", &dir, "old".into(), 0).seed, "42");
    }
}
