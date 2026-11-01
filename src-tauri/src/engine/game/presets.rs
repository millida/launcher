// Graphics presets "as in games": five levels from "Potato" to "Epic". A preset is a set of graphics keys in options.txt,
// the "More FPS" mods, a simplified resource pack (Potato) or shaders (Epic). Before the first preset the build's options.txt
// is copied aside; "Undo" gives back only the keys the presets changed (their values from before, kept as a diff) and removes
// exactly what the presets added - everything else the player set since stays. Downloads only from Modrinth.
use super::common_share::shared_options_path;
use super::fpsboost::{
    apply_tuning, boost_off_for_preset, boost_on_for_preset, decode_options, enabled_jars, encode_options, options_path, patch, profile_loader, profile_version, read_options,
    release_line, rows_for_version, settings_of, stable_pick, str_list, undo_tuning, write_options, Options,
};
use super::shaders::{shaders_off_for_preset, shaders_on_for_preset};
use crate::engine::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Must match `GRAPHICS_PRESETS_PUBLIC` in src/lib/graphicsRelease.ts: while the
/// presets are hidden, the FPS boost keeps its slot list instead of the pin table.
pub(super) const GRAPHICS_PRESETS_PUBLIC: bool = false;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GfxPreset {
    Potato,
    Low,
    Standard,
    High,
    Epic,
}

impl GfxPreset {
    pub fn parse(raw: &str) -> Option<GfxPreset> {
        match raw {
            "potato" => Some(GfxPreset::Potato),
            "low" => Some(GfxPreset::Low),
            "standard" => Some(GfxPreset::Standard),
            "high" => Some(GfxPreset::High),
            "epic" => Some(GfxPreset::Epic),
            _ => None,
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            GfxPreset::Potato => "potato",
            GfxPreset::Low => "low",
            GfxPreset::Standard => "standard",
            GfxPreset::High => "high",
            GfxPreset::Epic => "epic",
        }
    }

    fn wants_shaders(self) -> bool {
        self == GfxPreset::Epic
    }

    fn wants_simple_pack(self) -> bool {
        self == GfxPreset::Potato
    }
}

/// Simplified 16x textures for "Potato": in the Millida catalogue with its
/// licence stated (bare-bones-dlya-minecraft), downloaded from Modrinth, never
/// re-hosted. Only a file made for this exact game version is taken.
const POTATO_PACKS: &[&str] = &["bare-bones"];
const POTATO_PACK_TITLE: &str = "Bare Bones";

const BACKUP_DIR: &str = "millida-gfx-backup";
const OWN_COPY: &str = "options.txt";
const SHARED_COPY: &str = "common-options.txt";

/// The build's own choice "no preset": the launcher-wide preset does not touch it.
const KEEP_AS_IS: &str = "none";
/// The build's own choice "the level for this PC": the interface resolves it
/// by the hardware before the start (src/lib/gfxPresets.ts, recommendPreset).
const AUTO_PICK: &str = "auto";

/// Sessions kept for the "before / after" number on the build page.
const FPS_LOG_MAX: usize = 12;

#[derive(Serialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FpsRecord {
    /// Mean of the mod's five-second frame reports while the player was in a world, window in front.
    pub avg: u32,
    /// Mean of the slowest twentieth of those reports: what a stutter feels like.
    pub low: u32,
    pub minutes: u32,
    pub preset: Option<String>,
    pub at: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GfxPresetState {
    /// The preset the build's files are set to now.
    pub preset: Option<String>,
    /// "own" when picked on this build, "global" when taken from the launcher-wide choice.
    pub source: Option<String>,
    /// The player's pick for this build, applied before the next start: a
    /// preset id, "auto" (the level for this PC), "none" (keep the files as
    /// they are), or None (follow the launcher-wide choice). Picking is
    /// instant; the downloads wait for Play.
    pub want: Option<String>,
    /// A copy of the options from before the first preset exists.
    pub can_revert: bool,
    /// False for a catalogue pack whose author tuned its graphics.
    pub applicable: bool,
    /// The game has never started this build (no options.txt): a new build,
    /// which the launcher-wide choice takes over. A played build without its
    /// own choice is left alone until the player asks (`gfx_unchosen_builds`).
    pub fresh: bool,
    /// The loader takes the performance mods (Fabric, Quilt, Forge, NeoForge).
    pub mods: bool,
    /// Shaders install on this loader and the machine has a discrete card (or the core cannot tell).
    pub shaders_ok: bool,
    pub last_fps: Option<FpsRecord>,
    /// The latest session played under another preset (or none): the "before" number.
    pub before_fps: Option<FpsRecord>,
    /// What had no file for this game version, from the last apply.
    pub skipped: Vec<String>,
    /// A video driver Sodium does not start on: the interface offers the vendor's page.
    pub driver: Option<DriverIssue>,
    /// The preset was applied for a laptop on battery: a step lower and 60 FPS.
    pub battery: bool,
    /// Applied from "Auto": the mod's auto distance is on.
    pub auto: bool,
    /// The player changed the preset's graphics in the game afterwards: the
    /// level reads "Custom" and the launcher does not write over it until the
    /// player picks a level again.
    pub custom: bool,
}

/// What the presets themselves turned on, so "Undo" and a switch to another
/// preset take back only that and never what the player had before.
#[derive(Default, Clone, Debug, PartialEq)]
struct AddedBy {
    boost: bool,
    shaders: bool,
    pack: Option<String>,
    /// RenderScale jar the light levels installed.
    scale: Option<String>,
    /// config/renderscale.json5 existed before: then it stays when the mod goes.
    scale_cfg: bool,
}

impl AddedBy {
    fn read(v: &Value) -> AddedBy {
        AddedBy {
            boost: v["boost"].as_bool().unwrap_or(false),
            shaders: v["shaders"].as_bool().unwrap_or(false),
            pack: v["pack"].as_str().filter(|p| !p.is_empty()).map(String::from),
            scale: v["scale"].as_str().filter(|p| !p.is_empty()).map(String::from),
            scale_cfg: v["scaleCfg"].as_bool().unwrap_or(false),
        }
    }

    fn to_value(&self) -> Value {
        json!({ "boost": self.boost, "shaders": self.shaders, "pack": self.pack, "scale": self.scale, "scaleCfg": self.scale_cfg })
    }
}

