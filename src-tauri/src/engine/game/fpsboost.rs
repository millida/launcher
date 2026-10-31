// "More FPS" mode: picks JVM flags, installs a known set of performance mods (Sodium and similar) from Modrinth
// and, if the user wants, edits options.txt of the modpack. All of it can be undone: turning it off brings the old settings back.
use super::presets::GRAPHICS_PRESETS_PUBLIC;
use crate::engine::*;
use serde_json::Value;
use tauri::AppHandle;

/// GC profile for Minecraft: short pauses instead of peak throughput. The same
/// set auto-tuning uses (`GC_FLAGS`) plus pre-touching the heap — this mode is
/// switched on deliberately, for frames. Every flag passes `jvm_arg_allowed`:
/// nothing executable belongs here.
pub fn boost_flags() -> Vec<&'static str> {
    GC_FLAGS.iter().copied().chain(std::iter::once(PRETOUCH_FLAG)).collect()
}

/// Bumped whenever `boost_mods` or the way its files are checked changes: builds
/// that enabled the mode under an older revision are brought up to date on their
/// next launch instead of never. Revision 4 re-checks files already installed
/// against their own jars; revision 5 moves to the pin table and takes back
/// Entity Culling and More Culling the mode used to install itself. While the
/// graphics presets are hidden the slot list stays and so does revision 4.
pub const BOOST_SET_REV: u64 = if GRAPHICS_PRESETS_PUBLIC { PINNED_SET_REV } else { SLOT_SET_REV };
const SLOT_SET_REV: u64 = 4;
const PINNED_SET_REV: u64 = 5;

/// Mods a version had no stable file for are asked about again after this long:
/// performance mods reach a fresh game version weeks after it ships.
const RECHECK_SKIPPED_SECS: u64 = 24 * 60 * 60;

/// One job in the boost set. A slot is filled once: by any of `counts` the build
/// already has, otherwise by the first of `install` with a stable file for the
/// version. Two Sodium-family renderers in one build crash on start.
#[derive(Debug, Clone, Copy)]
pub struct Slot {
    pub install: &'static [&'static str],
    pub counts: &'static [&'static str],
    /// Crashes or renders garbage next to OptiFine.
    pub optifine_clash: bool,
}

const fn one(slug: &'static [&'static str]) -> Slot {
    Slot { install: slug, counts: slug, optifine_clash: false }
}

const fn clashing(slug: &'static [&'static str]) -> Slot {
    Slot { install: slug, counts: slug, optifine_clash: true }
}

pub(super) const RENDERERS: &[&str] = &["sodium", "embeddium", "rubidium"];

const FABRIC_SET: &[Slot] = &[
    Slot { install: &["sodium"], counts: RENDERERS, optifine_clash: true },
    one(&["lithium"]),
    one(&["ferrite-core"]),
    one(&["entityculling"]),
    clashing(&["immediatelyfast"]),
    one(&["modernfix"]),
    one(&["dynamic-fps"]),
    clashing(&["moreculling"]),
    // Быстрее открывается список серверов и вход: без лишних DNS-запросов (ресёрч 11.10.2026).
    one(&["fast-ip-ping"]),
];

const FORGE_SET: &[Slot] = &[
    Slot { install: &["embeddium"], counts: RENDERERS, optifine_clash: true },
    one(&["ferrite-core"]),
    one(&["entityculling"]),
    clashing(&["immediatelyfast"]),
    one(&["modernfix"]),
    one(&["dynamic-fps"]),
    one(&["fast-ip-ping"]),
];

/// 1.12.2 — по-прежнему одна из самых играемых версий в больших сборках, а
/// Sodium-семейства на ней нет: VintageFix (загрузка и память) и Nothirium
/// (рендер чанков, с OptiFine несовместим).
const FORGE_1122_SET: &[Slot] = &[
    one(&["vintagefix"]),
    Slot { install: &["nothirium"], counts: &["nothirium", "vintagium", "celeritas"], optifine_clash: true },
    one(&["entityculling"]),
];

const NEOFORGE_SET: &[Slot] = &[
    Slot { install: &["sodium", "embeddium"], counts: RENDERERS, optifine_clash: true },
    one(&["ferrite-core"]),
    one(&["entityculling"]),
    clashing(&["immediatelyfast"]),
    one(&["modernfix"]),
    one(&["dynamic-fps"]),
    one(&["fast-ip-ping"]),
];

/// VulkanMod in place of Sodium: a Vulkan renderer for Fabric. It replaces the
/// whole OpenGL path, so the mods that patch that path (ImmediatelyFast,
/// MoreCulling) and Iris are left out. Sodium stays as the second choice of the
/// renderer slot, so a version VulkanMod has no stable file for still gets one.
pub(super) const VULKAN_MOD: &str = "vulkanmod";

const FABRIC_VULKAN_SET: &[Slot] = &[
    Slot { install: &["vulkanmod", "sodium"], counts: &["vulkanmod", "sodium", "embeddium", "rubidium"], optifine_clash: true },
    one(&["lithium"]),
    one(&["ferrite-core"]),
    one(&["entityculling"]),
    one(&["modernfix"]),
    one(&["dynamic-fps"]),
    one(&["fast-ip-ping"]),
];

/// VulkanMod ships for Fabric from 1.18 on. It has no macOS build of its own,
/// and the shaderc and VMA natives it bundles exist for x86_64 Linux only.
const VULKAN_MOD_SYSTEM: bool = !cfg!(target_os = "macos") && !cfg!(all(target_os = "linux", target_arch = "aarch64"));

pub fn vulkan_fits(loader: &str, game_version: &str) -> bool {
    matches!(loader, "fabric" | "quilt") && VULKAN_MOD_SYSTEM && release_line(game_version) >= (1, 18)
}

/// Forge before 1.16 has none of the set: Embeddium, FerriteCore and the rest
/// start at 1.16.5, so asking Modrinth for 1.7.10 only produced a list of
/// skipped mods under a switch that promises Sodium.
fn forge_set_exists(game_version: &str) -> bool {
    let key: Vec<u32> = game_version
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse().ok())
        .collect();
    key.first() != Some(&1) || key.get(1).is_some_and(|m| *m >= 16)
}

/// Моды-ускорители по загрузчику. Slug'и Modrinth; ставится то, у чего есть
/// сборка под версию профиля, остальное пропускается — режим не должен
/// разваливаться из-за одного мода, отставшего от новой версии игры.
/// The set with the player's renderer choice: VulkanMod where it fits, the usual one otherwise.
pub fn boost_mods_for(loader: &str, game_version: &str, vulkan: bool) -> &'static [Slot] {
    if vulkan && vulkan_fits(loader, game_version) {
        FABRIC_VULKAN_SET
    } else {
        boost_mods(loader, game_version)
    }
}

