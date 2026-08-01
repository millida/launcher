use crate::engine::*;
use serde_json::Value;

pub(crate) const CSL_LATEST: &str = "https://api.github.com/repos/xfl03/MCCustomSkinLoader/releases/latest";
const CSL_JAR: &str = "CustomSkinLoader.jar";
const CSL_OPTOUT: &str = ".millida-skip";
/// Pinned build used when the release feed carries no digest: the jar runs
/// inside the player's JVM, so an unverifiable download is not acceptable.
const CSL_PINNED_URL: &str =
    "https://github.com/xfl03/MCCustomSkinLoader/releases/download/v15.0.1/CustomSkinLoader_Universal-15.0.1.jar";
const CSL_PINNED_SHA256: &str = "026d8b38ea93edccd647f60568193e79801a377b7bd4e916dcfc0d5482b767fc";

fn local_skin_dir() -> std::path::PathBuf { data_dir().join("localskin") }

pub fn set_local_skin(skin: Option<String>, cape: Option<String>, slim: bool) -> Result<(), String> {
    let dir = local_skin_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let write_png = |name: &str, b64: &Option<String>| -> Result<(), String> {
        let p = dir.join(name);
        match b64 {
            Some(b) if !b.is_empty() => {
                let raw = b.rsplit(',').next().unwrap_or(b);
                let bytes = b64_decode(raw).ok_or("битый PNG")?;
                if bytes.len() > 2_000_000 || !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
                    return Err("не PNG или слишком большой".into());
                }
                std::fs::write(&p, &bytes).map_err(|e| e.to_string())
            }
            _ => { let _ = std::fs::remove_file(&p); Ok(()) }
        }
    };
    write_png("skin.png", &skin)?;
    write_png("cape.png", &cape)?;
    write_json_atomic(&dir.join("meta.json"), &serde_json::json!({ "slim": slim }))?;
    Ok(())
}

fn have_local_skin() -> bool { local_skin_dir().join("skin.png").exists() }

fn local_slim() -> bool {
    std::fs::read(local_skin_dir().join("meta.json")).ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .map(|v| v["slim"].as_bool().unwrap_or(false))
        .unwrap_or(false)
}

/// Layout expected by the CustomSkinLoader `Local` source:
/// CustomSkinLoader/LocalSkin/{skins,capes}/<nick>.png
fn place_local_skin(build_dir: &std::path::Path, nick: &str) {
    let src = local_skin_dir();
    let ls = build_dir.join("CustomSkinLoader").join("LocalSkin");
    let safe: String = nick.chars().filter(|c| c.is_alphanumeric() || *c=='_' || *c=='-').collect();
    let safe = if safe.is_empty() { "player".to_string() } else { safe };
    for (sub, file) in [("skins", "skin.png"), ("capes", "cape.png")] {
        let from = src.join(file);
        let to_dir = ls.join(sub);
        let to = to_dir.join(format!("{}.png", safe));
        if from.exists() {
            std::fs::create_dir_all(&to_dir).ok();
            let _ = std::fs::copy(&from, &to);
        } else {
            let _ = std::fs::remove_file(&to);
        }
    }
}

/// Modded profiles only: vanilla has nowhere to load a mod from.
pub async fn ensure_custom_skin_loader(profile: &str, loader: &str, csl_root: Option<&str>, nick: &str) -> Result<(), String> {
    if !matches!(loader, "fabric" | "quilt" | "forge" | "neoforge") {
        return Err("сборка без загрузчика модов".into());
    }
    let dir = profile_dir(profile);
    let mods = dir.join("mods");
    std::fs::create_dir_all(&mods).map_err(|e| e.to_string())?;

    place_local_skin(&dir, nick);

    let cfg_dir = dir.join("CustomSkinLoader");
    std::fs::create_dir_all(&cfg_dir).map_err(|e| e.to_string())?;
    let mut loadlist = vec![serde_json::json!({
        "name": "Local", "type": "Local", "checkPNG": true,
        "model": if local_slim() { "slim" } else { "default" }
    })];
    if let Some(root) = csl_root {
        loadlist.push(serde_json::json!({ "name": "Millida", "type": "CustomSkinAPI", "root": root }));
    }
    loadlist.push(serde_json::json!({ "name": "Mojang", "type": "MojangAPI" }));
    let cfg = serde_json::json!({
        "loadlist": loadlist,
        "enableCape": true,
        "enableDynamicSkull": true,
        "enableTransparentSkin": true,
        "forceLoadAllTextures": true,
        "threadPoolSize": 8,
        "cacheExpiry": 30
    });
    write_json_atomic(&cfg_dir.join("CustomSkinLoader.json"), &cfg)?;

    let jar = mods.join(CSL_JAR);
    // never add a second copy: two mods with the same id is a hard crash
    if jar.exists() || foreign_csl(&mods) {
        return Ok(());
    }
    // opted out after a crash, see drop_custom_skin_loader
    if cfg_dir.join(CSL_OPTOUT).exists() {
        return Ok(());
    }
    let latest = get_json(CSL_LATEST).await.unwrap_or(Value::Null);
    let (url, digest) = signed_universal_asset(&latest)
        .unwrap_or_else(|| (CSL_PINNED_URL.to_string(), CSL_PINNED_SHA256.to_string()));
    download_checked(&url, &jar, Some(Sum::Sha256(&digest)), None).await
}

/// Universal jar plus its sha256 from the release feed (`digest` is
/// "sha256:..."). A release without a digest is rejected as unverifiable.
fn signed_universal_asset(rel: &Value) -> Option<(String, String)> {
    let asset = rel["assets"].as_array()?.iter().find(|x| {
        let n = x["name"].as_str().unwrap_or("");
        n.contains("Universal") && n.ends_with(".jar")
    })?;
    let url = asset["browser_download_url"].as_str()?.to_string();
    let digest = asset["digest"].as_str()?.strip_prefix("sha256:")?.to_lowercase();
    let hex = digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit());
    (hex && url.starts_with("https://")).then_some((url, digest))
}

/// Detects a user-installed CustomSkinLoader. Upstream releases always carry a
/// version in the file name, so the bare `CustomSkinLoader.jar` name marks ours.
fn foreign_csl(mods: &std::path::Path) -> bool {
    let Ok(rd) = std::fs::read_dir(mods) else { return false };
    for e in rd.flatten() {
        let n = e.file_name().to_string_lossy().to_lowercase();
        if !n.ends_with(".jar") || n == CSL_JAR.to_lowercase() { continue }
        if n.replace([' ', '-', '_'], "").contains("customskinloader") { return true }
    }
    false
}

/// Records an opt-out so the mod is not reinstalled after it crashed the game.
pub fn drop_custom_skin_loader(profile: &str) -> bool {
    let dir = profile_dir(profile);
    if !dir.join("mods").join(CSL_JAR).exists() {
        return false;
    }
    let removed = std::fs::remove_file(dir.join("mods").join(CSL_JAR)).is_ok();
    if removed {
        let _ = std::fs::create_dir_all(dir.join("CustomSkinLoader"));
        let _ = std::fs::write(dir.join("CustomSkinLoader").join(CSL_OPTOUT), b"crash");
    }
    removed
}

pub fn want_in_game_skins(csl_root: Option<&str>) -> bool {
    have_local_skin() || csl_root.is_some()
}
