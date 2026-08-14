use super::library::as_data_url;
use crate::engine::*;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

// Player head avatars, cached on disk so repeat views are instant and offline.

const HEAD_URL: &str = "https://api.millida.net/v2/heads/avatar/";
const HEAD_PX: u32 = 64;
/// A face is 8x8 skin pixels: only a multiple of 8 gives every pixel the same
/// width on screen, anything else renders the face torn.
const HEAD_CELLS: u32 = 8;
const HEAD_PX_MAX: u32 = 512;
const TTL: Duration = Duration::from_secs(14 * 24 * 3600);
const MAX_BYTES: usize = 200_000;
const MAX_FILES: usize = 400;

fn heads_dir() -> PathBuf {
    data_dir().join("cache").join("heads")
}

/// Minecraft nicks are alphanumeric plus underscore; anything else must never
/// reach a cache file name.
fn cache_key(nick: &str) -> Result<String, String> {
    let key: String = nick
        .trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(16)
        .collect();
    if key.is_empty() {
        return Err("пустой ник".into());
    }
    Ok(key.to_lowercase())
}

fn head_px(size: Option<u32>) -> u32 {
    let px = size.unwrap_or(HEAD_PX).clamp(HEAD_CELLS, HEAD_PX_MAX);
    (px as f32 / HEAD_CELLS as f32).round().max(1.0) as u32 * HEAD_CELLS
}

fn fresh(path: &std::path::Path) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .map(|age| age < TTL)
        .unwrap_or(false)
}

fn prune(dir: &std::path::Path) {
    let mut files: Vec<(SystemTime, PathBuf)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let modified = e.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect();
    if files.len() <= MAX_FILES {
        return;
    }
    files.sort_by_key(|(t, _)| *t);
    for (_, path) in files.iter().take(files.len() - MAX_FILES) {
        let _ = std::fs::remove_file(path);
    }
}

