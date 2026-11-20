// Own launcher wallpapers: copies the picture the player picked into the wallpaper/ folder of the launcher data and keeps at most eight.
// The network is used only by the shared wallpaper library: publishing an own wallpaper and saving one from the library.
use crate::engine::*;
use std::path::{Component, Path, PathBuf};

const KEEP_NEWEST: usize = 8;
const LIBRARY_MAX_BYTES: usize = 15 * 1024 * 1024;
const NAME_MAX_CHARS: usize = 64;
const LIBRARY_ENDPOINT: &str = "/launcher/wallpapers";

#[derive(serde::Serialize)]
pub struct CustomWallpaper {
    pub kind: String, // "image" | "video"
    pub path: String,
    pub name: String,
}

#[derive(serde::Serialize)]
pub struct PickedTexture {
    pub name: String,
    pub data: String, // data:image/png;base64,...
}

const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// Native file dialog: an HTML <input type=file> aborts WKWebView on macOS, so
/// the file is picked here and returned as a data URL.
pub async fn pick_texture() -> Result<Option<PickedTexture>, String> {
    let picked = pick_file(dialog().add_filter("PNG", &["png"]).set_title(crate::engine::ui("Скин или плащ (PNG)"))).await;
    let Some(p) = picked else { return Ok(None) };
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 {
        return Err("PNG слишком большой (макс 2 МБ)".into());
    }
    let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "texture".into());
    Ok(Some(PickedTexture {
        name,
        data: format!("data:image/png;base64,{}", base64_encode(&bytes)),
    }))
}

/// Copied under a unique name, because WKWebView serves a cached image when the
/// path repeats. Only the 8 most recent files are kept.
pub async fn pick_wallpaper() -> Result<Option<CustomWallpaper>, String> {
    let picked = pick_file(
        dialog()
            .add_filter(crate::engine::ui("Фон"), &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov", "m4v"])
            .set_title(crate::engine::ui("Свой фон лаунчера")),
    )
    .await;
    let Some(src) = picked else { return Ok(None) };
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let kind = if matches!(ext.as_str(), "mp4" | "webm" | "mov" | "m4v") { "video" } else { "image" };
    let dir = wallpaper_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "wallpaper".into());
    let dest = dir.join(unique_name(&ext));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    prune_wallpapers(&dir);
    Ok(Some(CustomWallpaper {
        kind: kind.into(),
        path: dest.to_string_lossy().to_string(),
        name,
    }))
}

fn wallpaper_dir() -> PathBuf {
    data_dir().join("wallpaper")
}

fn unique_name(ext: &str) -> String {
    let uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("wp_{uniq}.{ext}")
}

/// Picked and library wallpapers share one budget, so the folder never grows past the eight newest.
fn prune_wallpapers(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut wps: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();
    for e in rd.flatten() {
        let fname = e.file_name().to_string_lossy().to_string();
        if fname.starts_with("custom.") {
            let _ = std::fs::remove_file(e.path());
        } else if fname.starts_with("wp_") {
            let mt = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            wps.push((e.path(), mt));
        }
    }
    wps.sort_by_key(|w| std::cmp::Reverse(w.1));
    for (p, _) in wps.into_iter().skip(KEEP_NEWEST) {
        let _ = std::fs::remove_file(p);
    }
}

/// The type comes from the bytes, not the extension: the server stores what the multipart part declares.
fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP".as_slice()) {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

/// The webview names the file, so only a picture already in our wallpaper folder may leave the machine:
/// an XSS must not be able to upload an arbitrary file from the disk.
fn publishable_path(dir: &Path, raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw);
    let plain = path.components().all(|c| matches!(c, Component::Normal(_) | Component::RootDir | Component::Prefix(_)));
    let inside = plain && path.is_absolute() && path.file_name().is_some() && path != dir && is_inside(dir, &path);
    if !inside {
        return Err("Эта картинка лежит вне папок лаунчера".into());
    }
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("Фоном ставится картинка: PNG, JPG или WebP".into());
    }
    Ok(path)
}

fn publish_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    let chars = name.chars().count();
    if chars == 0 || chars > NAME_MAX_CHARS || name.chars().any(char::is_control) {
        return Err("Дай фону название до 64 знаков".into());
    }
    Ok(name.to_string())
}

