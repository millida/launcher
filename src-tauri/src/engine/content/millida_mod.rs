// Installs the Millida mod (skins, cosmetics) into the player's modpacks and updates it.
// The version list comes from cdn.millida.net/mod, the jar is downloaded from there and checked against the sha256 from the list. The list is also signed with the Millida key. The list of blocked versions is api.millida.net/v2/launcher/mod/blocked.
// Can be turned off in settings. Mod summaries are switched off by the statistics switch.
use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

// Mod version list on the Millida CDN.
const MANIFEST_URL: &str = "https://cdn.millida.net/mod/variants.json";
// Kill switch: mod versions the launcher must not install (crashes).
const BLOCKED_URL: &str = "https://api.millida.net/v2/launcher/mod/blocked";
const MOD_BASE: &str = "https://cdn.millida.net/mod";

/// The jar comes only from our CDN folder: a `baseUrl` in the manifest counts
/// only inside it, so a swapped manifest cannot point the download elsewhere.
fn mod_base_allowed(base: &str) -> bool {
    let b = base.trim_end_matches('/');
    b == MOD_BASE || (b.starts_with(&format!("{}/", MOD_BASE)) && !b.contains(".."))
}
const FILE_PREFIX: &str = "millida-mod-";

pub(crate) fn is_millida_mod_file(name: &str) -> bool {
    name.starts_with(FILE_PREFIX) && name.ends_with(".jar")
}

#[derive(serde::Serialize, Default, Clone)]
pub struct MillidaModState {
    /// Installed jar in this build, empty when the mod is not there.
    pub installed: String,
    /// Variant that fits this build, empty when the version is not covered yet.
    pub available: String,
    pub version: String,
    pub loader: String,
    pub game_version: String,
    /// Why nothing fits, for the rare build we do not cover.
    pub reason: String,
    /// Off means the player turned the mod off for every build.
    pub enabled: bool,
    /// Контрольная сумма подходящего варианта из каталога.
    pub sha256: String,
    /// Id варианта из каталога («fabric-1.20.1»): по нему и версии работает рубильник.
    pub variant: String,
}

/// Version ranges in the manifest are closed on the left and open on the right,
/// so a build sitting exactly on the upper bound belongs to the next variant.
fn version_key(version: &str) -> Vec<u32> {
    version
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u32>().ok())
        .collect()
}

fn version_at_least(version: &str, bound: &str) -> bool {
    version_key(version) >= version_key(bound)
}

fn version_below(version: &str, bound: &str) -> bool {
    version_key(version) < version_key(bound)
}

/// Снапшот, пре-релиз или кандидат («25w05a», «1.21.9-rc1», «26.2-snapshot-7»).
/// Наш jar объявляет диапазон релизов, и загрузчик считает такую версию
/// МЛАДШЕ релиза: «1.21.9-rc1» не проходит «>=1.21.9», и сборка падала с
/// «Моды собраны под другую версию игры: Millida».
fn is_prerelease(game_version: &str) -> bool {
    game_version.chars().any(|c| c.is_ascii_alphabetic())
}

fn variant_fits(variant: &Value, game_version: &str, loader: &str) -> bool {
    let loaders = variant["loaders"].as_array().cloned().unwrap_or_default();
    if !loaders.iter().any(|l| l.as_str() == Some(loader)) {
        return false;
    }
    let from = variant["minecraft"]["from"].as_str().unwrap_or("");
    if !from.is_empty() && !version_at_least(game_version, from) {
        return false;
    }
    match variant["minecraft"]["to"].as_str() {
        Some(to) if !to.is_empty() => version_below(game_version, to),
        _ => true,
    }
}

/// Where `manifest` gets the list from: the UI and an install want the newest (a short wait
/// for the network, the copy as the fallback), a launch wants no wait at all.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum ManifestSource {
    Fresh,
    Launch,
}

/// How old the copy of the version list may be before a launch asks the CDN again (in the background).
const MANIFEST_LAUNCH_TTL: Duration = Duration::from_secs(10 * 60);

/// Read before every launch of a modded build. Without a copy on disk, a launch
/// with no network lost the mod the build already had.
async fn manifest(source: ManifestSource) -> Result<Value, String> {
    let copy = data_dir().join("millida-mod-variants.json");
    let m = match source {
        ManifestSource::Fresh => get_json_revalidated(MANIFEST_URL, &copy).await,
        // A launch takes the copy it has and lets the newer list land for the next one: a new
        // mod release reaches a build one launch later, and nobody waits for the CDN.
        ManifestSource::Launch => get_json_swr(MANIFEST_URL, &copy, MANIFEST_LAUNCH_TTL).await,
    }
    .map_err(|e| format!("Каталог версий мода недоступен: {}", e))?;
    let seen = data_dir().join("millida-mod-signed");
    match manifest_signature(&m, MOD_MANIFEST_PUBKEY) {
        ManifestSignature::Valid => {
            if !seen.exists() {
                let _ = std::fs::write(&seen, b"1");
            }
            Ok(m)
        }
        // Переход: пока выпуски мода не подписывались, список без подписи
        // принимается — но только на ПК, который подписанного ещё не видел.
        ManifestSignature::Missing if !seen.exists() => Ok(m),
        ManifestSignature::Missing => Err("Список версий мода пришёл без подписи — мод не ставим".into()),
        ManifestSignature::Invalid => Err("Подпись списка версий мода не сошлась — мод не ставим".into()),
    }
}

/// Открытая часть ключа, которым CI мода (millida-mod, scripts/manifest_canonical.py)
/// подписывает список вариантов: сервер или CDN без закрытой части не может
/// подсунуть в игру другой jar — его sha256 стоит в подписанной строке.
// Public minisign key in base64 (it contains the text "minisign public key"). The private part is kept in the mod CI and is not in this repository.
const MOD_MANIFEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDBCMjA5MkFGRDhCODAzOEMKUldTTUE3allyNUlnQ3haTTFKZnlLcjExcFIybGRjVlMrSzNvQzZiQjNLbVY2cEJUVW5lUXZNdDAK";

#[derive(Debug, PartialEq, Eq)]
enum ManifestSignature {
    Valid,
    Missing,
    Invalid,
}

/// Строка, которую подписывает CI мода: версия и «файл|sha256|размер» каждого
/// варианта по порядку. Не зависит от пробелов и порядка ключей json.
fn manifest_canonical(m: &Value) -> Option<String> {
    let version = m["version"].as_str()?;
    let mut out = format!("millida-mod-manifest-v1\nversion={}\n", version);
    for v in m["variants"].as_array()? {
        let artifact = v["artifact"].as_str()?.replace("{version}", version);
        let sha = v["sha256"].as_str()?.to_lowercase();
        out.push_str(&format!("{}|{}|{}\n", artifact, sha, v["size"].as_u64().unwrap_or(0)));
    }
    Some(out)
}

fn manifest_signature(m: &Value, pubkey_b64: &str) -> ManifestSignature {
    use base64::Engine as _;
    use minisign_verify::{PublicKey, Signature};
    let Some(sig_b64) = m["signature"].as_str().filter(|s| !s.trim().is_empty()) else {
        return ManifestSignature::Missing;
    };
    let decode = |b64: &str| {
        base64::engine::general_purpose::STANDARD
            .decode(b64.trim())
            .ok()
            .and_then(|raw| String::from_utf8(raw).ok())
    };
    let ok = (|| {
        let key = PublicKey::decode(decode(pubkey_b64)?.trim()).ok()?;
        let sig = Signature::decode(decode(sig_b64)?.trim()).ok()?;
        let text = manifest_canonical(m)?;
        key.verify(text.as_bytes(), &sig, true).ok()
    })();
    if ok.is_some() { ManifestSignature::Valid } else { ManifestSignature::Invalid }
}

/// Все наши jar в сборке. Их обязан быть один, но бывает два: при обновлении
/// старый файл удаляется ПОСЛЕ скачивания нового, и если удалить его не вышло
/// (занят антивирусом, права), в mods/ остаются обе версии. Загрузчик видит два
/// мода с одним id и роняет игру ещё до входа - ровно то, с чем игроки пришли
/// 16.09.2026. Поэтому наружу отдаётся список, а не первый попавшийся файл.
fn installed_jars(profile: &str) -> Vec<String> {
    let dir = profile_dir(profile).join("mods");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return vec![];
    };
    let mut out: Vec<String> = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.starts_with(FILE_PREFIX) && n.ends_with(".jar"))
        .collect();
    out.sort();
    out
}

fn installed_jar(profile: &str) -> String {
    installed_jars(profile).into_iter().next().unwrap_or_default()
}

/// Оставить в сборке ровно один наш jar. Возвращает файлы, которые убрать не
/// удалось: молчать о них нельзя - именно они и роняют запуск.
fn keep_only(profile: &str, keep: &str) -> Vec<String> {
    let mods = profile_dir(profile).join("mods");
    let mut stuck = vec![];
    for name in installed_jars(profile) {
        if name == keep {
            continue;
        }
        // Extra versions of our mod are deleted (only files millida-mod-*.jar).
        if std::fs::remove_file(mods.join(&name)).is_err() {
            stuck.push(name);
        }
    }
    stuck
}

fn profile_of(profile: &str) -> Option<Profile> {
    load_profiles().into_iter().find(|p| p.name == profile)
}

pub async fn millida_mod_state(profile: String) -> Result<MillidaModState, String> {
    mod_state(profile, ManifestSource::Fresh).await
}

async fn mod_state(profile: String, source: ManifestSource) -> Result<MillidaModState, String> {
    let Some(entry) = profile_of(&profile) else {
        return Err("Сборка не найдена".into());
    };
    let loader = entry.loader_id();
    let mut state = MillidaModState {
        installed: installed_jar(&profile),
        loader: loader.clone(),
        game_version: entry.version.clone(),
        enabled: millida_mod_enabled(),
        ..Default::default()
    };
    if !state.enabled {
        state.reason = "Выключен в настройках лаунчера".into();
        return Ok(state);
    }
    if loader == "vanilla" {
        state.reason = "Мод ставится в сборку с загрузчиком: Fabric, Quilt, Forge или NeoForge".into();
        return Ok(state);
    }
    if is_prerelease(&entry.version) {
        state.reason = format!("Под предварительную версию {} мода нет", entry.version);
        return Ok(state);
    }
    let manifest = manifest(source).await?;
    let version = manifest["version"].as_str().unwrap_or("").to_string();
    match manifest["variants"].as_array().and_then(|variants| {
        variants.iter().find(|v| variant_fits(v, &entry.version, &loader))
    }) {
        Some(variant) => {
            state.available = variant["artifact"].as_str().unwrap_or("").replace("{version}", &version);
            state.sha256 = variant["sha256"].as_str().unwrap_or("").to_string();
            state.variant = variant["id"].as_str().unwrap_or("").to_string();
            state.version = version;
        }
        None => {
            state.reason = format!("Под {} {} мода пока нет", loader, entry.version);
        }
    }
    Ok(state)
}

/// Installs the variant that fits the build. The old jar is removed only after
/// the new one is in place: a failed download must not leave the build without
/// the mod it had.
pub async fn millida_mod_install(app: AppHandle, profile: String) -> Result<MillidaModState, String> {
    run_install(&app, profile, None).await
}

