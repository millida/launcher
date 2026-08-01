use std::path::PathBuf;

/// Inside Flatpak /app is read-only: self-update is handled by `flatpak update`
/// and Java comes from the bundled SDK extension instead of Adoptium.
pub fn is_flatpak() -> bool {
    std::env::var_os("FLATPAK_ID").is_some() || std::path::Path::new("/.flatpak-info").exists()
}

pub fn data_dir() -> PathBuf {
    dirs::data_dir().unwrap_or_else(|| PathBuf::from(".")).join("net.millida.launcher")
}

fn configured_root() -> Option<PathBuf> {
    let txt = std::fs::read_to_string(data_dir().join("game-root.txt")).ok()?;
    let trimmed = txt.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

/// Returns the configured directory even when its drive is offline: silently
/// falling back to the default would look like every profile disappeared.
pub fn game_root() -> PathBuf {
    configured_root().unwrap_or_else(|| data_dir().join("minecraft"))
}

/// For callers where an unavailable drive must surface as an error rather than
/// as empty data.
pub fn game_root_ready() -> Result<PathBuf, String> {
    let p = game_root();
    std::fs::create_dir_all(&p)
        .map_err(|e| format!("Папка игры недоступна: {} ({}). Проверь диск или выбери другую папку в настройках.", p.display(), e))?;
    Ok(p)
}

/// Everything else under the game root is regenerated on demand.
const ROOT_CONTENT: [&str; 6] = ["profiles", "versions", "libraries", "assets", "runtime", "natives"];

/// Rename first (instant within one volume), copy-then-delete across volumes.
/// Entries already present in the destination are left untouched.
pub fn move_game_data(from: &std::path::Path, to: &std::path::Path) -> Result<usize, String> {
    if from == to || !from.exists() {
        return Ok(0);
    }
    let mut moved = 0;
    for name in ROOT_CONTENT {
        let src = from.join(name);
        if !src.exists() {
            continue;
        }
        let dst = to.join(name);
        if dst.exists() {
            continue;
        }
        if std::fs::rename(&src, &dst).is_ok() {
            moved += 1;
            continue;
        }
        std::fs::create_dir_all(&dst).map_err(|e| format!("{}: {}", name, e))?;
        crate::engine::copy_dir_all(&src, &dst).map_err(|e| format!("{}: {}", name, e))?;
        let _ = std::fs::remove_dir_all(&src);
        moved += 1;
    }
    Ok(moved)
}

pub fn set_game_root(path: String, move_data: bool) -> Result<String, String> {
    let marker = data_dir().join("game-root.txt");
    std::fs::create_dir_all(data_dir()).map_err(|e| e.to_string())?;
    let old = game_root();
    if path.trim().is_empty() {
        let default = data_dir().join("minecraft");
        if move_data {
            std::fs::create_dir_all(&default).map_err(|e| e.to_string())?;
            move_game_data(&old, &default)?;
        }
        let _ = std::fs::remove_file(&marker);
        return Ok(game_root().to_string_lossy().to_string());
    }
    let p = PathBuf::from(path.trim());
    std::fs::create_dir_all(&p).map_err(|e| format!("Папка недоступна: {}", e))?;
    let probe = p.join(".millida-write-test");
    std::fs::write(&probe, b"ok").map_err(|e| format!("Нет прав на запись: {}", e))?;
    let _ = std::fs::remove_file(&probe);
    if move_data {
        move_game_data(&old, &p)?;
    }
    std::fs::write(&marker, p.to_string_lossy().as_bytes()).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().to_string())
}

pub fn open_game_folder() {
    let p = game_root();
    std::fs::create_dir_all(&p).ok();
    open_path(&p.to_string_lossy());
}

pub(crate) fn dir_size(p: &std::path::Path) -> u64 {
    let mut total = 0;
    if let Ok(rd) = std::fs::read_dir(p) {
        for e in rd.flatten() {
            if let Ok(md) = e.metadata() {
                if md.is_dir() {
                    total += dir_size(&e.path());
                } else {
                    total += md.len();
                }
            }
        }
    }
    total
}

// Only regenerable directories: temp downloads and extracted natives. Versions,
// libraries, assets, worlds and profiles are never listed here.
fn cache_dirs() -> Vec<PathBuf> {
    let mut out = vec![data_dir().join("tmp")];
    if let Ok(rd) = std::fs::read_dir(game_root().join("versions")) {
        for e in rd.flatten() {
            let n = e.path().join("natives");
            if n.is_dir() {
                out.push(n);
            }
        }
    }
    out
}

pub fn cache_size() -> u64 {
    cache_dirs().iter().map(|p| dir_size(p)).sum()
}

pub fn clear_cache() -> u64 {
    let freed = cache_size();
    for p in cache_dirs() {
        let _ = std::fs::remove_dir_all(&p);
    }
    freed
}

/// Uses the system API rather than spawning a shell.
pub fn open_path(path: &str) {
    let _ = tauri_plugin_opener::open_path(path, None::<&str>);
}

/// Write to a temp file and rename: an interrupted in-place write leaves
/// truncated JSON, which parses as "no data".
pub fn write_json_atomic<T: serde::Serialize + ?Sized>(path: &std::path::Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut tmp_name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

pub fn write_json_quiet<T: serde::Serialize + ?Sized>(path: &std::path::Path, value: &T) {
    let _ = write_json_atomic(path, value);
}

pub fn write_bytes_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut tmp_name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".tmp");
    let tmp = path.with_file_name(tmp_name);
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            Err(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-root-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn game_data_moves_and_keeps_whats_already_there() {
        let from = tmp("from");
        let to = tmp("to");
        std::fs::create_dir_all(from.join("profiles/Moya")).unwrap();
        std::fs::write(from.join("profiles/Moya/options.txt"), b"lang:ru").unwrap();
        std::fs::create_dir_all(from.join("versions")).unwrap();
        std::fs::create_dir_all(to.join("versions")).unwrap();
        std::fs::write(to.join("versions/keep.txt"), b"mine").unwrap();

        assert_eq!(move_game_data(&from, &to).unwrap(), 1);
        assert!(to.join("profiles/Moya/options.txt").exists());
        assert!(!from.join("profiles").exists());
        assert!(to.join("versions/keep.txt").exists());
        assert!(from.join("versions").exists());
    }
}
