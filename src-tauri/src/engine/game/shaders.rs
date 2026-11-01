// "Shaders in one click": a renderer (Sodium or Embeddium), a shader loader (Iris or Oculus) and a light shader pack from Modrinth,
// then the pack is switched on in the loader's config. Turning it off removes exactly what it added.
use super::fpsboost::{
    enabled_jars, optifine_among, patch, profile_loader, profile_version, settings_of, slot_filled, stable_pick, str_list, Slot, RENDERERS,
};
use crate::engine::*;
use serde_json::Value;
use tauri::AppHandle;

/// A renderer and the shader loader built on it. Iris runs only on Sodium and
/// Oculus only on Embeddium (Rubidium on older Forge), so they are picked as a pair.
struct Kit {
    renderer: &'static str,
    shaders: &'static str,
}

const SHADER_LOADERS: &[&str] = &["iris", "oculus"];

const FABRIC_KITS: &[Kit] = &[Kit { renderer: "sodium", shaders: "iris" }];
const NEOFORGE_KITS: &[Kit] = &[Kit { renderer: "sodium", shaders: "iris" }, Kit { renderer: "embeddium", shaders: "oculus" }];
const FORGE_KITS: &[Kit] = &[Kit { renderer: "embeddium", shaders: "oculus" }, Kit { renderer: "rubidium", shaders: "oculus" }];

/// Light packs first: the button promises shaders on an ordinary computer,
/// not a benchmark. Complementary is the fallback when MakeUp has no file.
const SHADER_PACKS: &[&str] = &["makeup-ultra-fast-shaders", "complementary-reimagined"];

/// The "Epic" graphics preset asks for the full-looking packs instead, and only
/// on a discrete card (see `presets.rs`). Both are in the Millida catalogue
/// with a stated licence and are downloaded from Modrinth, never re-hosted.
pub(super) const EPIC_SHADER_PACKS: &[&str] = &["complementary-reimagined", "bsl-shaders"];

fn kits(loader: &str) -> &'static [Kit] {
    match loader {
        "fabric" | "quilt" => FABRIC_KITS,
        "neoforge" => NEOFORGE_KITS,
        "forge" => FORGE_KITS,
        _ => &[],
    }
}

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShadersState {
    pub enabled: bool,
    /// The build's loader takes shader mods at all.
    pub supported: bool,
    /// False for a catalogue pack whose author tuned graphics (see `fps_boost_applicable`).
    pub applicable: bool,
    /// OptiFine is in the build: Iris and Sodium crash next to it.
    pub optifine: bool,
    pub pack: String,
}

pub fn shaders_state(profile: &str) -> ShadersState {
    let s = settings_of(profile);
    ShadersState {
        enabled: s["shaders"].as_bool().unwrap_or(false),
        supported: !kits(&profile_loader(profile)).is_empty(),
        applicable: fps_boost_applicable(profile),
        optifine: optifine_among(&enabled_jars(profile)),
        pack: s["shadersPack"].as_str().unwrap_or("").to_string(),
    }
}

fn single(slug: &'static &'static str) -> Slot {
    Slot { install: std::slice::from_ref(slug), counts: std::slice::from_ref(slug), optifine_clash: true }
}

fn config_name(shaders: &str) -> &'static str {
    if shaders == "oculus" { "oculus.properties" } else { "iris.properties" }
}

fn property_of(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let (k, v) = l.split_once('=')?;
        (k.trim() == key).then(|| v.trim().to_string())
    })
}

/// Turns the pack on in the loader's config and returns what was there before,
/// so turning the mode off puts the player's own choice back.
fn switch_on(profile: &str, shaders: &str, pack: &str) -> Result<Value, String> {
    let path = profile_dir(profile).join("config").join(config_name(shaders));
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let before = serde_json::json!({
        "enableShaders": property_of(&text, "enableShaders"),
        "shaderPack": property_of(&text, "shaderPack"),
    });
    let text = set_property(&set_property(&text, "enableShaders", "true"), "shaderPack", pack);
    write_bytes_atomic(&path, text.as_bytes())?;
    Ok(before)
}

fn switch_back(profile: &str, shaders: &str, before: &Value) -> Result<(), String> {
    let path = profile_dir(profile).join("config").join(config_name(shaders));
    let Ok(text) = std::fs::read_to_string(&path) else { return Ok(()) };
    let enable = before["enableShaders"].as_str().unwrap_or("false");
    let mut text = set_property(&text, "enableShaders", enable);
    if let Some(pack) = before["shaderPack"].as_str() {
        text = set_property(&text, "shaderPack", pack);
    }
    write_bytes_atomic(&path, text.as_bytes())
}

