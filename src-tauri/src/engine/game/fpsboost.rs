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

/// Моды-ускорители по загрузчику. Slug'и Modrinth; ставится то, у чего есть
/// сборка под версию профиля, остальное пропускается — режим не должен
/// разваливаться из-за одного мода, отставшего от новой версии игры.
fn boost_mods(loader: &str) -> &'static [&'static str] {
    match loader {
        "fabric" | "quilt" => &[
            "sodium",
            "lithium",
            "ferrite-core",
            "entityculling",
            "immediatelyfast",
            "modernfix",
        ],
        "forge" | "neoforge" => &[
            "embeddium",
            "ferrite-core",
            "entityculling",
            "immediatelyfast",
            "modernfix",
        ],
        _ => &[],
    }
}

/// Стоит ли мод режима уже в сборке. Манифест хранит канонический id проекта,
/// а список режима задан slug'ами; старые манифесты (и офлайн-установка, где
/// каталог не ответил) держат в том же поле slug. Совпадение по любому из двух
/// имён значит «этот мод у игрока есть», и второй копии быть не должно.
fn already_installed(known: &[String], slug: &str, canonical: &str) -> bool {
    known.iter().any(|p| p == slug || p == canonical)
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
}

fn settings_of(profile: &str) -> Value {
    std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null)
}

fn str_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn profile_loader(profile: &str) -> String {
    load_profiles()
        .into_iter()
        .find(|p| p.name == profile)
        .map(|p| p.loader_id())
        .unwrap_or_else(|| "vanilla".into())
}

fn profile_version(profile: &str) -> String {
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
        vanilla: boost_mods(&loader).is_empty(),
    }
}

fn options_path(profile: &str) -> std::path::PathBuf {
    profile_dir(profile).join("options.txt")
}

