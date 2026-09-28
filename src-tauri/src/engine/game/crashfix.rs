//! Turning a crash into something the player can press.
//!
//! The verdict itself comes from `analyze_crash`. What this module adds is the
//! step after it: which jar in THIS build the loader named, how much memory the
//! build actually needs, which Java its game version wants — and a command that
//! performs exactly the one action offered, so a fix is never "try removing
//! mods until it starts".

use serde::Serialize;

use crate::engine::*;
use super::launch::SYSTEM_MEMORY_REASON;

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
    /// Стабильный класс вылета для телеметрии: own_mod, skin_mod, missing_deps,
    /// wrong_mc, missing_renderer, mixin, conflict, api_mismatch, gpu, gpu_driver, amd_driver, gpu_fallback,
    /// oom, system_memory, java_version, jvm_fatal, auth_cert, no_log, unknown.
    pub kind: String,
    /// Первая осмысленная строка ошибки (≤300 символов), без домашней папки,
    /// имени сборки, ника и токенов.
    pub cause: String,
}

impl CrashDiag {
    pub fn classified(mut self, kind: &str, cause: String) -> Self {
        self.kind = kind.to_string();
        self.cause = cause;
        self
    }
}

/// Java the game version needs. The mapping is Mojang's own: 26.x (new
/// year-based numbering) moved to 25, 1.20.5 moved to 21, 1.17 moved to 17,
/// everything older still runs on 8.
pub(crate) fn java_major_for(version: &str) -> u64 {
    let parts: Vec<&str> = version.split(['.', '-', ' ']).take(3).collect();
    let num = |i: usize| parts.get(i).and_then(|p| p.parse::<u32>().ok());
    // Снапшот («25w05a», «26w14a») начинается с года: 26-й год — это уже
    // 26.x на Java 25, всё раньше — 1.21.x на Java 21.
    let lead: u32 = parts
        .first()
        .map(|p| p.chars().take_while(char::is_ascii_digit).collect::<String>())
        .and_then(|d| d.parse().ok())
        .unwrap_or(0);
    let (major, minor, patch) = match num(0) {
        Some(m) => (m, num(1).unwrap_or(0), num(2).unwrap_or(0)),
        None => return if lead >= 26 { 25 } else { 21 },
    };
    if major != 1 {
        return if major >= 26 { 25 } else { 21 };
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

pub(crate) const RENDERER_MISSING_REASON: &str = "Моду не хватает рендерера Fabric: так бывает, когда в сборке Sodium без мода Indium.";

const RENDERER_MISSING_MARKERS: [&str; 2] = ["no fabric renderer found", "fabric rendering api is not available"];

pub(crate) fn renderer_missing(low: &str) -> bool {
    RENDERER_MISSING_MARKERS.iter().any(|m| low.contains(m))
}

/// A mod the crash dialog may add on its own. The webview passes only the slug
/// back; the Modrinth project comes from this table, never from the payload.
pub(crate) struct Companion {
    pub slug: &'static str,
    pub project_id: &'static str,
    pub title: &'static str,
}

pub(crate) const COMPANIONS: [Companion; 1] = [Companion { slug: "indium", project_id: "Orvt0mRa", title: "Indium" }];

fn companion(slug: &str) -> Option<&'static Companion> {
    COMPANIONS.iter().find(|c| c.slug == slug)
}

/// Sodium implements the Fabric Rendering API itself since 0.6; older builds
/// switch Indigo off and leave FRAPI mods without a renderer unless Indium is
/// installed. Accepts both the jar version ("0.5.13+mc1.20.1") and the Modrinth
/// version number ("mc1.20.1-0.5.13-fabric").
pub(crate) fn sodium_lacks_frapi(version: &str) -> bool {
    let v = version.trim().to_lowercase();
    let core = match v.strip_prefix("mc") {
        Some(rest) => rest.split_once('-').map(|(_, r)| r).unwrap_or(""),
        None => v.as_str(),
    };
    let mut parts = core.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty());
    let major: u32 = match parts.next().and_then(|p| p.parse().ok()) {
        Some(n) => n,
        None => return false,
    };
    let minor: u32 = parts.next().and_then(|p| p.parse().ok()).unwrap_or(0);
    major == 0 && minor < 6
}

