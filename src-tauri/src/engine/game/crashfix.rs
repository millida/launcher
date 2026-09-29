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
use super::crashcause::{is_platform_id, loader_findings, LoaderFinding, ModRef};

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
    /// What «Починить сборку» will do, step by step, for the `fix-plan` action.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<String>,
    /// Whether «Починить сборку» performs this action as part of its plan. An
    /// alternative to another step (disable instead of update) stays a button.
    #[serde(skip)]
    in_plan: bool,
}

/// Actions that change the mod set of the build — the ones a repair plan is
/// made of. Anything else (memory, Java, a link) is its own button.
const PLAN_KINDS: [&str; 5] = ["add-mod", "install-deps", "install-dep", "set-mod-version", "disable-mod"];

const PLAN_MAX_STEPS: usize = 16;

impl CrashAction {
    fn new(kind: &str, label: String, arg: String, hint: &str) -> Self {
        Self { kind: kind.into(), label, arg, hint: hint.into(), steps: vec![], in_plan: PLAN_KINDS.contains(&kind) }
    }

    fn alternative(mut self) -> Self {
        self.in_plan = false;
        self
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
    /// wrong_mc, old_loader, wrong_loader, missing_renderer, mixin, conflict, api_mismatch, gpu, gpu_driver, amd_driver, gpu_fallback,
    /// oom, system_memory, java_version, jvm_fatal, auth_cert, no_log, unknown.
    pub kind: String,
    /// Первая осмысленная строка ошибки (≤300 символов), без домашней папки,
    /// имени сборки, ника и токенов.
    pub cause: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_file: Option<String>,
}

impl CrashDiag {
    pub fn classified(mut self, kind: &str, cause: String) -> Self {
        self.kind = kind.to_string();
        self.cause = cause;
        self
    }

