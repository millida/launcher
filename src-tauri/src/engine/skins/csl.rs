use crate::engine::*;
use serde_json::Value;

pub(crate) const CSL_LATEST: &str = "https://api.github.com/repos/xfl03/MCCustomSkinLoader/releases/latest";
const CSL_JAR: &str = "CustomSkinLoader.jar";
const CSL_DISABLED: &str = "CustomSkinLoader.jar.disabled";
const CSL_OPTOUT: &str = ".millida-skip";
/// Mods that already answer for the player's skin. Two of them in one build
/// patch the same texture path, and a downloaded pack that ships its own one
/// crashed as soon as the launcher added a second.
const SKIN_OWNING_MODS: [&str; 6] = [
    "customskinloader",
    "hdskins",
    "offlineskins",
    "skinrestorer",
    "fabrictailor",
    "entitytexturefeatures",
];
/// Pinned build used when the release feed carries no digest: the jar runs
/// inside the player's JVM, so an unverifiable download is not acceptable.
const CSL_PINNED_URL: &str =
    "https://github.com/xfl03/MCCustomSkinLoader/releases/download/v15.0.1/CustomSkinLoader_Universal-15.0.1.jar";
const CSL_PINNED_SHA256: &str = "026d8b38ea93edccd647f60568193e79801a377b7bd4e916dcfc0d5482b767fc";

fn local_skin_dir() -> std::path::PathBuf { data_dir().join("localskin") }

/// Layout the `Legacy` source reads, relative to the build's CustomSkinLoader
/// folder. The loadlist paths and the files the launcher copies must stay in
/// step: a mismatch is silent, the mod simply finds no texture.
const CSL_LOCAL_DIR: &str = "LocalSkin";
const CSL_SKINS_SUB: &str = "skins";
const CSL_CAPES_SUB: &str = "capes";

