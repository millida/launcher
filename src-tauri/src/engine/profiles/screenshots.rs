//! Screenshot gallery: what the game wrote into `screenshots/`, plus the two
//! things a player wants next — keep it somewhere else, or send it to someone.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::engine::*;

const SHARE_ENDPOINT: &str = "/launcher/screenshots";
/// The gallery is a wall of images decoded by the webview; past this many the
/// list itself becomes the slow part.
const MAX_LISTED: usize = 400;
/// Matches what the API accepts. A 4K screenshot is around 8 MB.
const MAX_SHARE_BYTES: u64 = 12 * 1024 * 1024;

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Screenshot {
    pub profile: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub taken_at: u64,
    pub width: u32,
    pub height: u32,
}

fn screenshots_dir(profile: &str) -> PathBuf {
    profile_dir(profile).join("screenshots")
}

fn is_png(name: &str) -> bool {
    name.to_ascii_lowercase().ends_with(".png")
}

/// Size straight out of the PNG header: decoding a hundred 4K images to learn
/// their dimensions would stall the gallery for seconds.
fn png_size(path: &Path) -> (u32, u32) {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else { return (0, 0) };
    let mut head = [0u8; 24];
    if f.read_exact(&mut head).is_err() {
        return (0, 0);
    }
    if &head[..8] != b"\x89PNG\r\n\x1a\n" || &head[12..16] != b"IHDR" {
        return (0, 0);
    }
    let num = |o: usize| u32::from_be_bytes(head[o..o + 4].try_into().unwrap_or([0; 4]));
    (num(16), num(20))
}

fn describe(profile: &str, path: PathBuf) -> Option<Screenshot> {
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let (width, height) = png_size(&path);
    Some(Screenshot {
        profile: profile.to_string(),
        name: path.file_name()?.to_string_lossy().to_string(),
        size_bytes: meta.len(),
        taken_at: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0),
        width,
        height,
        path: path.to_string_lossy().to_string(),
    })
}

fn of_profile(profile: &str) -> Vec<Screenshot> {
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(screenshots_dir(profile)) else { return out };
    for e in rd.flatten() {
        if !is_png(&e.file_name().to_string_lossy()) {
            continue;
        }
        if let Some(shot) = describe(profile, e.path()) {
            out.push(shot);
        }
    }
    out
}

/// An empty profile name means every build: the gallery has an "all builds"
/// mode, and a screenshot is usually remembered by what is on it, not by which
/// build took it.
pub fn gallery(profile: &str) -> Vec<Screenshot> {
    let mut out = if profile.is_empty() {
        load_profiles().iter().flat_map(|p| of_profile(&p.name)).collect()
    } else {
        of_profile(profile)
    };
    out.sort_by_key(|s| std::cmp::Reverse(s.taken_at));
    out.truncate(MAX_LISTED);
    out
}

fn shot_path(profile: &str, name: &str) -> Result<PathBuf, String> {
    let file = safe_file_name(name)?;
    if !is_png(&file) {
        return Err("Это не скриншот".into());
    }
    let path = safe_child(&screenshots_dir(profile), &file)?;
    if !path.is_file() {
        return Err("Скриншот не найден".into());
    }
    Ok(path)
}

pub fn delete_screenshot(profile: &str, name: &str) -> Result<(), String> {
    let path = shot_path(profile, name)?;
    std::fs::remove_file(&path).map_err(|e| format!("Не удалось удалить скриншот: {}", e))
}

/// Copies the file wherever the player points the native dialog; the webview
/// never names the destination.
pub async fn save_screenshot_as(profile: String, name: String) -> Result<Option<String>, String> {
    let src = shot_path(&profile, &name)?;
    let picked = save_file(
        dialog()
            .add_filter("Изображение PNG", &["png"])
            .set_file_name(&name)
            .set_title("Куда сохранить скриншот"),
    )
    .await;
    let Some(out) = picked else { return Ok(None) };
    std::fs::copy(&src, &out).map_err(|e| format!("Не удалось сохранить: {}", e))?;
    Ok(Some(out.to_string_lossy().to_string()))
}

/// Publishes the screenshot and returns the link to it. The bytes are read by
/// the core from a path it resolved itself, so the webview cannot aim the
/// upload at another file.
pub async fn share_screenshot(profile: String, name: String) -> Result<String, String> {
    let path = shot_path(&profile, &name)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_SHARE_BYTES {
        return Err(format!(
            "Скриншот больше {} МБ — такой не примет сервер",
            MAX_SHARE_BYTES / 1024 / 1024
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let file = safe_file_name(&name)?;
    let res = millida_upload_auth(SHARE_ENDPOINT.to_string(), file, "image/png", bytes, vec![]).await?;
    res.get("url")
        .and_then(|v| v.as_str())
        .filter(|u| u.starts_with("https://"))
        .map(str::to_string)
        .ok_or_else(|| "Сервер не вернул ссылку на скриншот".into())
}

pub fn screenshot_count(profile: &str) -> usize {
    std::fs::read_dir(screenshots_dir(profile))
        .map(|rd| rd.flatten().filter(|e| is_png(&e.file_name().to_string_lossy())).count())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-shots-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        out.extend_from_slice(&13u32.to_be_bytes());
        out.extend_from_slice(b"IHDR");
        out.extend_from_slice(&width.to_be_bytes());
        out.extend_from_slice(&height.to_be_bytes());
        out.extend_from_slice(&[8, 6, 0, 0, 0]);
        out
    }

    /// The gallery shows resolution under every tile, and reading it from the
    /// header is what keeps opening the screen instant.
    #[test]
    fn resolution_comes_from_the_png_header() {
        let dir = tmp("size");
        let path = dir.join("shot.png");
        std::fs::write(&path, png(2560, 1440)).unwrap();
        assert_eq!(png_size(&path), (2560, 1440));

        let not_png = dir.join("fake.png");
        std::fs::write(&not_png, b"GIF89a and then some").unwrap();
        assert_eq!(png_size(&not_png), (0, 0), "чужой формат не должен выдавать выдуманный размер");
    }

    /// name -> verdict. The name arrives over IPC and becomes a path inside the
    /// build, so anything but a plain png file name must be refused.
    #[test]
    fn only_a_plain_png_name_resolves() {
        for bad in ["../../secrets.bin", "shot.png/../../x", "world.dat", "", "shot.PNG.exe"] {
            assert!(
                shot_path("Test", bad).is_err(),
                "«{bad}» не должен превращаться в путь: имя приходит из вебвью и ведёт к удалению и выгрузке файла",
            );
        }
    }
}