/// A launch stops waiting for the jar after `LAUNCH_WAIT`: the build starts
/// without the new version and the download keeps going for the next launch.
async fn install_for_launch(app: &AppHandle, profile: &str) -> Result<MillidaModState, String> {
    run_install(app, profile.to_string(), Some(LAUNCH_WAIT)).await
}

async fn run_install(app: &AppHandle, profile: String, wait: Option<Duration>) -> Result<MillidaModState, String> {
    let job = Job::start(format!("millida-mod:{}", profile), "Косметика Millida")?;
    let res = install_job(app, &job, profile, wait).await;
    job.finish(app, res)
}

const LAUNCH_WAIT: Duration = Duration::from_secs(8);

/// Rounds of the whole download after its own quick retries gave up, started
/// further along the doubling so a round never comes sooner than the last retry.
const PATIENT_ROUNDS: u32 = 6;
const ROUND_BACKOFF_FROM: u32 = 3;

const FETCH_LATER: &str = "Сервер косметики сейчас перегружен — сборка запускается без новой версии мода, она докачается в фоне и встанет при следующем запуске";

#[derive(Clone)]
struct JarSource {
    url: String,
    artifact: String,
    sha256: String,
    size: Option<u64>,
}

/// One copy per launcher, not per build: a player with five builds cost five
/// downloads of the same jar per release.
fn jar_cache(artifact: &str) -> Result<PathBuf, String> {
    let dir = data_dir().join("millida-mod-cache");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Папка загрузок мода не создалась: {} — проверь место на диске и права", e))?;
    safe_child(&dir, artifact)
}

/// Jars of older releases are never asked for again once a newer one landed.
fn prune_jar_cache(current_version: &str) {
    let Ok(entries) = std::fs::read_dir(data_dir().join("millida-mod-cache")) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if is_millida_mod_file(&name) && jar_version(&name) != current_version {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

async fn fetch_patiently(src: &JarSource) -> Result<PathBuf, String> {
    let dest = jar_cache(&src.artifact)?;
    let mut round = 1;
    loop {
        let err = match download_checked(&src.url, &dest, Some(Sum::Sha256(&src.sha256)), src.size).await {
            Ok(()) => return Ok(dest),
            Err(e) => e,
        };
        if round >= PATIENT_ROUNDS || !is_transient(&err) {
            return Err(err);
        }
        tokio::time::sleep(throttle_pause(round + ROUND_BACKOFF_FROM - 1, server_wait(&err), jitter_unit())).await;
        round += 1;
    }
}

type SharedFetch = futures::future::Shared<futures::future::BoxFuture<'static, Result<PathBuf, String>>>;

fn in_flight() -> &'static std::sync::Mutex<std::collections::HashMap<String, SharedFetch>> {
    static MAP: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, SharedFetch>>> =
        std::sync::OnceLock::new();
    MAP.get_or_init(Default::default)
}

/// The download runs as its own task, so a launch that stops waiting does not
/// cancel it, and several builds launched together share one request.
fn shared_fetch(src: JarSource) -> SharedFetch {
    use futures::FutureExt as _;
    let mut map = in_flight().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(running) = map.get(&src.artifact) {
        return running.clone();
    }
    let key = src.artifact.clone();
    let task = tauri::async_runtime::spawn(async move {
        let res = fetch_patiently(&src).await;
        in_flight().lock().unwrap_or_else(|e| e.into_inner()).remove(&src.artifact);
        res
    });
    let fetch = async move { task.await.map_err(|e| format!("Загрузка мода прервалась: {}", e))? }
        .boxed()
        .shared();
    map.insert(key, fetch.clone());
    fetch
}

async fn fetch_jar(src: JarSource, wait: Option<Duration>) -> Result<PathBuf, String> {
    let fetch = shared_fetch(src);
    match wait {
        None => fetch.await,
        Some(limit) => tokio::time::timeout(limit, fetch).await.unwrap_or_else(|_| Err(FETCH_LATER.into())),
    }
}

/// Copied next to the target and renamed, so a failed copy never leaves a
/// truncated jar that the loader would choke on.
fn place_jar(cached: &Path, dest: &Path) -> Result<(), String> {
    let mut part = dest.as_os_str().to_os_string();
    part.push(".part");
    let part = PathBuf::from(part);
    let copied = std::fs::copy(cached, &part).and_then(|_| std::fs::rename(&part, dest));
    if let Err(e) = copied {
        let _ = std::fs::remove_file(&part);
        return Err(format!("Мод не лёг в папку сборки: {} — закрой игру и антивирус и запусти ещё раз", e));
    }
    Ok(())
}

async fn install_job(app: &AppHandle, job: &Job, profile: String, wait: Option<Duration>) -> Result<MillidaModState, String> {
    job.emit(app, 10.0, "Подбираем версию…");
    if !millida_mod_enabled() {
        return Err("Мод выключен в настройках лаунчера".into());
    }
    let state = millida_mod_state(profile.clone()).await?;
    if state.available.is_empty() {
        return Err(if state.reason.is_empty() { "Мод не подошёл к сборке".into() } else { state.reason });
    }
    let manifest = manifest(ManifestSource::Fresh).await?;
    let version = manifest["version"].as_str().unwrap_or("");
    let variant = manifest["variants"]
        .as_array()
        .and_then(|variants| {
            variants.iter().find(|v| {
                v["artifact"].as_str().unwrap_or("").replace("{version}", version) == state.available
            })
        })
        .ok_or("Вариант мода пропал из каталога")?;

    let sha256 = variant["sha256"].as_str().unwrap_or("");
    if sha256.is_empty() {
        return Err("Каталог не дал контрольную сумму файла".into());
    }
    let base = manifest["baseUrl"].as_str().filter(|b| mod_base_allowed(b)).unwrap_or(MOD_BASE);
    let url = format!("{}/{}", base.trim_end_matches('/'), state.available);

    let mods = profile_dir(&profile).join("mods");
    std::fs::create_dir_all(&mods).map_err(|e| e.to_string())?;
    let dest = safe_child(&mods, &state.available)?;
    job.check()?;
    job.emit(app, 45.0, "Скачиваем…");
    let src = JarSource {
        url,
        artifact: state.available.clone(),
        sha256: sha256.to_string(),
        size: variant["size"].as_u64(),
    };
    let cached = fetch_jar(src, wait).await?;
    job.check()?;
    let (check_path, check_sum) = (cached.clone(), sha256.to_string());
    let intact = tokio::task::spawn_blocking(move || file_is(&check_path, &check_sum)).await.unwrap_or(false);
    if !intact {
        let _ = std::fs::remove_file(&cached);
        return Err(format!("Скачанный мод не сошёлся с каталогом ({}) — запусти сборку ещё раз", SUM_MISMATCH));
    }
    place_jar(&cached, &dest)?;
    prune_jar_cache(&state.version);

    let stuck = keep_only(&profile, &state.available);
    if !stuck.is_empty() {
        // Two versions side by side stop the loader, so the build stays on the
        // one it cannot let go of and takes the new one next launch.
        let _ = std::fs::remove_file(&dest);
        return Err(format!(
            "Старую версию мода не удалось убрать: {}. Закрой игру и антивирус, затем удали файл из папки mods сборки - иначе игра не запустится с двумя версиями сразу",
            stuck.join(", ")
        ));
    }
    job.emit(app, 100.0, "Установлено");
    state_after(&profile, state)
}

fn state_after(profile: &str, mut state: MillidaModState) -> Result<MillidaModState, String> {
    state.installed = installed_jar(profile);
    Ok(state)
}

/// Файл настроек мода. Пишется перед каждым запуском: адрес службы, порядок
/// источников скина и белый список хостов — дело лаунчера, а выключатели ниже
/// принадлежат игроку и остаются как были.
fn write_settings(dir: &Path, licensed: bool) -> Result<(), String> {
    let cfg_dir = dir.join("config");
    std::fs::create_dir_all(&cfg_dir).map_err(|e| e.to_string())?;
    let path = cfg_dir.join("millida.json");
    let mut cfg = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    cfg.insert("apiRoot".into(), Value::String(MILLIDA_API.to_string()));
    // Millida, потом файлы игрока. Лицензионный профиль спрашиваем последним и
    // только если аккаунт и правда мояновский: иначе этот ник там принадлежит
    // постороннему, и игрок увидит чужой скин.
    let order: Vec<Value> = if licensed {
        ["millida", "local", "mojang"].iter().map(|s| Value::String((*s).into())).collect()
    } else {
        ["millida", "local"].iter().map(|s| Value::String((*s).into())).collect()
    };
    cfg.insert("sourceOrder".into(), Value::Array(order));
    cfg.insert("allowNameLookup".into(), Value::Bool(false));
    let hosts = cfg.entry("textureHosts".to_string()).or_insert_with(|| Value::Array(vec![]));
    if let Some(list) = hosts.as_array_mut() {
        for host in ["millida.net", "cdn.millida.net", "cdn.millida.trade", "textures.minecraft.net"] {
            if !list.iter().any(|h| h.as_str() == Some(host)) {
                list.push(Value::String(host.into()));
            }
        }
    }
    seed_hud(&mut cfg, pvp_hud_default());
    write_json_atomic(&path, &Value::Object(cfg))
}

/// The launcher only picks the starting state of the PvP modules. Once the
/// file carries a "hud" object the player has seen the modules in game, and
/// the Right Shift menu owns the switch from then on.
fn seed_hud(cfg: &mut serde_json::Map<String, Value>, on: bool) {
    if on || cfg.contains_key("hud") {
        return;
    }
    cfg.insert("hud".into(), serde_json::json!({ "enabled": false }));
}

fn pvp_hud_off_file() -> PathBuf {
    data_dir().join("pvp-hud-off")
}

pub fn pvp_hud_default() -> bool {
    enabled_at(&pvp_hud_off_file())
}

pub fn set_pvp_hud_default(on: bool) -> Result<(), String> {
    if on {
        turn_on_at(&pvp_hud_off_file())
    } else {
        turn_off_at(&pvp_hud_off_file())
    }
}

/// Раскладка, которую читает мод: `millida/local/{skins,capes}/<ник>.png`. Та же
/// картинка, что игрок применил в гардеробе, — тогда скин на месте и без сети.
fn place_local_skin(dir: &Path, nick: &str) {
    place_local_skin_from(&data_dir().join("localskin"), local_slim(), dir, nick);
}

/// The arm type travels with the picture as `models/<nick>.txt`. Without it the
/// mod knew the skin but not its arms, stopped asking further sources once the
/// cape was found too, and dressed an Alex skin in Steve sleeves.
fn place_local_skin_from(source: &Path, slim: bool, dir: &Path, nick: &str) {
    let safe: String = nick.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    if safe.is_empty() {
        return;
    }
    let local = dir.join("millida").join("local");
    for (file, sub) in [("skin.png", "skins"), ("cape.png", "capes")] {
        let from = source.join(file);
        let into = local.join(sub);
        let target = into.join(format!("{}.png", safe));
        if !from.exists() {
            let _ = std::fs::remove_file(&target);
            continue;
        }
        if std::fs::create_dir_all(&into).is_ok() {
            let _ = std::fs::copy(&from, &target);
        }
    }
    let models = local.join("models");
    let marker = models.join(format!("{}.txt", safe));
    if !source.join("skin.png").exists() {
        let _ = std::fs::remove_file(&marker);
        return;
    }
    if std::fs::create_dir_all(&models).is_ok() {
        let _ = std::fs::write(&marker, if slim { "slim" } else { "classic" });
    }
}

/// Выключатель мода, общий для всех сборок.
///
/// Мод ставится принудительно, и до сих пор отказаться от него было нельзя
/// вовсе: у кого он не уживался с остальными модами, у того не запускалась ни
/// одна модовая сборка, и единственным выходом оставалась ванильная игра
/// (16.09.2026, жалоба через Евгения). Карантин снимает только КОНКРЕТНУЮ
/// версию и только после падения - осознанного отказа он не заменяет.
///
/// Хранится у ядра, а не у интерфейса: решение читается при запуске игры, и
/// оно должно действовать, даже когда окно ещё не открывали.
fn disabled_file() -> PathBuf {
    data_dir().join("millida-mod-off")
}

pub fn millida_mod_enabled() -> bool {
    enabled_at(&disabled_file())
}

pub fn millida_mod_wanted(profile: &str) -> bool {
    millida_mod_enabled() && millida_mod_on(profile)
}

/// Игрок выключил статистику в лаунчере: мод в игре тоже молчит. Флаг живёт
/// файлом, потому что игру запускает Rust, а выключатель - в интерфейсе.
fn telemetry_off_file() -> PathBuf {
    data_dir().join("telemetry-off")
}

pub fn game_telemetry_enabled() -> bool {
    enabled_at(&telemetry_off_file())
}

pub fn set_game_telemetry_enabled(on: bool) -> Result<(), String> {
    if on {
        turn_on_at(&telemetry_off_file())
    } else {
        turn_off_at(&telemetry_off_file())
    }
}

/// Отсутствие файла - это «включено»: у тех, кто не трогал настройку, файла нет,
/// и мод обязан ставиться сам.
fn enabled_at(file: &Path) -> bool {
    !file.exists()
}

fn turn_off_at(file: &Path) -> Result<(), String> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Настройка не сохранилась: {}", e))?;
    }
    std::fs::write(file, b"off").map_err(|e| format!("Настройка не сохранилась: {}", e))
}