/// World resolution for the light levels (PERF-framegen FG-03): RenderScale
/// draws the world at this share of the window and the HUD at full size.
/// Starting values; the stand A/B on UHD 620/630, Iris Xe, Vega 8 decides.
pub(super) fn render_scale(level: GfxPreset) -> Option<f32> {
    match level {
        GfxPreset::Potato => Some(0.75),
        GfxPreset::Low => Some(0.85),
        _ => None,
    }
}

const SCALE_CONFIG: &str = "renderscale.json5";

fn scale_config_path(profile: &str) -> PathBuf {
    profile_dir(profile).join("config").join(SCALE_CONFIG)
}

/// Sets one number in RenderScale's Jankson config, keeping everything else
/// (the shader scale `irisScale` and the rest). A missing file or key is added.
pub(super) fn set_json5_number(text: &str, key: &str, value: f32) -> String {
    let quoted = format!("\"{}\"", key);
    let shown = format!("{:.2}", value);
    let mut found = false;
    let lines: Vec<String> = text
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if !found && (trimmed.starts_with(&format!("{}:", quoted)) || trimmed.starts_with(&format!("{} :", quoted))) {
                found = true;
                let indent = &line[..line.len() - trimmed.len()];
                let comma = if trimmed.trim_end().ends_with(',') { "," } else { "" };
                format!("{}{}: {}{}", indent, quoted, shown, comma)
            } else {
                line.to_string()
            }
        })
        .collect();
    if found {
        return lines.join("\n") + "\n";
    }
    match text.find('{') {
        Some(at) => format!("{}{{\n\t{}: {},{}", &text[..at], quoted, shown, &text[at + 1..]),
        None => format!("{{\n\t{}: {}\n}}\n", quoted, shown),
    }
}

/// Installs one pinned Modrinth version with its required dependencies.
async fn install_pinned(profile: &str, loader: &str, version: &str, pin: &super::perfpins::Pin) -> Result<String, String> {
    let all = project_versions(&pin.slug).await?;
    let ver = all.into_iter().find(|v| v["id"].as_str() == Some(pin.version.as_str())).ok_or_else(|| pin.slug.clone())?;
    let file = install_project_version(profile, "mod", &pin.slug, &ver).await?;
    let loaders = modrinth_loaders(loader, "mod");
    let bridge = bridge_loaders(profile, loader, "mod");
    let _ = resolve_deps(profile, version, &loaders, &bridge, &ver["dependencies"]).await;
    Ok(file)
}

fn write_scale_config(profile: &str, scale: f32) -> Result<(), String> {
    let path = scale_config_path(profile);
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    write_bytes_atomic(&path, set_json5_number(&text, "scale", scale).as_bytes())
}