    pub fn with_log_file(mut self, log_file: Option<String>) -> Self {
        self.log_file = log_file;
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

/// Files of the build that came from Modrinth or CurseForge: only those can
/// be switched to another version of the same mod.
fn sourced_files(profile: &str) -> Vec<String> {
    load_content_manifest(profile)
        .into_iter()
        .filter(|e| e.kind == "mod" && !e.project_id.is_empty())
        .map(|e| e.file_name)
        .collect()
}

fn is_own(m: &ModRef) -> bool {
    m.id.eq_ignore_ascii_case("millida") || m.name.eq_ignore_ascii_case("millida")
}

/// Loaders need a newer build of themselves; no mod download fixes that.
pub(crate) fn is_loader_id(id: &str) -> bool {
    is_platform_id(id) && !matches!(id, "minecraft" | "java")
}

type FileOf<'a> = &'a dyn Fn(&str) -> Option<String>;
type HasSource<'a> = &'a dyn Fn(&str) -> bool;

fn file_of_ref(file_of: FileOf, m: &ModRef) -> Option<String> {
    file_of(m.name.as_str()).or_else(|| file_of(m.id.as_str()))
}

fn add_action(out: &mut Vec<(CrashAction, Option<String>)>, a: CrashAction, file: Option<String>) {
    if !out.iter().any(|(x, _)| x.kind == a.kind && x.arg == a.arg) {
        out.push((a, file));
    }
}

/// What to do about each thing the loader refused, most direct fix first:
/// fetch a missing dependency in the version asked for, move a mod to the
/// version the build needs, and only when that is impossible switch it off.
/// Returns each action with the jar it is about, when there is one.
fn finding_actions(findings: &[LoaderFinding], file_of: FileOf, has_source: HasSource) -> Vec<(CrashAction, Option<String>)> {
    let mut out: Vec<(CrashAction, Option<String>)> = vec![];
    for f in findings {
        match f {
            LoaderFinding::Requires { by, dep, range, present } => {
                if is_own(by) || dep.id == "java" {
                    continue;
                }
                let by_file = file_of_ref(file_of, by);
                if is_platform_id(&dep.id) {
                    let Some(file) = by_file else { continue };
                    if !is_loader_id(&dep.id) && has_source(file.as_str()) {
                        add_action(
                            &mut out,
                            CrashAction::new(
                                "set-mod-version",
                                format!("Сменить версию «{}»", by.name),
                                format!("{}|*", file),
                                "Поставим версию мода под игру этой сборки",
                            ),
                            Some(file.clone()),
                        );
                        add_action(
                            &mut out,
                            CrashAction::new("disable-mod", format!("Отключить «{}»", by.name), file.clone(), "Мод собран под другую версию игры")
                                .alternative(),
                            Some(file),
                        );
                    } else {
                        let why = if is_loader_id(&dep.id) { "Моду нужен загрузчик новее, чем в сборке" } else { "Мод собран под другую версию игры" };
                        add_action(&mut out, CrashAction::new("disable-mod", format!("Отключить «{}»", by.name), file.clone(), why), Some(file));
                    }
                    continue;
                }
                match present {
                    None => add_action(
                        &mut out,
                        CrashAction::new(
                            "install-dep",
                            format!("Поставить «{}»", dep.name),
                            format!("{}|{}", dep.id, range),
                            &format!("Нужен моду «{}»", by.name),
                        ),
                        None,
                    ),
                    Some(have) => {
                        let dep_file = file_of_ref(file_of, dep).filter(|f| has_source(f.as_str()));
                        match (dep_file, by_file) {
                            (Some(file), _) => add_action(
                                &mut out,
                                CrashAction::new(
                                    "set-mod-version",
                                    format!("Сменить версию «{}»", dep.name),
                                    format!("{}|{}", file, range),
                                    &format!("«{}» нужна версия {}, а стоит {}", by.name, range, have),
                                ),
                                Some(file),
                            ),
                            (None, Some(file)) => add_action(
                                &mut out,
                                CrashAction::new(
                                    "disable-mod",
                                    format!("Отключить «{}»", by.name),
                                    file.clone(),
                                    &format!("Ему нужна другая версия «{}»", dep.name),
                                ),
                                Some(file),
                            ),
                            (None, None) => {}
                        }
                    }
                }
            }
            LoaderFinding::Incompatible { by, other } => {
                if is_own(other) {
                    continue;
                }
                if let Some(file) = file_of_ref(file_of, other) {
                    add_action(
                        &mut out,
                        CrashAction::new("disable-mod", format!("Отключить «{}»", other.name), file.clone(), &format!("Несовместим с «{}»", by.name)),
                        Some(file),
                    );
                }
            }
            LoaderFinding::MixinFailed { by } => {
                if is_own(by) {
                    continue;
                }
                let Some(file) = file_of_ref(file_of, by) else { continue };
                let off = CrashAction::new("disable-mod", format!("Отключить «{}»", by.name), file.clone(), "Мод не подошёл к игре или соседним модам");
                if has_source(file.as_str()) {
                    add_action(
                        &mut out,
                        CrashAction::new(
                            "set-mod-version",
                            format!("Обновить «{}»", by.name),
                            format!("{}|*", file),
                            "Поставим его последнюю версию под эту сборку",
                        ),
                        Some(file.clone()),
                    );
                    add_action(&mut out, off.alternative(), Some(file));
                } else {
                    add_action(&mut out, off, Some(file));
                }
            }
            LoaderFinding::WrongLoader { file, loader } => {
                let why = format!("Это мод для {}", loader);
                if has_source(file.as_str()) {
                    add_action(
                        &mut out,
                        CrashAction::new("set-mod-version", format!("Заменить «{}»", file), format!("{}|*", file), "Поставим его версию под загрузчик сборки"),
                        Some(file.clone()),
                    );
                    add_action(&mut out, CrashAction::new("disable-mod", format!("Отключить «{}»", file), file.clone(), &why).alternative(), Some(file.clone()));
                } else {
                    add_action(&mut out, CrashAction::new("disable-mod", format!("Отключить «{}»", file), file.clone(), &why), Some(file.clone()));
                }
            }
            LoaderFinding::Duplicate { id, files } => {
                let Some(kept) = file_of(id.as_str()).filter(|k| files.contains(k)).or_else(|| files.last().cloned()) else { continue };
                for extra in files.iter().filter(|f| **f != kept) {
                    add_action(
                        &mut out,
                        CrashAction::new(
                            "disable-mod",
                            format!("Отключить дубль «{}»", extra),
                            extra.clone(),
                            &format!("Второй файл «{}» — останется {}", id, kept),
                        ),
                        Some(extra.clone()),
                    );
                }
            }
        }
    }
    out
}

/// The single action «Починить сборку» performs: every mod-set change of the
/// verdict, in the order they are listed, shown to the player before it runs.
/// The steps travel as their own kind/arg pairs, and each is checked again on
/// the way back exactly as if its own button had been pressed.
fn fix_plan(actions: &[CrashAction]) -> Option<CrashAction> {
    let steps: Vec<&CrashAction> = actions.iter().filter(|a| a.in_plan).take(PLAN_MAX_STEPS).collect();
    if steps.is_empty() {
        return None;
    }
    let pairs: Vec<(&str, &str)> = steps.iter().map(|a| (a.kind.as_str(), a.arg.as_str())).collect();
    let arg = serde_json::to_string(&pairs).ok()?;
    let mut plan = CrashAction::new("fix-plan", "Починить сборку".into(), arg, "");
    plan.steps = steps.iter().map(|a| a.label.clone()).collect();
    plan.in_plan = false;
    Some(plan)
}

/// Builds the action list for a verdict. Ordered by how likely each one is to
/// be the actual fix, because the first button is the one that gets pressed.
pub fn diagnose(profile: &str, reason: &str, tail: &str, log_text: &str) -> CrashDiag {
    let low = reason.to_lowercase();
    let mut actions: Vec<CrashAction> = vec![];
    let mut culprits: Vec<String> = vec![];

    let sourced = sourced_files(profile);
    let found = finding_actions(&loader_findings(log_text), &|name: &str| file_for_mod(profile, name), &|file: &str| {
        sourced.iter().any(|f| f == file)
    });
    for (action, culprit) in found {
        if let Some(file) = culprit {
            if !culprits.contains(&file) {
                culprits.push(file);
            }
        }
        actions.push(action);
    }

    // A loader that stopped on unmet requirements does not need a file check —
    // it needs the missing jars fetched. "Починить сборку" only re-verifies what
    // is already installed, so it answered this verdict by downloading nothing.
    // The audit is the fallback for a log that did not say what exactly is missing.
    if low.contains("зависимост") && !actions.iter().any(|a| a.kind == "install-dep") {
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
    if let Some(plan) = fix_plan(&actions) {
        actions.push(plan);
    }
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
        log_file: None,
    }
}

/// Performs one offered action. The webview names the kind and passes the arg
/// back verbatim; both are validated here, because a crash dialog is exactly
/// the place where a stale payload would otherwise disable a random mod.
pub async fn apply_crash_fix(app: tauri::AppHandle, profile: String, kind: String, arg: String) -> Result<String, String> {
    if kind != "fix-plan" {
        return apply_step(app, profile, kind, arg).await;
    }
    let steps = plan_steps(&arg)?;
    let mut done: Vec<String> = vec![];
    let mut failed: Vec<String> = vec![];
    for (kind, arg) in steps {
        match apply_step(app.clone(), profile.clone(), kind, arg).await {
            Ok(msg) => done.push(msg.trim_end_matches(" Запусти игру ещё раз.").trim_end_matches('.').to_string()),
            Err(e) => failed.push(e),
        }
    }
    if failed.is_empty() {
        return Ok(format!("{}. Запусти игру ещё раз.", done.join("; ")));
    }
    Err(if done.is_empty() {
        failed.join(". ")
    } else {
        format!("Сделано: {}. Не вышло: {}", done.join("; "), failed.join("; "))
    })
}

/// The steps of a plan exactly as `fix_plan` wrote them, and nothing else: a
/// kind outside the mod-set changes or an oversized list is refused whole.
fn plan_steps(arg: &str) -> Result<Vec<(String, String)>, String> {
    let steps: Vec<(String, String)> = serde_json::from_str(arg).map_err(|_| "Некорректный план починки".to_string())?;
    if steps.is_empty() || steps.len() > PLAN_MAX_STEPS || steps.iter().any(|(k, _)| !PLAN_KINDS.contains(&k.as_str())) {
        return Err("Некорректный план починки".into());
    }
    Ok(steps)
}

/// A mod id as loaders print it, and a version range in predicate syntax.
/// Both came back from the webview and go into a catalogue lookup.
fn dep_arg(arg: &str) -> Result<(String, String), String> {
    let (id, range) = arg.split_once('|').ok_or("Некорректная зависимость")?;
    let id_ok = !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-' | b'.'));
    let range_ok = !range.is_empty()
        && range.len() <= 80
        && range.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'+' | b'_' | b' ' | b'<' | b'>' | b'=' | b'*'));
    if !id_ok || !range_ok || id.starts_with('.') {
        return Err("Некорректная зависимость".into());
    }
    Ok((id.to_string(), range.to_string()))
}

async fn apply_step(app: tauri::AppHandle, profile: String, kind: String, arg: String) -> Result<String, String> {
    match kind.as_str() {
        "install-dep" => {
            let (id, range) = dep_arg(&arg)?;
            let ctx = ctx_of(&profile, "mod");
            let project = bridged_project(&ctx, catalog_slug(&id)).to_string();
            let version_id = version_for_dependency(&ctx, &project, &range)
                .await
                .map_err(|e| format!("«{}»: {} — поставь его вручную из каталога или отключи мод, который его просит", id, e))?;
            let item = PlanItem { source: "modrinth".into(), project_id: project, version_id };
            let report = install_dep_items(app, profile, "mod".into(), vec![item]).await?;
            if report.installed.is_empty() {
                return Err(format!("«{}» не встал: {}", id, report.failed.join("; ")));
            }
            if !report.failed.is_empty() {
                return Err(format!("«{}» поставлен, но не встали его зависимости: {}", id, report.failed.join("; ")));
            }
            Ok(format!("Поставлен {}", report.installed.join(", ")))
        }
        "set-mod-version" => {
            let (file, range) = arg.split_once('|').ok_or("Некорректный мод")?;
            let file = safe_file_name(file)?;
            let (_, range) = dep_arg(&format!("x|{}", range))?;
            let installed = set_content_version_in_range(&profile, "mod", &file, &range).await?;
            Ok(format!("Вместо {} стоит {}", file, installed))
        }
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

    /// log -> what «Починить сборку» does, for a build with Sodium from
    /// Modrinth, a hand-dropped OptiFabric and two JEI jars. Each case is a
    /// crash the old repair answered by re-hashing files or by switching the
    /// requiring mod off instead of fetching what it asked for.
    #[test]
    fn a_loader_refusal_turns_into_a_repair_plan() {
        let files = |name: &str| -> Option<String> {
            match name.to_lowercase().as_str() {
                "sodium" => Some("sodium-fabric-0.5.3.jar".into()),
                "iris" => Some("iris-1.7.0.jar".into()),
                "optifabric" => Some("optifabric-1.13.0.jar".into()),
                "walkers" => Some("walkers-1.0.jar".into()),
                "jei" => Some("jei-1.20.1-forge-15.3.0.4.jar".into()),
                _ => None,
            }
        };
        let sourced = |file: &str| file == "sodium-fabric-0.5.3.jar" || file == "walkers-1.0.jar";
        #[allow(clippy::type_complexity)]
        let cases: Vec<(&str, &str, Vec<(&str, &str)>)> = vec![
            (
                "Fabric: нет зависимости — ставится она, а не отключается мод",
                "\t - Mod 'Mod Menu' (modmenu) 7.2.2 requires version 0.92.0 or later of fabric-api, which is missing!",
                vec![("install-dep", "fabric-api|>=0.92.0")],
            ),
            (
                "Fabric: зависимость не той версии — меняется версия зависимости",
                "\t - Mod 'Iris' (iris) 1.7.0 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!",
                vec![("set-mod-version", "sodium-fabric-0.5.3.jar|>=0.5.8")],
            ),
            (
                "Fabric: несовместимый мод отключается",
                "\t - Mod 'Iris' (iris) 1.7.0 is incompatible with any version of mod 'OptiFabric' (optifabric), yet a conflicting version is present: 1.13.0!",
                vec![("disable-mod", "optifabric-1.13.0.jar")],
            ),
            (
                "Forge: мод под другую версию игры с источником — ставится версия под игру",
                "\tMod ID: 'minecraft', Requested by: 'walkers', Expected range: '[1.20.4,)', Actual version: '1.20.1'\n\tMod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'",
                vec![("set-mod-version", "walkers-1.0.jar|*"), ("install-dep", "craftedcore|>=5.8.1")],
            ),
            (
                "мод без источника под чужой загрузчик — только отключение",
                "\t - Mod 'Iris' (iris) 1.7.0 requires version 0.16.0 or later of fabricloader, but only the wrong version is present: 0.14.21!",
                vec![("disable-mod", "iris-1.7.0.jar")],
            ),
            (
                "Forge: дубль — остаётся файл, который знает сборка",
                "\tMod ID: 'jei' from mod files: jei-1.20.1-forge-15.2.0.27.jar, jei-1.20.1-forge-15.3.0.4.jar",
                vec![("disable-mod", "jei-1.20.1-forge-15.2.0.27.jar")],
            ),
            (
                "миксин мода с источником — обновление, отключение остаётся кнопкой",
                "[main/ERROR]: Mixin apply for mod sodium failed sodium.mixins.json:WorldRendererMixin from mod sodium",
                vec![("set-mod-version", "sodium-fabric-0.5.3.jar|*")],
            ),
            (
                "наш мод убирается карантином, починка его не трогает",
                "\t - Mod 'Millida' (millida) 0.1.11 requires any version of fabric-api, which is missing!",
                vec![],
            ),
        ];
        for (why, log, want) in cases {
            let actions: Vec<CrashAction> = finding_actions(&loader_findings(log), &files, &sourced).into_iter().map(|(a, _)| a).collect();
            let got: Vec<(String, String)> = actions.iter().filter(|a| a.in_plan).map(|a| (a.kind.clone(), a.arg.clone())).collect();
            let want: Vec<(String, String)> = want.iter().map(|(k, a)| (k.to_string(), a.to_string())).collect();
            assert_eq!(got, want, "{}", why);
            if let Some(plan) = fix_plan(&actions) {
                let steps = plan_steps(&plan.arg).expect("план, собранный ядром, обязан пройти собственную проверку");
                assert_eq!(steps, want, "{}: план — это шаги в том же порядке", why);
                assert_eq!(plan.steps.len(), want.len(), "{}: игрок видит каждый шаг", why);
            } else {
                assert!(want.is_empty(), "{}: шаги есть, а плана нет", why);
            }
        }
    }

    /// arg -> accepted. A plan comes back from the webview; only mod-set
    /// changes the core itself would have listed may run from it.
    #[test]
    fn a_plan_from_the_webview_is_checked_step_by_step() {
        let cases: [(&str, bool, &str); 5] = [
            (r#"[["install-dep","fabric-api|*"],["disable-mod","a.jar"]]"#, true, "обычный план"),
            (r#"[["set-ram","65536"]]"#, false, "память — не шаг починки модов"),
            (r#"[["install-java","8"]]"#, false, "Java — отдельная кнопка"),
            ("[]", false, "пустой план"),
            ("not json", false, "мусор"),
        ];
        for (arg, ok, why) in cases {
            assert_eq!(plan_steps(arg).is_ok(), ok, "{}", why);
        }
        let deps: [(&str, bool, &str); 5] = [
            ("fabric-api|>=0.92.0", true, "id и диапазон"),
            ("craftedcore|>=5.8.1 <6", true, "полуинтервал"),
            ("../x|*", false, "путь вместо id"),
            ("Fabric API|*", false, "заголовок вместо id"),
            ("jei|>=1;rm", false, "лишние символы в диапазоне"),
        ];
        for (arg, ok, why) in deps {
            assert_eq!(dep_arg(arg).is_ok(), ok, "{}: {}", arg, why);
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