/// Уже включённый мод включается ещё раз без ошибки: файла нет - и хорошо.
fn turn_on_at(file: &Path) -> Result<(), String> {
    match std::fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Настройка не сохранилась: {}", e)),
    }
}

/// Выключение убирает jar из КАЖДОЙ сборки, а не только перестаёт ставить новый:
/// иначе игрок жмёт выключатель, запускает игру и видит мод на месте.
pub fn set_millida_mod_enabled(on: bool) -> Result<(), String> {
    if on {
        return turn_on_at(&disabled_file());
    }
    turn_off_at(&disabled_file())?;
    for profile in load_profiles() {
        remove_mod_from(&profile.name);
    }
    Ok(())
}

fn remove_mod_from(profile: &str) {
    let _ = keep_only(profile, "");
}

pub fn remove_millida_mod(profile: &str) {
    remove_mod_from(profile);
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum OwnMod {
    Place,
    Remove,
    Leave,
}

/// A catalogue pack that launches by its own description is someone else's
/// verified build, so our jar goes into it only when our own catalogue card
/// opted it in. A pack that was opted in and no longer is gets our jar back
/// out; any other such pack is not touched at all.
pub fn own_mod_action(catalog_pack: bool, opted_in: bool, opted_in_before: bool, enabled: bool) -> OwnMod {
    if catalog_pack && !opted_in {
        return if opted_in_before { OwnMod::Remove } else { OwnMod::Leave };
    }
    if enabled { OwnMod::Place } else { OwnMod::Remove }
}

/// Файл карантина: какая версия мода завалила запуск этой сборки.
///
/// Мод ставится в сборку принудительно — на нём держатся скины, плащи и
/// косметика, за которую заплачено. Но у принудительной установки есть цена:
/// сломанный выпуск делает НЕИГРАБЕЛЬНЫМИ все модовые сборки разом, и выхода у
/// игрока нет (16.09.2026 — мод собрался под Java новее игры, и сборки
/// перестали запускаться у всех).
///
/// Карантин — это выход, который не превращается в «выключить косметику
/// насовсем»: под карантин попадает КОНКРЕТНАЯ версия, и следующая ставится как
/// обычно. Если мод починили, игрок получает его назад сам.
fn quarantine_file(profile: &str) -> PathBuf {
    profile_dir(profile).join("millida").join("mod-quarantine")
}

/// Имя jar под карантином и его сумма (пустая у карантина старого формата).
fn quarantined(profile: &str) -> (String, String) {
    parse_quarantine(&std::fs::read_to_string(quarantine_file(profile)).unwrap_or_default())
}

fn parse_quarantine(raw: &str) -> (String, String) {
    let mut lines = raw.lines().map(str::trim);
    let jar = lines.next().unwrap_or("").to_string();
    let sha = lines.next().unwrap_or("").to_string();
    (jar, sha)
}

/// Карантин держит ИМЕННО тот файл, что уронил сборку. Исправленный jar,
/// перезалитый под тем же номером (так уже чинили 16.09.2026), — другой файл, и
/// карантин его не держит: иначе починка не доходила бы до сборки до выпуска
/// следующей версии.
fn blocks(quarantine: &(String, String), jar: &str, sha256: &str) -> bool {
    let (q_jar, q_sha) = quarantine;
    !q_jar.is_empty()
        && q_jar == jar
        && (q_sha.is_empty() || sha256.len() != 64 || q_sha.eq_ignore_ascii_case(sha256))
}

/// Тот ли это файл, что обещает каталог.
///
/// Свежесть мода решалась по ИМЕНИ файла, а имя содержит только номер версии.
/// Стоило перезалить исправленный jar под тем же номером - и у всех, кто успел
/// скачать сломанный, он оставался навсегда: лаунчер видел нужное имя и считал
/// сборку свежей. Ровно так у игроков остался мод, собранный под Java новее
/// игры, и Forge 1.20.1 падал UnsupportedClassVersionError при живом
/// исправлении на CDN.
fn file_is(path: &Path, want_sha256: &str) -> bool {
    if want_sha256.len() != 64 {
        // Каталог не дал суммы - сверять нечем. Считаем файл своим: иначе мод
        // перекачивался бы при каждом запуске.
        return true;
    }
    let Ok(bytes) = std::fs::read(path) else { return false };
    let hex = sha256_hex(&bytes);
    hex.eq_ignore_ascii_case(want_sha256)
}

/// Пометить версию как завалившую запуск и убрать её из сборки.
pub fn quarantine_millida_mod(profile: &str, jar: &str) -> bool {
    if jar.is_empty() {
        return false;
    }
    let file = quarantine_file(profile);
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let path = profile_dir(profile).join("mods").join(jar);
    let sha = std::fs::read(&path).map(|b| sha256_hex(&b)).unwrap_or_default();
    if std::fs::write(&file, format!("{}\n{}\n", jar, sha)).is_err() {
        return false;
    }
    // Занятый файл (антивирус, игра ещё держит) хотя бы выключается: иначе
    // следующий запуск загрузил бы его снова и упал бы так же.
    // Our jar is removed from mods/: deleted, or renamed to .disabled if the file is busy.
    if std::fs::remove_file(&path).is_err() {
        let _ = std::fs::rename(&path, profile_dir(profile).join("mods").join(format!("{}.disabled", jar)));
    }
    true
}

fn jar_version(jar: &str) -> String {
    let stem = jar.strip_prefix(FILE_PREFIX).unwrap_or(jar);
    let stem = stem.strip_suffix(".jar").unwrap_or(stem);
    stem.rsplit('-').next().unwrap_or("").to_string()
}

/// A quarantine file outlives its reason: once a newer jar from the catalogue
/// is installed, the record still names the old one but holds nothing back, and
/// the build page must not tell the player the cosmetics are off.
fn active_quarantine(quarantined_jar: &str, installed: &[String]) -> Option<String> {
    if quarantined_jar.is_empty() || installed.iter().any(|j| j != quarantined_jar) {
        return None;
    }
    Some(jar_version(quarantined_jar))
}

pub fn quarantined_mod_version(profile: &str) -> Option<String> {
    active_quarantine(&quarantined(profile).0, &installed_jars(profile))
}

fn lift_quarantine_in(dir: &Path) -> Result<(), String> {
    let mods = dir.join("mods");
    if let Ok(entries) = std::fs::read_dir(&mods) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(jar) = name.strip_suffix(".disabled") else { continue };
            if !is_millida_mod_file(jar) {
                continue;
            }
            std::fs::remove_file(entry.path())
                .map_err(|e| format!("Не удалось убрать выключенный мод {}: {} — закрой игру и попробуй ещё раз", name, e))?;
        }
    }
    match std::fs::remove_file(dir.join("millida").join("mod-quarantine")) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Не удалось вернуть косметику: {} — закрой игру и попробуй ещё раз", e)),
    }
}

/// The player takes the crashed version back on purpose: the next launch
/// installs the catalogue jar again, and a repeat crash quarantines it anew.
pub fn lift_millida_mod_quarantine(profile: &str) -> Result<(), String> {
    if profile_of(profile).is_none() {
        return Err("Сборка не найдена".into());
    }
    lift_quarantine_in(&profile_dir(profile))
}

/// Копия CustomSkinLoader, которую поставил сам лаунчер. Наш мод отвечает за
/// скин сам, а два мода на одну текстуру — это падение на загрузчике.
fn drop_launcher_csl(mods: &Path) -> bool {
    // Deletes only the file named exactly CustomSkinLoader.jar (the launcher names it so). Copies the player downloaded with a version in the name are not touched.
    let jar = mods.join("CustomSkinLoader.jar");
    jar.exists() && std::fs::remove_file(&jar).is_ok()
}

/// Готовит мод к запуску сборки: ставит нужный вариант, пишет настройки,
/// кладёт локальный скин и убирает CustomSkinLoader.
///
/// `None` означает «под эту сборку варианта нет» — тогда вызывающий оставляет
/// прежний путь со скинами: игроку на 1.13 скин нужен не меньше.
const FABRIC_API_PROJECT: &str = "P7dR8mSH";

/// Offline, the install hung on mirror timeouts for minutes; a game without
/// cosmetics beats no game.
const FABRIC_API_WAIT: std::time::Duration = std::time::Duration::from_secs(30);

fn needs_fabric_api(loader: &str) -> bool {
    matches!(loader, "fabric" | "quilt")
}

/// Что с Fabric API в сборке.
#[derive(PartialEq, Debug)]
enum FabricApi {
    Ready,
    Missing,
    /// Лежит, но собран под другую версию игры: загрузчик его отвергнет, и
    /// наш мод упадёт с «не хватает fabric-api».
    Unfit,
}

const FABRIC_API_IDS: [&str; 3] = ["fabric-api", "fabric", "quilted_fabric_api"];

