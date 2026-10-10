use crate::engine::*;
use base64::Engine as _;

/// Covers are stored in profiles.json as a small square PNG data URL rather than
/// as a file path, so they survive a game-root change or a profile rename.
/// 256: карточки «Моих сборок» рисуют значок до 132 px, на экране Retina это 264
/// точки — значок в 128 был мыльным (владелец 10.10.2026: «Immortal размыта»).
pub(crate) const COVER_PX: u32 = 256;
/// Guard against decoding huge camera photos into memory.
const MAX_SOURCE_BYTES: u64 = 12 * 1024 * 1024;

/// Picks an image and turns it into the small square PNG a cover is. Used both
/// when a build already exists and while one is being created — the second case
/// has no profile to attach it to yet, so the data URL is simply returned.
pub async fn pick_cover_image() -> Result<Option<String>, String> {
    let picked = pick_file(
        dialog().add_filter("Картинка", &["png", "jpg", "jpeg", "webp"]).set_title("Обложка сборки"),
    )
    .await;
    let Some(src) = picked else { return Ok(None) };
    if std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0) > MAX_SOURCE_BYTES {
        return Err("Картинка больше 12 МБ — возьми поменьше".into());
    }
    // decoding and resizing are blocking work, keep them off the async runtime
    let data = tauri::async_runtime::spawn_blocking(move || cover_data_url(&src))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Some(data))
}

pub async fn pick_profile_cover(profile: String) -> Result<Option<Vec<Profile>>, String> {
    let Some(data) = pick_cover_image().await? else { return Ok(None) };
    Ok(Some(set_profile_cover(&profile, Some(data))))
}

fn cover_data_url(path: &std::path::Path) -> Result<String, String> {
    let img = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|_| "Не удалось прочитать картинку — нужен PNG, JPEG или WebP".to_string())?;
    square_png_data_url(&img, image::imageops::FilterType::Lanczos3)
}

/// A catalogue pack's own icon, downloaded as bytes, in the same shape a picked
/// cover takes. Pixel art scaled by a whole factor keeps its hard edges.
pub(crate) fn pack_icon_data_url(bytes: &[u8]) -> Result<String, String> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(ICON_MAX_SIDE);
    limits.max_image_height = Some(ICON_MAX_SIDE);
    reader.limits(limits);
    let img = reader.decode().map_err(|_| "Иконка сборки не читается как картинка".to_string())?;
    let filter = if pixel_art(&img) { image::imageops::FilterType::Nearest } else { image::imageops::FilterType::Lanczos3 };
    square_png_data_url(&img, filter)
}

const ICON_MAX_SIDE: u32 = 2048;

/// A square that maps onto the cover grid by a whole factor: blown up from a
/// smaller one, or drawn in solid blocks of the factor's size. Smoothing such a
/// picture only blurs its pixels.
pub(crate) fn pixel_art(img: &image::DynamicImage) -> bool {
    let (w, h) = (img.width(), img.height());
    if w != h || w == 0 {
        return false;
    }
    // Уже нужного размера — масштабировать нечего.
    if w == COVER_PX {
        return false;
    }
    // Меньше квадрата и укладывается в него целое число раз — увеличиваем блоками.
    if w < COVER_PX && COVER_PX.is_multiple_of(w) {
        return true;
    }
    if !w.is_multiple_of(COVER_PX) {
        return false;
    }
    let k = w / COVER_PX;
    let rgba = img.to_rgba8();
    rgba.enumerate_pixels().all(|(x, y, p)| p == rgba.get_pixel(x - x % k, y - y % k))
}

fn square_png_data_url(img: &image::DynamicImage, filter: image::imageops::FilterType) -> Result<String, String> {
    // resize_to_fill centre-crops instead of stretching
    let square = img.resize_to_fill(COVER_PX, COVER_PX, filter);
    let mut png: Vec<u8> = vec![];
    square
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(&png)))
}

/// `None` restores the default cover.
pub fn set_profile_cover(profile: &str, icon: Option<String>) -> Vec<Profile> {
    let mut all = load_profiles();
    if let Some(p) = all.iter_mut().find(|p| p.name == profile) {
        p.icon = icon;
    }
    let _ = save_profiles(&all);
    all
}