/// The nick is already sanitized, so it cannot inject a path into the URL.
async fn download_head_service(nick: &str, px: u32) -> Result<Vec<u8>, String> {
    let url = format!("{}{}?size={}", HEAD_URL, nick, px);
    let res = client().get(url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("сервис голов ответил {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("сервис голов отдал не PNG".into());
    }
    Ok(bytes.to_vec())
}

/// Head rendered from the CustomSkinAPI skin, i.e. the same source
/// CustomSkinLoader reads in game.
async fn download_millida(nick: &str, px: u32) -> Result<Vec<u8>, String> {
    let meta = get_json(&format!("{}/yggdrasil/csl/{}", MILLIDA_API, nick)).await?;
    let hash = meta["skins"]["default"]
        .as_str()
        .or_else(|| meta["skins"]["slim"].as_str())
        .ok_or("у игрока нет скина Millida")?;
    let res = client()
        .get(format!("{}/yggdrasil/csl/textures/{}", MILLIDA_API, hash))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("скин Millida недоступен ({})", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 2_000_000 {
        return Err("скин слишком большой".into());
    }
    tokio::task::spawn_blocking(move || head_from_skin(&bytes, px))
        .await
        .map_err(|e| e.to_string())?
}

/// Head from a skin texture: face at (8,8) with the hat overlay at (40,8)
/// composited on top.
fn head_from_skin(skin: &[u8], px: u32) -> Result<Vec<u8>, String> {
    use image::GenericImageView as _;
    let img = image::load_from_memory(skin).map_err(|_| "скин не картинка".to_string())?;
    let (w, h) = img.dimensions();
    // skins are 64x64 (64x32 for legacy ones) but may come at doubled
    // resolution, so regions are computed as fractions
    if w < 64 || h < 32 {
        return Err("скин меньше 64 пикселей".into());
    }
    let s = w / 8;
    let mut head = img.view(s, s, s, s).to_image();
    if h >= w {
        let hat = img.view(s * 5, s, s, s).to_image();
        image::imageops::overlay(&mut head, &hat, 0, 0);
    }
    // nearest neighbour: the face is 8x8 pixels and any filtering blurs it
    let big = image::imageops::resize(&head, px, px, image::imageops::FilterType::Nearest);
    let mut png: Vec<u8> = vec![];
    image::DynamicImage::ImageRgba8(big)
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(png)
}

/// CustomSkinAPI first, then the platform head renderer for accounts that have
/// no profile here.
async fn download(nick: &str, px: u32) -> Result<Vec<u8>, String> {
    match download_millida(nick, px).await {
        Ok(bytes) => Ok(bytes),
        Err(_) => download_head_service(nick, px).await,
    }
}

/// Head as a data URL. A stale cache entry is served when the remote fails, so
/// the UI keeps showing a head rather than a placeholder.
pub async fn head_avatar(nick: String, size: Option<u32>) -> Result<String, String> {
    let key = cache_key(&nick)?;
    let px = head_px(size);
    let dir = heads_dir();
    let path = dir.join(format!("{}@{}.png", key, px));
    let cached = std::fs::read(&path).ok();
    if let Some(bytes) = &cached {
        if fresh(&path) {
            return Ok(as_data_url(bytes));
        }
    }
    match download(&key, px).await {
        Ok(bytes) => {
            if std::fs::create_dir_all(&dir).is_ok() {
                let _ = std::fs::write(&path, &bytes);
                prune(&dir);
            }
            Ok(as_data_url(&bytes))
        }
        Err(e) => match cached {
            Some(bytes) => Ok(as_data_url(&bytes)),
            None => Err(e),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{cache_key, head_from_skin, head_px, HEAD_PX};

    fn skin(hat_alpha: u8) -> Vec<u8> {
        let mut img = image::RgbaImage::new(64, 64);
        for y in 8..16 {
            for x in 8..16 {
                img.put_pixel(x, y, image::Rgba([255, 0, 0, 255]));
            }
            for x in 40..48 {
                img.put_pixel(x, y, image::Rgba([0, 255, 0, hat_alpha]));
            }
        }
        let mut png = vec![];
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        png
    }

    fn center_pixel(png: &[u8]) -> [u8; 4] {
        let img = image::load_from_memory(png).unwrap().to_rgba8();
        assert_eq!(img.dimensions(), (HEAD_PX, HEAD_PX));
        img.get_pixel(HEAD_PX / 2, HEAD_PX / 2).0
    }

    /// Input -> verdict: the render size must divide by the face cell, or skin
    /// pixels end up with different widths and the face looks torn.
    #[test]
    fn size_snaps_to_the_face_grid() {
        for (asked, expected) in [(None, 64), (Some(80), 80), (Some(84), 88), (Some(22), 24), (Some(1), 8), (Some(9999), 512)] {
            assert_eq!(
                head_px(asked),
                expected,
                "asked size {asked:?} must snap to a multiple of 8"
            );
            assert_eq!(head_px(asked) % 8, 0, "render is not a multiple of the face cell");
        }
    }

    #[test]
    fn head_takes_face_from_skin() {
        assert_eq!(center_pixel(&head_from_skin(&skin(0), HEAD_PX).unwrap()), [255, 0, 0, 255]);
    }

    #[test]
    fn hat_layer_covers_the_face() {
        assert_eq!(center_pixel(&head_from_skin(&skin(255), HEAD_PX).unwrap()), [0, 255, 0, 255]);
    }

    #[test]
    fn garbage_is_not_a_skin() {
        assert!(head_from_skin(b"not a png at all", HEAD_PX).is_err());
    }

    #[test]
    fn key_strips_path_tricks() {
        assert_eq!(cache_key("../../evil").unwrap(), "evil");
        assert_eq!(cache_key(" Vova12_PRO ").unwrap(), "vova12_pro");
        assert!(cache_key("../").is_err());
    }
}
