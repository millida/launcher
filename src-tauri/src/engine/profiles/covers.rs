use crate::engine::*;
use base64::Engine as _;

/// Covers are stored in profiles.json as a small square PNG data URL rather than
/// as a file path, so they survive a game-root change or a profile rename.
const COVER_PX: u32 = 128;
/// Guard against decoding huge camera photos into memory.
const MAX_SOURCE_BYTES: u64 = 12 * 1024 * 1024;

pub async fn pick_profile_cover(profile: String) -> Result<Option<Vec<Profile>>, String> {
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
    Ok(Some(set_profile_cover(&profile, Some(data))))
}

fn cover_data_url(path: &std::path::Path) -> Result<String, String> {
    let img = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?
        .decode()
        .map_err(|_| "Не удалось прочитать картинку — нужен PNG, JPEG или WebP".to_string())?;
    // resize_to_fill centre-crops instead of stretching
    let square = img.resize_to_fill(COVER_PX, COVER_PX, image::imageops::FilterType::Lanczos3);
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
