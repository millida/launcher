use crate::engine::*;
use std::path::{Path, PathBuf};

pub const MUSIC_EXTS: [&str; 5] = ["mp3", "ogg", "wav", "m4a", "flac"];
const MAX_TRACK_BYTES: u64 = 100 * 1024 * 1024;

#[derive(serde::Serialize)]
pub struct MusicTrack { pub path: String, pub file: String, pub title: String }

#[derive(serde::Serialize)]
pub struct MusicAdded { pub added: u32, pub too_big: Vec<String> }

fn music_dir() -> PathBuf {
    data_dir().join("music")
}

fn is_music_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|x| x.to_string_lossy().to_lowercase())
        .is_some_and(|ext| MUSIC_EXTS.contains(&ext.as_str()))
}

/// Every file name download_mc_music could have written (music of Minecraft
/// 1.17 – 26.3). Until 24.09.2026 the launcher filled the music folder with
/// these on its own, so they are not the player's music and stay out of the list.
const AUTO_MC_TRACKS: &[&str] = &[
    "A Familiar Room", "Aerie", "Alpha", "An Ordinary Day", "Ancestry", "Aria Math", "Axolotl",
    "Ballad Of The Cats", "Beginning 2", "Below And Above", "Biome Fest", "Blind Spots", "Boss",
    "Broken Clocks", "Bromeliad", "Calm1", "Calm2", "Calm3", "Chrysopoeia", "Clark",
    "Comforting Memories", "Concrete Halls", "Creative1", "Creative2", "Creative3", "Creative4",
    "Creative5", "Creative6", "Credits", "Crescent Dunes", "Danny", "Dead Voxel", "Deeper",
    "Dragon Fish", "Dreiton", "Dry Hands", "Ebb", "Echo In The Wind", "Eld Unknown", "End",
    "Endless", "Featherfall", "Firebugs", "Fireflies", "Floating Dream", "Floating Trees",
    "Haggstrom", "Hal1", "Hal2", "Hal3", "Hal4", "Haunt Muskie", "Home", "Infinite Amethyst", "Key",
    "Komorebi", "Labyrinthine", "Left To Bloom", "Lilypad", "Living Mice", "Memories", "Menu1",
    "Menu2", "Menu3", "Menu4", "Mice On Venus", "Minecraft", "Moog City 2", "Mutation", "Nether1",
    "Nether2", "Nether3", "Nether4", "Nightly", "Nuance1", "Nuance2", "One More Day", "Os Piano",
    "Oxygene", "Piano1", "Piano2", "Piano3", "Pokopoko", "Puzzlebox", "Rubedo", "Shores", "Shuniji",
    "So Below", "Stand Tall", "Subwoofer Lullaby", "Sweden", "Taswell", "The End", "Warmth",
    "Watcher", "Wending", "Wet Hands", "Yakusoku",
];

fn is_auto_mc_track(file: &str) -> bool {
    file.strip_suffix(".ogg").is_some_and(|stem| AUTO_MC_TRACKS.contains(&stem))
}

pub fn music_tracks() -> Vec<MusicTrack> {
    let dir = music_dir();
    std::fs::create_dir_all(&dir).ok();
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            let file = e.file_name().to_string_lossy().to_string();
            if !is_music_name(&file) || file.starts_with('.') || is_auto_mc_track(&file) { continue }
            let title = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
            out.push(MusicTrack { path: p.to_string_lossy().to_string(), file, title });
        }
    }
    out.sort_by_key(|t| t.title.to_lowercase());
    out
}

fn free_name(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let first = safe_child(dir, name)?;
    if !first.exists() {
        return Ok(first);
    }
    let path = Path::new(name);
    let stem = path.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
    for n in 2..1000 {
        let next = safe_child(dir, &format!("{} ({}).{}", stem, n, ext))?;
        if !next.exists() {
            return Ok(next);
        }
    }
    Err(format!("{}: слишком много файлов с таким именем, переименуй его", name))
}

/// Sources come only from the core's own file picker, never from the webview.
pub fn add_music_files(paths: Vec<PathBuf>) -> Result<MusicAdded, String> {
    let dir = music_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {}", dir.display(), e))?;
    let mut res = MusicAdded { added: 0, too_big: vec![] };
    for src in paths {
        let name = safe_file_name(&src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default())?;
        if !is_music_name(&name) {
            return Err(format!("{}: нужен файл mp3, ogg, wav, m4a или flac", name));
        }
        let size = std::fs::metadata(&src).map_err(|e| format!("{}: {}", src.display(), e))?.len();
        if size > MAX_TRACK_BYTES {
            res.too_big.push(name);
            continue;
        }
        let dest = free_name(&dir, &name)?;
        let part = safe_child(&dir, &format!(".{}.part", name))?;
        if let Err(e) = std::fs::copy(&src, &part).and_then(|_| std::fs::rename(&part, &dest)) {
            let _ = std::fs::remove_file(&part);
            return Err(format!("{}: не удалось скопировать — {}", name, e));
        }
        res.added += 1;
    }
    Ok(res)
}

pub fn remove_music_track(file: &str) -> Result<(), String> {
    let name = safe_file_name(file)?;
    if !is_music_name(&name) {
        return Err(format!("{}: это не трек", name));
    }
    let path = safe_child(&music_dir(), &name)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: не удалось удалить — {}", name, e)),
    }
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

    let dir = music_dir();
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
    let dir = music_dir();
    std::fs::create_dir_all(&dir).ok();
    open_path(&dir.to_string_lossy());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_audio_names_count_as_tracks() {
        let cases: &[(&str, bool, &str)] = &[
            ("song.mp3", true, "the common case"),
            ("Song.FLAC", true, "extensions are case-insensitive on Windows"),
            ("loop.ogg", true, "Minecraft-style tracks"),
            ("setup.exe", false, "an executable must never land in the music folder"),
            ("song.mp3.part", false, "an unfinished copy must not be played"),
            ("noext", false, "no extension is not audio"),
        ];
        for (name, want, why) in cases {
            assert_eq!(is_music_name(name), *want, "{}: {}", name, why);
        }
    }

    #[test]
    fn music_the_launcher_downloaded_itself_is_not_the_players() {
        let cases: &[(&str, bool, &str)] = &[
            ("Sweden.ogg", true, "C418 from the old automatic download"),
            ("A Familiar Room.ogg", true, "a multi-word title the download produced"),
            ("Sweden.mp3", false, "the player's own copy in another format is theirs"),
            ("Sweden (2).ogg", false, "a renamed copy is the player's"),
            ("my mix.ogg", false, "an ordinary player track"),
        ];
        for (name, want, why) in cases {
            assert_eq!(is_auto_mc_track(name), *want, "{}: {}", name, why);
        }
    }

    #[test]
    fn free_name_never_overwrites_an_existing_track() {
        let dir = std::env::temp_dir().join("millida-music-free-name");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_name(&dir, "a.mp3").unwrap(), dir.join("a.mp3"), "a free name is kept as is");
        std::fs::write(dir.join("a.mp3"), b"x").unwrap();
        assert_eq!(
            free_name(&dir, "a.mp3").unwrap(),
            dir.join("a (2).mp3"),
            "adding a second track with the same name must not replace the player's first one",
        );
        assert!(free_name(&dir, "../a.mp3").is_err(), "a name with a path must be refused");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
