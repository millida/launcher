use serde::Serialize;
use std::path::{Path, PathBuf};

use super::mp4;
use super::ring::Clip;
use crate::engine::core::safe_child;

const FOLDER: &str = "Millida Clips";
const EXTENSION: &str = "mp4";
const PARTIAL: &str = "part";
const MAX_LISTED: usize = 300;
const MAX_LABEL: usize = 40;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipFile {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub created_at: u64,
    pub duration_ms: u64,
}

pub fn folder() -> PathBuf {
    dirs::video_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Videos")))
        .unwrap_or_else(std::env::temp_dir)
        .join(FOLDER)
}

/// A build name turned into something every file system accepts.
pub fn label(profile: &str) -> String {
    let cleaned: String = profile
        .chars()
        .map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' || c == '.' { c } else { ' ' })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    let joined: String = words.join(" ").chars().take(MAX_LABEL).collect();
    let trimmed = joined.trim_matches(|c: char| c == '.' || c == ' ').to_string();
    if trimmed.is_empty() { "Minecraft".into() } else { trimmed }
}

pub fn file_name(profile: &str, stamp: &str, attempt: u32) -> String {
    match attempt {
        0 => format!("{} {}.{}", label(profile), stamp, EXTENSION),
        n => format!("{} {} ({}).{}", label(profile), stamp, n + 1, EXTENSION),
    }
}

fn unused(dir: &Path, profile: &str, stamp: &str) -> PathBuf {
    (0..100)
        .map(|attempt| dir.join(file_name(profile, stamp, attempt)))
        .find(|path| !path.exists())
        .unwrap_or_else(|| dir.join(file_name(profile, &format!("{} {}", stamp, std::process::id()), 0)))
}

/// Writes next to the destination and renames on success, so a crash or a
/// full disk never leaves a half-written clip in the list.
pub fn save(dir: &Path, profile: &str, stamp: &str, clip: &Clip, audio_bitrate: u32) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Не удалось создать папку клипов {}: {}", dir.display(), e))?;
    let target = unused(dir, profile, stamp);
    let partial = target.with_extension(PARTIAL);
    let written = (|| -> std::io::Result<()> {
        let file = std::fs::File::create(&partial)?;
        let mut out = std::io::BufWriter::with_capacity(1 << 20, file);
        mp4::write(&mut out, clip, audio_bitrate)?;
        out.into_inner().map_err(|e| e.into_error())?.sync_all()
    })();
    if let Err(e) = written {
        let _ = std::fs::remove_file(&partial);
        return Err(format!("Клип не записан: {}. Проверь место на диске.", e));
    }
    std::fs::rename(&partial, &target).map_err(|e| {
        let _ = std::fs::remove_file(&partial);
        format!("Клип не записан: {}", e)
    })?;
    Ok(target)
}

fn describe(path: PathBuf) -> Option<ClipFile> {
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let created_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let duration_ms = std::fs::File::open(&path).ok().and_then(|mut f| mp4::duration_ms(&mut f)).unwrap_or(0);
    Some(ClipFile {
        name: path.file_name()?.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        size_bytes: meta.len(),
        created_at,
        duration_ms,
    })
}

pub fn list(dir: &Path) -> Vec<ClipFile> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut clips: Vec<ClipFile> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case(EXTENSION)))
        .filter_map(describe)
        .collect();
    clips.sort_by_key(|c| std::cmp::Reverse(c.created_at));
    clips.truncate(MAX_LISTED);
    clips
}

/// A name from the webview, resolved inside the clips folder only.
pub fn resolve(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let path = safe_child(dir, name)?;
    if !path.extension().is_some_and(|x| x.eq_ignore_ascii_case(EXTENSION)) {
        return Err("Это не клип".into());
    }
    if !path.is_file() {
        return Err("Клип не найден — возможно, его уже удалили".into());
    }
    Ok(path)
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    let path = resolve(dir, name)?;
    std::fs::remove_file(&path).map_err(|e| format!("Не удалось удалить клип: {}", e))
}

#[cfg(test)]
mod tests {
    use super::super::ring::{Packet, VideoFormat};
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("millida-clips-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn tiny() -> Clip {
        let frame: Vec<u8> = vec![0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0, 0, 0, 1, 0x68, 0xEB, 0, 0, 0, 1, 0x65, 0x88];
        Clip {
            format: VideoFormat { width: 2, height: 2, sps: vec![0x67, 0x64, 0, 0x28], pps: vec![0x68, 0xEB] },
            video: vec![Packet { time: 0, data: frame.into(), key: true }],
            audio: Vec::new(),
            end: 333_333,
        }
    }

    #[test]
    fn label_verdicts() {
        let cases = [
            ("Fabric 1.21", "Fabric 1.21", "a plain name is kept"),
            ("a/b\\c:d*e?f\"g<h>i|j", "a b c d e f g h i j", "characters Windows forbids become spaces"),
            ("..", "Minecraft", "dots alone would name a parent folder"),
            ("", "Minecraft", "empty falls back"),
            ("con.", "con", "a trailing dot is dropped by Windows and would rename the file"),
        ];
        for (input, want, why) in cases {
            assert_eq!(label(input), want, "{}", why);
        }
        assert!(label(&"x".repeat(200)).chars().count() <= MAX_LABEL, "long names are cut");
    }

    #[test]
    fn save_list_delete_round_trip() {
        let dir = scratch("round");
        let first = save(&dir, "My build", "2026-10-09 21-00-00", &tiny(), 192_000).unwrap();
        let second = save(&dir, "My build", "2026-10-09 21-00-00", &tiny(), 192_000).unwrap();
        assert_ne!(first, second, "two clips in the same second must not overwrite each other");
        assert!(second.to_string_lossy().ends_with("(2).mp4"));
        let listed = list(&dir);
        assert_eq!(listed.len(), 2);
        assert!(std::fs::read_dir(&dir).unwrap().flatten().all(|e| !e.path().to_string_lossy().ends_with(".part")), "no partial file stays behind");
        delete(&dir, &listed[0].name).unwrap();
        assert_eq!(list(&dir).len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resolve_rejects_paths_outside_the_folder() {
        let dir = scratch("resolve");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("notes.txt"), b"x").unwrap();
        let cases = [
            ("../secret.mp4", "a parent path must not escape the folder"),
            ("C:\\Windows\\win.ini", "an absolute path must not be deleted"),
            ("notes.txt", "only mp4 files are clips"),
            ("missing.mp4", "a missing clip is an error, not a silent success"),
        ];
        for (name, why) in cases {
            assert!(resolve(&dir, name).is_err(), "{}", why);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