pub fn boost_mods(loader: &str, game_version: &str) -> &'static [Slot] {
    match loader {
        "fabric" | "quilt" => FABRIC_SET,
        "forge" if forge_set_exists(game_version) => FORGE_SET,
        "forge" if game_version == "1.12.2" => FORGE_1122_SET,
        "neoforge" => NEOFORGE_SET,
        _ => &[],
    }
}

/// A catalogue pack that starts by its own description brings its own
/// renderer, JVM flags and options.txt (OneBlock: Angelica on lwjgl3ify, its
/// resource packs listed in options.txt). The mode has nothing to add there and
/// only overwrites what the author tuned.
pub fn fps_boost_applicable(profile: &str) -> bool {
    trusted_pack_launch_spec(profile).is_none() && !trusted_native_pack(profile)
}

/// Стоит ли мод режима уже в сборке. Манифест хранит канонический id проекта,
/// а список режима задан slug'ами; старые манифесты (и офлайн-установка, где
/// каталог не ответил) держат в том же поле slug. Совпадение по любому из двух
/// имён значит «этот мод у игрока есть», и второй копии быть не должно.
fn already_installed(known: &[String], slug: &str, canonical: &str) -> bool {
    known.iter().any(|p| p == slug || p == canonical)
}

fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase()
}

/// Jars dropped in by hand never reach the manifest, and a second copy of the
/// same mod id stops Fabric and Forge before the window opens.
pub(super) fn jar_present(jars: &[String], slug: &str) -> bool {
    let want = squash(slug);
    jars.iter().any(|j| squash(j).starts_with(&want))
}

pub(super) fn optifine_among(jars: &[String]) -> bool {
    jars.iter().any(|j| {
        let n = j.to_ascii_lowercase();
        n.contains("optifine") || n.contains("optifabric")
    })
}

pub(super) fn enabled_jars(profile: &str) -> Vec<String> {
    std::fs::read_dir(profile_dir(profile).join(content_dir("mod")))
        .map(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().to_string())
                .filter(|n| n.to_ascii_lowercase().ends_with(".jar"))
                .collect()
        })
        .unwrap_or_default()
}

/// Release first, beta if nothing else exists; alpha never. A boost that
/// crashes the game costs more frames than it saves.
pub(super) fn stable_pick(versions: &[Value], game_version: &str, loaders: &[String]) -> Option<Value> {
    ["release", "beta"].iter().find_map(|kind| {
        versions
            .iter()
            .find(|v| v["version_type"].as_str() == Some(kind) && version_fits(v, game_version, loaders))
            .cloned()
    })
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn needs_top_up(enabled: bool, rev: u64, skipped: usize, checked_at: u64, now: u64) -> bool {
    enabled && (rev != BOOST_SET_REV || (skipped > 0 && now.saturating_sub(checked_at) >= RECHECK_SKIPPED_SECS))
}

/// Значения options.txt, которые снимают нагрузку с GPU и CPU, не ломая игру.
/// Ключи разных версий отличаются, поэтому пишем весь набор: незнакомые строки
/// игра игнорирует.
const VIDEO_TUNING: &[(&str, &str)] = &[
    ("graphicsMode", "0"),
    ("fancyGraphics", "false"),
    ("renderDistance", "8"),
    ("simulationDistance", "6"),
    ("entityDistanceScaling", "0.5"),
    ("entityShadows", "false"),
    ("particles", "2"),
    ("ao", "false"),
    ("mipmapLevels", "0"),
    ("biomeBlendRadius", "0"),
    ("renderClouds", "\"false\""),
    ("enableVsync", "false"),
    ("maxFps", "260"),
    ("bobView", "false"),
    ("screenEffectScale", "0.0"),
];

#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FpsBoostState {
    pub enabled: bool,
    /// Файлы модов, поставленных режимом, — их же он и снимает при выключении.
    pub mods: Vec<String>,
    /// Моды, которых нет под эту версию игры.
    pub skipped: Vec<String>,
    pub flags: Vec<String>,
    pub video: bool,
    /// Загрузчик не держит моды — ускоряем только JVM и настройки графики.
    pub vanilla: bool,
    /// The mode is on, but the set changed or skipped mods are due a recheck.
    pub stale: bool,
    /// False for a build the mode must not touch (see `fps_boost_applicable`).
    pub applicable: bool,
    /// The player asked for VulkanMod instead of Sodium.
    pub vulkan: bool,
    /// VulkanMod exists for this loader, version and system.
    pub vulkan_available: bool,
    /// Shaders are on: Iris needs Sodium, so VulkanMod waits until they are off.
    pub vulkan_blocked: bool,
}