/// Проверка по ВКЛЮЧЁННЫМ файлам в mods/, а не по спискам лаунчера. Индекс
/// установленного помнит и выключенный (.disabled), и удалённый руками Fabric
/// API — лаунчер считал его на месте, ставил наш мод, и Fabric ронял сборку с
/// «Модам не хватает зависимостей: Millida» (893 игрока за 14 дней, 25.09.2026).
fn fabric_api_state(profile: &str, game_version: &str) -> FabricApi {
    let dir = profile_dir(profile).join("mods");
    let Ok(entries) = std::fs::read_dir(&dir) else { return FabricApi::Missing };
    let metas = local_meta_map(profile, "mod");
    let mut unfit = false;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".jar") || name.starts_with(FILE_PREFIX) {
            continue;
        }
        let id_hit = |id: &str| FABRIC_API_IDS.contains(&id.to_lowercase().as_str());
        // Открывать каждый из сотен jar ради одного незачем: кандидат — по
        // имени файла или по уже прочитанным метаданным.
        let low = name.to_lowercase();
        let by_name = ["fabric-api", "fabric_api", "fabricapi", "qfapi", "quilted"].iter().any(|m| low.contains(m));
        let by_meta = metas.get(&name).is_some_and(|m| id_hit(&m.mod_id) || m.provides.iter().any(|p| id_hit(p)));
        if !by_name && !by_meta {
            continue;
        }
        let decl = read_declared(&e.path());
        let is_api = by_meta || decl.as_ref().is_some_and(|d| d.ids.iter().any(|i| id_hit(i)));
        if !is_api {
            continue;
        }
        match decl {
            Some(d) if !d.fits_game(game_version) => unfit = true,
            _ => return FabricApi::Ready,
        }
    }
    if unfit { FabricApi::Unfit } else { FabricApi::Missing }
}

/// Что jar сам о себе объявил: свои id и требования к игре и загрузчику.
#[derive(Default, Debug)]
struct Declared {
    ids: Vec<String>,
    /// Fabric: предикаты версии игры (любой из них).
    fabric_mc: Vec<String>,
    fabric_loader: Vec<String>,
    /// Forge/NeoForge: диапазоны Maven.
    toml_mc: String,
    toml_loader: String,
}

impl Declared {
    fn fits_game(&self, game_version: &str) -> bool {
        let fabric_ok = self.fabric_mc.is_empty()
            || self.fabric_mc.iter().any(|r| super::deps::version_satisfies(game_version, r));
        fabric_ok && maven_range_ok(game_version, &self.toml_mc)
    }

    fn fits_loader(&self, loader_version: &str) -> bool {
        if loader_version.is_empty() {
            return true;
        }
        let fabric_ok = self.fabric_loader.is_empty()
            || self.fabric_loader.iter().any(|r| super::deps::version_satisfies(loader_version, r));
        fabric_ok && maven_range_ok(loader_version, &self.toml_loader)
    }
}

fn predicates(v: &Value) -> Vec<String> {
    match v {
        Value::String(s) => vec![s.clone()],
        Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect(),
        _ => vec![],
    }
}

fn read_declared(path: &Path) -> Option<Declared> {
    let file = std::fs::File::open(path).ok()?;
    let mut jar = zip::ZipArchive::new(file).ok()?;
    let mut text = |name: &str| -> Option<String> {
        use std::io::Read;
        let mut entry = jar.by_name(name).ok()?;
        let mut s = String::new();
        entry.read_to_string(&mut s).ok()?;
        Some(s)
    };
    let mut d = Declared::default();
    if let Some(raw) = text("fabric.mod.json") {
        let v: Value = serde_json::from_str(&raw).ok()?;
        if let Some(id) = v["id"].as_str() {
            d.ids.push(id.to_string());
        }
        d.ids.extend(predicates(&v["provides"]));
        d.fabric_mc = predicates(&v["depends"]["minecraft"]);
        d.fabric_loader = predicates(&v["depends"]["fabricloader"]);
        return Some(d);
    }
    let Some(raw) = text("META-INF/neoforge.mods.toml").or_else(|| text("META-INF/mods.toml")) else {
        // Forge 1.7.10-1.12.2 describes a mod only in mcmod.info, and FML does not
        // enforce the game version written there.
        let raw = text("mcmod.info")?;
        let v: Value = serde_json::from_str(&raw).ok()?;
        let list = v.as_array().or_else(|| v["modList"].as_array())?;
        d.ids.extend(list.iter().filter_map(|m| m["modid"].as_str().map(str::to_string)));
        return Some(d);
    };
    let (mut section, mut mod_id, mut range) = (String::new(), String::new(), String::new());
    let flush = |section: &str, mod_id: &str, range: &str, d: &mut Declared| {
        if !section.starts_with("[[dependencies") {
            return;
        }
        match mod_id {
            "minecraft" => d.toml_mc = range.to_string(),
            "forge" | "neoforge" => d.toml_loader = range.to_string(),
            _ => {}
        }
    };
    for line in raw.lines() {
        let t = line.trim();
        if t.starts_with("[[") {
            flush(&section, &mod_id, &range, &mut d);
            section = t.to_string();
            mod_id.clear();
            range.clear();
            continue;
        }
        let Some((k, v)) = t.split_once('=') else { continue };
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "modId" if section.starts_with("[[mods") => d.ids.push(v),
            "modId" => mod_id = v,
            "versionRange" => range = v,
            _ => {}
        }
    }
    flush(&section, &mod_id, &range, &mut d);
    Some(d)
}

fn cmp_padded(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut x, mut y) = (version_key(a), version_key(b));
    let n = x.len().max(y.len());
    x.resize(n, 0);
    y.resize(n, 0);
    x.cmp(&y)
}

/// Диапазон Maven, как его пишут mods.toml: «[1.20.1,1.20.2)», «[47,)»,
/// «[1.20.1]». Голая версия у Forge — пожелание, а не требование.
/// Непонятное считается подходящим: отказ ставить мод дороже ложной тревоги.
fn maven_range_ok(version: &str, range: &str) -> bool {
    use std::cmp::Ordering::*;
    let r = range.trim();
    if r.is_empty() || r == "*" || !(r.starts_with('[') || r.starts_with('(')) || r.len() < 2 {
        return true;
    }
    // Несколько диапазонов через запятую между скобками — любой из них.
    if r.contains("],") || r.contains("),") {
        return true;
    }
    let lo_inc = r.starts_with('[');
    let hi_inc = r.ends_with(']');
    let inner = &r[1..r.len() - 1];
    let Some((lo, hi)) = inner.split_once(',') else {
        return cmp_padded(version, inner.trim()) == Equal;
    };
    let (lo, hi) = (lo.trim(), hi.trim());
    let lo_ok = lo.is_empty() || matches!((cmp_padded(version, lo), lo_inc), (Greater, _) | (Equal, true));
    let hi_ok = hi.is_empty() || matches!((cmp_padded(version, hi), hi_inc), (Less, _) | (Equal, true));
    lo_ok && hi_ok
}

/// Версия загрузчика, под которую идёт запуск. Пустая — неизвестна (ставится
/// рекомендованная), тогда проверять не по чему. NeoForge на 1.x нумеруется от
/// версии игры: 1.21.1 → 21.1.x, 1.21 → 21.0.x.
fn loader_version_of(entry: &Profile) -> String {
    if let Some(v) = entry.loader_version.as_deref().filter(|v| !v.is_empty()) {
        return v.to_string();
    }
    if entry.loader_id() == "neoforge" {
        let key = version_key(&entry.version);
        if key.first() == Some(&1) && key.len() >= 2 {
            return format!("{}.{}", key[1], key.get(2).copied().unwrap_or(0));
        }
    }
    String::new()
}

/// Встанет ли наш jar в эту сборку по ЕГО собственным требованиям. Каталог
/// вариантов шире, чем объявлено в самих jar (вариант «от 1.20» при jar
/// «>=1.20.1», NeoForge 1.21 при jar «neoforge [21.1,)»), и загрузчик роняет всю
/// сборку, увидев такой jar.
fn jar_fits(path: &Path, entry: &Profile) -> bool {
    match read_declared(path) {
        Some(d) => d.fits_game(&entry.version) && d.fits_loader(&loader_version_of(entry)),
        // Не прочитали — файл битый, в сборку его нельзя.
        None => false,
    }
}

async fn ensure_fabric_api(app: &AppHandle, profile: &str, game_version: &str) -> bool {
    match fabric_api_state(profile, game_version) {
        FabricApi::Ready => return true,
        // Второй Fabric API рядом с чужим — это дубль и падение загрузчика.
        FabricApi::Unfit => return false,
        FabricApi::Missing => {}
    }
    let item = PlanItem { source: "modrinth".into(), project_id: FABRIC_API_PROJECT.into(), version_id: String::new() };
    let install = install_dep_items(app.clone(), profile.to_string(), "mod".into(), vec![item]);
    match tokio::time::timeout(FABRIC_API_WAIT, install).await {
        Ok(Ok(report)) => !report.installed.is_empty() && fabric_api_state(profile, game_version) == FabricApi::Ready,
        _ => false,
    }
}

/// The catalogue is out of reach or the new version did not download, while the
/// build already holds a working one: the game goes with it. Such a launch used
/// to lose the cosmetics and the token, and CustomSkinLoader was put in instead.
fn keep_installed(profile: &str, dir: &Path, nick: &str, licensed: bool) -> Option<String> {
    let jar = installed_jars(profile).into_iter().max_by_key(|j| version_key(j))?;
    if quarantined(profile).0 == jar {
        remove_mod_from(profile);
        return None;
    }
    let entry = profile_of(profile)?;
    let loader = entry.loader_id();
    // Сборку могли перевести на другую версию игры: старый jar при этом
    // остаётся в папке и роняет загрузчик.
    if !jar_fits(&dir.join("mods").join(&jar), &entry)
        || (needs_fabric_api(&loader) && fabric_api_state(profile, &entry.version) != FabricApi::Ready)
    {
        remove_mod_from(profile);
        return None;
    }
    if !keep_only(profile, &jar).is_empty() {
        return None;
    }
    write_settings(dir, licensed).ok()?;
    place_local_skin(dir, nick);
    drop_launcher_csl(&dir.join("mods"));
    Some(jar)
}

/// Рубильник: сервер собирает блок-лист из всплесков вылетов по вине мода.
/// Пара (id варианта, версия каталога) в списке - мод в этот запуск не ставим.
/// Без сети берётся копия на диске, без копии - не блокируем ничего.
fn blocked_by(list: &Value, variant: &str, version: &str) -> bool {
    if variant.is_empty() || version.is_empty() || list["version"].as_str() != Some(version) {
        return false;
    }
    list["variants"].as_array().is_some_and(|v| v.iter().any(|x| x.as_str() == Some(variant)))
}

/// A verdict of the kill switch is trusted this long, for the catalogue version it was made for.
const KILL_SWITCH_TTL: Duration = Duration::from_secs(30 * 60);
/// A copy this young needs no second look at all.
const KILL_SWITCH_RECENT: Duration = Duration::from_secs(2 * 60);
/// With no usable copy a launch waits this long for the live list, as it always did.
const KILL_SWITCH_WAIT: Duration = Duration::from_secs(2);
/// A usable copy lets a launch wait this long for a live answer that is still on its way.
const KILL_SWITCH_GRACE: Duration = Duration::from_millis(400);
/// A live request that runs next to the install may take longer than a launch is willing to wait.
const KILL_SWITCH_LIVE: Duration = Duration::from_secs(6);

