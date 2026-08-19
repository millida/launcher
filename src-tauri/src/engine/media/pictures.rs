//! What a player expects from a picture they opened in the viewer: put it on
//! the clipboard, or keep a copy on disk.

use std::path::PathBuf;
use std::time::Duration;

use futures::StreamExt;
use serde::Deserialize;
use tauri::image::Image;
use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::engine::*;

const MAX_BYTES: usize = 32 * 1024 * 1024;
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);

/// Where the opened picture came from. The webview names one of the two, and
/// the core decides on its own whether that source may be read at all.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PictureRef {
    pub url: Option<String>,
    pub path: Option<String>,
}

fn too_big() -> String {
    format!("Картинка больше {} МБ", MAX_BYTES / 1024 / 1024)
}

/// Chat attachments live on the storage CDN (millida.trade), the rest of the
/// pictures on millida.net. Anything else the webview asks for is refused
/// rather than fetched on its behalf.
const OUR_DOMAINS: [&str; 2] = ["millida.net", "millida.trade"];

fn host_allowed(host: &str) -> bool {
    let h = host.to_ascii_lowercase();
    OUR_DOMAINS.iter().any(|d| h == *d || h.ends_with(&format!(".{}", d)))
}

async fn remote_bytes(url: &str) -> Result<Vec<u8>, String> {
    let parsed = validate_external_url(url)?;
    let allowed = parsed.scheme() == "https" && parsed.host_str().map(host_allowed).unwrap_or(false);
    if !allowed {
        return Err("Эту картинку лаунчер не может скачать".into());
    }
    let res = client()
        .get(parsed.as_str())
        .timeout(FETCH_TIMEOUT)
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    if !res.status().is_success() {
        return Err(format!("Сервер ответил {}", res.status()));
    }
    if res.content_length().map(|n| n as usize > MAX_BYTES).unwrap_or(false) {
        return Err(too_big());
    }
    let mut out: Vec<u8> = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| net_err(&e))?;
        if out.len() + chunk.len() > MAX_BYTES {
            return Err(too_big());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// A path arriving over IPC is untrusted: only files the launcher itself wrote
/// are readable, so an XSS cannot turn the viewer into a file reader.
fn local_file(path: &str) -> Result<PathBuf, String> {
    let file = PathBuf::from(path);
    let ours = [game_root(), data_dir()].into_iter().any(|base| is_inside(&base, &file));
    if !ours {
        return Err("Эта картинка лежит вне папок лаунчера".into());
    }
    let meta = std::fs::metadata(&file).map_err(|e| format!("Файл не читается: {}", e))?;
    if !meta.is_file() {
        return Err("Это не файл".into());
    }
    if meta.len() as usize > MAX_BYTES {
        return Err(too_big());
    }
    Ok(file)
}

/// The path is whatever the webview sent, so the tail is cut on both
/// separators: a Windows path must yield a file name on a Linux build too.
fn file_name_of(path: &str) -> Option<String> {
    let last = path.rsplit(['/', '\\']).next()?.trim();
    (!last.is_empty()).then(|| last.to_string())
}

fn name_of(src: &PictureRef) -> String {
    let raw = src
        .path
        .as_deref()
        .and_then(file_name_of)
        .or_else(|| {
            let url = url::Url::parse(src.url.as_deref().unwrap_or("")).ok()?;
            let last = url.path_segments()?.next_back()?.replace("%20", " ");
            if last.contains('%') {
                return None;
            }
            Some(last)
        })
        .unwrap_or_default();
    safe_file_name(&raw).unwrap_or_else(|_| "image.png".into())
}

async fn bytes_of(src: &PictureRef) -> Result<Vec<u8>, String> {
    if let Some(path) = src.path.as_deref().filter(|p| !p.is_empty()) {
        let file = local_file(path)?;
        return tauri::async_runtime::spawn_blocking(move || {
            std::fs::read(&file).map_err(|e| format!("Файл не читается: {}", e))
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    match src.url.as_deref().filter(|u| !u.is_empty()) {
        Some(url) => remote_bytes(url).await,
        None => Err("Нечего копировать".into()),
    }
}

/// The clipboard takes raw RGBA, so the picture is decoded first — on the
/// blocking pool, because a 4K frame stalls the webview for a noticeable beat.
pub async fn copy_picture(app: AppHandle, src: PictureRef) -> Result<(), String> {
    let bytes = bytes_of(&src).await?;
    let rgba = tauri::async_runtime::spawn_blocking(move || {
        let img = image::load_from_memory(&bytes)
            .map_err(|_| "Файл не похож на изображение".to_string())?
            .to_rgba8();
        let (w, h) = img.dimensions();
        Ok::<_, String>((img.into_raw(), w, h))
    })
    .await
    .map_err(|e| e.to_string())??;
    let (raw, w, h) = rgba;
    app.clipboard()
        .write_image(&Image::new(&raw, w, h))
        .map_err(|e| format!("Буфер обмена не принял картинку: {}", e))
}

/// Returns the chosen path, or `None` when the save dialog was dismissed.
pub async fn save_picture_as(src: PictureRef) -> Result<Option<String>, String> {
    let name = name_of(&src);
    let ext = name.rsplit('.').next().filter(|e| e.len() <= 5 && !e.is_empty()).unwrap_or("png");
    let bytes = bytes_of(&src).await?;
    let picked = save_file(
        dialog()
            .add_filter("Изображение", &[ext])
            .set_file_name(&name)
            .set_title("Куда сохранить изображение"),
    )
    .await;
    let Some(out) = picked else { return Ok(None) };
    std::fs::write(&out, &bytes).map_err(|e| format!("Не удалось сохранить: {}", e))?;
    Ok(Some(out.to_string_lossy().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_hosts_are_fetched() {
        for host in ["millida.net", "api.millida.net", "cdn.millida.trade", "millida.trade"] {
            assert!(host_allowed(host), "{} — наш хост, вложения лежат там", host);
        }
        for host in ["millida.net.evil.example", "evil.example", "notmillida.net", "cdnmillida.trade"] {
            assert!(!host_allowed(host), "{} только выглядит нашим — качать оттуда нельзя", host);
        }
    }

    #[test]
    fn name_comes_from_the_source_and_is_sanitised() {
        let by_path = PictureRef { url: None, path: Some(r"C:\games\screenshots\2026-08-19.png".into()) };
        assert_eq!(name_of(&by_path), "2026-08-19.png", "имя режется по '\\' на любой платформе сборки");
        let by_posix_path = PictureRef { url: None, path: Some("/home/p/.millida/shot.png".into()) };
        assert_eq!(name_of(&by_posix_path), "shot.png");
        let by_url = PictureRef {
            url: Some("https://millida.net/media/chat/my%20shot.png".into()),
            path: None,
        };
        assert_eq!(name_of(&by_url), "my shot.png");
        let traversal = PictureRef { url: Some("https://millida.net/media/..".into()), path: None };
        assert_eq!(name_of(&traversal), "image.png", "«..» не должно стать именем файла");
        let empty = PictureRef { url: None, path: None };
        assert_eq!(name_of(&empty), "image.png");
    }

    #[test]
    fn foreign_paths_are_refused() {
        assert!(local_file(r"C:\Windows\System32\config\SAM").is_err());
        assert!(local_file("/etc/shadow").is_err());
        assert!(local_file("").is_err());
    }
}