pub(super) fn settings_of(profile: &str) -> Value {
    std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

pub(super) fn str_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

pub(super) fn profile_loader(profile: &str) -> String {
    load_profiles()
        .into_iter()
        .find(|p| p.name == profile)
        .map(|p| p.loader_id())
        .unwrap_or_else(|| "vanilla".into())
}

pub(super) fn profile_version(profile: &str) -> String {
    load_profiles()
        .into_iter()
        .find(|p| p.name == profile)
        .map(|p| p.version)
        .unwrap_or_default()
}

pub fn fps_boost_state(profile: &str) -> FpsBoostState {
    let s = settings_of(profile);
    let loader = profile_loader(profile);
    FpsBoostState {
        enabled: s["fpsBoost"].as_bool().unwrap_or(false),
        mods: str_list(&s["fpsBoostMods"]),
        skipped: str_list(&s["fpsBoostSkipped"]),
        flags: boost_flags().iter().map(|f| f.to_string()).collect(),
        video: s["fpsBoostVideo"].is_object(),
        vanilla: if GRAPHICS_PRESETS_PUBLIC {
            !super::perfpins::pins_exist(&loader, &profile_version(profile))
        } else {
            boost_mods(&loader, &profile_version(profile)).is_empty()
        },
        applicable: fps_boost_applicable(profile),
        vulkan: s["fpsBoostVulkan"].as_bool().unwrap_or(false),
        vulkan_available: vulkan_fits(&loader, &profile_version(profile)),
        vulkan_blocked: s["shaders"].as_bool().unwrap_or(false),
        stale: needs_top_up(
            s["fpsBoost"].as_bool().unwrap_or(false),
            s["fpsBoostSet"].as_u64().unwrap_or(1),
            str_list(&s["fpsBoostSkipped"]).len(),
            s["fpsBoostCheckedAt"].as_u64().unwrap_or(0),
            now_unix(),
        ),
    }
}

pub(super) fn options_path(profile: &str) -> std::path::PathBuf {
    profile_dir(profile).join("options.txt")
}

/// options.txt as the game wrote it. Minecraft 1.7.10 writes it in the system
/// code page, so mod key names in Cyrillic are not UTF-8 there (OneBlock ships
/// such a file). Reading it as UTF-8 failed, the failure read as an empty file,
/// and the mode wrote back its fifteen keys alone: the pack lost its resource
/// packs, language and key bindings. Such a file is read byte for byte instead
/// and written back in the same bytes.
pub(super) struct Options {
    pub(super) rows: Vec<(String, String)>,
    pub(super) bytewise: bool,
}

pub(super) fn decode_options(bytes: &[u8]) -> Options {
    let (text, bytewise) = match std::str::from_utf8(bytes) {
        Ok(s) => (s.to_string(), false),
        Err(_) => (bytes.iter().map(|b| char::from(*b)).collect(), true),
    };
    let rows = text
        .lines()
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect();
    Options { rows, bytewise }
}

pub(super) fn encode_options(opts: &Options) -> Vec<u8> {
    let body: String = opts.rows.iter().map(|(k, v)| format!("{}:{}\n", k, v)).collect();
    if opts.bytewise {
        body.chars().map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?')).collect()
    } else {
        body.into_bytes()
    }
}

pub(super) fn read_options(profile: &str) -> Result<Options, String> {
    match std::fs::read(options_path(profile)) {
        Ok(bytes) => Ok(decode_options(&bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Options { rows: vec![], bytewise: false }),
        Err(e) => Err(format!("Не удалось прочитать настройки игры (options.txt): {}. Закрой игру и попробуй ещё раз", e)),
    }
}

pub(super) fn write_options(profile: &str, opts: &Options) -> Result<(), String> {
    let dir = profile_dir(profile);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_bytes_atomic(&options_path(profile), &encode_options(opts))
}

/// Правит только известные ключи и запоминает их прежние значения: выключение
/// режима возвращает ровно их, а не затирает всё, что игрок настроил после.
pub(super) fn apply_tuning(rows: &mut Vec<(String, String)>, table: &[(String, String)]) -> serde_json::Map<String, Value> {
    let mut previous = serde_json::Map::new();
    for (key, val) in table {
        match rows.iter_mut().find(|(k, _)| k == key) {
            Some(row) => {
                previous.insert((*key).to_string(), Value::String(row.1.clone()));
                row.1 = (*val).to_string();
            }
            None => {
                previous.insert((*key).to_string(), Value::Null);
                rows.push(((*key).to_string(), (*val).to_string()));
            }
        }
    }
    previous
}

pub(super) fn undo_tuning(rows: &mut Vec<(String, String)>, previous: &Value) {
    let Some(map) = previous.as_object() else { return };
    for (key, was) in map {
        match was.as_str() {
            Some(v) => match rows.iter_mut().find(|(k, _)| k == key) {
                Some(row) => row.1 = v.to_string(),
                None => rows.push((key.clone(), v.to_string())),
            },
            // ключа не было до режима — убираем, а не оставляем наш
            None => rows.retain(|(k, _)| k != key),
        }
    }
}

/// Ключи options.txt, которые лаунчер может подобрать под железо игрока, и
/// форма их значений. Набор приходит из интерфейса (src/lib/perfTier.ts), поэтому
/// всё вне списка отбрасывается: настройки графики — да, пакеты ресурсов, клавиши
/// и сервера — нет.
const VIDEO_KEYS: &[&str] = &[
    "graphicsMode", "fancyGraphics", "graphicsPreset", "renderDistance", "simulationDistance",
    "entityDistanceScaling", "entityShadows", "particles", "ao", "mipmapLevels", "biomeBlendRadius",
    "renderClouds", "cloudRange", "enableVsync", "maxFps", "bobView", "screenEffectScale", "guiScale",
    "textureFiltering", "maxAnisotropyBit", "cutoutLeaves", "weatherRadius", "improvedTransparency",
    "prioritizeChunkUpdates",
];

fn video_value_ok(v: &str) -> bool {
    let number = !v.is_empty() && v.len() <= 8 && v.trim_start_matches('-').chars().all(|c| c.is_ascii_digit() || c == '.');
    let word = matches!(v, "true" | "false");
    let quoted = v.len() >= 3
        && v.len() <= 18
        && v.starts_with('"')
        && v.ends_with('"')
        && v[1..v.len() - 1].chars().all(|c| c.is_ascii_lowercase() || c == '_');
    number || word || quoted
}

/// Набор под железо из интерфейса, если он целиком годится; иначе — общий.
pub fn video_table(custom: Option<Vec<(String, String)>>) -> Vec<(String, String)> {
    let fallback = || -> Vec<(String, String)> { VIDEO_TUNING.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() };
    match custom {
        Some(rows) if !rows.is_empty() && rows.len() <= 40 && rows.iter().all(|(k, v)| VIDEO_KEYS.contains(&k.as_str()) && video_value_ok(v)) => rows,
        _ => fallback(),
    }
}

fn tune_video(profile: &str, table: &[(String, String)]) -> Result<serde_json::Map<String, Value>, String> {
    let mut opts = read_options(profile)?;
    let previous = apply_tuning(&mut opts.rows, table);
    write_options(profile, &opts)?;
    Ok(previous)
}

fn restore_video(profile: &str, previous: &Value) -> Result<(), String> {
    if !previous.is_object() {
        return Ok(());
    }
    let mut opts = read_options(profile)?;
    undo_tuning(&mut opts.rows, previous);
    write_options(profile, &opts)
}

pub(super) fn patch(profile: &str, entries: Vec<(&str, Value)>) {
    let mut m = serde_json::Map::new();
    for (k, v) in entries {
        m.insert(k.to_string(), v);
    }
    merge_settings(profile, m);
}

pub async fn set_fps_boost(app: AppHandle, profile: String, on: bool, keep_options: bool, video: Option<Vec<(String, String)>>, vulkan: Option<bool>) -> Result<FpsBoostState, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    if on && !fps_boost_applicable(&profile) {
        return Err("Буст FPS этой сборке не нужен: графику, Java и настройки для неё подобрал автор".into());
    }
    if let Some(want) = vulkan {
        let before = settings_of(&profile);
        if want && before["shaders"].as_bool().unwrap_or(false) {
            return Err("VulkanMod не работает с шейдерами: сначала выключи «Шейдеры»".into());
        }
        let changed = before["fpsBoostVulkan"].as_bool().unwrap_or(false) != want;
        patch(&profile, vec![("fpsBoostVulkan", Value::Bool(want))]);
        // The renderer is the first slot of the set: switching it means the
        // mode takes its own mods out and installs the other set in their place.
        if changed && on && before["fpsBoost"].as_bool().unwrap_or(false) {
            disable(&profile)?;
        }
    }
    if on {
        enable(&app, &profile, keep_options, video_table(video)).await
    } else {
        disable(&profile)
    }
}

/// `(major, minor)` of a game version; year-numbered releases (26.x) read as
/// newer than any 1.x.
pub(super) fn release_line(version: &str) -> (u32, u32) {
    let mut nums = version.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).filter_map(|p| p.parse::<u32>().ok());
    match (nums.next(), nums.next()) {
        (Some(1), Some(minor)) => (1, minor),
        (Some(major), _) if major > 1 => (major, 0),
        _ => (1, u32::MAX),
    }
}

