//! Turning a crash into something the player can press.
//!
//! The verdict itself comes from `analyze_crash`. What this module adds is the
//! step after it: which jar in THIS build the loader named, how much memory the
//! build actually needs, which Java its game version wants — and a command that
//! performs exactly the one action offered, so a fix is never "try removing
//! mods until it starts".

use serde::Serialize;

use crate::engine::*;

/// One button under the crash message. `kind` is a closed set the core knows
/// how to perform; `arg` is its only parameter and is re-checked when applied.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrashAction {
    pub kind: String,
    pub label: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub arg: String,
    /// Why this is offered, in one line.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub hint: String,
}

impl CrashAction {
    fn new(kind: &str, label: String, arg: String, hint: &str) -> Self {
        Self { kind: kind.into(), label, arg, hint: hint.into() }
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrashDiag {
    pub profile: String,
    pub reason: String,
    pub tail: String,
    /// Files in mods/ the loader complained about.
    pub culprits: Vec<String>,
    pub actions: Vec<CrashAction>,
}

/// Java the game version needs. The mapping is Mojang's own: 1.20.5 moved to
/// 21, 1.17 moved to 17, everything older still runs on 8.
pub(crate) fn java_major_for(version: &str) -> u64 {
    let parts: Vec<&str> = version.split(['.', '-', ' ']).take(3).collect();
    let num = |i: usize| parts.get(i).and_then(|p| p.parse::<u32>().ok());
    // A snapshot ("25w05a") has no release number at all: it is always newer
    // than the last release, so it gets the current runtime.
    let (major, minor, patch) = match num(0) {
        Some(m) => (m, num(1).unwrap_or(0), num(2).unwrap_or(0)),
        None => return 21,
    };
    if major != 1 {
        return 21;
    }
    match (minor, patch) {
        (m, _) if m >= 21 => 21,
        (20, p) if p >= 5 => 21,
        (m, _) if m >= 17 => 17,
        _ => 8,
    }
}

/// Matches a name the loader printed against the jars actually in the build.
/// Loaders quote either the human title ("Sodium") or the mod id ("sodium"),
/// and neither is the file name — so both are compared, case-insensitively.
fn file_for_mod(profile: &str, name: &str) -> Option<String> {
    let want = name.trim().to_lowercase();
    if want.is_empty() {
        return None;
    }
    let metas = local_meta_map(profile, "mod");
    let hit = metas.values().find(|m| {
        m.mod_id.to_lowercase() == want
            || m.title.to_lowercase() == want
            || m.provides.iter().any(|p| p.to_lowercase() == want)
    });
    if let Some(m) = hit {
        return Some(m.file_name.clone());
    }
    // Falling back to the file name catches jars the metadata reader could not
    // open — usually the very ones that break the loader.
    let squashed: String = want.chars().filter(|c| c.is_alphanumeric()).collect();
    metas
        .keys()
        .find(|f| {
            let plain: String = f.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect();
            !squashed.is_empty() && plain.starts_with(&squashed)
        })
        .cloned()
}

fn profile_version(profile: &str) -> String {
    load_profiles().into_iter().find(|p| p.name == profile).map(|p| p.version).unwrap_or_default()
}

const DRIVER_LINKS: [(&str, &str); 3] = [
    ("nvidia", "https://www.nvidia.com/Download/index.aspx"),
    ("amd", "https://www.amd.com/en/support"),
    ("intel", "https://www.intel.com/content/www/us/en/download-center/home.html"),
];

fn driver_link(reason: &str) -> Option<(&'static str, &'static str)> {
    let low = reason.to_lowercase();
    DRIVER_LINKS.iter().find(|(vendor, _)| low.contains(vendor)).copied()
}

/// Builds the action list for a verdict. Ordered by how likely each one is to
/// be the actual fix, because the first button is the one that gets pressed.
pub fn diagnose(profile: &str, reason: &str, tail: &str, log_text: &str) -> CrashDiag {
    let low = reason.to_lowercase();
    let mut actions: Vec<CrashAction> = vec![];
    let mut culprits: Vec<String> = vec![];

    for fault in mod_faults(log_text) {
        if let Some(file) = file_for_mod(profile, &fault.name) {
            if culprits.contains(&file) {
                continue;
            }
            actions.push(CrashAction::new(
                "disable-mod",
                format!("Отключить «{}»", fault.name),
                file.clone(),
                if fault.wrong_version {
                    "Мод собран под другую версию игры"
                } else {
                    "Моду не хватает зависимости"
                },
            ));
            culprits.push(file);
        }
    }

    if low.contains("оператив") || low.contains("памяти") {
        let tuning = tune_profile(profile);
        actions.insert(
            0,
            CrashAction::new(
                "set-ram",
                format!("Выделить {} ГБ памяти", tuning.ram_mb / 1024),
                tuning.ram_mb.to_string(),
                &tuning.reasons.join(". "),
            ),
        );
    }

    if low.contains("java") && (low.contains("верси") || low.contains("нужна")) {
        let major = java_major_for(&profile_version(profile));
        actions.insert(
            0,
            CrashAction::new(
                "install-java",
                format!("Поставить Java {}", major),
                major.to_string(),
                "Версия игры требует именно её",
            ),
        );
    }

    if let Some((_, url)) = driver_link(reason) {
        actions.push(CrashAction::new("open-url", "Скачать драйвер".into(), url.into(), "Падение произошло внутри драйвера"));
    }

    if low.contains("антивирус") {
        actions.push(CrashAction::new(
            "open-folder",
            "Открыть папку сборки".into(),
            String::new(),
            "Добавь её в исключения антивируса",
        ));
    }

    // Repair is the fallback, not the first idea: it re-downloads the client and
    // the libraries, which fixes nothing when the problem is a mod or the heap.
    actions.push(CrashAction::new("repair", "Починить сборку".into(), String::new(), "Проверит и перекачает файлы игры"));
    actions.push(CrashAction::new("share-log", "Поделиться логом".into(), String::new(), "Ссылку можно отправить в поддержку"));

    CrashDiag { profile: profile.to_string(), reason: reason.to_string(), tail: tail.to_string(), culprits, actions }
}

/// Performs one offered action. The webview names the kind and passes the arg
/// back verbatim; both are validated here, because a crash dialog is exactly
/// the place where a stale payload would otherwise disable a random mod.
pub async fn apply_crash_fix(app: tauri::AppHandle, profile: String, kind: String, arg: String) -> Result<String, String> {
    match kind.as_str() {
        "disable-mod" => {
            let file = safe_file_name(&arg)?;
            toggle_content(&profile, "mod", &file, false)?;
            Ok(format!("Мод «{}» отключён", file))
        }
        "set-ram" => {
            let mb: u32 = arg.parse().map_err(|_| "Некорректный объём памяти".to_string())?;
            if !(512..=65536).contains(&mb) {
                return Err("Такой объём памяти лаунчер не выставит".into());
            }
            let mut patch = serde_json::Map::new();
            patch.insert("ramMb".into(), serde_json::json!(mb));
            merge_settings(&profile, patch);
            Ok(format!("Сборке выделено {} ГБ", mb / 1024))
        }
        "install-java" => {
            let major: u64 = arg.parse().map_err(|_| "Некорректная версия Java".to_string())?;
            let version = ensure_java_major(&app, major).await?;
            let mut patch = serde_json::Map::new();
            patch.insert("javaMajor".into(), serde_json::json!(major));
            patch.insert("javaPath".into(), serde_json::json!(""));
            merge_settings(&profile, patch);
            Ok(format!("Java {} готова", version))
        }
        _ => Err("Это действие лаунчер не выполняет".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// game version -> java major. A wrong answer here is offered to the player
    /// as a button that installs the wrong runtime and leaves the build broken.
    #[test]
    fn java_major_follows_the_game_version() {
        let cases: [(&str, u64, &str); 8] = [
            ("1.21.4", 21, "современные версии — Java 21"),
            ("1.20.6", 21, "1.20.5 перешла на 21"),
            ("1.20.4", 17, "до 1.20.5 хватает 17"),
            ("1.17", 17, "1.17 — первая на 17"),
            ("1.16.5", 8, "старые версии живут на 8"),
            ("1.12.2", 8, "самая популярная модовая версия"),
            ("1.8.9", 8, "PvP-версии"),
            ("25w05a", 21, "снапшот без 1.x читается как современный"),
        ];
        for (version, want, why) in cases {
            assert_eq!(
                java_major_for(version),
                want,
                "для {version} нужна Java {want}. Зачем случай закреплён: {why}",
            );
        }
    }

    /// The last two actions are the ones that always apply, so a verdict the
    /// analyser could not narrow down still gives the player something to do.
    #[test]
    fn every_crash_offers_a_fallback() {
        let diag = diagnose("Test", "Игра вылетела. Загляни в лог — там причина.", "", "");
        let kinds: Vec<&str> = diag.actions.iter().map(|a| a.kind.as_str()).collect();
        assert!(kinds.contains(&"repair") && kinds.contains(&"share-log"), "получили {kinds:?}");
    }

    #[test]
    fn memory_verdict_offers_memory_first() {
        let diag = diagnose("Test", "Не хватило оперативной памяти. Добавь ОЗУ в настройках сборки.", "", "");
        assert_eq!(
            diag.actions.first().map(|a| a.kind.as_str()),
            Some("set-ram"),
            "кнопка с памятью должна быть первой — иначе игрок нажмёт «Починить сборку», которая тут ничего не меняет",
        );
    }

    #[test]
    fn driver_verdict_links_the_right_vendor() {
        let diag = diagnose("Test", "Игра упала внутри драйвера видеокарты NVIDIA — сама игра тут ни при чём.", "", "");
        let link = diag.actions.iter().find(|a| a.kind == "open-url").map(|a| a.arg.clone());
        assert_eq!(link.as_deref(), Some("https://www.nvidia.com/Download/index.aspx"));
    }
}
