use crate::engine::*;

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
    let picked = pick_file(dialog().add_filter("PNG", &["png"]).set_title("Скин или плащ (PNG)")).await;
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
            .add_filter("Фон", &["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov", "m4v"])
            .set_title("Свой фон лаунчера"),
    )
    .await;
    let Some(src) = picked else { return Ok(None) };
    let ext = src.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let kind = if matches!(ext.as_str(), "mp4" | "webm" | "mov" | "m4v") { "video" } else { "image" };
    let dir = data_dir().join("wallpaper");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "wallpaper".into());
    let uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dest = dir.join(format!("wp_{}.{}", uniq, ext));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    if let Ok(rd) = std::fs::read_dir(&dir) {
        let mut wps: Vec<(std::path::PathBuf, std::time::SystemTime)> = Vec::new();
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
        for (p, _) in wps.into_iter().skip(8) {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(Some(CustomWallpaper {
        kind: kind.into(),
        path: dest.to_string_lossy().to_string(),
        name,
    }))
}