/// `(major, minor, patch)` of a game version, None when it carries no number
/// (an unknown version keeps every key). "26.4-snapshot-5" reads as 26.4.5.
pub(super) fn version_key(version: &str) -> Option<(u32, u32, u32)> {
    let mut nums = version.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty()).filter_map(|p| p.parse::<u32>().ok());
    let major = nums.next()?;
    Some((major, nums.next().unwrap_or(0), nums.next().unwrap_or(0)))
}

/// Keys a version does not know are dropped: simulation distance came in
/// 1.18, the three-way graphics mode in 1.16 (replacing `fancyGraphics`) and
/// gave way to the vanilla preset `graphicsPreset` in 26.1; clouds range,
/// weather radius, cutout leaves, improved transparency and texture filtering
/// arrived in 1.21.6. Before 1.13 the cloud setting is a bare word: a quoted
/// value there reads as garbage and the game falls back to its own default.
pub(super) fn rows_for_version(rows: Vec<(String, String)>, version: &str) -> Vec<(String, String)> {
    let Some(v) = version_key(version) else { return rows };
    rows.into_iter()
        .filter(|(k, _)| match k.as_str() {
            "simulationDistance" => v >= (1, 18, 0),
            "fancyGraphics" => v < (1, 16, 0),
            "graphicsMode" => ((1, 16, 0)..(26, 0, 0)).contains(&v),
            "graphicsPreset" => v >= (26, 0, 0),
            "cloudRange" | "weatherRadius" | "cutoutLeaves" | "improvedTransparency" | "textureFiltering" => v >= (1, 21, 6),
            _ => true,
        })
        .map(|(k, val)| {
            if k == "renderClouds" && v < (1, 13, 0) {
                let bare = val.trim_matches('"').to_string();
                (k, bare)
            } else {
                (k, val)
            }
        })
        .collect()
}

/// Graphics picked for this PC, written before a build's first start. Only a
/// build the game has never started gets it: an existing options.txt holds the
/// player's own choices and is never touched here. True when the file was
/// written.
pub fn seed_video_options(profile: &str, video: Option<Vec<(String, String)>>) -> Result<bool, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    if !fps_boost_applicable(profile) || options_path(profile).exists() {
        return Ok(false);
    }
    let table = rows_for_version(video_table(video), &profile_version(profile));
    let mut opts = Options { rows: vec![], bytewise: false };
    apply_tuning(&mut opts.rows, &table);
    write_options(profile, &opts)?;
    patch(profile, vec![("videoSeededAt", Value::from(now_unix()))]);
    Ok(true)
}

/// What the build already has for a slot, by manifest id or by a hand-dropped jar.
pub(super) fn slot_filled(slot: &Slot, known: &[String], canon: &std::collections::HashMap<&str, String>, jars: &[String]) -> bool {
    slot.counts.iter().any(|slug| {
        let id = canon.get(slug).map(String::as_str).unwrap_or(slug);
        already_installed(known, slug, id) || jar_present(jars, slug)
    })
}

/// The set is ordered by weight, the renderer first. When two of the mode's own
/// files clash, the later one goes, so it is checked first: Sodium stays and the
/// culling add-on that breaks it is removed, not the other way round.
fn settle_order(installed: &[String]) -> Vec<String> {
    installed.iter().rev().cloned().collect()
}

