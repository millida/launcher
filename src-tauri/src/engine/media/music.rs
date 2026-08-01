use crate::engine::*;

#[derive(serde::Serialize)]
pub struct MusicTrack { pub path: String, pub title: String }

pub fn music_tracks() -> Vec<MusicTrack> {
    let dir = data_dir().join("music");
    std::fs::create_dir_all(&dir).ok();
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !matches!(ext.as_str(), "mp3" | "ogg" | "wav" | "m4a" | "flac") { continue }
            let title = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            out.push(MusicTrack { path: p.to_string_lossy().to_string(), title });
        }
    }
    out.sort_by_key(|t| t.title.to_lowercase());
    out
}

/// Official tracks pulled from the same asset CDN the game itself uses.
pub(crate) const MC_MUSIC_PREFIX: &str = "minecraft/sounds/music/";
pub(crate) const MC_MUSIC_LIMIT: usize = 25;

pub(crate) fn asset_title(key: &str) -> String {
    let stem = key.rsplit('/').next().unwrap_or(key).trim_end_matches(".ogg");
    stem.split('_')
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub async fn download_mc_music() -> Result<u32, String> {
    let root = game_root();
    let manifest = get_json_cached(MANIFEST, &root.join("version_manifest_v2.json")).await?;
    let latest = manifest["latest"]["release"].as_str().ok_or("нет данных о версиях")?.to_string();
    let vurl = manifest["versions"].as_array().and_then(|a| {
        a.iter().find(|v| v["id"].as_str() == Some(latest.as_str()))
            .and_then(|v| v["url"].as_str().map(|s| s.to_string()))
    }).ok_or("не нашли версию игры")?;
    let vjson = get_json(&vurl).await?;
    let aidx_url = vjson["assetIndex"]["url"].as_str().ok_or("нет индекса ассетов")?;
    let aidx = get_json(aidx_url).await?;
    let objects = aidx["objects"].as_object().ok_or("пустой индекс ассетов")?;

    let mut keys: Vec<(&String, &str)> = objects
        .iter()
        .filter(|(k, _)| k.starts_with(MC_MUSIC_PREFIX) && k.ends_with(".ogg"))
        .filter_map(|(k, v)| v["hash"].as_str().map(|h| (k, h)))
        .collect();
    keys.sort_by(|a, b| a.0.cmp(b.0));
    keys.truncate(MC_MUSIC_LIMIT);
    if keys.is_empty() {
        return Err("в ассетах игры не нашлось музыки".into());
    }

    let dir = data_dir().join("music");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut saved = 0u32;
    for (key, hash) in keys {
        let dest = dir.join(format!("{}.ogg", asset_title(key)));
        if dest.exists() {
            saved += 1;
            continue;
        }
        let url = format!("https://resources.download.minecraft.net/{}/{}", &hash[0..2], hash);
        if let Ok(r) = client().get(&url).send().await {
            if let Ok(b) = r.bytes().await {
                if b.len() > 10_000 && std::fs::write(&dest, &b).is_ok() { saved += 1 }
            }
        }
    }
    if saved == 0 {
        return Err("не удалось скачать треки — проверь интернет".into());
    }
    Ok(saved)
}

pub fn open_music_folder() {
    let dir = data_dir().join("music");
    std::fs::create_dir_all(&dir).ok();
    open_path(&dir.to_string_lossy());
}