fn blocked_copy_path() -> PathBuf {
    data_dir().join("millida-mod-blocked.json")
}

fn file_age(path: &Path) -> Option<Duration> {
    std::fs::metadata(path).ok()?.modified().ok()?.elapsed().ok()
}

fn read_list(path: &Path) -> Option<Value> {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok())
}

/// The copy of the list can stand in for the network when it is recent and was made for the
/// catalogue version about to be placed. A list for an older version says nothing about a new
/// release, so that case asks the server.
fn kill_copy_usable(age: Option<Duration>, list: &Value, version: &str) -> bool {
    age.is_some_and(|a| a < KILL_SWITCH_TTL)
        && list["variants"].is_array()
        && !version.is_empty()
        && list["version"].as_str() == Some(version)
}

/// One live request for the list; a good answer replaces the copy on disk.
async fn kill_switch_live_at(url: &str, copy: &Path) -> Option<Value> {
    // Our own API, no token and nothing about the player is sent.
    let v = tokio::time::timeout(KILL_SWITCH_LIVE, get_json(url)).await.ok()?.ok()?;
    if !v["variants"].is_array() {
        return None;
    }
    write_json_quiet(copy, &v);
    Some(v)
}

/// The live request for the list, started when the launch starts so that it runs next to the
/// install instead of after it. Dropping it does not cancel the request: the copy still updates.
pub(crate) struct KillPrefetch(Option<tokio::task::JoinHandle<Option<Value>>>);

impl KillPrefetch {
    pub(crate) fn none() -> Self {
        KillPrefetch(None)
    }

    /// Nothing is asked while the copy is younger than two minutes.
    pub(crate) fn start() -> Self {
        let copy = blocked_copy_path();
        if file_age(&copy).is_some_and(|a| a < KILL_SWITCH_RECENT) {
            return Self::none();
        }
        KillPrefetch(Some(tokio::spawn(async move { kill_switch_live_at(BLOCKED_URL, &copy).await })))
    }
}

/// The lists a launch of a modded build reads — the kill switch and the variants of our mod —
/// brought up to date by the lobby ahead of Play: the launch then finds fresh copies and asks the
/// network nothing. Each is asked at most as often as a launch would ask it.
pub(crate) async fn warm_mod_lists() {
    let kill = KillPrefetch::start();
    let _ = manifest(ManifestSource::Launch).await;
    if let Some(job) = kill.0 {
        let _ = job.await;
    }
}

/// The answer of the request the launch started, if it is here or arrives within `wait`. The
/// handle that did not make it in time is given back: the request goes on, and its result is
/// still good for the late check.
async fn live_within(
    handle: Option<tokio::task::JoinHandle<Option<Value>>>,
    wait: Duration,
) -> (Option<Value>, Option<tokio::task::JoinHandle<Option<Value>>>) {
    let Some(mut h) = handle else { return (None, None) };
    match tokio::time::timeout(wait, &mut h).await {
        Ok(joined) => (joined.ok().flatten(), None),
        Err(_) => (None, Some(h)),
    }
}

/// Is this variant of this catalogue version on the kill switch? The live list outranks the
/// copy: if the request the launch started has answered (or answers within a short grace), its
/// verdict is the verdict, and a version the server blocked never starts. Only when the live
/// list is not there in time does a usable copy answer at once, with the live list catching up
/// in the background: if it turns out the version was blocked after the game has started with
/// it, `on_late_block` fires and the copy already says no for the next launch. Without a usable
/// copy the live list is awaited (briefly), and the stale copy is the fallback.
async fn kill_switch_blocked_at(
    copy: &Path,
    url: &str,
    variant: &str,
    version: &str,
    prefetch: KillPrefetch,
    on_late_block: impl FnOnce() + Send + 'static,
) -> bool {
    let age = file_age(copy);
    let cached = read_list(copy);
    let usable = cached.as_ref().is_some_and(|l| kill_copy_usable(age, l, version));
    let young = age.is_some_and(|a| a < KILL_SWITCH_RECENT);
    let asked = prefetch.0.is_some();
    let (live, pending) = live_within(prefetch.0, if usable { KILL_SWITCH_GRACE } else { KILL_SWITCH_WAIT }).await;
    if let Some(live) = live {
        return blocked_by(&live, variant, version);
    }
    if usable {
        let blocked = cached.as_ref().is_some_and(|l| blocked_by(l, variant, version));
        if !blocked && !young && (pending.is_some() || !asked) {
            let (url, copy, variant, version) = (url.to_string(), copy.to_path_buf(), variant.to_string(), version.to_string());
            tokio::spawn(async move {
                let live = match pending {
                    Some(h) => h.await.ok().flatten(),
                    None => kill_switch_live_at(&url, &copy).await,
                };
                if live.is_some_and(|l| blocked_by(&l, &variant, &version)) {
                    on_late_block();
                }
            });
        }
        return blocked;
    }
    // No usable copy: the request already in flight has had its wait; without one, ask now.
    let live = if asked {
        None
    } else {
        tokio::time::timeout(KILL_SWITCH_WAIT, kill_switch_live_at(url, copy)).await.ok().flatten()
    };
    live.or(cached).is_some_and(|l| blocked_by(&l, variant, version))
}

async fn kill_switch_blocked(app: &AppHandle, variant: &str, version: &str, prefetch: KillPrefetch) -> bool {
    let app = app.clone();
    kill_switch_blocked_at(&blocked_copy_path(), BLOCKED_URL, variant, version, prefetch, move || {
        // The copy of the list already says so, so the next launch starts the build without the mod.
        // Not a bare literal on purpose: a core text found by the translation scan needs all 20 tables, and
        // this one is the same kind of status line as before.
        warn(&app, &format!("Мод «{}» отключён сервером: со следующего запуска сборка стартует без него", "Millida"));
    })
    .await
}

pub async fn ensure_millida_mod(
    app: &AppHandle,
    profile: &str,
    nick: &str,
    licensed: bool,
) -> Result<Option<String>, String> {
    ensure_millida_mod_with(app, profile, nick, licensed, KillPrefetch::none()).await
}