/// `keep_options`: an automatic caller (version builds, presets) only fills in
/// an options.txt the game has not written yet; the player's own is theirs.
async fn enable(app: &AppHandle, profile: &str, keep_options: bool, video_rows: Vec<(String, String)>) -> Result<FpsBoostState, String> {
    let loader = profile_loader(profile);
    let version = profile_version(profile);
    let before_choice = settings_of(profile);
    let vulkan = before_choice["fpsBoostVulkan"].as_bool().unwrap_or(false)
        && !before_choice["shaders"].as_bool().unwrap_or(false);
    // The usual set comes from the pin table (perfpins.rs): exact versions per
    // loader and game version, nothing for a version without a row. The old
    // slot list stays only for the player's own VulkanMod choice.
    let use_pins = GRAPHICS_PRESETS_PUBLIC && !vulkan;
    let pinned = if use_pins { super::perfpins::pins_for(&super::perfpins::current().await, &loader, &version) } else { None };
    let wanted: &[Slot] = if use_pins { &[] } else { boost_mods_for(&loader, &version, vulkan) };
    let loaders = modrinth_loaders(&loader, "mod");
    let bridge = bridge_loaders(profile, &loader, "mod");
    let known: Vec<String> = load_content_manifest(profile)
        .into_iter()
        .map(|e| e.project_id)
        .collect();
    let jars = enabled_jars(profile);
    let optifine = optifine_among(&jars);
    let before = settings_of(profile);
    let was_on = before["fpsBoost"].as_bool().unwrap_or(false);

    let mut installed = str_list(&before["fpsBoostMods"]);
    let mut skipped: Vec<String> = vec![];
    let mut slug_of: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let total = wanted.len().max(1);
    for (i, slot) in wanted.iter().enumerate() {
        let name = slot.install.first().copied().unwrap_or_default();
        emit(app, "fpsboost", 10.0 + 70.0 * (i as f32 / total as f32), &format!("Ставим {}…", name));
        if optifine && slot.optifine_clash {
            warn(app, &format!("{}: не ставим рядом с OptiFine — вместе они роняют игру", name));
            continue;
        }
        // Мод уже стоит у игрока — режим его не дублирует и не снимет потом.
        // В манифесте лежит КАНОНИЧЕСКИЙ id Modrinth, а список режима — из
        // slug'ов: сравнение id со slug'ом не совпадало никогда, и поверх
        // Sodium игрока вставал второй Sodium. Fabric такой запуск не
        // переживает — «включаю буст FPS в связке с модами, игра вылетает».
        let mut canon = std::collections::HashMap::new();
        for slug in slot.counts {
            canon.insert(*slug, fetch_project_meta(slug).await.0);
        }
        if slot_filled(slot, &known, &canon, &jars) {
            continue;
        }
        let mut picked: Option<(&str, Value)> = None;
        for slug in slot.install {
            if let Ok(all) = project_versions(slug).await {
                if let Some(v) = stable_pick(&all, &version, &loaders) {
                    picked = Some((*slug, v));
                    break;
                }
            }
        }
        let Some((slug, ver)) = picked else {
            skipped.push(name.to_string());
            continue;
        };
        match install_project_version(profile, "mod", slug, &ver).await {
            Ok(file) => {
                for miss in resolve_deps(profile, &version, &loaders, &bridge, &ver["dependencies"]).await {
                    warn(app, &format!("{}: нет зависимости {} под {}", slug, miss, version));
                }
                slug_of.insert(file.clone(), slug.to_string());
                if !installed.contains(&file) {
                    installed.push(file);
                }
            }
            Err(e) => {
                warn(app, &format!("Мод {} не поставился: {}", slug, e));
                skipped.push(slug.to_string());
            }
        }
    }

    if let Some(pins) = &pinned {
        let bad_driver = super::gpu::driver_issue();
        let total = pins.len().max(1);
        for (i, pin) in pins.iter().enumerate() {
            emit(app, "fpsboost", 10.0 + 70.0 * (i as f32 / total as f32), &format!("Ставим {}…", pin.slug));
            if optifine && pin.optifine_clash {
                warn(app, &format!("{}: не ставим рядом с OptiFine — вместе они роняют игру", pin.slug));
                continue;
            }
            // Sodium does not start on these drivers (Sodium wiki): the build
            // stays without it and the interface offers the vendor's driver page.
            if pin.slot == "renderer" && bad_driver.is_some() {
                skipped.push(format!("{} — старый драйвер видеокарты", pin.slug));
                continue;
            }
            let counts: Vec<&str> = if pin.slot == "renderer" {
                RENDERERS.iter().copied().chain([VULKAN_MOD, "nothirium", "vintagium", "celeritas"]).collect()
            } else {
                vec![pin.slug.as_str()]
            };
            let mut have = false;
            for slug in counts {
                let id = fetch_project_meta(slug).await.0;
                if already_installed(&known, slug, &id) || jar_present(&jars, slug) {
                    have = true;
                    break;
                }
            }
            if have {
                continue;
            }
            let picked = project_versions(&pin.slug)
                .await
                .ok()
                .and_then(|all| all.into_iter().find(|v| v["id"].as_str() == Some(pin.version.as_str())));
            let Some(ver) = picked else {
                skipped.push(pin.slug.clone());
                continue;
            };
            match install_project_version(profile, "mod", &pin.slug, &ver).await {
                Ok(file) => {
                    for miss in resolve_deps(profile, &version, &loaders, &bridge, &ver["dependencies"]).await {
                        warn(app, &format!("{}: нет зависимости {} под {}", pin.slug, miss, version));
                    }
                    slug_of.insert(file.clone(), pin.slug.clone());
                    if !installed.contains(&file) {
                        installed.push(file);
                    }
                }
                Err(e) => {
                    warn(app, &format!("Мод {} не поставился: {}", pin.slug, e));
                    skipped.push(pin.slug.clone());
                }
            }
        }
        // Earlier sets installed Entity Culling and More Culling by themselves;
        // they are the player's own choice now, so the mode takes back its copies.
        if was_on {
            let doc = super::perfpins::bundled();
            installed.retain(|file| {
                let unwanted = doc.manual_only.iter().chain(&doc.never).any(|slug| jar_present(std::slice::from_ref(file), slug));
                if unwanted {
                    let _ = delete_content(profile, "mod", file);
                }
                !unwanted
            });
        }
    }

    emit(app, "fpsboost", 85.0, "Проверяем совместимость…");
    let present = enabled_jars(profile);
    for file in settle_order(&installed) {
        if !present.contains(&file) {
            continue;
        }
        let blockers = settle_installed_jar(profile, &file).await;
        if blockers.is_clear() {
            continue;
        }
        let name = slug_of.get(&file).cloned().unwrap_or_else(|| file.clone());
        match delete_content(profile, "mod", &file) {
            Ok(()) => {
                warn(app, &format!("{}: не ставим — {}", name, blockers.describe().join("; ")));
                installed.retain(|f| f != &file);
                if !skipped.contains(&name) {
                    skipped.push(name);
                }
            }
            Err(e) => warn(app, &format!("{}: мешает запуску ({}), но убрать файл не вышло: {}", name, blockers.describe().join("; "), e)),
        }
    }

    emit(app, "fpsboost", 90.0, "Настройки графики…");
    let video = if was_on {
        before["fpsBoostVideo"].clone()
    } else if keep_options && options_path(profile).exists() {
        Value::Null
    } else {
        Value::Object(tune_video(profile, &video_rows)?)
    };
    patch(
        profile,
        vec![
            ("fpsBoost", Value::Bool(true)),
            ("fpsBoostMods", Value::Array(installed.iter().map(|f| Value::String(f.clone())).collect())),
            ("fpsBoostSkipped", Value::Array(skipped.iter().map(|f| Value::String(f.clone())).collect())),
            ("fpsBoostVideo", video),
            ("fpsBoostSet", Value::from(BOOST_SET_REV)),
            ("fpsBoostCheckedAt", Value::from(now_unix())),
        ],
    );
    emit(app, "fpsboost", 100.0, "Буст FPS включён");
    Ok(fps_boost_state(profile))
}

fn disable(profile: &str) -> Result<FpsBoostState, String> {
    let s = settings_of(profile);
    // Iris and Oculus do not start without the renderer: with shaders on it
    // stays, even when this mode was the one that brought it.
    let shaders_on = s["shaders"].as_bool().unwrap_or(false);
    for file in str_list(&s["fpsBoostMods"]) {
        let keeps_shaders = shaders_on && RENDERERS.iter().any(|r| jar_present(std::slice::from_ref(&file), r));
        if !keeps_shaders {
            let _ = delete_content(profile, "mod", &file);
        }
    }
    restore_video(profile, &s["fpsBoostVideo"])?;
    patch(
        profile,
        vec![
            ("fpsBoost", Value::Bool(false)),
            ("fpsBoostMods", Value::Array(vec![])),
            ("fpsBoostSkipped", Value::Array(vec![])),
            ("fpsBoostVideo", Value::Null),
            ("fpsBoostSet", Value::Null),
            ("fpsBoostCheckedAt", Value::Null),
        ],
    );
    Ok(fps_boost_state(profile))
}

