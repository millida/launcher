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
        for host in ["millida.net", "cdn.millida.net", "textures.minecraft.net"] {
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

fn quarantined(profile: &str) -> String {
    std::fs::read_to_string(quarantine_file(profile))
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
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
    if std::fs::write(&file, jar).is_err() {
        return false;
    }
    let _ = std::fs::remove_file(profile_dir(profile).join("mods").join(jar));
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

fn has_fabric_api(installed: &Installed) -> bool {
    installed.has(FABRIC_API_PROJECT, "Fabric API") || installed.has("fabric-api", "") || installed.has("fabric", "")
}

async fn ensure_fabric_api(app: &AppHandle, profile: &str) -> bool {
    if has_fabric_api(&installed_index(profile)) {
        return true;
    }
    let item = PlanItem { source: "modrinth".into(), project_id: FABRIC_API_PROJECT.into(), version_id: String::new() };
    let install = install_dep_items(app.clone(), profile.to_string(), "mod".into(), vec![item]);
    match tokio::time::timeout(FABRIC_API_WAIT, install).await {
        Ok(Ok(report)) => !report.installed.is_empty() && has_fabric_api(&installed_index(profile)),
        _ => false,
    }
}

/// The catalogue is out of reach or the new version did not download, while the
/// build already holds a working one: the game goes with it. Such a launch used
/// to lose the cosmetics and the token, and CustomSkinLoader was put in instead.
fn keep_installed(profile: &str, dir: &Path, nick: &str, licensed: bool) -> Option<String> {
    let jar = installed_jars(profile).into_iter().max_by_key(|j| version_key(j))?;
    if quarantined(profile) == jar {
        return None;
    }
    let loader = profile_of(profile)?.loader_id();
    if needs_fabric_api(&loader) && !has_fabric_api(&installed_index(profile)) {
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
        return Ok(None);
    }
    // Мод - часть сборки, а не дополнение к ней: на нём держатся скины, плащи и
    // косметика, за которую заплачено. Стёрли файл руками или снёс антивирус -
    // запуск ставит его заново, без вопросов.
    // Версия, уже уронившая эту сборку, повторно не ставится: иначе запуск
    // чинится только удалением сборки. Новая версия карантином не считается —
    // ради неё он и заведён.
    if quarantined(profile) == state.available {
        write_settings(&dir, licensed)?;
        place_local_skin(&dir, nick);
        drop_launcher_csl(&mods);
        return Ok(None);
    }
    // The Fabric jar declares a hard dependency on Fabric API: without it the
    // loader refuses the whole build before the game even opens.
    if needs_fabric_api(&state.loader) && !ensure_fabric_api(app, profile).await {
        remove_mod_from(profile);
        warn(
            app,
            "Косметике Millida нужен Fabric API, а поставить его не вышло. Сборка запустится без косметики - проверь интернет и запусти ещё раз",
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

    #[test]
    fn version_compare_is_numeric_not_alphabetical() {
        assert!(version_at_least("1.21.10", "1.21.9"), "1.21.10 новее 1.21.9, хотя строкой меньше");
        assert!(version_below("1.21.9", "1.21.10"), "и обратное сравнение тоже численное");
    }
}