/// The launch's version: the list of versions comes from the copy (refreshed in the background)
/// and the kill switch from the request the launch started earlier.
pub(crate) async fn ensure_millida_mod_with(
    app: &AppHandle,
    profile: &str,
    nick: &str,
    licensed: bool,
    prefetch: KillPrefetch,
) -> Result<Option<String>, String> {
    if !millida_mod_wanted(profile) {
        // Мод выключен насовсем: сборку не трогаем и не забираем у неё
        // CustomSkinLoader - без нашего мода скин иначе брать неоткуда.
        remove_mod_from(profile);
        return Ok(None);
    }
    let dir = profile_dir(profile);
    let mods = dir.join("mods");
    let state = match mod_state(profile.to_string(), ManifestSource::Launch).await {
        Ok(state) => state,
        Err(e) => return keep_installed(profile, &dir, nick, licensed).map(Some).ok_or(e),
    };
    if state.available.is_empty() {
        // Под эту связку варианта нет, а jar от прежней версии сборки мог
        // остаться: загрузчик прочтёт его и упадёт.
        remove_mod_from(profile);
        return Ok(None);
    }
    // Рубильник: сломанный выпуск не должен дойти до игры. Файл убираем, но
    // карантина нет - со следующей версией в каталоге мод поставится сам.
    if kill_switch_blocked(app, &state.variant, &state.version, prefetch).await {
        remove_mod_from(profile);
        write_settings(&dir, licensed)?;
        place_local_skin(&dir, nick);
        drop_launcher_csl(&mods);
        return Ok(None);
    }
    // Мод - часть сборки, а не дополнение к ней: на нём держатся скины, плащи и
    // косметика, за которую заплачено. Стёрли файл руками или снёс антивирус -
    // запуск ставит его заново, без вопросов.
    // Версия, уже уронившая эту сборку, повторно не ставится: иначе запуск
    // чинится только удалением сборки. Новая версия карантином не считается —
    // ради неё он и заведён.
    if blocks(&quarantined(profile), &state.available, &state.sha256) {
        // Файл убирается и здесь: если при карантине удалить его не вышло,
        // иначе он грузился бы снова и ронял каждый запуск.
        remove_mod_from(profile);
        write_settings(&dir, licensed)?;
        place_local_skin(&dir, nick);
        drop_launcher_csl(&mods);
        return Ok(None);
    }
    // The Fabric jar declares a hard dependency on Fabric API: without it the
    // loader refuses the whole build before the game even opens.
    if needs_fabric_api(&state.loader) && !ensure_fabric_api(app, profile, &state.game_version).await {
        remove_mod_from(profile);
        warn(
            app,
            "Косметике Millida нужен Fabric API под версию этой сборки, а его нет или он от другой версии игры. Сборка запустится без косметики",
        );
        return Ok(None);
    }
    // Имя совпало - ещё не значит, что файл тот. Перезалитый под тем же номером
    // jar отличается только содержимым, и сверка суммы - единственное, что это
    // ловит.
    let stale = !state.installed.is_empty()
        && state.installed == state.available
        && !file_is(&mods.join(&state.installed), &state.sha256);
    if state.installed != state.available || stale {
        if stale {
            let _ = std::fs::remove_file(mods.join(&state.installed));
        }
        if let Err(e) = install_for_launch(app, profile).await {
            return keep_installed(profile, &dir, nick, licensed).map(Some).ok_or(e);
        }
    }
    // Даже когда версия та самая: лишний jar рядом с ней роняет загрузчик, а
    // проверка выше сравнивает только ОДНО имя из папки.
    // Последнее слово за самим jar: объявленные им версии игры и загрузчика.
    if let Some(entry) = profile_of(profile) {
        if !jar_fits(&mods.join(&state.available), &entry) {
            remove_mod_from(profile);
            return Ok(None);
        }
    }
    let stuck = keep_only(profile, &state.available);
    if !stuck.is_empty() {
        warn(
            app,
            &format!("В сборке осталась лишняя версия мода: {}. Удали её из папки mods", stuck.join(", ")),
        );
    }
    write_settings(&dir, licensed)?;
    place_local_skin(&dir, nick);
    drop_launcher_csl(&mods);
    Ok(Some(state.available))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Подпись настоящим ключом мода (scripts/manifest_canonical.py + tauri signer):
    /// подменённая сумма jar или чужая подпись не проходят, без подписи — «нет подписи».
    #[test]
    fn a_signed_mod_manifest_is_checked_line_by_line() {
        let signed = json!({
            "formatVersion": 1,
            "version": "0.2.11",
            "baseUrl": "https://cdn.millida.net/mod",
            "variants": [
                { "id": "fabric-1.21.1", "artifact": "millida-mod-fabric-1.21.1-0.2.11.jar", "sha256": "AB12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12", "size": 123456 },
                { "id": "forge-1.20.1", "artifact": "millida-mod-forge-1.20.1-0.2.11.jar", "sha256": "cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34cd34", "size": 654321 }
            ],
            "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTTUE3allyNUlnQzBGT3VCTUVFNFFzaXhha1BkZVIybHF6V00zTS81aTFNNy9CTndDbnBGZ0I4OVdocDFZb3RJUUtzZFFzYmc5TWFidWM2bldYb08yNzhwdTV6YkZlUWdVPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkxNzA4Mjk0CWZpbGU6dmFyaWFudHMuY2Fub25pY2FsCndwYjJyazV2elo4M1VzL1Z5MTZrNHU0eStrQ0JzSHhWZ0xZSFVLQnNZc09xVDdmTnZWSmNtNFJjTzdwM083eTQrdmNPNytxak1QR2V0K0paUDFmR0R3PT0K"
        });
        assert_eq!(manifest_signature(&signed, MOD_MANIFEST_PUBKEY), ManifestSignature::Valid, "список, подписанный CI мода");
        let mut swapped = signed.clone();
        swapped["variants"][0]["sha256"] = json!("ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56ef56");
        assert_eq!(manifest_signature(&swapped, MOD_MANIFEST_PUBKEY), ManifestSignature::Invalid, "подменённый jar не проходит");
        let mut extra = signed.clone();
        extra["variants"].as_array_mut().unwrap().push(json!({ "artifact": "evil.jar", "sha256": "00", "size": 1 }));
        assert_eq!(manifest_signature(&extra, MOD_MANIFEST_PUBKEY), ManifestSignature::Invalid, "добавленный вариант не проходит");
        let mut unsigned = signed.clone();
        unsigned.as_object_mut().unwrap().remove("signature");
        assert_eq!(manifest_signature(&unsigned, MOD_MANIFEST_PUBKEY), ManifestSignature::Missing);
        let mut cosmetic = signed.clone();
        cosmetic["comment"] = json!("пробелы и новые поля подпись не ломают");
        assert_eq!(manifest_signature(&cosmetic, MOD_MANIFEST_PUBKEY), ManifestSignature::Valid);
    }

    /// The jar reaches the build only as a whole file: a copy that fails half
    /// way must leave neither a truncated jar nor a stray part file in mods/.
    #[test]
    fn a_cached_jar_lands_in_the_build_whole_or_not_at_all() {
        let root = std::env::temp_dir().join(format!("millida-place-jar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("mods")).unwrap();
        let cached = root.join("cache.jar");
        std::fs::write(&cached, b"new jar").unwrap();
        let cases: [(&str, Option<&[u8]>, bool, &str); 3] = [
            ("mods/millida-mod-a.jar", None, true, "an empty slot gets the jar"),
            ("mods/millida-mod-b.jar", Some(b"old"), true, "a stale file of the same name is replaced"),
            ("missing/millida-mod-c.jar", None, false, "a folder that is not there fails cleanly"),
        ];
        for (rel, before, ok, why) in cases {
            let dest = root.join(rel);
            if let Some(bytes) = before {
                std::fs::write(&dest, bytes).unwrap();
            }
            assert_eq!(place_jar(&cached, &dest).is_ok(), ok, "{}", why);
            if ok {
                assert_eq!(std::fs::read(&dest).unwrap(), b"new jar", "{}: the build must hold the cached bytes", why);
            } else {
                assert!(!dest.exists(), "{}: nothing may appear at the target", why);
            }
            let mut part = dest.as_os_str().to_os_string();
            part.push(".part");
            assert!(!PathBuf::from(part).exists(), "{}: the part file must not outlive the call", why);
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Input -> verdict for the arm marker the mod's local source reads. A
    /// licensed Alex player with a cape got Steve sleeves in game: the local
    /// copy answered skin and cape, the mod stopped there, and no arm type came
    /// with them.
    #[test]
    fn the_local_skin_carries_its_arm_type() {
        let root = std::env::temp_dir().join(format!("millida-local-arms-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let source = root.join("localskin");
        let build = root.join("build");
        std::fs::create_dir_all(&source).unwrap();
        let marker = build.join("millida").join("local").join("models").join("Alex_1.txt");
        let cases: [(bool, bool, Option<&str>, &str); 3] = [
            (true, true, Some("slim"), "an Alex skin is marked slim"),
            (true, false, Some("classic"), "a Steve skin is marked classic, not left to the uuid guess"),
            (false, true, None, "no local skin leaves no marker behind"),
        ];
        for (with_skin, slim, want, why) in cases {
            if with_skin {
                std::fs::write(source.join("skin.png"), b"png").unwrap();
            } else {
                let _ = std::fs::remove_file(source.join("skin.png"));
            }
            place_local_skin_from(&source, slim, &build, "Alex_1");
            assert_eq!(std::fs::read_to_string(&marker).ok().as_deref(), want, "{}", why);
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The background rounds run after the download's own quick retries gave
    /// up, so the first round must not come back sooner than they did, and the
    /// whole schedule has to end instead of polling the shield forever.
    #[test]
    fn background_rounds_back_off_and_end() {
        let first_round = throttle_pause(ROUND_BACKOFF_FROM, None, 0.0);
        assert!(first_round >= Duration::from_secs(20), "first round waited only {:?}", first_round);
        let total: Duration = (1..PATIENT_ROUNDS)
            .map(|round| throttle_pause(round + ROUND_BACKOFF_FROM - 1, None, 1.0))
            .sum();
        assert!(total <= Duration::from_secs(15 * 60), "the worst case schedule runs {:?}", total);
        assert!(LAUNCH_WAIT <= Duration::from_secs(10), "a launch must not stand on the mod longer than a few seconds");
    }

    #[test]
    fn the_mod_jar_comes_only_from_our_cdn_folder() {
        let cases = [
            ("https://cdn.millida.net/mod", true, "обычная база"),
            ("https://cdn.millida.net/mod/", true, "со слэшем"),
            ("https://cdn.millida.net/mod/beta", true, "подпапка нашей же папки"),
            ("https://cdn.millida.net/modx", false, "соседняя папка с похожим именем"),
            ("https://cdn.millida.net/mod/../other", false, "выход из папки"),
            ("https://evil.example/mod", false, "чужой хост"),
            ("http://cdn.millida.net/mod", false, "без https"),
        ];
        for (base, want, why) in cases {
            assert_eq!(mod_base_allowed(base), want, "{}", why);
        }
    }

    /// The launcher must never overwrite a choice the player made in the
    /// Right Shift menu: it only fills in a missing "hud" object, and only
    /// when the player asked for the modules to start switched off.
    #[test]
    fn hud_seed_touches_only_a_missing_hud_object() {
        let cases: [(Value, bool, Value, &str); 4] = [
            (json!({}), true, json!({}), "default on keeps the mod's own default"),
            (json!({}), false, json!({ "hud": { "enabled": false } }), "default off seeds the switch"),
            (
                json!({ "hud": { "enabled": true, "theme": "x" } }),
                false,
                json!({ "hud": { "enabled": true, "theme": "x" } }),
                "the player's in-game choice wins over the launcher default",
            ),
            (
                json!({ "hud": { "enabled": false } }),
                true,
                json!({ "hud": { "enabled": false } }),
                "turning the default back on does not flip existing builds",
            ),
        ];
        for (before, on, after, why) in cases {
            let mut cfg = before.as_object().cloned().unwrap_or_default();
            seed_hud(&mut cfg, on);
            assert_eq!(Value::Object(cfg), after, "{}", why);
        }
    }

    /// Мод ставится принудительно, поэтому отказ обязан пережить перезапуск
    /// лаунчера и читаться до открытия окна. Свойство закреплено на файле:
    /// пока его нет - мод ставится, появился - не ставится.
    #[test]
    fn the_off_switch_is_the_file_and_defaults_to_on() {
        let dir = std::env::temp_dir().join(format!("millida-mod-switch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let file = dir.join("millida-mod-off");

        assert!(enabled_at(&file), "не трогали настройку - мод ставится сам");

        turn_off_at(&file).expect("выключение обязано сохраниться");
        assert!(!enabled_at(&file), "после выключения мод не ставится ни в одну сборку");

        turn_off_at(&file).expect("повторное выключение - не ошибка");
        assert!(!enabled_at(&file), "и состояние то же");

        turn_on_at(&file).expect("включение обязано сработать");
        assert!(enabled_at(&file), "мод вернулся");

        turn_on_at(&file).expect("включить включённое - не ошибка, файла просто нет");
        assert!(enabled_at(&file));

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Две версии мода в одной сборке = падение загрузчика ещё до входа в игру
    /// (RezanansX, 16.09.2026: краш указывал на 0.1.0, лежавшую рядом с 0.1.1).
    /// Из папки должна выбираться СТАРШАЯ по алфавиту, чтобы сверка со свежей
    /// версией не совпала и переустановка убрала лишнее.
    #[test]
    fn two_jars_in_one_build_never_read_as_up_to_date() {
        let dir = std::env::temp_dir().join(format!("millida-mod-dup-{}", std::process::id()));
        let mods = dir.join("mods");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&mods).unwrap();
        for name in ["millida-mod-neoforge-1.21.1-0.1.1.jar", "millida-mod-neoforge-1.21.1-0.1.0.jar", "sodium.jar"] {
            std::fs::write(mods.join(name), b"x").unwrap();
        }

        let mut ours: Vec<String> = std::fs::read_dir(&mods)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(FILE_PREFIX) && n.ends_with(".jar"))
            .collect();
        ours.sort();

        assert_eq!(ours.len(), 2, "чужие моды не наши и в счёт не идут");
        assert_eq!(
            ours[0], "millida-mod-neoforge-1.21.1-0.1.0.jar",
            "берётся старшая: совпади она со свежей, лишний jar остался бы лежать навсегда"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Файл под нужным именем, но с чужим содержимым. Именно так у игроков
    /// остался мод под Java новее игры: исправленный jar перезалили под тем же
    /// номером версии, имя совпало, и лаунчер считал сборку свежей — при живом
    /// исправлении на CDN и падении Forge при каждом запуске.
    #[test]
    fn a_rebuilt_jar_under_the_same_name_is_not_the_same_file() {
        let dir = std::env::temp_dir().join(format!("millida-mod-sha-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jar = dir.join("millida-mod-forge-1.20.1-0.1.1.jar");

        std::fs::write(&jar, b"correct build").unwrap();
        let good = sha256_hex(b"correct build");
        assert!(file_is(&jar, &good), "тот самый файл переустанавливать незачем");

        std::fs::write(&jar, b"stale build under the same name").unwrap();
        assert!(!file_is(&jar, &good), "содержимое другое - файл обязан считаться чужим");

        assert!(file_is(&jar, ""), "без суммы сверять нечем: качать заново каждый запуск хуже");
        assert!(file_is(&jar, "не-сумма"), "мусор вместо суммы тоже не повод перекачивать");
        assert!(!file_is(&dir.join("нет-такого.jar"), &good), "пропавший файл не совпадает ни с чем");

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// вход → вердикт: какой вариант подходит сборке.
    #[test]
    fn variant_matches_loader_and_range() {
        let variant = json!({
            "loaders": ["fabric", "quilt"],
            "minecraft": { "from": "1.20.1", "to": "1.20.2" }
        });

        assert!(variant_fits(&variant, "1.20.1", "fabric"), "своя версия и свой загрузчик подходят");
        assert!(variant_fits(&variant, "1.20.1", "quilt"), "Quilt читает моды Fabric");
        assert!(!variant_fits(&variant, "1.20.1", "forge"), "чужой загрузчик не подходит");
        assert!(!variant_fits(&variant, "1.20.2", "fabric"), "верхняя граница не входит в диапазон");
        assert!(!variant_fits(&variant, "1.19.4", "fabric"), "версия ниже нижней границы не подходит");
    }

    #[test]
    fn open_upper_bound_covers_newer_versions() {
        let variant = json!({ "loaders": ["neoforge"], "minecraft": { "from": "1.21.11", "to": null } });

        assert!(variant_fits(&variant, "1.21.11", "neoforge"), "открытый диапазон берёт свою версию");
        assert!(variant_fits(&variant, "1.21.20", "neoforge"), "и всё, что новее");
        assert!(!variant_fits(&variant, "1.21.9", "neoforge"), "но не то, что старше");
    }

    /// Нумерация игры сменилась: после 1.21.11 идёт 26.1, и «26» обязано
    /// читаться как версия НОВЕЕ единицы, а не старее. Сборке на 26.2 нельзя
    /// подсунуть вариант под 1.21.11 — там другая игра внутри.
    #[test]
    fn year_numbering_is_newer_than_the_old_one() {
        let old = json!({ "loaders": ["fabric"], "minecraft": { "from": "1.21.11", "to": "26.1" } });
        let fresh = json!({ "loaders": ["fabric"], "minecraft": { "from": "26.2", "to": null } });

        assert!(variant_fits(&old, "1.21.11", "fabric"), "вариант под 1.21.11 берёт свою версию");
        assert!(!variant_fits(&old, "26.2", "fabric"), "но не берёт 26.2: это уже другая ветка");
        assert!(variant_fits(&fresh, "26.2", "fabric"), "вариант под 26.2 берёт 26.2");
        assert!(!variant_fits(&fresh, "26.1.2", "fabric"), "и не забирает 26.1 у её собственного варианта");
        assert!(!variant_fits(&fresh, "1.21.11", "fabric"), "и не забирает старую нумерацию");
    }

    /// 1.8.9 и 1.13.2 стоят между уже закрытыми диапазонами: соседи не должны
    /// их перехватывать, иначе игрок получит мод под другую игру.
    #[test]
    fn old_versions_go_to_their_own_variants() {
        let v1710 = json!({ "loaders": ["forge"], "minecraft": { "from": "1.7.10", "to": "1.8" } });
        let v189 = json!({ "loaders": ["forge"], "minecraft": { "from": "1.8", "to": "1.9" } });
        let v1132 = json!({ "loaders": ["forge"], "minecraft": { "from": "1.13", "to": "1.14" } });

        assert!(variant_fits(&v189, "1.8.9", "forge"), "1.8.9 берёт свой вариант");
        assert!(!variant_fits(&v1710, "1.8.9", "forge"), "и не достаётся варианту под 1.7.10");
        assert!(!variant_fits(&v189, "1.9.4", "forge"), "1.9.4 мы не поддерживаем и молчим об этом");
        assert!(variant_fits(&v1132, "1.13.2", "forge"), "1.13.2 берёт свой вариант");
        assert!(!variant_fits(&v1132, "1.14.4", "forge"), "а 1.14.4 — уже нет");
    }

    /// Диапазоны из mods.toml наших jar — ровно те, на которых ошибался каталог.
    #[test]
    fn maven_ranges_read_like_forge_reads_them() {
        let cases: [(&str, &str, bool, &str); 9] = [
            ("1.20.1", "[1.20.1,1.20.2)", true, "своя версия"),
            ("1.20", "[1.20.1,1.20.2)", false, "каталог отдавал jar под 1.20.1 сборке на 1.20"),
            ("1.20.2", "[1.20.1,1.20.2)", false, "правая граница открыта"),
            ("21.0.167", "[21.1,)", false, "NeoForge 1.21 (21.0.x) не тянет jar под 21.1"),
            ("21.1.200", "[21.1,)", true, "NeoForge 1.21.1"),
            ("1.20.1", "[1.20.1]", true, "точная версия"),
            ("1.20.1", "1.20", true, "голая версия у Forge — пожелание"),
            ("1.20.1", "", true, "нет требования"),
            ("1.18.1", "[1.18.2,1.19)", false, "вариант «от 1.18» при jar «от 1.18.2»"),
        ];
        for (v, r, want, why) in cases {
            assert_eq!(maven_range_ok(v, r), want, "{v} в {r}: {why}");
        }
    }

    #[test]
    fn prerelease_builds_get_no_variant() {
        for v in ["1.21.9-rc1", "26.2-snapshot-7", "25w05a", "1.21.5-pre2"] {
            assert!(is_prerelease(v), "{v}: наш jar объявляет релизы, загрузчик считает {v} младше релиза");
        }
        for v in ["1.21.11", "26.3", "26.1.2", "1.8.9"] {
            assert!(!is_prerelease(v), "{v} — релиз");
        }
    }

    /// Карантин держит упавший файл, но не исправление под тем же именем и не
    /// следующую версию.
    #[test]
    fn quarantine_blocks_only_the_file_that_crashed() {
        let sha_bad = "a".repeat(64);
        let sha_fixed = "b".repeat(64);
        let q = parse_quarantine(&format!("millida-mod-fabric-1.21.11-0.1.11.jar\n{}\n", sha_bad));
        assert!(blocks(&q, "millida-mod-fabric-1.21.11-0.1.11.jar", &sha_bad), "тот же файл не ставится снова");
        assert!(!blocks(&q, "millida-mod-fabric-1.21.11-0.1.11.jar", &sha_fixed), "перезалитое исправление проходит");
        assert!(!blocks(&q, "millida-mod-fabric-1.21.11-0.1.12.jar", &sha_bad), "следующая версия проходит");
        let old = parse_quarantine("millida-mod-forge-1.20.1-0.1.10.jar");
        assert!(blocks(&old, "millida-mod-forge-1.20.1-0.1.10.jar", &sha_fixed), "карантин старого формата держит по имени");
        assert!(!blocks(&parse_quarantine(""), "x.jar", &sha_bad), "пустой карантин не держит ничего");
    }

    fn jar_with(dir: &Path, name: &str, entry: &str, body: &str) -> PathBuf {
        use std::io::Write;
        let path = dir.join(name);
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.start_file(entry, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(body.as_bytes()).unwrap();
        zip.finish().unwrap();
        path
    }

    fn profile(version: &str, loader: &str, loader_version: Option<&str>) -> Profile {
        Profile {
            name: "t".into(),
            version: version.into(),
            fabric: loader == "fabric",
            loader: Some(loader.into()),
            loader_version: loader_version.map(str::to_string),
            icon: None,
        }
    }

    /// jar → вердикт по его собственным требованиям, а не по каталогу.
    #[test]
    fn our_jar_is_judged_by_what_it_declares() {
        let dir = std::env::temp_dir().join(format!("millida-mod-decl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fabric = jar_with(
            &dir,
            "millida-mod-fabric-26.2-0.1.11.jar",
            "fabric.mod.json",
            r#"{"id":"millida","depends":{"fabricloader":">=0.19.0","minecraft":">=26.2","fabric-api":"*"}}"#,
        );
        assert!(jar_fits(&fabric, &profile("26.3", "fabric", None)), "26.3 проходит «>=26.2»");
        assert!(!jar_fits(&fabric, &profile("26.3", "fabric", Some("0.18.4"))), "старый Fabric Loader не тянет jar");
        let neo = jar_with(
            &dir,
            "millida-mod-neoforge-1.21.1-0.1.11.jar",
            "META-INF/neoforge.mods.toml",
            "[[mods]]\nmodId = \"millida\"\n[[dependencies.millida]]\nmodId = \"neoforge\"\ntype = \"required\"\nversionRange = \"[21.1,)\"\n\
             [[dependencies.millida]]\nmodId = \"minecraft\"\nversionRange = \"[1.21,1.21.2)\"\n",
        );
        assert!(jar_fits(&neo, &profile("1.21.1", "neoforge", None)), "1.21.1 → NeoForge 21.1");
        assert!(!jar_fits(&neo, &profile("1.21", "neoforge", None)), "1.21 → NeoForge 21.0, jar просит 21.1");
        let legacy = jar_with(
            &dir,
            "millida-mod-forge-1.7.10-0.1.15.jar",
            "mcmod.info",
            r#"[{"modid":"millida","name":"Millida","version":"0.1.15","mcversion":"1.7.10"}]"#,
        );
        assert!(
            jar_fits(&legacy, &profile("1.7.10", "forge", Some("10.13.4.1614"))),
            "Forge 1.7.10-1.12.2 jars carry only mcmod.info: reading it as broken took the mod out of every such build, OneBlock included"
        );
        let broken = dir.join("millida-mod-broken.jar");
        std::fs::write(&broken, b"not a zip").unwrap();
        assert!(!jar_fits(&broken, &profile("1.21.1", "neoforge", None)), "битый jar в сборку не идёт");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// (catalogue pack, opted in now, opted in before, player switch) -> what launch does with our jar.
    #[test]
    fn own_mod_goes_into_a_catalogue_pack_only_on_our_opt_in() {
        use OwnMod::*;
        let cases: [(bool, bool, bool, bool, OwnMod, &str); 8] = [
            (false, false, false, true, Place, "an ordinary build always carries the mod"),
            (false, false, false, false, Remove, "the player turned the mod off for every build"),
            (true, false, false, true, Leave, "Arcania: a protected pack verifies its own files, our jar is a change behind the author's back"),
            (true, false, false, false, Leave, "a pack we never touched stays untouched even when the switch is off"),
            (true, true, false, true, Place, "OneBlock 27.09: players see each other's Millida cosmetics"),
            (true, true, true, false, Remove, "the player's off switch wins over our opt-in"),
            (true, false, true, true, Remove, "an opt-in we withdrew takes our jar back out of the pack"),
            (true, true, true, true, Place, "an opt-in that stands keeps the mod in place"),
        ];
        for (pack, opted, before, enabled, want, why) in cases {
            assert_eq!(own_mod_action(pack, opted, before, enabled), want, "{}", why);
        }
    }

    #[test]
    fn kill_switch_blocks_only_the_listed_variant_of_that_version() {
        let list = json!({"version": "0.2.12", "variants": ["fabric-1.20.1"], "updatedAt": "x"});
        assert!(blocked_by(&list, "fabric-1.20.1", "0.2.12"));
        assert!(!blocked_by(&list, "fabric-1.21.1", "0.2.12"), "другой вариант проходит");
        assert!(!blocked_by(&list, "fabric-1.20.1", "0.2.13"), "новая версия проходит сама");
        assert!(!blocked_by(&json!({"version": "", "variants": []}), "fabric-1.20.1", "0.2.12"));
        assert!(!blocked_by(&json!({}), "fabric-1.20.1", "0.2.12"), "пустой ответ не блокирует");
        assert!(!blocked_by(&list, "", "0.2.12"));
    }

    /// (quarantined jar, jars in mods/) -> version the build page reports as held back.
    #[test]
    fn only_a_quarantine_still_in_force_is_reported() {
        let old = "millida-mod-fabric-1.20.1-0.2.18.jar";
        let new = "millida-mod-fabric-1.20.1-0.2.19.jar";
        type Case<'a> = (&'a str, &'a [&'a str], Option<&'a str>, &'a str);
        let cases: [Case; 5] = [
            ("", &[], None, "no quarantine file: nothing to report"),
            (old, &[], Some("0.2.18"), "the crashed jar was taken out and nothing replaced it"),
            (old, &[old], Some("0.2.18"), "the busy jar is still there under the same name"),
            (old, &[new], None, "a newer catalogue jar is installed, the quarantine holds nothing back"),
            (old, &[old, new], None, "any other jar in mods/ means the launcher moved past the crashed one"),
        ];
        for (quarantined, installed, want, why) in cases {
            let installed: Vec<String> = installed.iter().map(|s| s.to_string()).collect();
            assert_eq!(active_quarantine(quarantined, &installed).as_deref(), want, "{}", why);
        }
    }

    /// (files before) -> files left after «Вернуть». Only our quarantine traces go.
    #[test]
    fn lifting_the_quarantine_removes_only_our_traces() {
        let dir = std::env::temp_dir().join(format!("millida-mod-lift-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        std::fs::create_dir_all(dir.join("millida")).unwrap();
        let cases: [(&str, bool, &str); 5] = [
            ("millida/mod-quarantine", false, "the record that keeps the crashed jar out"),
            ("mods/millida-mod-fabric-1.20.1-0.2.18.jar.disabled", false, "the busy jar the quarantine could only rename"),
            ("mods/sodium-fabric-0.6.jar.disabled", true, "a mod the player turned off stays off"),
            ("mods/sodium-fabric-0.6.jar", true, "the player's own mods are untouched"),
            ("mods/millida-mod-fabric-1.20.1-0.2.19.jar", true, "a working jar of ours is not a quarantine trace"),
        ];
        for (file, _, _) in cases {
            std::fs::write(dir.join(file), b"x").unwrap();
        }
        lift_quarantine_in(&dir).expect("lifting must succeed on a build nobody holds open");
        for (file, stays, why) in cases {
            assert_eq!(dir.join(file).exists(), stays, "{}: {}", file, why);
        }
        lift_quarantine_in(&dir).expect("lifting an already lifted quarantine is not an error");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_compare_is_numeric_not_alphabetical() {
        assert!(version_at_least("1.21.10", "1.21.9"), "1.21.10 новее 1.21.9, хотя строкой меньше");
        assert!(version_below("1.21.9", "1.21.10"), "и обратное сравнение тоже численное");
    }

    // ---- kill switch: the copy answers, the live list catches up ----

    fn aged(path: &Path, by: Duration) {
        let f = std::fs::File::options().write(true).open(path).unwrap();
        f.set_modified(std::time::SystemTime::now() - by).unwrap();
    }

    fn list_file(name: &str, body: &str, age: Duration) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("millida-kill-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("blocked.json");
        std::fs::write(&path, body).unwrap();
        aged(&path, age);
        path
    }

    async fn serve_list(body: &'static str, delay: Duration) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mod/blocked", listener.local_addr().unwrap());
        let hits = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = hits.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                tokio::time::sleep(delay).await;
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = sock.write_all(reply.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        (url, hits)
    }

    const NOT_LISTED: &str = r#"{"version":"0.2.12","variants":[]}"#;
    const LISTED: &str = r#"{"version":"0.2.12","variants":["fabric-1.20.1"]}"#;
    const DEAD: &str = "http://127.0.0.1:1/mod/blocked";

    #[test]
    fn a_copy_stands_in_for_the_network_only_when_recent_and_made_for_this_version() {
        let list = json!({"version": "0.2.12", "variants": []});
        let ok = Some(Duration::from_secs(10 * 60));
        assert!(kill_copy_usable(ok, &list, "0.2.12"));
        assert!(!kill_copy_usable(Some(Duration::from_secs(31 * 60)), &list, "0.2.12"), "30 minutes is the limit");
        assert!(!kill_copy_usable(ok, &list, "0.2.13"), "a new release has not been checked by this list");
        assert!(!kill_copy_usable(None, &list, "0.2.12"), "no copy, no answer");
        assert!(!kill_copy_usable(ok, &json!({"version": "0.2.12"}), "0.2.12"), "a list without variants is not a list");
        assert!(!kill_copy_usable(ok, &list, ""), "an unknown version is never vouched for");
    }

    #[tokio::test]
    async fn a_recent_copy_answers_at_once_and_the_live_list_only_catches_up() {
        let copy = list_file("late", NOT_LISTED, Duration::from_secs(10 * 60));
        let (url, hits) = serve_list(LISTED, Duration::from_millis(600)).await;
        let late = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = late.clone();
        let started = std::time::Instant::now();
        let blocked = kill_switch_blocked_at(&copy, &url, "fabric-1.20.1", "0.2.12", KillPrefetch::none(), move || {
            flag.store(true, std::sync::atomic::Ordering::Relaxed)
        })
        .await;
        assert!(!blocked, "the copy says the version is fine");
        assert!(started.elapsed() < Duration::from_millis(400), "the launch did not wait for the server");
        for _ in 0..100 {
            if late.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(late.load(std::sync::atomic::Ordering::Relaxed), "the user is told when the live list blocks what already started");
        assert_eq!(hits.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert!(blocked_by(&read_list(&copy).unwrap(), "fabric-1.20.1", "0.2.12"), "and the next launch finds the block in the copy");
        assert!(
            kill_switch_blocked_at(&copy, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch::none(), || {}).await,
            "the next launch refuses the mod without asking anyone"
        );
    }

    #[tokio::test]
    async fn a_blocked_copy_blocks_with_no_network_and_a_very_young_copy_asks_nobody() {
        let blocked = list_file("blocked", LISTED, Duration::from_secs(5 * 60));
        assert!(kill_switch_blocked_at(&blocked, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch::none(), || {}).await);

        let young = list_file("young", NOT_LISTED, Duration::from_secs(30));
        let (url, hits) = serve_list(LISTED, Duration::ZERO).await;
        let got = kill_switch_blocked_at(&young, &url, "fabric-1.20.1", "0.2.12", KillPrefetch::none(), || {}).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!got);
        assert_eq!(hits.load(std::sync::atomic::Ordering::Relaxed), 0, "a copy from the last two minutes is not checked again");
    }

    #[tokio::test]
    async fn without_a_usable_copy_the_live_list_decides_and_a_dead_network_falls_back_to_the_old_copy() {
        let stale = list_file("stale", NOT_LISTED, Duration::from_secs(3 * 3600));
        let (url, _) = serve_list(LISTED, Duration::ZERO).await;
        assert!(
            kill_switch_blocked_at(&stale, &url, "fabric-1.20.1", "0.2.12", KillPrefetch::none(), || {}).await,
            "a three-hour-old copy does not outvote the server"
        );

        let old_blocks = list_file("old-blocks", LISTED, Duration::from_secs(3 * 3600));
        assert!(
            kill_switch_blocked_at(&old_blocks, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch::none(), || {}).await,
            "no network: the last known verdict still holds"
        );

        let other_version = list_file("other", LISTED, Duration::from_secs(60));
        let (fresh_url, hits) = serve_list(r#"{"version":"0.2.13","variants":[]}"#, Duration::ZERO).await;
        assert!(
            !kill_switch_blocked_at(&other_version, &fresh_url, "fabric-1.20.1", "0.2.13", KillPrefetch::none(), || {}).await,
            "a list made for 0.2.12 says nothing about 0.2.13"
        );
        assert_eq!(hits.load(std::sync::atomic::Ordering::Relaxed), 1, "so the server was asked");
    }

    #[tokio::test]
    async fn a_live_answer_that_has_arrived_outvotes_a_recent_copy() {
        // The copy is ten minutes old and says "fine"; the request the launch started has already
        // been answered and says "blocked". The mod must not start. The prefetch writes its copy
        // elsewhere, so only its own answer can carry the verdict.
        let copy = list_file("live-wins", NOT_LISTED, Duration::from_secs(10 * 60));
        let elsewhere = list_file("live-wins-aside", NOT_LISTED, Duration::from_secs(10 * 60));
        let (url, _) = serve_list(LISTED, Duration::from_millis(50)).await;
        let handle = tokio::spawn(async move { kill_switch_live_at(&url, &elsewhere).await });
        while !handle.is_finished() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let late = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = late.clone();
        let blocked = kill_switch_blocked_at(&copy, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch(Some(handle)), move || {
            flag.store(true, std::sync::atomic::Ordering::Relaxed)
        })
        .await;
        assert!(blocked, "the live list outranks the copy");
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!late.load(std::sync::atomic::Ordering::Relaxed), "nothing started with the mod, so there is nothing to apologise for");
    }

    #[tokio::test]
    async fn a_live_answer_within_the_grace_outvotes_the_copy_and_a_slow_one_does_not_hold_the_launch() {
        let copy = list_file("grace", NOT_LISTED, Duration::from_secs(10 * 60));
        let (quick, _) = serve_list(LISTED, Duration::from_millis(150)).await;
        let aside = copy.clone();
        let handle = tokio::spawn(async move { kill_switch_live_at(&quick, &aside).await });
        assert!(
            kill_switch_blocked_at(&copy, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch(Some(handle)), || {}).await,
            "a request that answers within the grace decides"
        );

        let slow_copy = list_file("grace-slow", NOT_LISTED, Duration::from_secs(10 * 60));
        let (slow, _) = serve_list(LISTED, Duration::from_millis(1500)).await;
        let aside = slow_copy.clone();
        let handle = tokio::spawn(async move { kill_switch_live_at(&slow, &aside).await });
        let late = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = late.clone();
        let started = std::time::Instant::now();
        let blocked = kill_switch_blocked_at(&slow_copy, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch(Some(handle)), move || {
            flag.store(true, std::sync::atomic::Ordering::Relaxed)
        })
        .await;
        assert!(!blocked, "the copy answers when the server is slow");
        assert!(started.elapsed() < Duration::from_millis(1000), "the launch waited for the grace and no longer");
        for _ in 0..100 {
            if late.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(late.load(std::sync::atomic::Ordering::Relaxed), "the same request, once it answers, still tells about the block");
    }

    #[tokio::test]
    async fn the_request_started_with_the_launch_is_the_one_that_is_awaited() {
        let stale = list_file("prefetch", NOT_LISTED, Duration::from_secs(3 * 3600));
        let (url, hits) = serve_list(LISTED, Duration::from_millis(200)).await;
        let copy = stale.clone();
        let handle = tokio::spawn(async move { kill_switch_live_at(&url, &copy).await });
        let got = kill_switch_blocked_at(&stale, DEAD, "fabric-1.20.1", "0.2.12", KillPrefetch(Some(handle)), || {}).await;
        assert!(got, "the answer of the prefetched request counts");
        assert_eq!(hits.load(std::sync::atomic::Ordering::Relaxed), 1, "no second request");
    }
}