fn read_options(profile: &str) -> Vec<(String, String)> {
    let raw = std::fs::read_to_string(options_path(profile)).unwrap_or_default();
    raw.lines()
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

fn write_options(profile: &str, rows: &[(String, String)]) -> Result<(), String> {
    let body: String = rows.iter().map(|(k, v)| format!("{}:{}\n", k, v)).collect();
    let dir = profile_dir(profile);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_bytes_atomic(&options_path(profile), body.as_bytes())
}

/// Правит только известные ключи и запоминает их прежние значения: выключение
/// режима возвращает ровно их, а не затирает всё, что игрок настроил после.
fn apply_tuning(rows: &mut Vec<(String, String)>) -> serde_json::Map<String, Value> {
    let mut previous = serde_json::Map::new();
    for (key, val) in VIDEO_TUNING {
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

fn undo_tuning(rows: &mut Vec<(String, String)>, previous: &Value) {
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

fn tune_video(profile: &str) -> Result<serde_json::Map<String, Value>, String> {
    let mut rows = read_options(profile);
    let previous = apply_tuning(&mut rows);
    write_options(profile, &rows)?;
    Ok(previous)
}

fn restore_video(profile: &str, previous: &Value) -> Result<(), String> {
    if !previous.is_object() {
        return Ok(());
    }
    let mut rows = read_options(profile);
    undo_tuning(&mut rows, previous);
    write_options(profile, &rows)
}

fn patch(profile: &str, entries: Vec<(&str, Value)>) {
    let mut m = serde_json::Map::new();
    for (k, v) in entries {
        m.insert(k.to_string(), v);
    }
    merge_settings(profile, m);
}

pub async fn set_fps_boost(app: AppHandle, profile: String, on: bool) -> Result<FpsBoostState, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    if on {
        enable(&app, &profile).await
    } else {
        disable(&profile)
    }
}

async fn enable(app: &AppHandle, profile: &str) -> Result<FpsBoostState, String> {
    let loader = profile_loader(profile);
    let version = profile_version(profile);
    let wanted = boost_mods(&loader);
    let loaders = modrinth_loaders(&loader, "mod");
    let known: Vec<String> = load_content_manifest(profile)
        .into_iter()
        .map(|e| e.project_id)
        .collect();

    let mut installed = str_list(&settings_of(profile)["fpsBoostMods"]);
    let mut skipped: Vec<String> = vec![];
    let total = wanted.len().max(1);
    for (i, slug) in wanted.iter().enumerate() {
        emit(app, "fpsboost", 10.0 + 70.0 * (i as f32 / total as f32), &format!("Ставим {}…", slug));
        // Мод уже стоит у игрока — режим его не дублирует и не снимет потом.
        // В манифесте лежит КАНОНИЧЕСКИЙ id Modrinth, а список режима — из
        // slug'ов: сравнение id со slug'ом не совпадало никогда, и поверх
        // Sodium игрока вставал второй Sodium. Fabric такой запуск не
        // переживает — «включаю буст FPS в связке с модами, игра вылетает».
        let canonical = fetch_project_meta(slug).await.0;
        if already_installed(&known, slug, &canonical) {
            continue;
        }
        let ver = match best_version(slug, &version, &loaders).await {
            Ok(v) => v,
            Err(_) => {
                skipped.push((*slug).to_string());
                continue;
            }
        };
        match install_project_version(profile, "mod", slug, &ver).await {
            Ok(file) => {
                for miss in resolve_deps(profile, &version, &loaders, &ver["dependencies"]).await {
                    warn(app, &format!("{}: нет зависимости {} под {}", slug, miss, version));
                }
                if !installed.contains(&file) {
                    installed.push(file);
                }
            }
            Err(e) => {
                warn(app, &format!("Мод {} не поставился: {}", slug, e));
                skipped.push((*slug).to_string());
            }
        }
    }

    emit(app, "fpsboost", 90.0, "Настройки графики…");
    let previous = tune_video(profile)?;
    patch(
        profile,
        vec![
            ("fpsBoost", Value::Bool(true)),
            ("fpsBoostMods", Value::Array(installed.iter().map(|f| Value::String(f.clone())).collect())),
            ("fpsBoostSkipped", Value::Array(skipped.iter().map(|f| Value::String(f.clone())).collect())),
            ("fpsBoostVideo", Value::Object(previous)),
        ],
    );
    emit(app, "fpsboost", 100.0, "Буст FPS включён");
    Ok(fps_boost_state(profile))
}

fn disable(profile: &str) -> Result<FpsBoostState, String> {
    let s = settings_of(profile);
    for file in str_list(&s["fpsBoostMods"]) {
        let _ = delete_content(profile, "mod", &file);
    }
    restore_video(profile, &s["fpsBoostVideo"])?;
    patch(
        profile,
        vec![
            ("fpsBoost", Value::Bool(false)),
            ("fpsBoostMods", Value::Array(vec![])),
            ("fpsBoostSkipped", Value::Array(vec![])),
            ("fpsBoostVideo", Value::Null),
        ],
    );
    Ok(fps_boost_state(profile))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Флаги режима проходят тот же фильтр, что и пользовательские: иначе часть
    /// профиля молча отсеялась бы на запуске.
    #[test]
    fn boost_flags_survive_the_jvm_filter() {
        for f in boost_flags() {
            assert!(
                jvm_arg_allowed(f),
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

        let previous = apply_tuning(&mut rows);
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

    #[test]
    fn mod_set_matches_loader() {
        assert!(boost_mods("fabric").contains(&"sodium"), "на Fabric ускоритель рендера — Sodium");
        assert!(boost_mods("quilt").contains(&"sodium"), "Quilt грузит Fabric-моды");
        assert!(boost_mods("forge").contains(&"embeddium"), "на Forge Sodium не грузится, нужен Embeddium");
        assert!(boost_mods("neoforge").contains(&"embeddium"), "NeoForge использует тот же порт Sodium");
        assert!(boost_mods("vanilla").is_empty(), "ванилла не умеет грузить моды — только JVM и графика");
    }
}