fn renderer_companion(profile: &str) -> Option<&'static Companion> {
    let metas = local_meta_map(profile, "mod");
    if metas.values().any(|m| m.mod_id.eq_ignore_ascii_case("indium")) {
        return None;
    }
    let sodium = metas.values().find(|m| m.mod_id.eq_ignore_ascii_case("sodium"));
    match sodium {
        Some(m) if !sodium_lacks_frapi(&m.version) => None,
        _ => companion("indium"),
    }
}

/// Builds the action list for a verdict. Ordered by how likely each one is to
/// be the actual fix, because the first button is the one that gets pressed.
pub fn diagnose(profile: &str, reason: &str, tail: &str, log_text: &str) -> CrashDiag {
    let low = reason.to_lowercase();
    let mut actions: Vec<CrashAction> = vec![];
    let mut culprits: Vec<String> = vec![];

    for fault in mod_faults(log_text) {
        // Наш мод лаунчер убирает сам (карантин) — кнопка на него лишняя.
        if fault.name.eq_ignore_ascii_case("millida") {
            continue;
        }
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

    // A loader that stopped on unmet requirements does not need a file check —
    // it needs the missing jars fetched. "Починить сборку" only re-verifies what
    // is already installed, so it answered this verdict by downloading nothing.
    if low.contains("зависимост") {
        actions.insert(
            0,
            CrashAction::new(
                "install-deps",
                "Доустановить зависимости".into(),
                String::new(),
                "Найдём недостающие моды и поставим их",
            ),
        );
    }

    if renderer_missing(&log_text.to_lowercase()) {
        if let Some(c) = renderer_companion(profile) {
            actions.insert(
                0,
                CrashAction::new(
                    "add-mod",
                    format!("Поставить {}", c.title),
                    c.slug.into(),
                    "Даст модам рендерер Fabric, которого нет у Sodium этой версии",
                ),
            );
        }
    }

    if (low.contains("оператив") || low.contains("памяти")) && reason != SYSTEM_MEMORY_REASON {
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

    CrashDiag {
        profile: profile.to_string(),
        reason: reason.to_string(),
        tail: tail.to_string(),
        culprits,
        actions,
        kind: "unknown".into(),
        cause: String::new(),
    }
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
        "install-deps" => {
            let audit = audit_deps(profile.clone()).await?;
            let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
            let items: Vec<PlanItem> = audit
                .issues
                .iter()
                .filter_map(|i| i.fix.as_ref())
                .filter(|f| seen.insert(f.project_id.clone()))
                .map(|f| PlanItem {
                    source: f.source.clone(),
                    project_id: f.project_id.clone(),
                    version_id: f.version_id.clone(),
                })
                .collect();
            if items.is_empty() {
                let stuck: Vec<&str> = audit
                    .issues
                    .iter()
                    .filter(|i| i.kind == "missing")
                    .map(|i| i.detail.as_str())
                    .collect();
                return Err(if stuck.is_empty() {
                    "Недостающих зависимостей в сборке не нашли — причина вылета в другом, посмотри лог".into()
                } else {
                    format!(
                        "В каталогах нет того, что требуют моды ({}). Скачай их вручную или убери моды, которые их просят.",
                        stuck.join("; ")
                    )
                });
            }
            let want = items.len();
            let report = install_dep_items(app, profile, "mod".into(), items).await?;
            if !report.failed.is_empty() {
                return Err(format!(
                    "Поставили {} из {}, не встало: {}. Попробуй ещё раз или поставь их вручную.",
                    report.installed.len(),
                    want,
                    report.failed.join("; ")
                ));
            }
            Ok(format!("Доустановлено модов: {}. Запусти игру ещё раз.", report.installed.len()))
        }
        "add-mod" => {
            let c = companion(&arg).ok_or_else(|| "Этот мод лаунчер сам не ставит".to_string())?;
            let item = PlanItem { source: "modrinth".into(), project_id: c.project_id.into(), version_id: String::new() };
            let report = install_dep_items(app, profile.clone(), "mod".into(), vec![item]).await?;
            if report.installed.is_empty() {
                return Err(if report.failed.is_empty() {
                    format!("{} для версии этой сборки не нашёлся. Убери мод, который требует рендерер, или смени Sodium.", c.title)
                } else {
                    format!("{} не встал: {}. Попробуй ещё раз.", c.title, report.failed.join("; "))
                });
            }
            let prof = profile.clone();
            let present = tauri::async_runtime::spawn_blocking(move || scan_local_meta(&prof, "mod", false))
                .await
                .map_err(|e| e.to_string())?
                .iter()
                .any(|m| m.mod_id.eq_ignore_ascii_case(c.slug));
            if !present {
                return Err(format!("{} скачался, но загрузчик его не видит — поставь его вручную из каталога", c.title));
            }
            Ok(format!("{} установлен. Запусти игру ещё раз.", c.title))
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
        let cases: [(&str, u64, &str); 11] = [
            ("26.3", 25, "новая нумерация 26.x требует Java 25"),
            ("26.1.2", 25, "любая 26.x — Java 25"),
            ("26w14a", 25, "снапшот 26-го года — уже 26.x"),
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

    /// Sodium version -> whether FRAPI mods need Indium next to it. A wrong
    /// "yes" installs Indium over Sodium 0.6, which refuses to load with it.
    #[test]
    fn sodium_versions_without_frapi_need_indium() {
        let cases: [(&str, bool, &str); 8] = [
            ("0.5.13+mc1.20.1", true, "Sodium для 1.20.1 из жалобы владельца"),
            ("mc1.20.1-0.5.13-fabric", true, "номер версии на Modrinth"),
            ("mc1.20.4-0.5.8", true, "1.20.4 тоже на 0.5"),
            ("0.4.10+build.27", true, "старые 1.19"),
            ("0.6.0+mc1.21.1", false, "0.6 реализует FRAPI сама"),
            ("mc1.21.1-0.8.13-fabric", false, "новые ветки не трогаем"),
            ("1.0.0", false, "гипотетическая 1.x"),
            ("", false, "версию не прочли — Indium не навязываем"),
        ];
        for (version, want, why) in cases {
            assert_eq!(sodium_lacks_frapi(version), want, "Sodium {version}: {why}");
        }
    }

    /// log line -> verdict -> repair action. The renderer crash used to fall
    /// into "загляни в лог" with only a file re-check to offer.
    #[test]
    fn renderer_crash_offers_indium() {
        let cases: [(&str, &str, Option<&str>, &str); 3] = [
            (
                "Caused by: java.lang.NullPointerException: No fabric renderer found
	at net.mehvahdjukaar.supplementaries.common.utils.fabric.VibeCheckerImpl.vibeCheckModels(VibeCheckerImpl.java:131)",
                "missing_renderer",
                Some("indium"),
                "Supplementaries с Sodium 0.5 без Indium",
            ),
            (
                "[main/ERROR]: Fabric Rendering API is not available",
                "missing_renderer",
                Some("indium"),
                "другая формулировка того же отказа",
            ),
            ("java.lang.NullPointerException: Cannot invoke \"Object.toString()\"", "unknown", None, "обычный NPE Indium не лечит"),
        ];
        for (log, kind, action, why) in cases {
            let v = super::super::launch::crash_verdict(log);
            assert_eq!(v.kind, kind, "класс вылета: {why}");
            let diag = diagnose("Test-no-such-profile", &v.reason, "", log);
            let got = diag.actions.iter().find(|a| a.kind == "add-mod").map(|a| a.arg.as_str());
            assert_eq!(got, action, "действие ремонта: {why}");
            if action.is_some() {
                assert_eq!(diag.actions.first().map(|a| a.kind.as_str()), Some("add-mod"), "Indium должен быть главной кнопкой: {why}");
            }
        }
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
