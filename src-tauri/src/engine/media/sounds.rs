use crate::engine::*;
use std::path::PathBuf;

#[derive(serde::Serialize)]
pub struct UiSound {
    pub event: String,
    pub path: String,
}

/// UI sounds are downloaded from the Mojang asset CDN rather than bundled, so
/// no game assets are redistributed. The second key is a fallback for versions
/// where the first one no longer exists in the asset index.
/// Короткие мелодичные звуки нотного блока и опыта вместо сундуков и маяка
/// (владелец 24.09.2026, 14:01: «мелодичные, маленькие, миленькие»).
const UI_SOUNDS: &[(&str, &[&str])] = &[
    ("click", &["note/xylobone.ogg", "random/click.ogg"]),
    ("nav", &["note/bit.ogg", "random/click.ogg"]),
    ("toggle", &["random/pop.ogg"]),
    ("open", &["note/pling.ogg"]),
    ("close", &["note/pling.ogg"]),
    ("notify", &["note/bell.ogg", "note/pling.ogg"]),
    ("success", &["random/orb.ogg"]),
    ("install", &["note/icechime.ogg", "random/orb.ogg"]),
    ("achievement", &["random/levelup.ogg"]),
    ("error", &["note/bass.ogg", "note/didgeridoo.ogg"]),
    ("delete", &["item/bundle/remove_one1.ogg", "random/pop.ogg"]),
    ("login", &["note/flute.ogg", "ui/toast/in.ogg"]),
    ("launch", &["random/levelup.ogg"]),
    ("crash", &["note/didgeridoo.ogg", "note/bass.ogg"]),
    // Сундук — звуки Minecraft (владелец 24.09.2026, 18:56).
    ("chest_hit", &["dig/wood1.ogg", "dig/wood2.ogg"]),
    ("chest_crack", &["random/break.ogg"]),
    ("chest_open", &["random/chestopen.ogg"]),
    ("chest_card", &["random/orb.ogg"]),
    ("chest_rare", &["block/amethyst/break1.ogg", "random/orb.ogg"]),
    ("chest_epic", &["ui/toast/challenge_complete.ogg", "random/levelup.ogg"]),
    ("chest_gold", &["item/armor/equip_gold1.ogg", "random/orb.ogg"]),
];

const PREFIX: &str = "minecraft/sounds/";

fn sounds_dir() -> PathBuf {
    data_dir().join("sounds-v2")
}

pub fn ui_sounds() -> Vec<UiSound> {
    let dir = sounds_dir();
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x.to_string_lossy().to_lowercase()) != Some("wav".into()) {
                continue;
            }
            let event = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            if !UI_SOUNDS.iter().any(|(e, _)| *e == event) {
                std::fs::remove_file(&p).ok();
                continue;
            }
            out.push(UiSound { event, path: p.to_string_lossy().to_string() });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Game assets are ogg/vorbis, which WKWebView on macOS cannot play, so they
/// are transcoded to WAV once at download time.
fn ogg_to_wav(data: &[u8]) -> Option<Vec<u8>> {
    let mut rd = lewton::inside_ogg::OggStreamReader::new(std::io::Cursor::new(data.to_vec())).ok()?;
    let channels = rd.ident_hdr.audio_channels.max(1) as u16;
    let rate = rd.ident_hdr.audio_sample_rate;
    let mut pcm: Vec<i16> = vec![];
    while let Ok(Some(frame)) = rd.read_dec_packet_itl() {
        pcm.extend_from_slice(&frame);
    }
    if pcm.is_empty() {
        return None;
    }
    let bytes = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(bytes as usize + 44);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + bytes).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * channels as u32 * 2).to_le_bytes());
    out.extend_from_slice(&(channels * 2).to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&bytes.to_le_bytes());
    pcm.iter().for_each(|s| out.extend_from_slice(&s.to_le_bytes()));
    Some(out)
}

fn missing_events(have: &[UiSound]) -> Vec<&'static (&'static str, &'static [&'static str])> {
    UI_SOUNDS.iter().filter(|(e, _)| !have.iter().any(|s| s.event == *e)).collect()
}

pub async fn download_ui_sounds() -> Result<Vec<UiSound>, String> {
    let have = ui_sounds();
    if missing_events(&have).is_empty() {
        return Ok(have);
    }

    let root = game_root();
    let manifest = get_json_cached(MANIFEST, &root.join("version_manifest_v2.json")).await?;
    let latest = manifest["latest"]["release"].as_str().ok_or("нет данных о версиях")?.to_string();
    let vurl = manifest["versions"]
        .as_array()
        .and_then(|a| {
            a.iter()
                .find(|v| v["id"].as_str() == Some(latest.as_str()))
                .and_then(|v| v["url"].as_str().map(|s| s.to_string()))
        })
        .ok_or("не нашли версию игры")?;
    let vjson = get_json(&vurl).await?;
    let aidx_url = vjson["assetIndex"]["url"].as_str().ok_or("нет индекса ассетов")?;
    let aidx = get_json(aidx_url).await?;
    let objects = aidx["objects"].as_object().ok_or("пустой индекс ассетов")?;

    let dir = sounds_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for (event, keys) in UI_SOUNDS {
        if have.iter().any(|s| s.event == *event) {
            continue;
        }
        for key in *keys {
            // asset keys change between versions; fall back to the next one
            let hash = match objects.get(&format!("{}{}", PREFIX, key)).and_then(|v| v["hash"].as_str()) {
                Some(h) if h.len() > 2 => h.to_string(),
                _ => continue,
            };
            let dest = dir.join(format!("{}.wav", event));
            let url = format!("{}/{}/{}", RESOURCES, &hash[0..2], hash);
            if let Ok(r) = client().get(&url).send().await {
                if let Ok(b) = r.bytes().await {
                    if let Some(wav) = ogg_to_wav(&b) {
                        if std::fs::write(&dest, &wav).is_ok() {
                            break;
                        }
                    }
                }
            }
        }
    }

    let out = ui_sounds();
    if out.is_empty() {
        return Err("не удалось скачать звуки — проверь интернет".into());
    }
    Ok(out)
}