/// Library ids are cuids; anything else could steer the request to another API route.
fn library_id_ok(id: &str) -> bool {
    (20..=32).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn too_big() -> String {
    format!("Картинка больше {} МБ", LIBRARY_MAX_BYTES / 1024 / 1024)
}

pub async fn publish_wallpaper(path: String, name: String) -> Result<serde_json::Value, String> {
    let name = publish_name(&name)?;
    let file = publishable_path(&wallpaper_dir(), &path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&file).map_err(|e| format!("Файл не читается: {e}"))?;
        if !meta.is_file() {
            return Err("Это не файл".to_string());
        }
        if meta.len() > LIBRARY_MAX_BYTES as u64 {
            return Err(too_big());
        }
        std::fs::read(file).map_err(|e| format!("Файл не читается: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (mime, ext) = image_type(&bytes).ok_or_else(|| "Файл не похож на изображение".to_string())?;
    millida_upload_auth(
        LIBRARY_ENDPOINT.to_string(),
        format!("wallpaper.{ext}"),
        mime,
        bytes,
        vec![("name".to_string(), name)],
    )
    .await
}

/// The core builds the address itself and keeps the file on disk, so a library wallpaper works offline like an own one.
pub async fn save_library_wallpaper(id: String) -> Result<CustomWallpaper, String> {
    if !library_id_ok(&id) {
        return Err("Такого фона нет в библиотеке".into());
    }
    let url = format!("{MILLIDA_API}{LIBRARY_ENDPOINT}/{id}/file");
    let res = client().get(url.as_str()).send().await.map_err(|e| net_err(&e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("http {}", status.as_u16()));
    }
    let bytes = read_capped(res, LIBRARY_MAX_BYTES).await?;
    let (_, ext) = image_type(&bytes).ok_or_else(|| "Файл не похож на изображение".to_string())?;
    let dir = wallpaper_dir();
    let file_name = unique_name(ext);
    let dest = dir.join(&file_name);
    let target = dest.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        if let Err(e) = std::fs::write(&target, bytes) {
            let _ = std::fs::remove_file(target);
            return Err(e.to_string());
        }
        prune_wallpapers(&dir);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(CustomWallpaper {
        kind: "image".into(),
        path: dest.to_string_lossy().to_string(),
        name: file_name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        std::env::temp_dir().join("millida-wallpaper-test").join("wallpaper")
    }

    #[test]
    fn library_ids_are_cuids_only() {
        let cases: &[(&str, bool, &str)] = &[
            ("clx9k2m8f0000abcd1234efgh", true, "a typical 25-char cuid is a library id"),
            ("abcdefghijklmnopqrst", true, "20 lowercase letters is the shortest accepted id"),
            ("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6", true, "32 chars is the longest accepted id"),
            ("abcdefghijklmnopqrs", false, "19 chars is shorter than any accepted id"),
            ("a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q", false, "33 chars is longer than any accepted id"),
            ("CLX9K2M8F0000ABCD1234EFGH", false, "uppercase never appears in a cuid"),
            ("clx9k2m8f0000abcd/../mine", false, "a slash or dots would steer the request to another route"),
            ("clx9k2m8f0000abcd1234efg%2f", false, "an encoded separator must not pass"),
            ("clx9k2m8f0000abcd1234efgh?x=1", false, "a query string must not ride along with the id"),
            ("", false, "an empty id is not an id"),
        ];
        for (id, want, why) in cases {
            assert_eq!(library_id_ok(id), *want, "{id:?}: {why}");
        }
    }

    #[test]
    fn only_pictures_from_the_wallpaper_folder_are_publishable() {
        let dir = base();
        let ok = |p: PathBuf| publishable_path(&dir, &p.to_string_lossy()).is_ok();
        assert!(ok(dir.join("wp_1.png")), "a png in the wallpaper folder is the player's own wallpaper");
        assert!(ok(dir.join("wp_2.JPEG")), "the extension check ignores case");
        assert!(ok(dir.join("wp_3.webp")), "webp is a supported wallpaper type");
        assert!(!ok(dir.join("wp_4.mp4")), "a video wallpaper is not accepted by the library");
        assert!(!ok(dir.join("wp_5")), "a file without an extension is not a picture");
        assert!(!ok(dir.join("..").join("secrets.png")), "climbing out of the folder with .. must be refused");
        assert!(!ok(std::env::temp_dir().join("other.png")), "a picture elsewhere on the disk must not be uploaded");
        assert!(!ok(PathBuf::from("wp_1.png")), "a relative path would resolve against the working directory");
        assert!(publishable_path(&dir, "").is_err(), "an empty path names nothing");
        assert!(!ok(dir.clone()), "the folder itself is not a file");
    }

    #[test]
    fn names_are_trimmed_and_bounded() {
        assert_eq!(publish_name("  Forest  ").ok().as_deref(), Some("Forest"), "spaces around the name are dropped");
        assert!(publish_name("   ").is_err(), "a blank name is refused");
        assert!(publish_name(&"\u{44f}".repeat(64)).is_ok(), "64 characters fit, counted as characters, not bytes");
        assert!(publish_name(&"\u{44f}".repeat(65)).is_err(), "65 characters is over the limit");
        assert!(publish_name("a\u{0}b").is_err(), "control characters are refused");
    }

    #[test]
    fn image_type_reads_the_bytes() {
        let kind = |b: &[u8]| image_type(b).map(|t| t.1);
        assert_eq!(kind(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0]), Some("png"), "png signature");
        assert_eq!(kind(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("jpg"), "jpeg signature");
        assert_eq!(kind(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"), "webp is RIFF with WEBP at offset 8");
        assert_eq!(kind(b"RIFF\0\0\0\0WAVEfmt "), None, "a RIFF that is not WEBP is not a picture");
        assert_eq!(kind(b"GIF89a"), None, "gif is not accepted by the library");
        assert_eq!(kind(b"<html>"), None, "an error page is not a picture");
        assert_eq!(kind(&[]), None, "an empty body is not a picture");
    }
}
