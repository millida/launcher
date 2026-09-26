use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

const MANIFEST_URL: &str = "https://cdn.millida.net/mod/variants.json";
const FILE_PREFIX: &str = "millida-mod-";

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

/// Read before every launch of a modded build. Without a copy on disk, a launch
/// with no network lost the mod the build already had.
async fn manifest() -> Result<Value, String> {
    get_json_revalidated(MANIFEST_URL, &data_dir().join("millida-mod-variants.json"))
        .await
        .map_err(|e| format!("Каталог версий мода недоступен: {}", e))
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
    let manifest = manifest().await?;
    let version = manifest["version"].as_str().unwrap_or("").to_string();
    match manifest["variants"].as_array().and_then(|variants| {
        variants.iter().find(|v| variant_fits(v, &entry.version, &loader))
    }) {
        Some(variant) => {
            state.available = variant["artifact"].as_str().unwrap_or("").replace("{version}", &version);
            state.sha256 = variant["sha256"].as_str().unwrap_or("").to_string();
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
    let job = Job::start(format!("millida-mod:{}", profile), "Косметика Millida")?;
    let res = install_job(&app, &job, profile).await;
    job.finish(&app, res)
}

async fn install_job(app: &AppHandle, job: &Job, profile: String) -> Result<MillidaModState, String> {
    job.emit(app, 10.0, "Подбираем версию…");
    if !millida_mod_enabled() {
        return Err("Мод выключен в настройках лаунчера".into());
    }
    let state = millida_mod_state(profile.clone()).await?;
    if state.available.is_empty() {
        return Err(if state.reason.is_empty() { "Мод не подошёл к сборке".into() } else { state.reason });
    }
    let manifest = manifest().await?;
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
    let base = manifest["baseUrl"].as_str().unwrap_or("https://cdn.millida.net/mod");
    let url = format!("{}/{}", base.trim_end_matches('/'), state.available);

    let mods = profile_dir(&profile).join("mods");
    std::fs::create_dir_all(&mods).map_err(|e| e.to_string())?;
    let dest = safe_child(&mods, &state.available)?;
    job.check()?;
    job.emit(app, 45.0, "Скачиваем…");
    download_checked(&url, &dest, Some(Sum::Sha256(sha256)), variant["size"].as_u64()).await?;

    let stuck = keep_only(&profile, &state.available);
    if !stuck.is_empty() {
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
    write_json_atomic(&path, &Value::Object(cfg))
}

/// Раскладка, которую читает мод: `millida/local/{skins,capes}/<ник>.png`. Та же
/// картинка, что игрок применил в гардеробе, — тогда скин на месте и без сети.
fn place_local_skin(dir: &Path, nick: &str) {
    let source = data_dir().join("localskin");
    let safe: String = nick.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
    if safe.is_empty() {
        return;
    }
    for (file, sub) in [("skin.png", "skins"), ("cape.png", "capes")] {
        let from = source.join(file);
        let into = dir.join("millida").join("local").join(sub);
        let target = into.join(format!("{}.png", safe));
        if !from.exists() {
            let _ = std::fs::remove_file(&target);
            continue;
        }
        if std::fs::create_dir_all(&into).is_ok() {
            let _ = std::fs::copy(&from, &target);
        }
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
    if std::fs::remove_file(&path).is_err() {
        let _ = std::fs::rename(&path, profile_dir(profile).join("mods").join(format!("{}.disabled", jar)));
    }
    true
}

/// Копия CustomSkinLoader, которую поставил сам лаунчер. Наш мод отвечает за
/// скин сам, а два мода на одну текстуру — это падение на загрузчике.
fn drop_launcher_csl(mods: &Path) -> bool {
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
    let raw = text("META-INF/neoforge.mods.toml").or_else(|| text("META-INF/mods.toml"))?;
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

pub async fn ensure_millida_mod(
    app: &AppHandle,
    profile: &str,
    nick: &str,
    licensed: bool,
) -> Result<Option<String>, String> {
    if !millida_mod_enabled() {
        // Мод выключен насовсем: сборку не трогаем и не забираем у неё
        // CustomSkinLoader - без нашего мода скин иначе брать неоткуда.
        remove_mod_from(profile);
        return Ok(None);
    }
    let dir = profile_dir(profile);
    let mods = dir.join("mods");
    let state = match millida_mod_state(profile.to_string()).await {
        Ok(state) => state,
        Err(e) => return keep_installed(profile, &dir, nick, licensed).map(Some).ok_or(e),
    };
    if state.available.is_empty() {
        // Под эту связку варианта нет, а jar от прежней версии сборки мог
        // остаться: загрузчик прочтёт его и упадёт.
        remove_mod_from(profile);
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
        if let Err(e) = millida_mod_install(app.clone(), profile.to_string()).await {
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
        let broken = dir.join("millida-mod-broken.jar");
        std::fs::write(&broken, b"not a zip").unwrap();
        assert!(!jar_fits(&broken, &profile("1.21.1", "neoforge", None)), "битый jar в сборку не идёт");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn version_compare_is_numeric_not_alphabetical() {
        assert!(version_at_least("1.21.10", "1.21.9"), "1.21.10 новее 1.21.9, хотя строкой меньше");
        assert!(version_below("1.21.9", "1.21.10"), "и обратное сравнение тоже численное");
    }
}