/// `None` leaves the texture as it is, `Some("")` removes it: changing only the
/// skin must not silently drop a cape the player still wears.
pub fn set_local_skin(skin: Option<String>, cape: Option<String>, slim: bool) -> Result<(), String> {
    let dir = local_skin_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let write_png = |name: &str, b64: &Option<String>| -> Result<(), String> {
        let Some(b) = b64 else { return Ok(()) };
        let p = dir.join(name);
        if b.is_empty() {
            let _ = std::fs::remove_file(&p);
            return Ok(());
        }
        let raw = b.rsplit(',').next().unwrap_or(b);
        let bytes = b64_decode(raw).ok_or("битый PNG")?;
        if bytes.len() > 2_000_000 || !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            return Err("не PNG или слишком большой".into());
        }
        std::fs::write(&p, &bytes).map_err(|e| e.to_string())
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
    let ls = build_dir.join("CustomSkinLoader").join(CSL_LOCAL_DIR);
    let safe: String = nick.chars().filter(|c| c.is_alphanumeric() || *c=='_' || *c=='-').collect();
    let safe = if safe.is_empty() { "player".to_string() } else { safe };
    for (sub, file) in [(CSL_SKINS_SUB, "skin.png"), (CSL_CAPES_SUB, "cape.png")] {
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

/// Texture sources in the order CustomSkinLoader asks them.
///
/// The account goes first and the local copy is only a fallback: with Local
/// ahead of it the game kept showing the skin of the last "Apply" click while
/// the wardrobe, the site and finished Skins orders changed the account one.
/// Mojang answers by nickname, so it is asked only for a Mojang account —
/// otherwise the same name there belongs to a stranger whose skin the player
/// then wears in game.
/// The local copy is a `Legacy` source over `CustomSkinLoader/LocalSkin`: the
/// mod has no `Local` type, and an unknown type is skipped with a line in the
/// log, so the copy the launcher writes never reached the game.
/// `GameProfile` is the only source that reads the texture the server itself
/// attached to a profile, and the mod routes decorative player heads through the
/// same list: without it a case head is looked up by the nickname stored in it
/// and comes back wearing some player's skin instead of its own texture.
fn csl_loadlist(csl_root: Option<&str>, licensed: bool, slim: bool) -> Vec<Value> {
    let mut list = Vec::new();
    if let Some(root) = csl_root {
        list.push(serde_json::json!({ "name": "Millida", "type": "CustomSkinAPI", "root": root }));
    }
    list.push(serde_json::json!({ "name": "GameProfile", "type": "GameProfile" }));
    list.push(serde_json::json!({
        "name": "LocalSkin",
        "type": "Legacy",
        "checkPNG": false,
        "skin": format!("{}/{}/{{USERNAME}}.png", CSL_LOCAL_DIR, CSL_SKINS_SUB),
        "cape": format!("{}/{}/{{USERNAME}}.png", CSL_LOCAL_DIR, CSL_CAPES_SUB),
        "model": if slim { "slim" } else { "default" }
    }));
    if licensed {
        list.push(serde_json::json!({ "name": "Mojang", "type": "MojangAPI" }));
    }
    list
}

#[derive(PartialEq, Debug)]
enum Absent { Install, Skip, OptOut }

/// What to do when the launcher's own jar is not in `mods/`. Only a build that
/// never had it gets one: a jar the player disabled or deleted used to come back
/// on the very next launch, so a build the mod does not fit crashed again however
/// many times the player took it out.
fn absent_action(switch_on: bool, disabled_copy: bool, installed_before: bool) -> Absent {
    if !switch_on {
        Absent::Skip
    } else if disabled_copy || installed_before {
        Absent::OptOut
    } else {
        Absent::Install
    }
}

/// Modded profiles only: vanilla has nowhere to load a mod from.
/// `licensed` means the launch runs on a Mojang account: only then may Mojang
/// answer for this nickname — for a Millida or offline account the same name
/// belongs to a stranger there, and the game would show that stranger's skin.
pub async fn ensure_custom_skin_loader(
    profile: &str,
    loader: &str,
    csl_root: Option<&str>,
    nick: &str,
    licensed: bool,
) -> Result<(), String> {
    if !matches!(loader, "fabric" | "quilt" | "forge" | "neoforge") {
        return Err("сборка без загрузчика модов".into());
    }
    let dir = profile_dir(profile);
    let mods = dir.join("mods");
    std::fs::create_dir_all(&mods).map_err(|e| e.to_string())?;

    let jar = mods.join(CSL_JAR);
    let other = skin_owning_mod(&mods);
    let present = jar.exists() || other.is_some();
    if !present {
        match absent_action(
            skin_mod_on(profile),
            mods.join(CSL_DISABLED).exists(),
            profile_settings(profile)["skinModInstalled"].as_bool().unwrap_or(false),
        ) {
            Absent::Install => {}
            Absent::Skip => return Ok(()),
            Absent::OptOut => {
                note_skin_mod_removed(profile);
                return Ok(());
            }
        }
    }

    place_local_skin(&dir, nick);

    let cfg_dir = dir.join("CustomSkinLoader");
    std::fs::create_dir_all(&cfg_dir).map_err(|e| e.to_string())?;
    let cfg = serde_json::json!({
        "loadlist": csl_loadlist(csl_root, licensed, local_slim()),
        "enableCape": true,
        "enableDynamicSkull": true,
        "enableTransparentSkin": true,
        "forceLoadAllTextures": true,
        "threadPoolSize": 8,
        // Seconds a profile is kept without asking the sources again.
        "cacheExpiry": 30
    });
    write_json_atomic(&cfg_dir.join("CustomSkinLoader.json"), &cfg)?;

    if jar.exists() {
        return Ok(());
    }
    // never add a second one: a copy of the same mod is a hard crash on the
    // loader, and a different skin mod fights ours over the same texture
    if let Some(other) = other {
        return if is_csl(&other) { Ok(()) } else {
            Err(format!("в сборке уже есть свой мод скинов ({})", other))
        };
    }
    let latest = get_json(CSL_LATEST).await.unwrap_or(Value::Null);
    let (url, digest) = signed_universal_asset(&latest)
        .unwrap_or_else(|| (CSL_PINNED_URL.to_string(), CSL_PINNED_SHA256.to_string()));
    download_checked(&url, &jar, Some(Sum::Sha256(&digest)), None).await?;
    // last, and only on a real success: a marker set next to the attempt would
    // make a failed download look like a jar the player deleted
    mark_installed(profile, true);
    Ok(())
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

/// A mod in the build that already owns the player's skin, ours excluded.
/// Upstream CustomSkinLoader releases always carry a version in the file name,
/// so the bare `CustomSkinLoader.jar` name marks the copy the launcher added.
fn is_csl(file_name: &str) -> bool {
    file_name.to_lowercase().replace([' ', '-', '_'], "").contains("customskinloader")
}

fn skin_owning_mod(mods: &std::path::Path) -> Option<String> {
    let rd = std::fs::read_dir(mods).ok()?;
    for e in rd.flatten() {
        let raw = e.file_name().to_string_lossy().to_string();
        let n = raw.to_lowercase();
        // a disabled file is not loaded, so it collides with nothing
        if !n.ends_with(".jar") || n == CSL_JAR.to_lowercase() { continue }
        let flat = n.replace([' ', '-', '_'], "");
        if SKIN_OWNING_MODS.iter().any(|m| flat.contains(m)) {
            return Some(raw);
        }
    }
    None
}

/// Records an opt-out so the mod is not reinstalled after it crashed the game.
pub fn drop_custom_skin_loader(profile: &str) -> bool {
    let jar = profile_dir(profile).join("mods").join(CSL_JAR);
    if !jar.exists() {
        return false;
    }
    let removed = std::fs::remove_file(&jar).is_ok();
    if removed {
        opt_out(profile, b"crash");
    }
    removed
}

/// The single place that turns the injected mod off: the file marker survives a
/// settings file rewritten by an older build, the setting is what the build
/// screen shows, and the install marker must go so a later launch does not read
/// "installed but missing" and opt out a second time.
fn opt_out(profile: &str, why: &[u8]) {
    let cfg = profile_dir(profile).join("CustomSkinLoader");
    let _ = std::fs::create_dir_all(&cfg);
    let _ = std::fs::write(cfg.join(CSL_OPTOUT), why);
    let mut patch = serde_json::Map::new();
    patch.insert("skinMod".into(), Value::String("off".into()));
    patch.insert("skinModInstalled".into(), Value::Bool(false));
    merge_settings(profile, patch);
}

fn profile_settings(profile: &str) -> Value {
    std::fs::read(profile_dir(profile).join("millida-settings.json")).ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

fn skin_mod_on(profile: &str) -> bool {
    profile_settings(profile)["skinMod"].as_str() != Some("off")
        && !profile_dir(profile).join("CustomSkinLoader").join(CSL_OPTOUT).exists()
}

fn mark_installed(profile: &str, installed: bool) {
    let mut patch = serde_json::Map::new();
    patch.insert("skinModInstalled".into(), Value::Bool(installed));
    merge_settings(profile, patch);
}

/// The file name the launcher gives its own copy, so the mods list can tell
/// removing it apart from removing a mod the build brought itself.
pub fn is_injected_skin_mod(file: &str) -> bool { file.eq_ignore_ascii_case(CSL_JAR) }

/// Called when a pack install wipes `mods/`: the jar it removed was not taken
/// out by the player, so the next launch must not read that as an opt-out.
pub fn forget_skin_mod_install(profile: &str) {
    mark_installed(profile, false);
}

/// The player took our jar out of `mods/` through the launcher. Every earlier
/// version put it straight back on the next launch, which is how a build that
/// the mod does not fit kept crashing after the player had already fixed it.
pub fn note_skin_mod_removed(profile: &str) {
    opt_out(profile, b"removed");
}

pub fn skin_mod_state(profile: &str) -> Value {
    let mods = profile_dir(profile).join("mods");
    serde_json::json!({
        "on": skin_mod_on(profile),
        "present": mods.join(CSL_JAR).exists(),
        "conflict": skin_owning_mod(&mods)
    })
}

/// Turning it back on clears the opt-out; turning it off takes the jar out now,
/// so the build screen and `mods/` never disagree.
pub fn set_skin_mod(profile: &str, on: bool) -> Result<Value, String> {
    if on {
        let _ = std::fs::remove_file(profile_dir(profile).join("CustomSkinLoader").join(CSL_OPTOUT));
        let mut patch = serde_json::Map::new();
        patch.insert("skinMod".into(), Value::String("auto".into()));
        merge_settings(profile, patch);
    } else {
        let jar = profile_dir(profile).join("mods").join(CSL_JAR);
        if jar.exists() {
            std::fs::remove_file(&jar)
                .map_err(|e| format!("Не удалось убрать мод скинов: {} — закрой игру и попробуй ещё раз", e))?;
        }
        opt_out(profile, b"off");
    }
    Ok(skin_mod_state(profile))
}

pub fn want_in_game_skins(csl_root: Option<&str>) -> bool {
    have_local_skin() || csl_root.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[Value]) -> Vec<String> {
        list.iter().map(|s| s["name"].as_str().unwrap_or("").to_string()).collect()
    }

    fn source(list: &[Value], name: &str) -> Value {
        list.iter().find(|s| s["name"] == name).cloned().unwrap_or(Value::Null)
    }

    /// account   | licensed | expected order
    /// Millida   | no       | Millida, GameProfile, Local — Mojang answers by nickname
    /// offline   | no       | GameProfile, Local — nothing else knows this player
    /// Mojang    | yes      | GameProfile, Local, Mojang — the licence is the player's own
    #[test]
    fn loadlist_order_puts_account_first_and_mojang_only_for_a_licence() {
        assert_eq!(
            names(&csl_loadlist(Some("https://api/yggdrasil/csl/"), false, false)),
            ["Millida", "GameProfile", "LocalSkin"],
            "аккаунт Millida обязан опрашиваться раньше локальной копии, иначе в игре остаётся скин с прошлого «Применить»"
        );
        assert_eq!(
            names(&csl_loadlist(None, false, false)),
            ["GameProfile", "LocalSkin"],
            "без лицензии Mojang спрашивать нельзя: этот ник там принадлежит постороннему игроку"
        );
        assert_eq!(
            names(&csl_loadlist(None, true, false)),
            ["GameProfile", "LocalSkin", "Mojang"],
            "на лицензии Mojang — законный источник скина"
        );
    }

    /// Decorative heads (cases, crates, decorations) carry their texture in the
    /// profile the server sends. The mod resolves them through this same list, so
    /// without `GameProfile` the head is looked up by the nickname stored in it
    /// and shows a stranger's skin — the licence made it worse, not better,
    /// because Mojang answers for far more nicknames than our own API does.
    #[test]
    fn server_supplied_textures_have_a_source_and_it_outranks_every_nickname_lookup() {
        for licensed in [false, true] {
            let list = csl_loadlist(Some("https://api/yggdrasil/csl/"), licensed, false);
            let n = names(&list);
            let gp = n.iter().position(|x| x == "GameProfile").expect(
                "без источника GameProfile головы-кейсы теряют свою текстуру и ищутся по нику",
            );
            assert_eq!(
                source(&list, "GameProfile")["type"], "GameProfile",
                "тип обязан быть из реализованных модом, иначе источник молча выкидывается"
            );
            for by_nick in ["LocalSkin", "Mojang"] {
                if let Some(i) = n.iter().position(|x| x == by_nick) {
                    assert!(
                        gp < i,
                        "{} ищет по нику и обязан спрашиваться после текстуры, которую прислал сервер",
                        by_nick
                    );
                }
            }
        }
    }

    /// The mod knows no `Local` type: it logged "Type 'Local' is not defined."
    /// and dropped the source, so the catalog skin never showed up in game.
    #[test]
    fn local_source_uses_a_type_the_mod_implements_and_the_paths_it_is_given() {
        let local = source(&csl_loadlist(None, false, false), "LocalSkin");
        assert_eq!(local["type"], "Legacy", "тип обязан быть из реализованных модом, иначе источник молча выкидывается");
        assert_eq!(
            local["skin"], "LocalSkin/skins/{USERNAME}.png",
            "путь скина обязан совпадать с тем, куда кладёт файл place_local_skin"
        );
        assert_eq!(local["cape"], "LocalSkin/capes/{USERNAME}.png");
    }

    /// switch | disabled copy | installed before | verdict
    /// on     | no            | no               | Install — a build that never had it
    /// on     | no            | yes              | OptOut  — the player deleted the jar
    /// on     | yes           | no               | OptOut  — the player disabled the jar
    /// off    | any           | any              | Skip    — already opted out
    #[test]
    fn a_jar_the_player_took_out_is_never_downloaded_again() {
        assert_eq!(absent_action(true, false, false), Absent::Install);
        assert_eq!(
            absent_action(true, false, true),
            Absent::OptOut,
            "мод уже ставили и его нет — игрок удалил его сам, вернуть его значит снова уронить сборку"
        );
        assert_eq!(
            absent_action(true, true, false),
            Absent::OptOut,
            "выключенная копия в mods/ — это отказ игрока, а не повод скачать вторую"
        );
        assert_eq!(absent_action(false, false, false), Absent::Skip);
        assert_eq!(absent_action(false, true, true), Absent::Skip);
    }

    #[test]
    fn a_build_with_its_own_skin_mod_is_left_alone() {
        let dir = std::env::temp_dir().join("millida-csl-conflict-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let touch = |n: &str| std::fs::write(dir.join(n), b"x").unwrap();

        touch("sodium-fabric-0.5.jar");
        touch("readme.txt");
        assert_eq!(skin_owning_mod(&dir), None, "обычные моды сборки не мешают скинам");

        touch("HDSkins-1.20.jar");
        assert_eq!(
            skin_owning_mod(&dir).as_deref(),
            Some("HDSkins-1.20.jar"),
            "второй мод скинов дерётся с нашим за ту же текстуру — свой ставить нельзя"
        );

        std::fs::remove_file(dir.join("HDSkins-1.20.jar")).unwrap();
        touch("CustomSkinLoader_Fabric-15.0.1.jar");
        let own = skin_owning_mod(&dir).unwrap();
        assert!(is_csl(&own), "чужая копия того же мода узнаётся и второй экземпляр не ставится");
        assert!(!is_csl("sodium-fabric-0.5.jar"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn loadlist_passes_the_arm_model_to_the_local_source() {
        let slim = source(&csl_loadlist(None, false, true), "LocalSkin");
        assert_eq!(slim["model"], "slim", "тонкие руки должны доехать до мода, иначе руки в игре толстые");
        let classic = source(&csl_loadlist(None, false, false), "LocalSkin");
        assert_eq!(classic["model"], "default");
    }
}