/// Takes back the RenderScale the presets installed, and its config if they created it.
fn remove_scale(profile: &str, by: &mut AddedBy) {
    if let Some(file) = by.scale.take() {
        let _ = delete_content(profile, "mod", &file);
        if !by.scale_cfg {
            let _ = std::fs::remove_file(scale_config_path(profile));
        }
    }
    by.scale_cfg = false;
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// A card name from DXGI -> is it a discrete card. Integrated graphics carry
/// look-alike names: "Radeon RX Vega 10 Graphics" sits inside a Ryzen and
/// "Intel Arc Graphics" inside a Core Ultra; the discrete ones carry a model
/// number ("RX 6600", "Arc A770").
pub(super) fn looks_discrete(name: &str) -> bool {
    let lower = name.to_ascii_lowercase().replace("(tm)", " ").replace("(r)", " ");
    let words: Vec<&str> = lower.split(|c: char| c.is_whitespace() || c == '/').filter(|w| !w.is_empty()).collect();
    let has = |w: &str| words.contains(&w);
    let model_after = |w: &str, starts: &[char]| {
        words
            .windows(2)
            .any(|pair| pair[0] == w && pair[1].starts_with(starts) && pair[1].chars().nth(1).is_some_and(|c| c.is_ascii_digit()))
    };
    if has("nvidia") || has("geforce") || has("quadro") {
        return true;
    }
    if has("radeon") {
        if has("pro") {
            return true;
        }
        let integrated = has("vega") || words.last() == Some(&"graphics");
        let numbered = words.windows(2).any(|pair| pair[0] == "rx" && pair[1].starts_with(|c: char| c.is_ascii_digit()));
        return numbered && !integrated;
    }
    if has("arc") {
        return model_after("arc", &['a', 'b']);
    }
    false
}

/// Some(false) only when the core sees the cards and none is discrete. macOS
/// and Linux report no names here, so the interface decides there.
pub fn gpu_discrete_known() -> Option<bool> {
    let names = adapter_names();
    if names.is_empty() {
        None
    } else {
        Some(names.iter().any(|n| looks_discrete(n)))
    }
}

/// The resource pack list as the game version writes it: 1.13 and newer name
/// files "file/<name>" next to "vanilla", older versions use the bare file name.
/// A list the core cannot read is left alone rather than rewritten.
pub(super) fn with_pack(rows: &mut Vec<(String, String)>, version: &str, add: Option<&str>, remove: Option<&str>) {
    const KEY: &str = "resourcePacks";
    let modern = release_line(version) >= (1, 13);
    let id = |file: &str| if modern { format!("file/{}", file) } else { file.to_string() };
    let current = rows.iter().find(|(k, _)| k == KEY).map(|(_, v)| v.clone());
    let mut list: Vec<String> = match current.as_deref() {
        Some(text) => match serde_json::from_str::<Vec<String>>(text) {
            Ok(list) => list,
            Err(_) => return,
        },
        None if add.is_none() => return,
        None if modern => vec!["vanilla".to_string()],
        None => vec![],
    };
    if let Some(file) = remove {
        let gone = id(file);
        list.retain(|p| p != &gone);
    }
    if let Some(file) = add {
        let wanted = id(file);
        // The last entry is drawn on top of the others.
        list.retain(|p| p != &wanted);
        list.push(wanted);
    }
    let text = serde_json::to_string(&list).unwrap_or_else(|_| "[]".into());
    match rows.iter_mut().find(|(k, _)| k == KEY) {
        Some(row) => row.1 = text,
        None => rows.push((KEY.to_string(), text)),
    }
}

fn backup_dir(profile: &str) -> PathBuf {
    profile_dir(profile).join(BACKUP_DIR)
}

/// Copies `from` aside; false when there was nothing to copy.
fn copy_aside(from: &Path, to: &Path) -> Result<bool, String> {
    match std::fs::read(from) {
        Ok(bytes) => {
            write_bytes_atomic(to, &bytes)?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Не удалось сохранить копию настроек игры: {}. Закрой игру и попробуй ещё раз", e)),
    }
}

/// Taken once, before the first preset: switching between presets keeps the
/// copy of what the player had, so "Undo" always returns to that.
fn take_backup(profile: &str) -> Result<(), String> {
    let s = settings_of(profile);
    if s["gfxBackup"].is_object() {
        return Ok(());
    }
    let dir = backup_dir(profile);
    let own = copy_aside(&options_path(profile), &dir.join(OWN_COPY))?;
    let shared = match shared_options_path(profile) {
        Some(path) => Value::Bool(copy_aside(&path, &dir.join(SHARED_COPY))?),
        None => Value::Null,
    };
    patch(
        profile,
        vec![(
            "gfxBackup",
            json!({
                "options": own,
                "shared": shared,
                "boost": s["fpsBoost"].as_bool().unwrap_or(false),
                "shaders": s["shaders"].as_bool().unwrap_or(false),
                "at": now_unix(),
            }),
        )],
    );
    Ok(())
}

/// Shaders off without orphaning their renderer: with "More FPS" on, Sodium
/// stays in the build, and from now on that mode owns it, so turning the mode
/// off later removes it too.
fn shaders_off_keeping_renderer(profile: &str) -> Result<(), String> {
    let theirs = str_list(&settings_of(profile)["shadersMods"]);
    shaders_off_for_preset(profile)?;
    let s = settings_of(profile);
    if !s["fpsBoost"].as_bool().unwrap_or(false) {
        return Ok(());
    }
    let present = enabled_jars(profile);
    let mut owned = str_list(&s["fpsBoostMods"]);
    for file in theirs {
        if present.contains(&file) && !owned.contains(&file) {
            owned.push(file);
        }
    }
    patch(profile, vec![("fpsBoostMods", Value::Array(owned.into_iter().map(Value::String).collect()))]);
    Ok(())
}

async fn install_simple_pack(profile: &str, version: &str) -> Option<String> {
    for slug in POTATO_PACKS {
        let Ok(all) = project_versions(slug).await else { continue };
        let Some(v) = stable_pick(&all, version, &[]) else { continue };
        if let Ok(file) = install_project_version(profile, "resourcepack", slug, &v).await {
            return Some(file);
        }
    }
    None
}

/// Returns the values the keys had before (`apply_tuning`'s diff), for "Undo".
fn tune_file(
    path: &Path,
    table: &[(String, String)],
    version: &str,
    add: Option<&str>,
    remove: Option<&str>,
) -> Result<serde_json::Map<String, Value>, String> {
    let mut opts = match std::fs::read(path) {
        Ok(bytes) => decode_options(&bytes),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Options { rows: vec![], bytewise: false },
        Err(e) => return Err(format!("Не удалось прочитать общие настройки игры: {}", e)),
    };
    let previous = apply_tuning(&mut opts.rows, table);
    with_pack(&mut opts.rows, version, add, remove);
    write_bytes_atomic(path, &encode_options(&opts))?;
    Ok(previous)
}

/// The diff "key: value from before the presets", kept across applies: a key is
/// recorded the first time any preset touches it, so switching presets never
/// overwrites the player's own value with the previous preset's.
fn remember_previous(stored: &Value, now: serde_json::Map<String, Value>) -> Value {
    let mut all = stored.as_object().cloned().unwrap_or_default();
    for (key, was) in now {
        all.entry(key).or_insert(was);
    }
    Value::Object(all)
}

/// A build whose backup was taken before the diff was kept: the same diff read
/// from the copy of the file, for the keys the presets write.
fn previous_from_copy(copy: &Path, existed: bool, written: &Value) -> Result<Value, String> {
    let rows = if existed {
        let bytes = std::fs::read(copy).map_err(|e| format!("Копия настроек пропала из папки сборки: {}", e))?;
        decode_options(&bytes).rows
    } else {
        vec![]
    };
    let mut keys: Vec<String> = vec!["graphicsPreset".into(), "guiScale".into()];
    keys.extend(written.as_object().map(|m| m.keys().cloned().collect::<Vec<_>>()).unwrap_or_default());
    let mut map = serde_json::Map::new();
    for key in keys {
        let was = rows.iter().find(|(k, _)| *k == key).map(|(_, v)| Value::String(v.clone())).unwrap_or(Value::Null);
        map.entry(key).or_insert(was);
    }
    Ok(Value::Object(map))
}

/// The file did not exist before the presets, so every key they touched was absent,
/// whatever a mode that created the file with the same values recorded on the way.
fn all_absent(previous: &Value) -> Value {
    Value::Object(previous.as_object().map(|m| m.keys().map(|k| (k.clone(), Value::Null)).collect()).unwrap_or_default())
}

/// What "Undo" does to the rows of one options file: the keys the presets
/// changed go back to their old values (or disappear if they were not there),
/// the preset's own resource pack leaves the list, and every other row - key
/// bindings, sound, language, whatever the player set since - stays as it is.
fn revert_rows(rows: &mut Vec<(String, String)>, previous: &Value, version: &str, pack: Option<&str>) {
    undo_tuning(rows, previous);
    if let Some(file) = pack {
        with_pack(rows, version, None, Some(file));
    }
}

pub async fn apply_gfx_preset(
    app: AppHandle,
    profile: String,
    preset: String,
    video: Option<Vec<(String, String)>>,
    source: Option<String>,
    battery: Option<bool>,
    auto: Option<bool>,
) -> Result<GfxPresetState, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let battery = battery.unwrap_or(false);
    let auto = auto.unwrap_or(false);
    let Some(level) = GfxPreset::parse(&preset) else {
        return Err("Такого пресета графики нет".into());
    };
    if !fps_boost_applicable(&profile) {
        return Err("Графику этой сборки подобрал автор — пресет её не меняет".into());
    }
    assert_not_running(&profile, "выбери пресет снова")?;
    if level.wants_shaders() && gpu_discrete_known() == Some(false) {
        return Err("«Эпические» — только для дискретной видеокарты (NVIDIA или AMD RX)".into());
    }
    if level.wants_shaders() && driver_issue().is_some() {
        return Err("Шейдерам нужен свежий драйвер видеокарты — обнови его с сайта производителя".into());
    }
    let source = if source.as_deref() == Some("global") { "global" } else { "own" };
    let version = profile_version(&profile);
    let loader = profile_loader(&profile);
    take_backup(&profile)?;
    let mut by = AddedBy::read(&settings_of(&profile)["gfxBy"]);
    let save_by = |by: &AddedBy| patch(&profile, vec![("gfxBy", by.to_value())]);
    let mut skipped: Vec<String> = vec![];

    // Shaders before the boost: Iris pairs with Sodium, and the boost then
    // counts that Sodium as its renderer instead of installing a second one.
    let shaders_on = settings_of(&profile)["shaders"].as_bool().unwrap_or(false);
    if level.wants_shaders() {
        if !shaders_on {
            emit(&app, "gfxpreset", 10.0, "Ставим шейдеры…");
            shaders_on_for_preset(&app, &profile).await?;
            by.shaders = true;
            save_by(&by);
        }
    } else if by.shaders {
        if shaders_on {
            shaders_off_keeping_renderer(&profile)?;
        }
        by.shaders = false;
        save_by(&by);
    }

    let table = rows_for_version(video_table(video), &version);
    if !settings_of(&profile)["fpsBoost"].as_bool().unwrap_or(false) {
        emit(&app, "gfxpreset", 40.0, "Ставим моды-ускорители…");
        match boost_on_for_preset(&app, &profile, table.clone()).await {
            Ok(state) => {
                by.boost = true;
                skipped.extend(state.skipped);
                save_by(&by);
            }
            Err(e) => warn(&app, &format!("Моды-ускорители не встали: {}", e)),
        }
    }

    let mut removed_pack: Option<String> = None;
    if level.wants_simple_pack() {
        if by.pack.is_none() {
            emit(&app, "gfxpreset", 80.0, "Ставим простые текстуры…");
            match install_simple_pack(&profile, &version).await {
                Some(file) => {
                    by.pack = Some(file);
                    save_by(&by);
                }
                None => skipped.push(POTATO_PACK_TITLE.to_string()),
            }
        }
    } else if let Some(file) = by.pack.take() {
        let _ = delete_content(&profile, "resourcepack", &file);
        removed_pack = Some(file);
        save_by(&by);
    }

    // World resolution for Potato and Low: a stable RenderScale from the pins,
    // never next to OptiFine, shaders or Distant Horizons, never over the
    // player's own copy.
    let scale = render_scale(level);
    let scale_pin = if scale.is_some() {
        super::perfpins::level_pins(&super::perfpins::current().await, &loader, &version, level.id())
            .into_iter()
            .find(|p| p.slot == "scale")
    } else {
        None
    };
    let jars = enabled_jars(&profile);
    let shaders_now = settings_of(&profile)["shaders"].as_bool().unwrap_or(false);
    let clash = |pin: &super::perfpins::Pin| shaders_now || pin.conflicts.iter().any(|c| super::fpsboost::jar_present(&jars, c));
    match (scale, &scale_pin) {
        (Some(value), Some(pin)) if !clash(pin) => {
            let own_copy = by.scale.is_none() && super::fpsboost::jar_present(&jars, &pin.slug);
            if by.scale.is_none() && !own_copy {
                emit(&app, "gfxpreset", 85.0, "Ставим масштаб мира…");
                match install_pinned(&profile, &loader, &version, pin).await {
                    Ok(file) => {
                        by.scale_cfg = scale_config_path(&profile).exists();
                        by.scale = Some(file);
                        save_by(&by);
                    }
                    Err(_) => skipped.push("RenderScale".to_string()),
                }
            }
            if by.scale.is_some() {
                write_scale_config(&profile, value)?;
            }
        }
        _ => {
            if by.scale.is_some() {
                remove_scale(&profile, &mut by);
                save_by(&by);
            }
        }
    }

    emit(&app, "gfxpreset", 90.0, "Настройки графики…");
    let mut opts = read_options(&profile)?;
    let before = settings_of(&profile);
    let mut undo = vec![("gfxUndo", remember_previous(&before["gfxUndo"], apply_tuning(&mut opts.rows, &table)))];
    with_pack(&mut opts.rows, &version, by.pack.as_deref(), removed_pack.as_deref());
    write_options(&profile, &opts)?;
    // A build that shares options takes the shared copy before every start.
    if let Some(shared) = shared_options_path(&profile) {
        let previous = tune_file(&shared, &table, &version, by.pack.as_deref(), removed_pack.as_deref())?;
        undo.push(("gfxUndoShared", remember_previous(&before["gfxUndoShared"], previous)));
    }
    let distance = table.iter().find(|(k, _)| k == "renderDistance").and_then(|(_, v)| v.parse::<u32>().ok());
    write_perf_profile(&profile, |revision| perf_profile(level, revision, auto, battery, distance));
    patch(&profile, undo);
    patch(
        &profile,
        vec![
            ("gfxPreset", Value::String(level.id().to_string())),
            ("gfxSource", Value::String(source.to_string())),
            ("gfxBy", by.to_value()),
            ("gfxAt", Value::from(now_unix())),
            ("gfxBattery", Value::Bool(battery)),
            ("gfxAuto", Value::Bool(auto)),
            ("gfxWritten", written_by_preset(&table)),
        ],
    );
    emit(&app, "gfxpreset", 100.0, "Пресет применён");
    let mut state = gfx_preset_state(&profile);
    state.skipped = skipped;
    Ok(state)
}

/// "Undo": the options from before the first preset, and nothing the presets added.
pub fn revert_gfx_preset(profile: &str) -> Result<GfxPresetState, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    assert_not_running(profile, "верни настройки снова")?;
    let s = settings_of(profile);
    let backup = s["gfxBackup"].clone();
    if !backup.is_object() {
        return Err("Возвращать нечего: пресет к этой сборке не применяли".into());
    }
    let mut by = AddedBy::read(&s["gfxBy"]);
    remove_scale(profile, &mut by);
    if by.shaders && s["shaders"].as_bool().unwrap_or(false) {
        shaders_off_keeping_renderer(profile)?;
    }
    if by.boost && settings_of(profile)["fpsBoost"].as_bool().unwrap_or(false) {
        boost_off_for_preset(profile)?;
    }
    if let Some(file) = &by.pack {
        let _ = delete_content(profile, "resourcepack", file);
    }
    let dir = backup_dir(profile);
    let version = profile_version(profile);
    let pack = by.pack.as_deref();
    let had_own = backup["options"].as_bool().unwrap_or(false);
    let previous = if s["gfxUndo"].is_object() {
        s["gfxUndo"].clone()
    } else {
        previous_from_copy(&dir.join(OWN_COPY), had_own, &s["gfxWritten"])?
    };
    let previous = if had_own { previous } else { all_absent(&previous) };
    let mut opts = read_options(profile)?;
    revert_rows(&mut opts.rows, &previous, &version, pack);
    if opts.rows.is_empty() && !had_own {
        // There was no file before the presets and nothing else has been written to it since.
        let _ = std::fs::remove_file(options_path(profile));
    } else {
        write_options(profile, &opts)?;
    }
    if let (Some(had), Some(shared)) = (backup["shared"].as_bool(), shared_options_path(profile)) {
        let previous = if s["gfxUndoShared"].is_object() {
            s["gfxUndoShared"].clone()
        } else {
            previous_from_copy(&dir.join(SHARED_COPY), had, &s["gfxWritten"])?
        };
        let previous = if had { previous } else { all_absent(&previous) };
        // A shared file the player removed since has nothing of ours left to take back.
        if let Ok(bytes) = std::fs::read(&shared) {
            let mut opts = decode_options(&bytes);
            revert_rows(&mut opts.rows, &previous, &version, pack);
            if opts.rows.is_empty() && !had {
                let _ = std::fs::remove_file(&shared);
            } else {
                write_bytes_atomic(&shared, &encode_options(&opts))?;
            }
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
    // The mod keeps what a profile set until a newer revision says otherwise:
    // a profile that only turns auto distance off, with the rest left alone.
    write_perf_profile(profile, |revision| json!({ "v": 1, "revision": revision, "autoDistance": false }));
    patch(
        profile,
        vec![
            ("gfxAuto", Value::Null),
            ("gfxBattery", Value::Null),
            ("gfxWritten", Value::Null),
            ("gfxUndo", Value::Null),
            ("gfxUndoShared", Value::Null),
            ("gfxPreset", Value::Null),
            ("gfxSource", Value::Null),
            ("gfxBy", Value::Null),
            ("gfxBackup", Value::Null),
            ("gfxAt", Value::Null),
            // Undone by hand: the launcher-wide preset must not come back on the next start.
            ("gfxWant", Value::String(KEEP_AS_IS.to_string())),
        ],
    );
    Ok(gfx_preset_state(profile))
}

/// The player's pick on the build page, saved at once and applied before the
/// next start (src/lib/prelaunchCare.ts). None follows the launcher-wide choice.
pub fn choose_gfx_preset(profile: &str, preset: Option<String>) -> Result<GfxPresetState, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let want = match preset.as_deref() {
        None => Value::Null,
        Some(KEEP_AS_IS) => Value::String(KEEP_AS_IS.to_string()),
        Some(AUTO_PICK) => Value::String(AUTO_PICK.to_string()),
        Some(id) => match GfxPreset::parse(id) {
            Some(level) => Value::String(level.id().to_string()),
            None => return Err("Такого пресета графики нет".into()),
        },
    };
    patch(profile, vec![("gfxWant", want), ("gfxWantAt", Value::from(now_unix()))]);
    Ok(gfx_preset_state(profile))
}

fn fps_log(s: &Value) -> Vec<FpsRecord> {
    s["fpsLog"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    Some(FpsRecord {
                        avg: u32::try_from(r["avg"].as_u64()?).ok()?,
                        low: r["low"].as_u64().and_then(|v| u32::try_from(v).ok()).unwrap_or(0),
                        minutes: r["minutes"].as_u64().and_then(|v| u32::try_from(v).ok()).unwrap_or(0),
                        preset: r["preset"].as_str().map(String::from),
                        at: r["at"].as_u64().unwrap_or(0),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The last session and the latest one before it under another preset.
fn last_and_before(log: &[FpsRecord]) -> (Option<FpsRecord>, Option<FpsRecord>) {
    let Some(last) = log.last() else { return (None, None) };
    let before = log.iter().rev().find(|r| r.preset != last.preset).cloned();
    (Some(last.clone()), before)
}

pub fn gfx_preset_state(profile: &str) -> GfxPresetState {
    let s = settings_of(profile);
    let (last_fps, before_fps) = last_and_before(&fps_log(&s));
    let loader = profile_loader(profile);
    GfxPresetState {
        preset: s["gfxPreset"].as_str().filter(|p| GfxPreset::parse(p).is_some()).map(String::from),
        source: s["gfxSource"].as_str().map(String::from),
        want: s["gfxWant"].as_str().filter(|w| *w == KEEP_AS_IS || *w == AUTO_PICK || GfxPreset::parse(w).is_some()).map(String::from),
        can_revert: s["gfxBackup"].is_object(),
        applicable: fps_boost_applicable(profile),
        fresh: !options_path(profile).exists(),
        mods: super::perfpins::pins_exist(&loader, &profile_version(profile)),
        shaders_ok: shaders_state(profile).supported && gpu_discrete_known() != Some(false) && driver_issue().is_none(),
        last_fps,
        before_fps,
        skipped: vec![],
        driver: driver_issue(),
        battery: s["gfxBattery"].as_bool().unwrap_or(false),
        auto: s["gfxAuto"].as_bool().unwrap_or(false),
        custom: changed_by_hand(profile, &s),
    }
}

/// The graphics keys the preset wrote, as written. The vanilla preset name
/// (the game turns it into "custom" itself once any value differs) and the
/// interface scale (a matter of eyesight, not of frames) are left out.
fn written_by_preset(table: &[(String, String)]) -> Value {
    let mut m = serde_json::Map::new();
    for (k, v) in table {
        if k != "graphicsPreset" && k != "guiScale" {
            m.insert(k.clone(), Value::String(v.clone()));
        }
    }
    Value::Object(m)
}

/// "0.5" and "0.50", `"fast"` and `fast`: the same setting.
fn same_value(a: &str, b: &str) -> bool {
    let (a, b) = (a.trim().trim_matches('"'), b.trim().trim_matches('"'));
    match (a.parse::<f64>(), b.parse::<f64>()) {
        (Ok(x), Ok(y)) => (x - y).abs() < 1e-9,
        _ => a == b,
    }
}

/// Changed by hand: a key the preset wrote now holds another value. A key the
/// game dropped (an older version does not know it) is not a change. A level
/// the player picked after the last apply wins over the old edits.
pub(super) fn edited_after(written: &Value, rows: &[(String, String)]) -> bool {
    let Some(map) = written.as_object() else { return false };
    map.iter().any(|(k, v)| {
        let Some(was) = v.as_str() else { return false };
        rows.iter().find(|(rk, _)| rk == k).is_some_and(|(_, now)| !same_value(was, now))
    })
}

fn changed_by_hand(profile: &str, s: &Value) -> bool {
    let picked_since = s["gfxWantAt"].as_u64().unwrap_or(0) > s["gfxAt"].as_u64().unwrap_or(0);
    if picked_since {
        return false;
    }
    read_options(profile).is_ok_and(|opts| edited_after(&s["gfxWritten"], &opts.rows))
}

/// Profile for the Millida mod in the build folder (format: work/MOD-optimize.md,
/// mod docs/perf.md). The mod applies a profile once per `revision` and only
/// to options the player has not changed, so every write takes a new revision.
const PERF_FILE: &str = "millida-perf.json";

/// Our five levels are the mod's five tiers: Minimum, Economy, Balance, Pretty, Maximum.
fn perf_tier(level: GfxPreset) -> u8 {
    match level {
        GfxPreset::Potato => 1,
        GfxPreset::Low => 2,
        GfxPreset::Standard => 3,
        GfxPreset::High => 4,
        GfxPreset::Epic => 5,
    }
}

/// The mod's own floor for auto distance per tier, never above the distance the preset set.
fn perf_min_distance(level: GfxPreset, preset_distance: Option<u32>) -> u32 {
    let floor = [4, 6, 8, 10, 12][usize::from(perf_tier(level)) - 1];
    preset_distance.map_or(floor, |d| floor.min(d.max(2)))
}

/// "Auto" on the slider turns the mod's auto distance on; on battery the
/// background limit drops further.
pub(super) fn perf_profile(level: GfxPreset, revision: u64, auto: bool, battery: bool, preset_distance: Option<u32>) -> Value {
    let mut profile = json!({
        "v": 1,
        "revision": revision,
        "tier": perf_tier(level),
        "targetFps": 60,
        "autoDistance": auto,
        "minDistance": perf_min_distance(level, preset_distance),
        "menuLimit": 60,
        "idleLimit": if battery { 10 } else { 15 },
    });
    // The level's world resolution, for the mod's own dynamic scale later (FG-04); the mod ignores it today.
    if let Some(scale) = render_scale(level) {
        profile["renderScale"] = json!(scale);
    }
    profile
}

/// Writes the profile with the build's next revision. The counter lives in the
/// build's settings and survives "Undo": the mod remembers the last revision
/// it applied, and a profile written later must still be newer.
fn write_perf_profile(profile: &str, body: impl FnOnce(u64) -> Value) {
    let revision = settings_of(profile)["gfxPerfRev"].as_u64().unwrap_or(0) + 1;
    patch(profile, vec![("gfxPerfRev", Value::from(revision))]);
    let _ = write_json_atomic(&profile_dir(profile).join(PERF_FILE), &body(revision));
}

/// Played builds the launcher-wide choice does not reach: no choice of their
/// own, never set by the launcher-wide one, graphics not tuned by an author.
/// Settings offer them one "Optimise my builds" button with a confirmation.
pub fn gfx_unchosen_builds() -> Vec<String> {
    load_profiles()
        .into_iter()
        .map(|p| p.name)
        .filter(|name| {
            let s = settings_of(name);
            s["gfxWant"].is_null() && s["gfxSource"].as_str() != Some("global") && options_path(name).exists() && fps_boost_applicable(name)
        })
        .collect()
}

/// Mean and the slowest twentieth of the session's frame reports; None for a
/// session too short to say anything (under a minute in a world).
pub(super) fn summarize_fps(samples: &[u32]) -> Option<(u32, u32)> {
    const MIN_SAMPLES: usize = 12;
    if samples.len() < MIN_SAMPLES {
        return None;
    }
    let sum: u64 = samples.iter().map(|&f| u64::from(f)).sum();
    let avg = u32::try_from(sum / samples.len() as u64).unwrap_or(u32::MAX);
    let mut sorted = samples.to_vec();
    sorted.sort_unstable();
    let tail = &sorted[..(sorted.len() / 20).max(1)];
    let low = u32::try_from(tail.iter().map(|&f| u64::from(f)).sum::<u64>() / tail.len() as u64).unwrap_or(u32::MAX);
    Some((avg, low))
}

/// Written by the core when a game closes, while the interface may be unloaded:
/// the build page and the toast after the game read it from the build's settings.
pub(super) fn record_session_fps(profile: &str, samples: &[u32], seconds_per_sample: u32) {
    let Some((avg, low)) = summarize_fps(samples) else { return };
    let s = settings_of(profile);
    let mut log: Vec<Value> = s["fpsLog"].as_array().cloned().unwrap_or_default();
    let minutes = (samples.len() as u64 * u64::from(seconds_per_sample) / 60) as u32;
    log.push(json!({ "avg": avg, "low": low, "minutes": minutes, "preset": s["gfxPreset"].clone(), "at": now_unix() }));
    let extra = log.len().saturating_sub(FPS_LOG_MAX);
    if extra > 0 {
        log = log.split_off(extra);
    }
    patch(profile, vec![("fpsLog", Value::Array(log))]);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    /// A month after the preset the player has remapped keys, changed the sound
    /// and the language. "Undo" gives back the graphics the preset wrote and
    /// nothing else: before the fix the whole file from a month ago came back.
    #[test]
    fn undo_gives_back_only_the_keys_the_preset_changed() {
        let before = rows(&[("renderDistance", "16"), ("key_key.jump", "key.keyboard.space"), ("lang", "en_us")]);
        let table = rows(&[("renderDistance", "6"), ("ao", "false")]);
        let mut now = before.clone();
        let previous = remember_previous(&Value::Null, apply_tuning(&mut now, &table));
        // The month of play after the preset.
        now.iter_mut().find(|(k, _)| k == "key_key.jump").unwrap().1 = "key.keyboard.left.shift".into();
        now.iter_mut().find(|(k, _)| k == "lang").unwrap().1 = "ru_ru".into();
        now.push(("soundCategory_master".into(), "0.3".into()));

        revert_rows(&mut now, &previous, "1.21.1", None);

        let get = |k: &str| now.iter().find(|(rk, _)| rk == k).map(|(_, v)| v.as_str());
        assert_eq!(get("renderDistance"), Some("16"), "the preset's key is back to what it was");
        assert_eq!(get("ao"), None, "a key the preset added is gone");
        assert_eq!(get("key_key.jump"), Some("key.keyboard.left.shift"), "key bindings made since stay");
        assert_eq!(get("lang"), Some("ru_ru"), "the language chosen since stays");
        assert_eq!(get("soundCategory_master"), Some("0.3"), "settings added since stay");
    }

    /// Switching from one preset to another must not make the second one's
    /// "was" the first one's values: Undo still goes back to the player's own.
    #[test]
    fn the_first_value_of_a_key_is_the_one_undo_returns_to() {
        let mut now = rows(&[("renderDistance", "16")]);
        let first = remember_previous(&Value::Null, apply_tuning(&mut now, &rows(&[("renderDistance", "6")])));
        let second = remember_previous(&first, apply_tuning(&mut now, &rows(&[("renderDistance", "10"), ("ao", "true")])));
        revert_rows(&mut now, &second, "1.21.1", None);
        assert_eq!(now, rows(&[("renderDistance", "16")]), "the player's 16, not the first preset's 6; the key added by the second is gone");
    }

    #[test]
    fn undo_takes_the_presets_pack_out_of_the_list_and_keeps_the_players_own_packs() {
        let mut now = rows(&[("resourcePacks", "[\"vanilla\",\"file/Fresh.zip\",\"file/Bare Bones.zip\"]")]);
        revert_rows(&mut now, &json!({}), "1.21.1", Some("Bare Bones.zip"));
        assert_eq!(now, rows(&[("resourcePacks", "[\"vanilla\",\"file/Fresh.zip\"]")]));
    }

    #[test]
    fn a_file_the_presets_created_has_every_touched_key_removed() {
        // The mode that created the file recorded the preset's own values as "before".
        let recorded = json!({ "renderDistance": "6", "ao": "false" });
        let absent = all_absent(&recorded);
        let mut now = rows(&[("renderDistance", "6"), ("ao", "false"), ("lang", "ru_ru")]);
        revert_rows(&mut now, &absent, "1.21.1", None);
        assert_eq!(now, rows(&[("lang", "ru_ru")]), "only the language the player set is left");
    }

    #[test]
    fn a_backup_without_a_diff_gives_the_same_diff_from_its_copy() {
        let dir = std::env::temp_dir().join(format!("millida-gfx-undo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let copy = dir.join("options.txt");
        std::fs::write(&copy, "renderDistance:16\nlang:en_us\n").unwrap();
        let written = json!({ "renderDistance": "6", "ao": "false" });
        let diff = previous_from_copy(&copy, true, &written).unwrap();
        assert_eq!(diff["renderDistance"], json!("16"));
        assert_eq!(diff["ao"], Value::Null, "absent in the copy: removed on undo");
        assert!(diff.get("lang").is_none(), "keys the presets never write are not in the diff");
        assert!(previous_from_copy(&dir.join("gone.txt"), true, &written).is_err(), "a lost copy is reported");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// adapter name -> discrete. The integrated look-alikes are the cases that
    /// would hand shaders to a laptop that cannot draw them.
    #[test]
    fn discrete_cards_are_told_from_integrated_look_alikes() {
        let cases: [(&str, bool, &str); 12] = [
            ("NVIDIA GeForce RTX 3060 Laptop GPU", true, "the most common gaming card in the fleet"),
            ("NVIDIA GeForce GTX 1650", true, "older discrete NVIDIA"),
            ("AMD Radeon RX 6600", true, "discrete AMD with a model number"),
            ("Radeon RX 580 Series", true, "older discrete AMD"),
            ("AMD Radeon(TM) RX Vega 10 Graphics", false, "Ryzen integrated graphics named RX Vega"),
            ("AMD Radeon(TM) Graphics", false, "Ryzen integrated graphics"),
            ("AMD Radeon 780M Graphics", false, "Ryzen 7040 integrated"),
            ("AMD Radeon Pro 5500M", true, "MacBook-class discrete AMD"),
            ("Intel(R) Arc(TM) A770 Graphics", true, "discrete Intel Arc"),
            ("Intel(R) Arc(TM) Graphics", false, "Core Ultra integrated Arc"),
            ("Intel(R) UHD Graphics 620", false, "plain Intel integrated"),
            ("Microsoft Basic Render Driver", false, "no driver at all"),
        ];
        for (name, want, why) in cases {
            assert_eq!(looks_discrete(name), want, "{name}: {why}");
        }
    }

    fn row(k: &str, v: &str) -> (String, String) {
        (k.to_string(), v.to_string())
    }

    /// (game version, resourcePacks before, add, remove) -> after. The pack
    /// goes on top; the player's own packs and the vanilla entry stay.
    #[test]
    fn the_simple_pack_is_listed_on_top_and_taken_off_exactly() {
        // (game version, list before, add, remove, list after, why)
        type Case<'a> = (&'a str, Option<&'a str>, Option<&'a str>, Option<&'a str>, Option<&'a str>, &'a str);
        let cases: [Case; 6] = [
            ("1.21.1", Some(r#"["vanilla","file/HD.zip"]"#), Some("BB.zip"), None, Some(r#"["vanilla","file/HD.zip","file/BB.zip"]"#), "modern list, on top"),
            ("1.21.1", None, Some("BB.zip"), None, Some(r#"["vanilla","file/BB.zip"]"#), "a fresh file starts with vanilla"),
            ("1.12.2", Some(r#"["HD.zip"]"#), Some("BB.zip"), None, Some(r#"["HD.zip","BB.zip"]"#), "1.12 lists bare file names"),
            ("1.21.1", Some(r#"["vanilla","file/BB.zip","file/HD.zip"]"#), None, Some("BB.zip"), Some(r#"["vanilla","file/HD.zip"]"#), "switching away removes only ours"),
            ("1.21.1", Some("not json"), Some("BB.zip"), None, Some("not json"), "an unreadable list is left alone"),
            ("1.21.1", None, None, Some("BB.zip"), None, "nothing to remove from a missing list"),
        ];
        for (version, before, add, remove, after, why) in cases {
            let mut rows = vec![row("lang", "ru_ru")];
            if let Some(b) = before {
                rows.push(row("resourcePacks", b));
            }
            with_pack(&mut rows, version, add, remove);
            let got = rows.iter().find(|(k, _)| k == "resourcePacks").map(|(_, v)| v.as_str());
            assert_eq!(got, after, "{why}");
            assert!(rows.iter().any(|(k, v)| k == "lang" && v == "ru_ru"), "{why}: other lines must stay");
        }
    }

    /// samples -> (avg, low). Short sessions say nothing: a menu and a
    /// loading screen are not the player's FPS.
    #[test]
    fn session_fps_needs_a_minute_and_reports_the_slow_tail() {
        assert_eq!(summarize_fps(&[60; 11]), None, "under a minute of reports");
        assert_eq!(summarize_fps(&[60; 12]), Some((60, 60)), "steady frames");
        let mut mixed = vec![100u32; 38];
        mixed.extend([20, 20]);
        let (avg, low) = summarize_fps(&mixed).expect("forty reports");
        assert_eq!(avg, 96, "mean of 38x100 and 2x20");
        assert_eq!(low, 20, "the slowest twentieth is the stutter");
    }

    /// The "before" number is the latest session under another preset, so a
    /// player sees what the switch changed and not two sessions of the same.
    #[test]
    fn before_is_the_latest_session_under_another_preset() {
        let r = |avg: u32, preset: Option<&str>| FpsRecord { avg, preset: preset.map(String::from), ..FpsRecord::default() };
        let log = vec![r(30, None), r(35, None), r(70, Some("low")), r(72, Some("low"))];
        let (last, before) = last_and_before(&log);
        assert_eq!(last.map(|l| l.avg), Some(72));
        assert_eq!(before.map(|b| b.avg), Some(35), "the newest session before the preset");
        let (_, none) = last_and_before(&[r(50, Some("high"))]);
        assert_eq!(none, None, "one session has nothing to compare with");
    }

    /// (written by the preset, options.txt now) -> changed by hand. The game
    /// rewrites the file on exit: the same values in its own formatting and a
    /// key an older version drops are not the player's edits.
    #[test]
    fn hand_edits_are_told_from_the_games_own_rewrites() {
        let written = written_by_preset(&[
            row("renderDistance", "6"),
            row("entityDistanceScaling", "0.5"),
            row("renderClouds", "\"false\""),
            row("graphicsPreset", "\"fast\""),
            row("guiScale", "3"),
            row("cloudRange", "32"),
        ]);
        let base = vec![row("renderDistance", "6"), row("entityDistanceScaling", "0.50"), row("renderClouds", "\"false\""), row("lang", "ru_ru")];
        type Case = (Vec<(String, String)>, bool, &'static str);
        let cases: [Case; 5] = [
            (base.clone(), false, "the game's own rewrite of the same values"),
            ([base.clone(), vec![row("graphicsPreset", "\"custom\"")]].concat(), false, "the game renames the vanilla preset itself"),
            ([base.clone(), vec![row("guiScale", "4")]].concat(), false, "interface scale is not graphics quality"),
            (vec![row("renderDistance", "12"), row("entityDistanceScaling", "0.5")], true, "render distance moved in the game"),
            (vec![row("renderDistance", "6")], false, "keys an older version dropped"),
        ];
        for (rows, want, why) in cases {
            assert_eq!(edited_after(&written, &rows), want, "{why}");
        }
        assert!(!edited_after(&Value::Null, &base), "a build without a preset has nothing to compare");
    }

    /// RenderScale's Jankson config -> after setting the world scale. Only the
    /// `scale` line changes; the shader scale and the rest stay.
    #[test]
    fn the_world_scale_is_written_into_renderscales_own_config() {
        let jankson = "{\n\t\"scale\": 1.0,\n\t\"irisScale\": -1.0,\n\t\"enableRenderScale\": true\n}";
        let set = set_json5_number(jankson, "scale", 0.75);
        assert!(set.contains("\t\"scale\": 0.75,"), "{set}");
        assert!(set.contains("\"irisScale\": -1.0"), "the shader scale is a different key: {set}");
        assert!(set.contains("\"enableRenderScale\": true"));
        let last = set_json5_number("{\n  \"scale\": 2.0\n}", "scale", 0.85);
        assert!(last.contains("  \"scale\": 0.85\n"), "no comma after the last key: {last}");
        let fresh = set_json5_number("", "scale", 0.75);
        assert_eq!(fresh.trim(), "{\n\t\"scale\": 0.75\n}");
        let other = set_json5_number("{\n\t\"irisScale\": 0.5\n}", "scale", 0.85);
        assert!(other.contains("\"scale\": 0.85,") && other.contains("\"irisScale\": 0.5"), "{other}");
        assert_eq!((render_scale(GfxPreset::Potato), render_scale(GfxPreset::Low), render_scale(GfxPreset::Standard)), (Some(0.75), Some(0.85), None));
        assert_eq!(perf_profile(GfxPreset::Potato, 1, true, false, Some(4))["renderScale"].as_f64(), Some(0.75));
        assert!(perf_profile(GfxPreset::High, 1, false, false, Some(16)).get("renderScale").is_none());
    }

    /// (level, auto, battery) -> the mod's profile fields (work/MOD-optimize.md).
    #[test]
    fn the_mod_profile_speaks_the_mods_format() {
        let p = perf_profile(GfxPreset::Potato, 3, true, false, Some(4));
        assert_eq!(p["v"].as_u64(), Some(1), "without v = 1 the mod ignores the file");
        assert_eq!(p["revision"].as_u64(), Some(3));
        assert_eq!(p["tier"].as_u64(), Some(1), "Potato is the mod's Minimum");
        assert_eq!(p["autoDistance"].as_bool(), Some(true), "Auto turns auto distance on");
        assert_eq!(p["minDistance"].as_u64(), Some(4));
        let p = perf_profile(GfxPreset::Potato, 4, false, false, Some(2));
        assert_eq!(p["minDistance"].as_u64(), Some(2), "never above the distance the preset set (4K screen)");
        assert_eq!(p["autoDistance"].as_bool(), Some(false), "a fixed level keeps the distance");
        let p = perf_profile(GfxPreset::Epic, 5, false, true, Some(16));
        assert_eq!((p["tier"].as_u64(), p["minDistance"].as_u64()), (Some(5), Some(12)), "Maximum, the mod's own floor");
        assert_eq!(p["idleLimit"].as_u64(), Some(10), "on battery the background limit drops");
        for key in ["targetFps", "menuLimit", "idleLimit"] {
            assert!(p[key].as_u64().is_some_and(|n| n >= 1), "{key} within the mod's range");
        }
    }

    /// The preset is recorded so a switch takes back only what the presets
    /// added: a boost the player had before must survive "Undo".
    #[test]
    fn what_the_presets_added_round_trips() {
        let by = AddedBy { boost: false, shaders: true, pack: Some("Bare Bones.zip".into()), scale: Some("renderscale-1.2.jar".into()), scale_cfg: true };
        assert_eq!(AddedBy::read(&by.to_value()), by);
        assert_eq!(AddedBy::read(&Value::Null), AddedBy::default(), "a build without presets added nothing");
        for id in ["potato", "low", "standard", "high", "epic"] {
            assert_eq!(GfxPreset::parse(id).map(GfxPreset::id), Some(id), "{id} must round trip");
        }
        assert_eq!(GfxPreset::parse("ultra"), None, "only the five levels exist");
    }
}
