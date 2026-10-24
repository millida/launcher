// Captions and albums of screenshots, and a cropped copy of one. Notes live next to the pictures in
// screenshots/.millida-notes.json, so they move and back up with the build. No network.
use crate::engine::*;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const NOTES_FILE: &str = ".millida-notes.json";
const MAX_CAPTION: usize = 200;
const MAX_ALBUM: usize = 40;

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(default)]
pub struct ShotNote {
    pub caption: String,
    pub album: String,
}

fn notes_path(dir: &Path) -> PathBuf {
    dir.join(NOTES_FILE)
}

pub(crate) fn read_notes(dir: &Path) -> BTreeMap<String, ShotNote> {
    std::fs::read_to_string(notes_path(dir)).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub(crate) fn clean_note_text(raw: &str, max: usize) -> Result<String, String> {
    let text = raw.trim();
    if text.chars().any(char::is_control) {
        return Err("Подпись должна быть одной строкой".into());
    }
    if text.chars().count() > max {
        return Err(format!("Не длиннее {} символов", max));
    }
    Ok(text.to_string())
}

fn shots_dir(profile: &str) -> PathBuf {
    profile_dir(profile).join("screenshots")
}

fn existing_shot(profile: &str, name: &str) -> Result<(PathBuf, String), String> {
    let file = safe_file_name(name)?;
    if !file.to_ascii_lowercase().ends_with(".png") {
        return Err("Это не скриншот".into());
    }
    let path = safe_child(&shots_dir(profile), &file)?;
    if !path.is_file() {
        return Err("Скриншот не найден".into());
    }
    Ok((path, file))
}

pub fn set_screenshot_note(profile: &str, name: &str, caption: &str, album: &str) -> Result<ShotNote, String> {
    let (_, file) = existing_shot(profile, name)?;
    let note = ShotNote { caption: clean_note_text(caption, MAX_CAPTION)?, album: clean_note_text(album, MAX_ALBUM)? };
    let dir = shots_dir(profile);
    let mut notes = read_notes(&dir);
    if note == ShotNote::default() {
        notes.remove(&file);
    } else {
        notes.insert(file, note.clone());
    }
    // Forget notes of pictures deleted outside the launcher, so the file does not grow forever.
    notes.retain(|n, _| dir.join(n).is_file());
    write_json_atomic(&notes_path(&dir), &notes)?;
    Ok(note)
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// The rectangle comes from the webview: it must sit inside the picture and be big enough to matter.
pub(crate) fn crop_fits(r: CropRect, w: u32, h: u32) -> bool {
    r.width >= 16 && r.height >= 16 && r.x.checked_add(r.width).is_some_and(|e| e <= w) && r.y.checked_add(r.height).is_some_and(|e| e <= h)
}

/// The original stays: the crop is saved as a new picture beside it.
pub async fn crop_screenshot(profile: String, name: String, rect: CropRect) -> Result<String, String> {
    let (src, file) = existing_shot(&profile, &name)?;
    tauri::async_runtime::spawn_blocking(move || {
        let img = image::open(&src).map_err(|e| format!("Не удалось открыть скриншот: {}", e))?;
        if !crop_fits(rect, img.width(), img.height()) {
            return Err("Рамка выходит за картинку".into());
        }
        let cut = img.crop_imm(rect.x, rect.y, rect.width, rect.height);
        let stem = file.trim_end_matches(".png").trim_end_matches(".PNG");
        let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let out = safe_child(&src.parent().map(Path::to_path_buf).unwrap_or_default(), &format!("{}-crop-{}.png", stem, ts))?;
        cut.save_with_format(&out, image::ImageFormat::Png).map_err(|e| format!("Не удалось сохранить обрезку: {}", e))?;
        Ok(out.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_rect_stays_inside_the_picture() {
        let r = |x, y, width, height| CropRect { x, y, width, height };
        let cases: [(CropRect, bool, &str); 5] = [
            (r(0, 0, 1920, 1080), true, "the whole picture"),
            (r(100, 100, 200, 200), true, "a part inside"),
            (r(1800, 0, 200, 100), false, "runs past the right edge"),
            (r(0, 0, 8, 8), false, "too small to be a picture"),
            (r(u32::MAX, 0, 20, 20), false, "overflow must not wrap around"),
        ];
        for (rect, ok, why) in cases {
            assert_eq!(crop_fits(rect, 1920, 1080), ok, "{why}");
        }
    }

    #[test]
    fn note_text_is_one_bounded_line() {
        assert_eq!(clean_note_text("  Закат над базой ", MAX_CAPTION).as_deref(), Ok("Закат над базой"));
        assert!(clean_note_text("a\nb", MAX_CAPTION).is_err(), "a second line would break the grid card");
        assert!(clean_note_text(&"x".repeat(MAX_ALBUM + 1), MAX_ALBUM).is_err());
    }
}