/// The graphics presets (`presets.rs`) turn the mode on and off for the player.
/// The options.txt the preset writes itself, so the mode only fills a file the
/// game has not written yet.
pub(super) async fn boost_on_for_preset(app: &AppHandle, profile: &str, video: Vec<(String, String)>) -> Result<FpsBoostState, String> {
    enable(app, profile, true, video).await
}

pub(super) fn boost_off_for_preset(profile: &str) -> Result<FpsBoostState, String> {
    disable(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Набор из интерфейса проходит, только если он целиком из графических
    /// ключей с простыми значениями; иначе ставится общий.
    #[test]
    fn a_hardware_video_set_is_taken_only_whole_and_clean() {
        let row = |k: &str, v: &str| (k.to_string(), v.to_string());
        let good = vec![row("renderDistance", "12"), row("graphicsPreset", "\"fancy\""), row("ao", "true"), row("entityDistanceScaling", "0.75")];
        assert_eq!(video_table(Some(good.clone())), good, "набор под железо");
        let foreign = vec![row("renderDistance", "12"), row("resourcePacks", "[\"evil.zip\"]")];
        assert_eq!(video_table(Some(foreign)).len(), VIDEO_TUNING.len(), "пакеты ресурсов и прочее — не графика");
        let weird = vec![row("renderDistance", "12; rm -rf")];
        assert_eq!(video_table(Some(weird)).len(), VIDEO_TUNING.len(), "значение не число, не слово и не строка в кавычках");
        assert_eq!(video_table(None).len(), VIDEO_TUNING.len(), "без набора — общий");
    }

    /// Флаги режима проходят тот же фильтр, что и пользовательские: иначе часть
    /// профиля молча отсеялась бы на запуске.
    /// (game version, key) -> does a fresh options.txt carry it. An unknown
    /// key is harmless to the game, but the seeded file is what the player
    /// sees in the folder and should hold only settings their version has.
    #[test]
    fn seeded_options_fit_the_game_version() {
        let row = |k: &str| (k.to_string(), "1".to_string());
        let rows = vec![row("renderDistance"), row("simulationDistance"), row("graphicsMode"), row("fancyGraphics"), row("graphicsPreset"), row("textureFiltering")];
        let cases: [(&str, &str, bool, &str); 14] = [
            ("1.21.1", "simulationDistance", true, "modern versions have simulation distance"),
            ("1.17.1", "simulationDistance", false, "simulation distance arrived in 1.18"),
            ("1.16.5", "graphicsMode", true, "three-way graphics arrived in 1.16"),
            ("1.16.5", "fancyGraphics", false, "1.16 replaced the old switch"),
            ("1.12.2", "graphicsMode", false, "1.12 has only fancyGraphics"),
            ("1.12.2", "fancyGraphics", true, "the old graphics switch stays for old versions"),
            ("1.7.10", "renderDistance", true, "every version has render distance"),
            ("26.2", "simulationDistance", true, "year-numbered versions are newer than any 1.x"),
            ("26.3", "graphicsPreset", true, "26.x speaks in vanilla presets"),
            ("26.3", "graphicsMode", false, "26.x dropped the three-way switch"),
            ("1.21.11", "graphicsPreset", false, "the preset key is 26.x only"),
            ("1.21.11", "textureFiltering", true, "texture filtering arrived in 1.21.6"),
            ("1.21.4", "textureFiltering", false, "not yet in 1.21.4"),
            ("", "simulationDistance", true, "an unknown version keeps the whole set"),
        ];
        for (version, key, want, why) in cases {
            let kept = rows_for_version(rows.clone(), version).iter().any(|(k, _)| k == key);
            assert_eq!(kept, want, "{version} {key}: {why}");
        }
    }

    #[test]
    fn boost_flags_survive_the_jvm_filter() {
        for f in boost_flags() {
            assert!(
                user_jvm_arg_allowed(f),
                "флаг {f} режима «Буст FPS» отсеивается фильтром аргументов JVM — он не дойдёт до игры",
            );
        }
    }

    /// options.txt принадлежит игроку: режим обязан вернуть ровно то, что было,
    /// и не тронуть чужие строки — иначе выключение буста стоит человеку
    /// настроек звука, языка и управления.
    #[test]
    fn video_tuning_is_reversible() {
        let mut rows: Vec<(String, String)> = vec![
            ("lang".into(), "ru_ru".into()),
            ("renderDistance".into(), "16".into()),
            ("soundCategory_master".into(), "0.7".into()),
            ("key_key.jump".into(), "key.keyboard.space".into()),
        ];
        let before = rows.clone();

        let previous = apply_tuning(&mut rows, &video_table(None));
        let get = |rs: &Vec<(String, String)>, k: &str| rs.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
        assert_eq!(get(&rows, "renderDistance").as_deref(), Some("8"), "дальность прорисовки не снизилась — буста нет");
        assert_eq!(get(&rows, "particles").as_deref(), Some("2"), "новый ключ не добавился");
        assert_eq!(get(&rows, "lang").as_deref(), Some("ru_ru"), "режим тронул чужую строку options.txt");

        undo_tuning(&mut rows, &Value::Object(previous));
        rows.sort();
        let mut expected = before;
        expected.sort();
        assert_eq!(rows, expected, "после выключения options.txt отличается от исходного");
    }

    /// options.txt bytes -> what the mode keeps after tuning and after undoing
    /// it. 1.7.10 writes the file in the system code page; OneBlock's copy has
    /// key names in cp1251.
    #[test]
    fn options_in_a_legacy_code_page_survive_the_mode_byte_for_byte() {
        let mut cp1251: Vec<u8> = b"resourcePacks:[\"MetaTextures.zip\",\"Lang.zip\"]\nlang:ru_RU\nkey_".to_vec();
        cp1251.extend_from_slice(&[0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2]);
        cp1251.extend_from_slice(b":44\nrenderDistance:12\n");
        let utf8 = "lang:ru_ru\nkey_Привет:44\nrenderDistance:12\n".as_bytes().to_vec();
        let cases: [(&[u8], &str); 2] = [
            (&cp1251, "OneBlock 28.09: the file was read as empty and written back with the mode's keys alone"),
            (&utf8, "a modern UTF-8 file keeps working as before"),
        ];
        for (bytes, why) in cases {
            let mut opts = decode_options(bytes);
            let previous = apply_tuning(&mut opts.rows, &video_table(None));
            let tuned = encode_options(&opts);
            for line in [&b"lang:"[..], &b"key_"[..]] {
                assert!(tuned.windows(line.len()).any(|w| w == line), "{why}: the player's lines must survive tuning");
            }
            if bytes == cp1251.as_slice() {
                assert!(tuned.windows(6).any(|w| w == [0xCF, 0xF0, 0xE8, 0xE2, 0xE5, 0xF2]), "{why}: the cp1251 key name must stay the same bytes");
                assert!(tuned.windows(13).any(|w| w == b"MetaTextures."), "{why}: the pack's resource packs must stay listed");
            }
            let mut back = decode_options(&tuned);
            undo_tuning(&mut back.rows, &Value::Object(previous));
            assert_eq!(encode_options(&back), bytes, "{why}: switching the mode off must give back the file it found");
        }
    }

    /// (loader, game version) -> does the mode install mods at all.
    /// (loader, version, asked) -> is VulkanMod the renderer slot's first choice.
    #[test]
    fn vulkan_replaces_sodium_only_where_it_exists() {
        let cases: [(&str, &str, bool, bool, &str); 6] = [
            ("fabric", "1.21.1", true, VULKAN_MOD_SYSTEM, "Fabric 1.21 with the box ticked"),
            ("fabric", "1.21.1", false, false, "the box ships unticked: Sodium stays the renderer"),
            ("quilt", "1.20.1", true, VULKAN_MOD_SYSTEM, "Quilt loads Fabric mods"),
            ("fabric", "1.16.5", true, false, "VulkanMod starts at 1.18"),
            ("forge", "1.20.1", true, false, "there is no VulkanMod for Forge"),
            ("neoforge", "1.21.1", true, false, "nor for NeoForge"),
        ];
        for (loader, version, asked, want, why) in cases {
            let first = boost_mods_for(loader, version, asked).first().and_then(|s| s.install.first().copied());
            assert_eq!(first == Some(VULKAN_MOD), want, "{loader} {version}: {why}");
        }
        let set = boost_mods_for("fabric", "1.21.1", true);
        for clash in ["immediatelyfast", "moreculling"] {
            assert!(
                !VULKAN_MOD_SYSTEM || set.iter().all(|s| !s.install.contains(&clash)),
                "{clash} patches the OpenGL path VulkanMod replaces: it must not come with it",
            );
        }
    }

    #[test]
    fn legacy_forge_gets_no_mod_set() {
        let cases: [(&str, &str, bool, &str); 6] = [
            ("forge", "1.7.10", false, "OneBlock's version: no Embeddium or FerriteCore exists, only a list of skipped mods"),
            ("forge", "1.12.2", true, "VintageFix and Nothirium: the old big-pack version gets its own set"),
            ("forge", "1.16.5", true, "first version with Embeddium and friends"),
            ("forge", "1.20.1", true, "the common modded version"),
            ("fabric", "1.20.1", true, "Fabric keeps its set"),
            ("neoforge", "1.21.1", true, "NeoForge keeps its set"),
        ];
        for (loader, version, want, why) in cases {
            assert_eq!(!boost_mods(loader, version).is_empty(), want, "{loader} {version}: {why}");
        }
    }

    #[test]
    fn installed_mod_is_recognised_by_id_and_by_slug() {
        // Вход → вердикт. Закреплено потому, что промах этой проверки ставил
        // второй Sodium поверх своего и ронял игру на старте.
        let by_id = vec!["AANobbMI".to_string()];
        assert!(
            already_installed(&by_id, "sodium", "AANobbMI"),
            "мод из каталога записан каноническим id — режим обязан узнать его и не ставить второй копией"
        );
        let by_slug = vec!["sodium".to_string()];
        assert!(
            already_installed(&by_slug, "sodium", "AANobbMI"),
            "старый манифест держит slug — он тоже значит «мод уже стоит»"
        );
        let other = vec!["P7dR8mSH".to_string()];
        assert!(
            !already_installed(&other, "sodium", "AANobbMI"),
            "чужой мод не должен отменять установку ускорителя"
        );
    }

    fn installs(loader: &str) -> Vec<Vec<&'static str>> {
        boost_mods(loader, "1.20.1").iter().map(|s| s.install.to_vec()).collect()
    }

    /// Pin of the whole set per loader. Changing it means bumping BOOST_SET_REV,
    /// or builds that already have the mode never receive the change.
    #[test]
    fn boost_set_is_pinned_per_loader() {
        let fabric: Vec<Vec<&str>> = vec![
            vec!["sodium"],
            vec!["lithium"],
            vec!["ferrite-core"],
            vec!["entityculling"],
            vec!["immediatelyfast"],
            vec!["modernfix"],
            vec!["dynamic-fps"],
            vec!["moreculling"],
            vec!["fast-ip-ping"],
        ];
        let cases: [(&str, Vec<Vec<&str>>, &str); 5] = [
            ("fabric", fabric.clone(), "Fabric: Sodium and the Fabulously Optimized core"),
            ("quilt", fabric, "Quilt loads Fabric mods, so it gets the same set"),
            (
                "forge",
                vec![vec!["embeddium"], vec!["ferrite-core"], vec!["entityculling"], vec!["immediatelyfast"], vec!["modernfix"], vec!["dynamic-fps"], vec!["fast-ip-ping"]],
                "Forge: Sodium does not load, Embeddium is the port",
            ),
            (
                "neoforge",
                vec![vec!["sodium", "embeddium"], vec!["ferrite-core"], vec!["entityculling"], vec!["immediatelyfast"], vec!["modernfix"], vec!["dynamic-fps"], vec!["fast-ip-ping"]],
                "NeoForge: official Sodium where it exists (1.21.1+), Embeddium before it",
            ),
            ("vanilla", vec![], "vanilla cannot load mods, only JVM flags and options apply"),
        ];
        for (loader, want, why) in cases {
            assert_eq!(installs(loader), want, "boost set for {loader} changed without a pin update: {why}");
        }
    }

    /// FNV-1a over everything a slot says: what it installs, what it counts as
    /// present and whether it clashes with OptiFine, for every loader and a spread
    /// of game versions (the Forge and NeoForge sets depend on the version), plus
    /// the VulkanMod variant.
    fn set_fingerprint() -> u64 {
        let mut text = String::new();
        for loader in ["fabric", "quilt", "forge", "neoforge", "vanilla"] {
            for version in ["1.12.2", "1.16.5", "1.20.1", "1.21.1", "1.21.11"] {
                text.push_str(&format!("{loader}@{version}:"));
                for slot in boost_mods(loader, version) {
                    text.push_str(&format!("{:?}/{:?}/{};", slot.install, slot.counts, slot.optifine_clash));
                }
                text.push('\n');
            }
        }
        for slot in FABRIC_VULKAN_SET {
            text.push_str(&format!("vk:{:?}/{:?}/{};", slot.install, slot.counts, slot.optifine_clash));
        }
        text.bytes().fold(0xcbf29ce484222325u64, |h, b| (h ^ b as u64).wrapping_mul(0x100000001b3))
    }

    /// Every revision that was ever shipped, with the fingerprint of the set it
    /// carried (0: not recorded, the fingerprint only exists since revision 5).
    /// Revision 4 re-checks installed files against their own jars; revision 5
    /// moved the install to the pin table. Changing a slot without adding a line
    /// here (with a bigger revision) fails the fingerprint check below: builds
    /// that already have the mode only receive a new set when `BOOST_SET_REV` grows.
    const REV_HISTORY: &[(u64, u64)] = &[(4, 0), (5, 0x32f003dcb45e9ea9)];

    #[test]
    fn a_changed_boost_set_comes_with_a_bigger_revision() {
        let revs: Vec<u64> = REV_HISTORY.iter().map(|(r, _)| *r).collect();
        assert!(revs.windows(2).all(|w| w[0] < w[1]), "revisions in the history only grow: {revs:?}");
        let (latest, fingerprint) = *REV_HISTORY.last().unwrap();
        assert_eq!(PINNED_SET_REV, latest, "PINNED_SET_REV and the last line of REV_HISTORY name the same revision");
        assert!(revs.contains(&BOOST_SET_REV), "BOOST_SET_REV {BOOST_SET_REV} must be a revision that was shipped: {revs:?}");
        assert_eq!(
            set_fingerprint(),
            fingerprint,
            "the boost set changed: add `({}, {:#x})` to REV_HISTORY and bump PINNED_SET_REV to {}",
            PINNED_SET_REV + 1,
            set_fingerprint(),
            PINNED_SET_REV + 1,
        );
    }

    #[test]
    fn exactly_one_renderer_slot_and_it_counts_every_sodium_port() {
        for loader in ["fabric", "quilt", "forge", "neoforge"] {
            let renderer: Vec<&Slot> = boost_mods(loader, "1.20.1").iter().filter(|s| s.counts.contains(&"sodium")).collect();
            assert_eq!(renderer.len(), 1, "{loader}: two renderer slots would install two Sodium ports and crash");
            for port in ["sodium", "embeddium", "rubidium"] {
                assert!(
                    renderer[0].counts.contains(&port),
                    "{loader}: a build with {port} already has a renderer; installing another one crashes on start",
                );
            }
            assert!(renderer[0].optifine_clash, "{loader}: Sodium ports and OptiFine crash together");
        }
    }

    #[test]
    fn hand_dropped_jars_are_recognised() {
        let cases: [(&str, &str, bool, &str); 6] = [
            ("ferritecore-6.0.1-fabric.jar", "ferrite-core", true, "jar name drops the dash of the slug"),
            ("sodium-fabric-0.5.13+mc1.20.1.jar", "sodium", true, "plain Sodium jar"),
            ("dynamic-fps-3.11.4+minecraft-1.21.0-fabric.jar", "dynamic-fps", true, "dash kept in the jar"),
            ("embeddium-0.3.31+mc1.20.1.jar", "sodium", false, "Embeddium is not Sodium by name; the slot counts it separately"),
            ("lithostitched-1.4.jar", "lithium", false, "a prefix of the letters is not the same mod"),
            ("create-1.20.1-6.0.jar", "modernfix", false, "unrelated mod"),
        ];
        for (jar, slug, want, why) in cases {
            assert_eq!(jar_present(&[jar.to_string()], slug), want, "{jar} vs {slug}: {why}");
        }
    }

    #[test]
    fn optifine_is_detected_by_jar_name() {
        let cases: [(&str, bool, &str); 4] = [
            ("OptiFine_1.20.1_HD_U_I6.jar", true, "Forge OptiFine jar"),
            ("optifabric-1.14.3.jar", true, "OptiFabric pulls OptiFine into Fabric"),
            ("sodium-fabric-0.5.13.jar", false, "Sodium is not OptiFine"),
            ("entityculling-forge-1.6.jar", false, "unrelated mod"),
        ];
        for (jar, want, why) in cases {
            assert_eq!(optifine_among(&[jar.to_string()]), want, "{jar}: {why}");
        }
    }

    #[test]
    fn only_release_or_beta_files_are_installed() {
        let v = |kind: &str, n: &str| serde_json::json!({"version_type": kind, "version_number": n, "game_versions": ["1.21.11"], "loaders": ["fabric"]});
        let fabric = vec!["fabric".to_string()];
        let cases: [(Vec<Value>, Option<&str>, &str); 4] = [
            (vec![v("alpha", "a"), v("release", "r"), v("beta", "b")], Some("r"), "release wins over a newer alpha"),
            (vec![v("alpha", "a"), v("beta", "b")], Some("b"), "beta when no release exists"),
            (vec![v("alpha", "a")], None, "alpha only: skip, a crash costs more than the frames"),
            (vec![], None, "nothing published for the version"),
        ];
        for (list, want, why) in cases {
            let got = stable_pick(&list, "1.21.11", &fabric);
            assert_eq!(got.as_ref().and_then(|x| x["version_number"].as_str()), want, "{why}");
        }
        assert!(stable_pick(&[v("release", "r")], "26.2", &fabric).is_none(), "a file for another game version is never picked");
    }

    #[test]
    fn builds_enabled_under_an_older_set_are_topped_up() {
        let day = RECHECK_SKIPPED_SECS;
        let cases: [(bool, u64, usize, u64, u64, bool, &str); 6] = [
            (true, 1, 0, 0, 10, true, "enabled before the set grew: the new mods must arrive"),
            (true, BOOST_SET_REV, 0, 0, 10 * day, false, "current set, nothing skipped: no network on launch"),
            (true, BOOST_SET_REV, 2, 100, 100 + day - 1, false, "skipped mods are not re-asked on every launch"),
            (true, BOOST_SET_REV, 2, 100, 100 + day, true, "a day later skipped mods are asked again: Sodium reaches new versions late"),
            (false, 1, 3, 0, 10 * day, false, "mode off: nothing to top up"),
            (false, BOOST_SET_REV, 0, 0, 0, false, "mode off stays off"),
        ];
        for (enabled, rev, skipped, checked, now, want, why) in cases {
            assert_eq!(needs_top_up(enabled, rev, skipped, checked, now), want, "{why}");
        }
    }
}