pub async fn set_shaders(app: AppHandle, profile: String, on: bool) -> Result<ShadersState, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    if on {
        enable(&app, &profile, SHADER_PACKS).await
    } else {
        disable(&profile)
    }
}

async fn latest_fit(slug: &str, version: &str, loaders: &[String]) -> Option<Value> {
    let all = project_versions(slug).await.ok()?;
    stable_pick(&all, version, loaders)
}

/// A shader pack runs on far more game versions than its listing names, so a
/// pack without a file for this exact version still takes the newest release.
async fn pick_pack(version: &str, packs: &'static [&'static str]) -> Option<(&'static str, Value)> {
    let loaders = vec!["iris".to_string()];
    for slug in packs {
        let Ok(all) = project_versions(slug).await else { continue };
        if let Some(v) = stable_pick(&all, version, &loaders).or_else(|| stable_pick(&all, "", &loaders)) {
            return Some((*slug, v));
        }
    }
    None
}

async fn enable(app: &AppHandle, profile: &str, packs: &'static [&'static str]) -> Result<ShadersState, String> {
    if !fps_boost_applicable(profile) {
        return Err("Графику этой сборки подобрал автор — шейдеры в ней включаются в настройках игры".into());
    }
    let loader = profile_loader(profile);
    let version = profile_version(profile);
    let choices = kits(&loader);
    if choices.is_empty() {
        return Err("Шейдерам нужен Fabric, Forge или NeoForge — смени загрузчик сборки".into());
    }
    let jars = enabled_jars(profile);
    if optifine_among(&jars) {
        return Err("В сборке стоит OptiFine — вместе с Iris и Sodium игра не запустится. Убери OptiFine и включи снова".into());
    }
    if super::fpsboost::jar_present(&jars, super::fpsboost::VULKAN_MOD) {
        return Err("В сборке стоит VulkanMod — шейдеры Iris работают только на Sodium. Сними галку VulkanMod в «Буст FPS» и включи снова".into());
    }
    let before = settings_of(profile);
    if before["shaders"].as_bool().unwrap_or(false) {
        return Ok(shaders_state(profile));
    }
    let known: Vec<String> = load_content_manifest(profile).into_iter().map(|e| e.project_id).collect();
    let mod_loaders = modrinth_loaders(&loader, "mod");
    emit(app, "shaders", 10.0, "Подбираем Iris и Sodium…");

    let mut canon = std::collections::HashMap::new();
    for slug in RENDERERS.iter().chain(SHADER_LOADERS) {
        canon.insert(*slug, fetch_project_meta(slug).await.0);
    }
    let has = |slug: &'static &'static str| slot_filled(&single(slug), &known, &canon, &jars);
    let any_renderer = RENDERERS.iter().any(has);

    let mut plan: Option<(&Kit, Vec<(&'static str, Value)>)> = None;
    for kit in choices {
        let have_renderer = has(&kit.renderer);
        if any_renderer && !have_renderer {
            continue;
        }
        let mut wanted = vec![];
        let mut missing = false;
        for slug in [&kit.renderer, &kit.shaders] {
            if has(slug) {
                continue;
            }
            match latest_fit(slug, &version, &mod_loaders).await {
                Some(v) => wanted.push((*slug, v)),
                None => missing = true,
            }
        }
        if !missing {
            plan = Some((kit, wanted));
            break;
        }
    }
    let Some((kit, wanted)) = plan else {
        return Err(format!("Для {} нет Iris или Oculus — шейдеры на этой версии не поставить", version));
    };

    let mut installed: Vec<String> = vec![];
    let undo = |files: &[String]| {
        for f in files {
            let _ = delete_content(profile, "mod", f);
        }
    };
    let total = wanted.len().max(1);
    for (i, (slug, ver)) in wanted.iter().enumerate() {
        emit(app, "shaders", 20.0 + 50.0 * (i as f32 / total as f32), &format!("Ставим {}…", slug));
        match install_project_version(profile, "mod", slug, ver).await {
            Ok(file) => {
                let bridge = bridge_loaders(profile, &loader, "mod");
                for miss in resolve_deps(profile, &version, &mod_loaders, &bridge, &ver["dependencies"]).await {
                    warn(app, &format!("{}: нет зависимости {} под {}", slug, miss, version));
                }
                installed.push(file);
            }
            Err(e) => {
                undo(&installed);
                return Err(format!("{} не поставился: {}", slug, e));
            }
        }
    }

    emit(app, "shaders", 75.0, "Скачиваем шейдеры…");
    let Some((pack_slug, pack_ver)) = pick_pack(&version, packs).await else {
        undo(&installed);
        return Err("Не нашли лёгкий шейдерпак на Modrinth — проверь интернет и попробуй ещё раз".into());
    };
    let pack = match install_project_version(profile, "shader", pack_slug, &pack_ver).await {
        Ok(f) => f,
        Err(e) => {
            undo(&installed);
            return Err(format!("Шейдерпак не скачался: {}", e));
        }
    };
    let previous = match switch_on(profile, kit.shaders, &pack) {
        Ok(p) => p,
        Err(e) => {
            undo(&installed);
            let _ = delete_content(profile, "shader", &pack);
            return Err(e);
        }
    };
    patch(
        profile,
        vec![
            ("shaders", Value::Bool(true)),
            ("shadersMods", Value::Array(installed.into_iter().map(Value::String).collect())),
            ("shadersPack", Value::String(pack)),
            ("shadersLoader", Value::String(kit.shaders.to_string())),
            ("shadersConfig", previous),
        ],
    );
    emit(app, "shaders", 100.0, "Шейдеры включены");
    Ok(shaders_state(profile))
}

fn disable(profile: &str) -> Result<ShadersState, String> {
    let s = settings_of(profile);
    let boost_on = s["fpsBoost"].as_bool().unwrap_or(false);
    for file in str_list(&s["shadersMods"]) {
        // FPS boost counts on the renderer too; it stays while that mode is on.
        let renderer = RENDERERS.iter().any(|r| super::fpsboost::jar_present(std::slice::from_ref(&file), r));
        if boost_on && renderer {
            continue;
        }
        let _ = delete_content(profile, "mod", &file);
    }
    if let Some(pack) = s["shadersPack"].as_str().filter(|p| !p.is_empty()) {
        let _ = delete_content(profile, "shader", pack);
    }
    let loader = s["shadersLoader"].as_str().unwrap_or("iris");
    switch_back(profile, loader, &s["shadersConfig"])?;
    patch(
        profile,
        vec![
            ("shaders", Value::Bool(false)),
            ("shadersMods", Value::Array(vec![])),
            ("shadersPack", Value::Null),
            ("shadersLoader", Value::Null),
            ("shadersConfig", Value::Null),
        ],
    );
    Ok(shaders_state(profile))
}

/// Shaders for the "Epic" graphics preset: the same kit, the full-looking packs.
pub(super) async fn shaders_on_for_preset(app: &AppHandle, profile: &str) -> Result<ShadersState, String> {
    enable(app, profile, EPIC_SHADER_PACKS).await
}

pub(super) fn shaders_off_for_preset(profile: &str) -> Result<ShadersState, String> {
    disable(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// loader -> the pair the button installs. A mixed pair (Iris on Embeddium)
    /// does not start, so every kit must name a renderer its loader runs on.
    #[test]
    fn every_kit_pairs_a_loader_with_its_own_renderer() {
        let table: [(&str, &str, &str); 4] = [
            ("fabric", "sodium", "iris"),
            ("quilt", "sodium", "iris"),
            ("neoforge", "sodium", "iris"),
            ("forge", "embeddium", "oculus"),
        ];
        for (loader, renderer, shaders) in table {
            let first = kits(loader).first().unwrap_or_else(|| panic!("{loader}: the button would offer shaders it cannot install"));
            assert_eq!((first.renderer, first.shaders), (renderer, shaders), "{loader}: wrong first pair");
        }
        assert!(kits("vanilla").is_empty(), "vanilla takes no mods: the button must say so instead of installing");
        for k in FORGE_KITS.iter().chain(NEOFORGE_KITS).chain(FABRIC_KITS) {
            assert!(RENDERERS.contains(&k.renderer), "{}: not a renderer the FPS boost knows, the two modes would install two", k.renderer);
            assert_eq!(k.shaders == "iris", k.renderer == "sodium", "{} runs only on its own renderer, not {}", k.shaders, k.renderer);
        }
    }

    /// The loader's config -> what is remembered for turning the mode off. The
    /// player's own pack must come back, and an absent key must stay absent.
    #[test]
    fn the_players_own_shader_choice_is_remembered() {
        let text = "enableShaders=false\nshaderPack = BSL.zip\nmaxShadowRenderDistance=32\n";
        assert_eq!(property_of(text, "shaderPack").as_deref(), Some("BSL.zip"), "the player's pack");
        assert_eq!(property_of(text, "enableShaders").as_deref(), Some("false"), "shaders were off");
        assert_eq!(property_of(text, "colorSpace"), None, "an absent key must not read as empty");
    }
}
