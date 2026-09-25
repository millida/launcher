use super::gameserver::track_server_hop;
use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Running games: profile name -> JVM process pid.
pub static RUNNING: Mutex<Vec<(String, u32)>> = Mutex::new(Vec::new());

const EXIT_POLL: std::time::Duration = std::time::Duration::from_secs(2);
const PLAYTIME_FLUSH: std::time::Duration = std::time::Duration::from_secs(60);
/// Сколько секунд сессии считается доказательством, что сборка открылась.
/// Полторы минуты — это дальше загрузки модов и окна входа; всё, что короче,
/// одинаково похоже и на запуск, и на вылет на середине загрузки.
const LAUNCH_CHECK_ALIVE: u64 = 90;

/// Pids killed on user request: a non-zero exit code for them is not a crash.
static STOPPED: Mutex<Vec<u32>> = Mutex::new(Vec::new());

fn was_stopped(pid: u32) -> bool {
    if let Ok(mut v) = STOPPED.lock() {
        if let Some(i) = v.iter().position(|id| *id == pid) {
            v.remove(i);
            return true;
        }
    }
    false
}

pub fn running_games() -> Vec<String> {
    RUNNING.lock().map(|v| v.iter().map(|(p, _)| p.clone()).collect()).unwrap_or_default()
}

fn forget_running(pid: u32) {
    if let Ok(mut v) = RUNNING.lock() {
        v.retain(|(_, id)| *id != pid);
    }
}

/// Windows needs taskkill /T to take down the whole JVM process tree; elsewhere
/// SIGTERM lets the game save the world before exiting.
pub fn stop_game(profile: Option<&str>) -> Result<(), String> {
    let pids: Vec<u32> = RUNNING
        .lock()
        .map(|v| {
            v.iter()
                .filter(|(p, _)| profile.map(|f| f == p).unwrap_or(true))
                .map(|(_, id)| *id)
                .collect()
        })
        .unwrap_or_default();
    if pids.is_empty() {
        return Err("Запущенной игры нет".into());
    }
    for pid in pids {
        if let Ok(mut v) = STOPPED.lock() {
            v.push(pid);
        }
        #[cfg(windows)]
        {
            let mut cmd = Command::new("taskkill");
            quiet(&mut cmd);
            cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
            cmd.status().map_err(|e| e.to_string())?;
        }
        #[cfg(not(windows))]
        {
            let mut cmd = Command::new("kill");
            cmd.args(["-TERM", &pid.to_string()]);
            cmd.status().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Evidence older than the launch belongs to an earlier run. Reading it as the
/// reason THIS run died is how a week-old crash report kept taking a mod out of
/// a build that had nothing to do with the crash.
const EVIDENCE_SLACK: std::time::Duration = std::time::Duration::from_secs(30);

fn is_fresh(path: &Path, since: std::time::SystemTime) -> bool {
    let cutoff = since.checked_sub(EVIDENCE_SLACK).unwrap_or(since);
    std::fs::metadata(path)
        .and_then(|md| md.modified())
        .map(|mt| mt >= cutoff)
        .unwrap_or(false)
}

/// Game logs are not required to be UTF-8: on a Russian Windows the JVM prints
/// in the console code page, and strict decoding threw the whole file away —
/// the crash dialog then had nothing to name a culprit from.
pub(crate) fn decode_log_bytes(raw: &[u8]) -> String {
    match std::str::from_utf8(raw) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::WINDOWS_1251.decode(raw).0.into_owned(),
    }
}

fn read_log_file(path: &Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| decode_log_bytes(&b))
}

fn read_fresh(path: &Path, since: std::time::SystemTime) -> Option<String> {
    is_fresh(path, since).then(|| read_log_file(path))?
}

fn newest_fresh_in(dir: &Path, since: std::time::SystemTime, name_starts: &str) -> Option<PathBuf> {
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        if !e.file_name().to_string_lossy().starts_with(name_starts) {
            continue;
        }
        let p = e.path();
        if !is_fresh(&p, since) {
            continue;
        }
        let mt = e.metadata().and_then(|md| md.modified()).unwrap_or(std::time::UNIX_EPOCH);
        if newest.as_ref().map(|(_, t)| mt > *t).unwrap_or(true) {
            newest = Some((p, mt));
        }
    }
    newest.map(|(p, _)| p)
}

fn newest_crash_report(game_dir: &Path, since: std::time::SystemTime) -> Option<PathBuf> {
    newest_fresh_in(&game_dir.join("crash-reports"), since, "")
}

/// A JVM that dies inside a native library (video driver, LWJGL) writes no crash
/// report and no last log line — the only trace is hs_err_pid<pid>.log next to
/// the game. Without it such a launch looks like "no evidence at all" and any
/// unrelated keyword in an old log becomes the verdict.
fn native_crash_log(game_dir: &Path, since: std::time::SystemTime) -> Option<String> {
    let p = newest_fresh_in(game_dir, since, "hs_err_pid")?;
    read_log_file(&p).map(|text| fatal_error_report(&text).to_string())
}

const HS_ERR_PROCESS_SECTION: &str = "---------------  P R O C E S S  ---------------";

fn fatal_error_report(text: &str) -> &str {
    text.find(HS_ERR_PROCESS_SECTION).map_or(text, |i| &text[..i])
}

/// Captured stdout plus the game's own latest.log, the newest crash report and a
/// JVM fatal-error log — all of them only if written by THIS launch. Fabric and
/// Quilt report mod resolution and mixin failures only in latest.log.
pub(crate) fn crash_text(game_dir: &Path, since: std::time::SystemTime) -> String {
    let mut text = read_fresh(&game_dir.join("logs/launcher-latest.log"), since).unwrap_or_default();
    for extra in [
        read_fresh(&game_dir.join("logs/latest.log"), since),
        newest_crash_report(game_dir, since).and_then(|p| read_log_file(&p)),
        native_crash_log(game_dir, since),
    ]
    .into_iter()
    .flatten()
    {
        text.push('\n');
        text.push_str(&extra);
    }
    text
}

/// Frame the JVM died in, e.g. "C  [nvoglv64.dll+0x9a1b30]" — the one line of a
/// hs_err log that says whose fault it was.
fn problematic_frame(text: &str) -> Option<String> {
    let i = text.find("# Problematic frame:")?;
    text[i..]
        .lines()
        .nth(1)
        .map(|l| l.trim_start_matches('#').trim().to_string())
        .filter(|l| !l.is_empty())
}

/// Video driver libraries the JVM can die inside, by vendor. Matched against the
/// problematic frame only, so a substring cannot collide with a file path
/// elsewhere in the log. Naming the vendor turns "обнови драйвер" into an
/// instruction the player can actually follow.
///
/// The empty vendor covers the API layers themselves: the frame proves the crash
/// is in graphics, but not whose driver is behind it.
const GPU_DRIVER_FRAMES: [(&str, &[&str]); 4] = [
    ("AMD", &["atio", "amdvlk", "amdxc", "aticfx", "amdxx"]),
    ("NVIDIA", &["nvoglv", "nvwgf2um", "nvd3dum", "nvcuda"]),
    ("Intel", &["igdumdim", "igxelpicd", "ig9icd", "igvk", "igdusc"]),
    ("", &["opengl32", "vulkan-1", "libgl", "lwjgl_opengl"]),
];

/// Vendor of the video driver the JVM died in, `Some("")` when only the graphics
/// API layer is named. `None` — the crash is not in a video driver.
fn gpu_driver_vendor(frame: &str) -> Option<&'static str> {
    let low = frame.to_lowercase();
    GPU_DRIVER_FRAMES
        .iter()
        .find(|(_, libs)| libs.iter().any(|l| low.contains(l)))
        .map(|(vendor, _)| *vendor)
}

/// True only when the injected skin mod is the one that failed: its code at the
/// top of a real (not WARN) stack, its mixin, or the loader naming it.
///
/// Matching the bare name anywhere in the log blamed the mod for every crash in
/// a build that merely had it installed — the loader's "Loading N mods" table
/// names it on every single launch. The build then lost its skins and kept
/// crashing for the original, still undiagnosed reason.
fn skin_mod_implicated(text: &str) -> bool {
    super::crashcause::mod_implicated(text, &super::crashcause::SKIN_MOD)
}

/// Наш собственный мод — виновник, а не свидетель.
///
/// Имя мода стоит в каждом запуске в списке загруженных, а его логгер пишет о
/// своих сетевых неудачах под WARN — ни то ни другое вылетом не является.
/// Улики перечислены в `crashcause::mod_implicated`. Отдельно ловится
/// UnsupportedClassVersionError: так выглядит мод, собранный под Java новее
/// игры, и это единственная поломка, которая валит ВСЕ модовые сборки сразу
/// (16.09.2026).
pub(crate) fn own_mod_implicated(text: &str) -> bool {
    super::crashcause::mod_implicated(text, &super::crashcause::OWN_MOD)
}

/// Кого из наших модов винить в вылете, и какие чужие моды назвал загрузчик.
pub(crate) struct Blame {
    pub skin: bool,
    pub own: bool,
    pub others: Vec<ModFault>,
}

/// Загрузчик отказался собрать моды: ни один мод до своего кода не дошёл, и
/// винить наши моды можно только если отказ назвал их самих. Так 25.09.2026
/// walkers без craftedcore обернулся «мод скинов не ужился» — у игрока забрали
/// скины, а причину спрятали.
pub(crate) fn blame(text: &str) -> Blame {
    let faults = mod_faults(text);
    let is_own = |f: &ModFault| f.name.eq_ignore_ascii_case("millida");
    let is_skin = |f: &ModFault| f.name.to_lowercase().replace(' ', "") == "customskinloader";
    let resolved = faults.is_empty();
    Blame {
        skin: faults.iter().any(is_skin) || (resolved && skin_mod_implicated(text)),
        own: faults.iter().any(is_own) || (resolved && own_mod_implicated(text)),
        others: faults.into_iter().filter(|f| !is_own(f) && !is_skin(f)).collect(),
    }
}

/// A mod the loader refused to load. `wrong_version` — the unmet requirement is
/// the game itself (or the loader), i.e. the jar is built for another version.
#[derive(PartialEq, Debug)]
pub(crate) struct ModFault {
    pub(crate) name: String,
    pub(crate) wrong_version: bool,
}

/// First `'...'` after the marker. Loaders quote mod names, so the quotes are
/// what separates the name from the sentence around it.
fn quoted_after(line: &str, marker: &str) -> Option<String> {
    let rest = line.split_once(marker)?.1;
    let start = rest.find('\'')? + 1;
    let end = rest[start..].find('\'')? + start;
    let name = rest[start..end].trim();
    (!name.is_empty() && name.len() <= 60).then(|| name.to_string())
}

/// The requirement a mod is missing is what the requirement is ABOUT: the game,
/// the loader, or another mod.
const GAME_REQUIREMENTS: [&str; 6] =
    [" of minecraft", "'minecraft'", "'neoforge'", "'forge'", "'fabricloader'", "'fabric loader'"];

/// Mods named in loader resolution failures. Fabric, Quilt and NeoForge all
/// print one line per unmet requirement, and that line is the only place the
/// player learns WHICH jar to update — without it the verdict stays "конфликт
/// модов", and a fifty-mod pack is unfixable by hand.
pub(crate) fn mod_faults(text: &str) -> Vec<ModFault> {
    let mut out: Vec<ModFault> = vec![];
    for line in text.lines() {
        let low = line.to_lowercase();
        // NeoForge: "Mod ID: 'minecraft', Requested by: 'sodium', Expected range: ..."
        let fault = if low.contains("requested by:") {
            quoted_after(line, "Requested by:").map(|name| ModFault {
                name,
                wrong_version: GAME_REQUIREMENTS.iter().any(|r| low.split("requested by:").next().unwrap_or("").contains(r)),
            })
        } else if low.contains("requires") && low.contains("mod '") {
            // Fabric/Quilt: "- Mod 'Sodium' (sodium) 0.5.8 requires version 1.20.1
            //  of minecraft, but only the wrong version is present: 1.21.1!"
            quoted_after(line, "Mod ").map(|name| ModFault {
                name,
                wrong_version: GAME_REQUIREMENTS.iter().any(|r| low.contains(r)),
            })
        } else {
            None
        };
        let Some(fault) = fault else { continue };
        if !out.iter().any(|f| f.name == fault.name) {
            out.push(fault);
        }
    }
    out
}

const FAULT_NAMES_SHOWN: usize = 3;

fn fault_list(faults: &[ModFault]) -> String {
    let names: Vec<&str> = faults.iter().take(FAULT_NAMES_SHOWN).map(|f| f.name.as_str()).collect();
    let mut list = names.join(", ");
    if faults.len() > names.len() {
        list.push_str(&format!(" и ещё {}", faults.len() - names.len()));
    }
    list
}

/// Verdict for a resolution failure: name the jars, then say what to do with them.
fn mod_fault_reason(faults: &[ModFault]) -> String {
    let list = fault_list(faults);
    if faults.iter().any(|f| f.wrong_version) {
        format!(
            "Моды собраны под другую версию игры: {}. Обнови их до версии сборки или убери из папки mods.",
            list
        )
    } else {
        format!("Модам не хватает зависимостей: {}. Установи то, что они требуют, или убери их.", list)
    }
}

const CERTIFICATE_REJECTION_MARKERS: [&str; 4] =
    ["pkix path", "certification path", "certificate_unknown", "sslhandshakeexception"];

/// Only the loaders' own refusal lines: Forge prints "fmlcore-….jar is missing
/// mods.toml file" on every healthy start, so a loose "missing mods" match
/// labelled almost every Forge crash as a missing dependency.
const MISSING_DEPENDENCY_MARKERS: [&str; 4] = [
    "mandatory dependencies",
    "missingmodsexception",
    ", which is missing!",
    "but only the wrong version is present",
];

fn loader_reported_missing_dependency(low: &str) -> bool {
    MISSING_DEPENDENCY_MARKERS.iter().any(|m| low.contains(m))
}

/// The machine ran out of commit memory, not the game out of heap: the JVM
/// prints a bare "java.lang.OutOfMemoryError" next to these lines, so they must
/// be checked first. Raising -Xmx here reserves even more and crashes sooner.
const SYSTEM_MEMORY_MARKERS: [&str; 4] = [
    "native memory allocation",
    "insufficient memory for the java runtime environment",
    "could not reserve enough space",
    "paging file is too small",
];

pub(crate) const SYSTEM_MEMORY_REASON: &str = "Компьютеру не хватило памяти: Windows не смогла выдать игре ни ОЗУ, ни файл подкачки. Прибавка ОЗУ в настройках сборки тут сделает только хуже — поставь меньше, чем сейчас, закрой браузер и другие тяжёлые программы и проверь, что файл подкачки Windows включён.";

fn system_memory_exhausted(low: &str) -> bool {
    SYSTEM_MEMORY_MARKERS.iter().any(|m| low.contains(m))
}

fn auth_server_certificate_rejected(low: &str) -> bool {
    low.contains("failed to fetch metadata") && CERTIFICATE_REJECTION_MARKERS.iter().any(|m| low.contains(m))
}

/// Вердикт о вылете: текст игроку, хвост лога, стабильный класс для
/// телеметрии и сырая строка-причина (маскируется перед отправкой).
pub(crate) struct CrashVerdict {
    pub reason: String,
    pub tail: String,
    pub kind: &'static str,
    pub cause: String,
}

/// Игра дошла до меню: звук поднят, атласы текстур собраны. После этого окно
/// уже открыто, и слова «GLFW»/«OpenGL» в логе — не отказ окна.
fn startup_finished(low: &str) -> bool {
    low.contains("sound engine started") || low.contains("-atlas") || low.contains("[chat]")
}

/// Отказ открыть окно — только по строкам, которые это и говорят, и только
/// если игра до окна не дошла. Голое «glfw» есть в любом отчёте о вылете
/// посреди игры: 112 из 344 «видеокарта не открыла окно» случились после
/// десяти минут игры (25.09.2026).
const WINDOW_FAILURE_MARKERS: [&str; 9] = [
    "failed to create window",
    "pixel format",
    "no opengl",
    "glfw error 65542",
    "glfw error 65543",
    "wglcreatecontext",
    "could not create context",
    "failed to initialize glfw",
    "opengl version is not supported",
];

fn window_failed(low: &str) -> bool {
    !startup_finished(low) && WINDOW_FAILURE_MARKERS.iter().any(|m| low.contains(m))
}

#[cfg(test)]
pub(crate) fn analyze_crash(game_dir: &Path, since: std::time::SystemTime) -> (String, String) {
    let v = crash_verdict(&crash_text(game_dir, since));
    (v.reason, v.tail)
}

pub(crate) fn crash_verdict(text: &str) -> CrashVerdict {
    let low = text.to_lowercase();
    // "Problematic frame" is written by nothing but a JVM fatal-error log, so it
    // stands on its own: a truncated hs_err (the header cut off by a rotating
    // tail, a report the player pasted from the middle) must still be diagnosed.
    let fatal_jvm = low.contains("a fatal error has been detected by the java runtime")
        || low.contains("# problematic frame:");
    let gpu_vendor = fatal_jvm
        .then(|| problematic_frame(text))
        .flatten()
        .and_then(|f| gpu_driver_vendor(&f));
    let faults = mod_faults(text);
    let verdict = |reason: String, kind: &'static str| CrashVerdict {
        reason,
        tail: crash_tail(text),
        kind,
        cause: super::crashcause::crash_cause(text),
    };
    let (reason, kind): (&str, &'static str) = if auth_server_certificate_rejected(&low) {
        ("Java этой сборки не доверяет сертификату сервера входа Millida, поэтому игра закрылась на старте. Чаще всего сертификат подменяет антивирус с проверкой защищённых соединений (Kaspersky, ESET, Dr.Web, AdGuard) — выключи в нём проверку HTTPS. Если на компьютере старая версия Java, поставь свежую кнопкой ниже.", "auth_cert")
    } else if system_memory_exhausted(&low) {
        (SYSTEM_MEMORY_REASON, "system_memory")
    } else if low.contains("outofmemoryerror") || low.contains("out of memory") {
        ("Не хватило оперативной памяти. Добавь ОЗУ в настройках сборки.", "oom")
    } else if low.contains("unsupportedclassversionerror") || low.contains("class file version") || low.contains("compiled by a more recent version of the java") {
        ("Нужна другая версия Java для этой сборки.", "java_version")
    } else if let Some(vendor) = gpu_vendor {
        let kind = if vendor == "AMD" { "amd_driver" } else { "gpu_driver" };
        return verdict(driver_crash_reason(vendor), kind);
    } else if fatal_jvm {
        ("Java аварийно завершилась. Отчёт hs_err_pid лежит в папке сборки — пришли его в поддержку.", "jvm_fatal")
    } else if !faults.is_empty() {
        let kind = if faults.iter().any(|f| f.wrong_version) { "wrong_mc" } else { "missing_deps" };
        return verdict(mod_fault_reason(&faults), kind);
    } else if loader_reported_missing_dependency(&low) {
        ("Не хватает зависимости одного из модов.", "missing_deps")
    } else if low.contains("duplicate mods") || low.contains("incompatible mod") || low.contains("found a duplicate mod")
        || low.contains("mod resolution encountered an incompatible mod set") || low.contains("duplicate mod") {
        ("Конфликт модов — есть дубли или несовместимые моды.", "conflict")
    } else if low.contains("mixin apply failed") || low.contains("mixinapplyerror") || low.contains("mixintransformererror") {
        ("Один из модов не подошёл к этой версии игры (ошибка миксина).", "mixin")
    } else if low.contains("nosuchmethoderror")
        || low.contains("noclassdeffounderror")
        || low.contains("nosuchfielderror")
        || low.contains("incompatibleclasschangeerror")
    {
        // Загрузчик пропустил мод, а код внутри него зовёт то, чего в этой версии
        // игры уже нет. Так падает сборка, перенесённая на другую версию, — часто
        // не на запуске, а при входе на сервер, когда мод впервые доходит до дела.
        ("Один из модов собран под другую версию игры: он зовёт код, которого в ней нет. Обнови моды сборки под её версию.", "api_mismatch")
    } else if window_failed(&low) {
        ("Игра не смогла открыть окно — дело в видеокарте или её драйвере. Обнови драйвер видеокарты.", "gpu")
    } else if text.trim().is_empty() {
        ("Игра закрылась без единой строчки в логе — чаще всего её закрыл антивирус. Добавь папку игры в исключения.", "no_log")
    } else {
        ("Игра вылетела. Загляни в лог — там причина.", "unknown")
    };
    verdict(reason.to_string(), kind)
}

const TAIL_LINES: usize = 18;

fn crash_tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(TAIL_LINES)..].join("\n")
}

/// The one crash the player can fix themselves, and the only one where naming the
/// vendor changes what they do: an access violation inside the video driver is
/// almost always an outdated driver, and on a laptop the other card often works
/// straight away.
fn driver_crash_reason(vendor: &str) -> String {
    let whose = match vendor {
        "" => "видеокарты".to_string(),
        v => format!("видеокарты {}", v),
    };
    format!(
        "Игра упала внутри драйвера {} — сама игра тут ни при чём. Обнови драйвер видеокарты до последней версии, \
         а если это ноутбук — в настройках сборки переключи видеокарту.",
        whose
    )
}

/// Game output is emitted to the webview in batches: mod loaders dump thousands
/// of lines at startup and one event per line stalls the UI thread.
const LOG_FLUSH_MS: u64 = 120;
/// The console view keeps only the last 800 lines, so older batched lines are
/// dropped; the full output still goes to the log file.
const LOG_BATCH_MAX: usize = 800;

/// Mojang's log4j config makes the game print every message as an XML event.
/// Parse it back into the plain `[thread/LEVEL]: message` form of latest.log.
#[derive(Default)]
struct Log4jFilter {
    head: String,
    cdata: bool,
    buf: String,
}

fn xml_attr(line: &str, name: &str) -> String {
    let key = format!("{}=\"", name);
    line.find(&key)
        .map(|i| &line[i + key.len()..])
        .and_then(|rest| rest.find('"').map(|e| rest[..e].to_string()))
        .unwrap_or_default()
}

impl Log4jFilter {
    fn feed(&mut self, raw: &str) -> Vec<String> {
        let line = raw.trim_end_matches(['\r', '\n']);
        if self.cdata {
            if let Some(end) = line.find("]]>") {
                self.buf.push_str(&line[..end]);
                self.cdata = false;
                return self.flush();
            }
            self.buf.push_str(line);
            self.buf.push('\n');
            return vec![];
        }
        let t = line.trim_start();
        if !t.starts_with("<log4j:") && !t.starts_with("</log4j:") {
            return vec![line.to_string()];
        }
        if t.starts_with("<log4j:Event") {
            let thread = xml_attr(t, "thread");
            let level = xml_attr(t, "level");
            self.head = match (thread.is_empty(), level.is_empty()) {
                (true, true) => String::new(),
                (true, false) => format!("[{}]: ", level),
                (false, true) => format!("[{}]: ", thread),
                _ => format!("[{}/{}]: ", thread, level),
            };
            if !t.contains("<![CDATA[") {
                return vec![];
            }
        }
        if let Some(i) = t.find("<![CDATA[") {
            let rest = &t[i + "<![CDATA[".len()..];
            if let Some(end) = rest.find("]]>") {
                self.buf.push_str(&rest[..end]);
                return self.flush();
            }
            self.buf.push_str(rest);
            self.buf.push('\n');
            self.cdata = true;
        }
        vec![]
    }

    fn flush(&mut self) -> Vec<String> {
        let body = std::mem::take(&mut self.buf);
        let head = self.head.clone();
        body.lines()
            .enumerate()
            .map(|(i, l)| if i == 0 { format!("{}{}", head, l) } else { l.to_string() })
            .collect()
    }
}

fn spawn_log_reader(
    reader: Box<dyn std::io::Read + Send>,
    file: Arc<Mutex<std::fs::File>>,
    app: AppHandle,
    server: ServerSlot,
) {
    let batch: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let done = Arc::new(std::sync::atomic::AtomicBool::new(false));

    let (b, d, a) = (batch.clone(), done.clone(), app.clone());
    std::thread::spawn(move || {
        use std::sync::atomic::Ordering;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(LOG_FLUSH_MS));
            let lines = b.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
            if !lines.is_empty() {
                let _ = a.emit("game-log", lines);
            }
            if d.load(Ordering::Relaxed) {
                break;
            }
        }
    });

    let app_hop = app.clone();
    std::thread::spawn(move || {
        use std::io::{BufRead, Write};
        let mut buf = std::io::BufReader::new(reader);
        let mut raw: Vec<u8> = Vec::new();
        let mut filter = Log4jFilter::default();
        loop {
            raw.clear();
            // read_until, not read_line: a single byte the console code page
            // wrote instead of UTF-8 used to abort the reader for the whole
            // session, so a Russian mod name silently ended the log.
            match buf.read_until(b'\n', &mut raw) {
                Ok(0) => break,
                Ok(_) => {
                    let line = decode_log_bytes(&raw);
                    let out = filter.feed(&line);
                    if out.is_empty() {
                        continue;
                    }
                    if let Ok(mut f) = file.lock() {
                        for l in &out {
                            let _ = f.write_all(l.as_bytes());
                            let _ = f.write_all(b"\n");
                        }
                    }
                    for l in &out {
                        track_server_hop(l, &server, &app_hop);
                    }
                    if let Ok(mut v) = batch.lock() {
                        for l in out {
                            if v.len() >= LOG_BATCH_MAX {
                                v.remove(0);
                            }
                            v.push(l);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        done.store(true, std::sync::atomic::Ordering::Relaxed);
    });
}

/// User-selected Java for a profile, then the Java chosen in settings for every
/// build; a missing or no longer allowed path falls back to the bundled JRE. The
/// setting is re-checked here because the file on disk may have been written by
/// an older build that did not validate it.
/// Java version the user pinned for this build by number. The runtime is fetched
/// at launch rather than resolved to a path once, so removing it in settings
/// reinstalls it instead of silently dropping the build back to the automatic
/// major.
pub fn profile_java_major(profile: &str) -> Option<u64> {
    std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|s| s["javaMajor"].as_u64())
        .filter(|m| JAVA_MAJORS.contains(m))
}

pub fn profile_java(profile: &str) -> Option<PathBuf> {
    let own = std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|s| {
            s["javaPath"]
                .as_str()
                .map(str::trim)
                .filter(|p| !p.is_empty() && java_path_allowed(Path::new(p)))
                .map(PathBuf::from)
        });
    own.or_else(default_java)
}

/// The single answer to "which Java does this build run on": a pinned version
/// number first — fetched here, so a runtime removed in settings comes back
/// instead of silently downgrading the build — then a chosen path, then the
/// automatic major from the version metadata.
pub(crate) async fn resolve_profile_java(app: &AppHandle, profile: &str) -> Result<Option<PathBuf>, String> {
    match profile_java_major(profile) {
        Some(m) => Ok(Some(ensure_java(app, m).await?)),
        None => Ok(profile_java(profile)),
    }
}

/// JVM flags that hand the JVM something to execute: native/Java agents, hooks
/// fired on VM errors, and options that decide which classes get loaded.
///
/// This black list only guards flags from our own API (pack launch tokens) and
/// from loader version jsons. Flags a player or a shared build can write go
/// through the white list in `user_jvm_arg_allowed`.
const BLOCKED_JVM_PREFIXES: &[&str] = &[
    "-javaagent",
    "-agentlib",
    "-agentpath",
    "-xrun",
    "-xbootclasspath",
    "-xx:onerror",
    "-xx:onoutofmemoryerror",
    "-xx:abortvmonexception",
    "-xx:vmoptionsfile",
    "-xx:flightrecorderoptions",
    "--class-path=",
    "--module-path=",
    "--upgrade-module-path=",
    "--patch-module=",
    // not code by themselves, but each one redirects what the game loads or
    // where the JVM writes: a log4j config with a JNDI appender, an extra mod
    // folder, native libraries from anywhere, arbitrary file writes
    "-djava.library.path",
    "-dlog4j.configurationfile",
    "-dlog4j2.configurationfile",
    "-dfabric.addmods",
    "-dfabric.loadmods",
    "-djava.system.class.loader",
    "-djava.security.manager",
    "-djava.security.policy",
    "-djdk.attach.allowattachself",
    "-xx:heapdumppath",
    "-xx:errorfile",
    "-xx:logfile",
    "-xx:startflightrecording",
    "-xlog",
    "-xloggc",
    "-xshare:",
    "-xx:sharedarchivefile",
];

/// Same idea, but for flags whose value is a separate token: matching them by
/// prefix would also reject unrelated options starting with the same letters.
const BLOCKED_JVM_EXACT: &[&str] = &[
    "-cp",
    "-classpath",
    "--class-path",
    "-p",
    "--module-path",
    "--upgrade-module-path",
    "--patch-module",
];

/// Everything the JVM would treat as an argument file (`@file`) or as the main
/// class is rejected as well: only real flags belong in this setting.
pub fn jvm_arg_allowed(arg: &str) -> bool {
    let a = arg.trim();
    if !a.starts_with('-') {
        return false;
    }
    let low = a.to_ascii_lowercase();
    !BLOCKED_JVM_EXACT.contains(&low.as_str()) && !BLOCKED_JVM_PREFIXES.iter().any(|p| low.starts_with(p))
}

/// `-XX:+Name` / `-XX:-Name` switches a player may set: GC choice and the
/// tuning switches from the popular guides (Aikar, Obydux, ZGC/Shenandoah
/// guides). Anything not listed is refused rather than guessed about.
const USER_XX_BOOL: &[&str] = &[
    "UseG1GC", "UseZGC", "ZGenerational", "UseShenandoahGC", "UseParallelGC", "UseSerialGC",
    "UseConcMarkSweepGC", "UseParNewGC", "ParallelRefProcEnabled", "UnlockExperimentalVMOptions",
    "UnlockDiagnosticVMOptions", "DisableExplicitGC", "ExplicitGCInvokesConcurrent", "AlwaysPreTouch",
    "PerfDisableSharedMem", "UseLargePages", "UseTransparentHugePages", "UseStringDeduplication",
    "UseCompressedOops", "UseCompressedClassPointers", "UseNUMA", "UseFastUnorderedTimeStamps",
    "UseVectorCmov", "UseCriticalJavaThreadPriority", "OmitStackTraceInFastThrow", "UseAdaptiveSizePolicy",
    "UseCondCardMark", "UseFPUForSpilling", "AggressiveOpts", "DisableAttachMechanism",
    "UseDynamicNumberOfGCThreads", "ZUncommit", "ZProactive", "ShenandoahUncommit", "UseJVMCICompiler",
    "EnableJVMCI", "EagerJVMCI", "UseCodeCacheFlushing", "SegmentedCodeCache", "TieredCompilation",
    "UseTLAB", "ResizeTLAB", "UseCMSInitiatingOccupancyOnly", "CMSParallelRemarkEnabled",
    "UseLoopPredicate", "RangeCheckElimination", "EliminateLocks", "DoEscapeAnalysis",
    "OptimizeStringConcat", "UseStringCache", "UseCompressedStrings",
    "UseXMMForArrayCopy", "UseThreadPriorities", "UseBiasedLocking", "UseAES", "UseAESIntrinsics",
    "UseSHA", "UseFMA", "UseNewLongLShift", "UseXmmI2D", "UseXmmI2F", "UseXmmLoadAndClearUpper",
    "UseXmmRegToRegMoveAll", "UseInlineCaches", "UseVectorizedMismatchIntrinsic", "UseTypeProfile",
    "UseJVMCINativeLibrary", "AlwaysActAsServerClassMachine", "UseFastJNIAccessors",
    // Флаги JIT из гайдов по FPS (Obydux, GraalVM): фильтр 24.09 молча их выкидывал.
    "UseFastStosb", "OptimizeFill", "UseSuperWord", "AlignVector", "UseLargePagesInMetaspace",
    "EnableJVMCIProduct",
];

/// `-XX:Name=<number>` (or a bare word such as a Shenandoah mode) a player may set.
const USER_XX_VALUE: &[&str] = &[
    "MaxGCPauseMillis", "G1NewSizePercent", "G1MaxNewSizePercent", "G1HeapRegionSize", "G1ReservePercent",
    "G1HeapWastePercent", "G1MixedGCCountTarget", "InitiatingHeapOccupancyPercent",
    "G1MixedGCLiveThresholdPercent", "G1RSetUpdatingPauseTimePercent", "G1ConcRefinementThreads",
    "G1SATBBufferEnqueueingThresholdPercent", "G1ConcMarkStepDurationMillis", "G1ConcRSHotCardLimit",
    "G1ConcRefinementServiceIntervalMillis", "G1PeriodicGCInterval", "SurvivorRatio", "MaxTenuringThreshold",
    "ParallelGCThreads", "ConcGCThreads", "ReservedCodeCacheSize", "MaxMetaspaceSize", "MetaspaceSize",
    "CICompilerCount", "NmethodSweepActivity", "LargePageSizeInBytes", "AllocatePrefetchStyle",
    "ThreadPriorityPolicy", "SoftRefLRUPolicyMSPerMB", "MaxInlineLevel", "MaxInlineSize", "FreqInlineSize",
    "InlineSmallCode", "MaxNodeLimit", "NodeLimitFudgeFactor", "LoopUnrollLimit", "ZCollectionInterval",
    "ZAllocationSpikeTolerance", "ZUncommitDelay", "ShenandoahGCMode", "ShenandoahGCHeuristics",
    "CMSInitiatingOccupancyFraction", "NewRatio", "NewSize", "MaxNewSize", "MaxDirectMemorySize",
    "TrimNativeHeapInterval", "GCTimeRatio", "AutoBoxCacheMax", "UseAVX", "UseSSE", "MaxRAMPercentage",
    "InitialRAMPercentage", "MinRAMPercentage", "MaxHeapFreeRatio", "MinHeapFreeRatio", "ThreadStackSize",
    "CompileThreshold", "Tier4InvocationThreshold", "MaxRAM", "SoftMaxHeapSize",
    "NonNMethodCodeHeapSize", "ProfiledCodeHeapSize", "NonProfiledCodeHeapSize", "JVMCIThreads",
];

/// `-D` properties a player may set: encodings, the well-known Forge/FML and
/// networking switches, Log4Shell mitigation, locale. Properties that make the
/// game load something (log4j config files, extra mod folders, native library
/// paths, class loaders) are exactly what a malicious share would use.
const USER_D_PROPS: &[&str] = &[
    "file.encoding", "sun.jnu.encoding", "sun.stdout.encoding", "sun.stderr.encoding", "stdout.encoding",
    "stderr.encoding", "fml.ignoreInvalidMinecraftCertificates", "fml.ignorePatchDiscrepancies",
    "fml.earlyprogresswindow", "fml.readTimeout", "fml.loginTimeout", "java.net.preferIPv4Stack",
    "java.net.preferIPv6Addresses", "java.net.useSystemProxies", "log4j2.formatMsgNoLookups",
    "user.language", "user.country", "user.region", "java.awt.headless", "sun.java2d.opengl",
    "sun.java2d.d3d", "sun.java2d.noddraw", "org.lwjgl.opengl.Display.allowSoftwareOpenGL",
    "org.lwjgl.util.NoChecks", "java.util.concurrent.ForkJoinPool.common.parallelism", "sun.rmi.dgc.server.gcInterval",
    "sun.rmi.dgc.client.gcInterval", "jdk.gamemode", "forge.logging.console.level", "forge.logging.markers",
    "fabric.skipMcProvider", "sodium.checks.issue2561", "mixin.env.disableRefMap",
];

fn size_value_ok(v: &str) -> bool {
    let digits = v.trim_end_matches(['k', 'K', 'm', 'M', 'g', 'G', 't', 'T']);
    !digits.is_empty() && digits.len() <= 12 && v.len() - digits.len() <= 1 && digits.bytes().all(|b| b.is_ascii_digit())
}

/// Numbers, sizes (`8M`) and bare words (`generational`, `adaptive`): nothing
/// that can name a file.
fn xx_value_ok(v: &str) -> bool {
    size_value_ok(v)
        || (v.len() <= 32 && !v.is_empty() && v.bytes().all(|b| b.is_ascii_alphabetic()))
        || (v.len() <= 16 && v.parse::<f64>().is_ok() && v.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
}

fn d_value_ok(v: &str) -> bool {
    v.len() <= 64 && v.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

/// White list for flags a player (or a shared build, or a stored setting) can
/// write: heap and stack sizes, listed `-XX` GC/performance options, listed
/// `-D` properties and `--add-opens/--add-exports`. Everything else — agents,
/// hooks, file-writing and file-loading options — is refused.
pub fn user_jvm_arg_allowed(arg: &str) -> bool {
    let a = arg.trim();
    if a != arg || a.is_empty() {
        return false;
    }
    for x in ["-Xmx", "-Xms", "-Xss", "-Xmn"] {
        if let Some(v) = a.strip_prefix(x) {
            return size_value_ok(v);
        }
    }
    if let Some(rest) = a.strip_prefix("-XX:") {
        if let Some(name) = rest.strip_prefix('+').or_else(|| rest.strip_prefix('-')) {
            return USER_XX_BOOL.contains(&name);
        }
        if let Some((name, v)) = rest.split_once('=') {
            return USER_XX_VALUE.contains(&name) && xx_value_ok(v);
        }
        return false;
    }
    if let Some(rest) = a.strip_prefix("-D") {
        let (name, v) = rest.split_once('=').unwrap_or((rest, ""));
        return USER_D_PROPS.contains(&name) && d_value_ok(v);
    }
    for x in ["--add-opens=", "--add-exports="] {
        if let Some(v) = a.strip_prefix(x) {
            let Some((what, to)) = v.split_once('=') else { return false };
            return !what.is_empty()
                && what.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/'))
                && !to.is_empty()
                && to.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b',' | b'-'));
        }
    }
    false
}

/// The first argument the launcher refuses to pass on, if any.
pub fn rejected_jvm_arg(raw: &str) -> Option<String> {
    raw.split_whitespace().find(|a| !user_jvm_arg_allowed(a)).map(str::to_string)
}

pub fn sanitize_jvm_args(raw: &str) -> Vec<String> {
    raw.split_whitespace().filter(|a| user_jvm_arg_allowed(a)).map(str::to_string).collect()
}

/// Flags whose value is the next token in a loader json (Forge 1.17+ lays out
/// its module path this way).
const LOADER_VALUE_FLAGS: &[&str] = &["-p", "--module-path", "--add-modules", "--add-opens", "--add-exports", "--add-reads"];
/// Flags dropped together with their value token.
const LOADER_DROP_WITH_VALUE: &[&str] = &["-cp", "-classpath", "--class-path", "--upgrade-module-path", "--patch-module"];

/// `arguments.jvm` of a non-Mojang version json (Fabric/Quilt meta, a Forge
/// installer's profile). The black list applies; the module-path flags Forge
/// needs are kept together with their value, and a bare token is only accepted
/// as such a value — anywhere else the JVM would take it as the main class.
pub(crate) fn filter_loader_jvm_args(list: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(list.len());
    let mut expect_value = false;
    let mut skip_value = false;
    for a in list {
        if skip_value {
            skip_value = false;
            if !a.starts_with('-') {
                continue;
            }
        }
        if expect_value {
            expect_value = false;
            if !a.starts_with('-') && !a.starts_with('@') {
                out.push(a);
                continue;
            }
        }
        let low = a.to_ascii_lowercase();
        if LOADER_VALUE_FLAGS.contains(&low.as_str()) {
            out.push(a);
            expect_value = true;
        } else if LOADER_DROP_WITH_VALUE.contains(&low.as_str()) {
            skip_value = true;
        } else if jvm_arg_allowed(&a) {
            out.push(a);
        }
    }
    if expect_value {
        // a value flag at the very end has no value: drop it
        out.pop();
    }
    out
}

/// Builds jvm+game arguments from the version json, expanding `${...}` placeholders.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_args(
    v: &Value,
    main_class: &str,
    classpath: &[PathBuf],
    nick: &str,
    game_dir: &Path,
    assets_root: &Path,
    natives_dir: &Path,
    libraries_dir: &Path,
    auth: &Auth,
) -> Vec<String> {
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let cp = classpath
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(sep);
    let primary_jar = classpath.last().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    // Online session needs user_type=msa; offline mode expects a name-derived
    // uuid, token "0" and user_type=legacy.
    let online = !auth.token.is_empty();
    let uuid = if online && !auth.uuid.is_empty() { auth.uuid.clone() } else { offline_uuid(nick) };
    let token = if online { auth.token.clone() } else { "0".to_string() };
    let user_type = if online { "msa" } else { "legacy" };
    let xuid = if auth.xuid.is_empty() { "0".to_string() } else { auth.xuid.clone() };
    // 1.7.6-1.8.9 pass `--userProperties ${user_properties}` and hand the value
    // straight to Gson: an unexpanded placeholder is a syntax error that kills
    // the game before the window opens. 1.6.4 and older want `${auth_session}`
    // and `${game_assets}` instead, and 1.5.2 has no named argument for the
    // nickname at all — a missed placeholder there becomes the player's name.
    let session = format!("token:{}:{}", token, uuid);
    // Only a virtual asset index has a laid-out directory; newer versions read
    // the object store and never reference `${game_assets}`.
    let game_assets = v["millidaGameAssets"]
        .as_str()
        .map(String::from)
        .unwrap_or_else(|| assets_root.to_string_lossy().to_string());
    let subst = |s: &str| -> String {
        s.replace("${auth_player_name}", nick)
            .replace("${user_properties}", "{}")
            .replace("${user_property_map}", "{}")
            .replace("${auth_session}", &session)
            .replace("${game_assets}", &game_assets)
            .replace("${profile_name}", "Millida")
            .replace("${version_name}", v["id"].as_str().unwrap_or(""))
            .replace("${game_directory}", &game_dir.to_string_lossy())
            .replace("${assets_root}", &assets_root.to_string_lossy())
            .replace("${assets_index_name}", v["assetIndex"]["id"].as_str().unwrap_or(""))
            .replace("${auth_uuid}", &uuid)
            .replace("${auth_access_token}", &token)
            .replace("${clientid}", "millida")
            .replace("${auth_xuid}", &xuid)
            .replace("${user_type}", user_type)
            .replace("${version_type}", v["type"].as_str().unwrap_or("release"))
            .replace("${natives_directory}", &natives_dir.to_string_lossy())
            .replace("${library_directory}", &libraries_dir.to_string_lossy())
            .replace("${classpath_separator}", sep)
            .replace("${primary_jar}", &primary_jar)
            .replace("${launcher_name}", "MillidaLauncher")
            .replace("${launcher_version}", "0.1")
            .replace("${classpath}", &cp)
    };
    let mut args: Vec<String> = vec![];
    let collect = |list: &Value, args: &mut Vec<String>| {
        if let Some(arr) = list.as_array() {
            for a in arr {
                if let Some(s) = a.as_str() {
                    args.push(subst(s));
                } else if rules_allow(&a["rules"]) {
                    if let Some(s) = a["value"].as_str() {
                        args.push(subst(s));
                    } else if let Some(vals) = a["value"].as_array() {
                        for s in vals {
                            args.push(subst(s.as_str().unwrap_or("")));
                        }
                    }
                }
            }
        }
    };
    // 1.13+ has an `arguments` object; <=1.12 only has the `minecraftArguments`
    // string and no jvm arguments at all, so classpath/natives are passed manually.
    // loader jvm arguments come from a json the launcher did not write
    let loader_jvm = |fj: &Value, args: &mut Vec<String>| {
        let mut raw = vec![];
        collect(&fj["jvm"], &mut raw);
        args.extend(filter_loader_jvm_args(raw));
    };
    if v["arguments"].is_object() {
        collect(&v["arguments"]["jvm"], &mut args);
        if let Some(fj) = v.get("fabricArguments") {
            loader_jvm(fj, &mut args);
        }
        args.push(main_class.to_string());
        collect(&v["arguments"]["game"], &mut args);
        if let Some(fj) = v.get("fabricArguments") {
            collect(&fj["game"], &mut args);
        }
    } else {
        args.push(format!("-Djava.library.path={}", natives_dir.to_string_lossy()));
        args.push("-cp".into());
        args.push(cp.clone());
        if let Some(fj) = v.get("fabricArguments") {
            loader_jvm(fj, &mut args);
        }
        args.push(main_class.to_string());
        let mc_args = v["minecraftArguments"].as_str().unwrap_or("");
        for tok in mc_args.split_whitespace() {
            args.push(subst(tok));
        }
        if let Some(fj) = v.get("fabricArguments") {
            collect(&fj["game"], &mut args);
        }
    }
    args
}

/// `ram_mb` of 0 means auto.
pub async fn install_and_launch(
    app: AppHandle,
    version_id: String,
    nick: String,
    with_fabric: bool,
    ram_mb: u32,
    auth: Auth,
) -> Result<String, String> {
    install_and_launch_in(app, version_id, nick, with_fabric, ram_mb, "default".into(), auth).await
}

pub async fn install_and_launch_in(
    app: AppHandle,
    version_id: String,
    nick: String,
    with_fabric: bool,
    ram_mb: u32,
    profile: String,
    auth: Auth,
) -> Result<String, String> {
    CANCEL.store(false, std::sync::atomic::Ordering::SeqCst);
    // the nick lands on the command line and in an argfile
    let nick = launch_nick(&nick);
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    // The window may still hold the loader id the build was imported with
    // ("neoforge-21.1.233"); the stored build already has the game version.
    let version_id = match &prof {
        Some(p) if split_loader_version_id(&version_id).is_some() => p.version.clone(),
        _ => version_id,
    };
    let loader_id = prof.as_ref().map(|p| p.loader_id())
        .unwrap_or_else(|| if with_fabric { "fabric".into() } else { "vanilla".into() });
    let loader_ver = prof.as_ref().and_then(|p| p.loader_version.clone());
    // Settings are read before install so a user-provided Java path can skip the
    // bundled JRE download instead of replacing it afterwards.
    let settings: Value = std::fs::read(profile_dir(&profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let java_pick = resolve_profile_java(&app, &profile).await?;
    let game_dir = profile_dir(&profile);
    /*
     * A catalogue pack that brought its own game is launched by its own
     * description: it ships libraries, minecraft.jar, assets and natives, and
     * its content is loaded out of those libraries rather than out of `mods/`.
     * Assembling such a build from parts gives a folder that starts without
     * most of what the player paid for.
     */
    // the descriptor is a file in the profile folder: it is honoured only for
    // a build the core itself installed from the catalogue
    let pack = trusted_pack_launch_spec(&profile);
    let (v, main_class, classpath, java, assets_root, natives_dir, libraries_dir) = match &pack {
        Some(spec) => {
            emit(&app, "launch", 20.0, "Готовим сборку…");
            let token = if spec.needs_token {
                match pack_launch_token(&spec.slug).await {
                    Ok(t) => t,
                    Err(e) => {
                        if let Ok(Some(PackAccess::Lost(reason))) = pack_access(&spec.slug).await {
                            return Err(forfeit_pack(&app, &profile, &spec.slug, &reason).await);
                        }
                        return Err(e);
                    }
                }
            } else {
                Vec::new()
            };
            /*
             * A pack names the Java it was built for, and a player's own Java
             * older than that never starts it: Java 8 does not even read the
             * argument file, so a 1.20.1 pack dies with «Could not find or load
             * main class @…millida-args.txt». Such a pick is set aside for this
             * pack only; a newer Java than required is still the player's call.
             */
            let pick = java_pick.filter(|p| match java_major_at(p) {
                Some(m) if u64::from(m) >= spec.java_major => true,
                found => {
                    warn(
                        &app,
                        &format!(
                            "Выбранная Java {} не подходит сборке — ей нужна Java {}. Запускаем на своей",
                            found.map(|m| m.to_string()).unwrap_or_else(|| "неизвестной версии".into()),
                            spec.java_major
                        ),
                    );
                    false
                }
            });
            let java = match pick {
                Some(p) => p,
                None => ensure_java(&app, spec.java_major).await?,
            };
            let cp = pack_classpath(&profile, spec)?;
            let natives = game_dir.join(&spec.natives_dir);
            let mut extra_jvm = token;
            if let Some(arg) = lwjgl_library_path_arg(&nested_native_dirs(&natives)) {
                extra_jvm.push(arg);
            }
            let mut v = pack_version_json(spec, &extra_jvm);
            /*
             * A pack built on a vanilla version may leave the sounds and
             * languages out and name the version instead: the objects are the
             * same for every pack of that version, so they live once in the
             * shared store rather than inside each archive.
             */
            let assets_root = if spec.vanilla_assets.is_empty() {
                game_dir.join(&spec.assets_dir)
            } else {
                let root = game_root_ready()?;
                let (vid, vjson) = vanilla_meta(&app, &root, &spec.vanilla_assets).await?;
                if let Some(dir) = ensure_assets(&app, &root, &vjson, &vid).await? {
                    v["millidaGameAssets"] = Value::String(dir.to_string_lossy().to_string());
                }
                if spec.asset_index.is_empty() {
                    v["assetIndex"]["id"] = vjson["assetIndex"]["id"].clone();
                }
                root.join("assets")
            };
            (v, spec.main_class.clone(), cp, java, assets_root, natives, game_dir.join("libraries"))
        }
        None => {
            let (v, main_class, classpath, java) =
                install_loader_with_java(&app, &version_id, &loader_id, loader_ver.as_deref(), java_pick).await?;
            let root = game_root_ready()?;
            let resolved_vid = v["id"].as_str().unwrap_or(&version_id).to_string();
            let natives = root.join("versions").join(&resolved_vid).join("natives");
            let libs = root.join("libraries");
            (v, main_class, classpath, java, game_root().join("assets"), natives, libs)
        }
    };
    check_cancel()?;
    std::fs::create_dir_all(game_dir.join("mods")).ok();

    check_cancel()?;
    emit(&app, "launch", 92.0, "Запускаем игру…");
    // authlib-injector redirects Yggdrasil to a custom auth server. Without the
    // agent the game would authenticate against Mojang with a non-Mojang token
    // and fail session checks, so a failure here falls back to offline mode.
    let mut auth = auth;
    let mut agent: Option<String> = None;
    // Метаданные сервера входа лаунчер берёт сам и отдаёт агенту готовыми:
    // иначе authlib-injector качает их из игры при старте, и сбой DNS у игрока
    // или 502 на выкатке роняет игру до окна (2.0.122, 25.09.2026: 13 игроков
    // за 6 часов). Сети нет даже у лаунчера — игра идёт офлайн, а не падает.
    let mut prefetched: Option<String> = None;
    if !auth.yggdrasil.is_empty() {
        match ensure_authlib_injector().await {
            Ok(jar) => match get_json(&auth.yggdrasil).await {
                Ok(meta) => {
                    use base64::Engine as _;
                    prefetched = Some(format!(
                        "-Dauthlibinjector.yggdrasil.prefetched={}",
                        base64::engine::general_purpose::STANDARD.encode(meta.to_string())
                    ));
                    agent = Some(format!("-javaagent:{}={}", jar.to_string_lossy(), auth.yggdrasil));
                }
                Err(e) => {
                    warn(&app, &format!("Сервер скинов Millida не ответил ({}) — запускаем в офлайн-режиме", e));
                    auth = Auth::default();
                }
            },
            Err(e) => {
                warn(&app, &format!("Скины Millida недоступны ({}) — запускаем в офлайн-режиме", e));
                auth = Auth::default();
            }
        }
    }
    // CustomSkinLoader is a client mod, so it can only be installed on modded
    // profiles; vanilla has no way to load custom skins without Yggdrasil.
    let root = if agent.is_some() && !auth.yggdrasil.is_empty() {
        Some(format!("{}/csl/", auth.yggdrasil.trim_end_matches('/')))
    } else { None };
    let want_skin = want_in_game_skins(root.as_deref());
    // Наш мод умеет всё, что умел CustomSkinLoader, и сверх того косметику,
    // поэтому сначала пробуем его. Под связку, которой у мода ещё нет варианта,
    // остаётся прежний путь: игроку нужен скин и на такой сборке.
    let mut own_mod = false;
    /*
     * A protected pack checks its own files, and its content lives in signed
     * libraries rather than in `mods/`. Dropping our skin mod into that folder
     * either changes what the pack verifies or simply never loads — either way
     * it is a change to someone else's build made behind their back.
     */
    let touch_mods = pack.is_none();
    let mut own_mod_jar = String::new();
    if touch_mods && matches!(loader_id.as_str(), "fabric" | "quilt" | "forge" | "neoforge") {
        let licensed = !auth.token.is_empty() && auth.yggdrasil.is_empty();
        match ensure_millida_mod(&app, &profile, &nick, licensed).await {
            Ok(Some(jar)) => {
                own_mod = true;
                // Какой именно файл поехал в сборку: если он её и уронит, под
                // карантин пойдёт он, а не «мод вообще».
                own_mod_jar = jar;
            }
            Ok(None) => {}
            Err(e) => warn(&app, &format!("Мод Millida не поставлен: {}", e)),
        }
    }
    if touch_mods && matches!(loader_id.as_str(), "fabric" | "quilt" | "forge" | "neoforge") && !own_mod {
        let licensed = !auth.token.is_empty() && auth.yggdrasil.is_empty();
        if want_skin {
            match ensure_custom_skin_loader(&profile, &loader_id, root.as_deref(), &nick, licensed).await {
                Err(e) => warn(&app, &format!("Мод скинов не поставлен: {}", e)),
                Ok(off) if !off.is_empty() => warn(
                    &app,
                    &format!(
                        "Выключили мод скинов другого лаунчера ({}) — он показывал скин с его сервера. Теперь скин берётся из Millida",
                        off.join(", ")
                    ),
                ),
                Ok(_) => {}
            }
        }
    } else if touch_mods && !own_mod {
        if let Some(why) = in_game_skin_blocker(&loader_id, !auth.token.is_empty(), want_skin) {
            warn(&app, why);
        }
    }
    let mut args = build_args(&v, &main_class, &classpath, &nick, &game_dir, &assets_root, &natives_dir, &libraries_dir, &auth);
    /*
     * A pack states the memory it was built for. The player's own choice still
     * wins inside those bounds; outside them the pack's number is used, because
     * «не хватило памяти» on a paid build reads as a broken build.
     */
    let mut ram = tuned_ram_mb(&profile, ram_mb);
    if let Some(spec) = &pack {
        if spec.min_ram_mb > 0 && ram < spec.min_ram_mb {
            ram = spec.min_ram_mb;
        }
        if spec.max_ram_mb > 0 && ram > spec.max_ram_mb {
            ram = spec.max_ram_mb;
        }
    }
    args.insert(0, format!("-Xmx{}M", ram));
    if let Some(a) = agent { args.insert(1, a); }
    if let Some(p) = prefetched { args.insert(1, p); }
    // Log4Shell mitigation for 1.7-1.18; harmless on newer versions.
    args.insert(1, "-Dlog4j2.formatMsgNoLookups=true".into());
    // 1.7-1.11.2 predate that property and can only be patched via Mojang's
    // replacement logging config, downloaded during version install.
    if let Some(l4j) = v["millidaLog4jArg"].as_str() {
        args.insert(1, l4j.to_string());
    }
    if let Some(jvm) = settings["jvmArgs"].as_str() {
        // Second line of defence: the setting may have been written by a build
        // that stored the value unchecked.
        if let Some(bad) = rejected_jvm_arg(jvm) {
            warn(&app, &format!("Аргумент JVM «{}» пропущен — такие лаунчер не передаёт", bad));
        }
        for (i, a) in sanitize_jvm_args(jvm).into_iter().enumerate() { args.insert(1 + i, a); }
    }
    // Профиль GC режима «Буст FPS» встаёт левее пользовательских аргументов:
    // у JVM выигрывает последний одноимённый флаг, поэтому свой -XX игрока
    // остаётся сильнее нашего.
    let boost_on = settings["fpsBoost"].as_bool().unwrap_or(false);
    if boost_on {
        let own = settings["jvmArgs"].as_str().unwrap_or("");
        let taken: Vec<&str> = own.split_whitespace().collect();
        let flags: Vec<String> = boost_flags()
            .into_iter()
            .filter(|f| !taken.iter().any(|a| a.eq_ignore_ascii_case(f)))
            .map(|f| f.to_string())
            .collect();
        for (i, a) in flags.into_iter().enumerate() { args.insert(1 + i, a); }
    }
    // Ask the JVM for UTF-8 on stdout, stderr and log files. Left of the
    // player's own arguments on purpose: this is a default, and a player who
    // pins another encoding must still win. Without it the game writes the
    // console code page and every non-ASCII line arrived as mojibake.
    for (i, a) in ["-Dfile.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8", "-Dsun.stderr.encoding=UTF-8"]
        .into_iter()
        .filter(|f| {
            let key = f.split('=').next().unwrap_or_default();
            !settings["jvmArgs"].as_str().unwrap_or("").split_whitespace().any(|a| a.starts_with(key))
        })
        .enumerate()
    {
        args.insert(1 + i, a.to_string());
    }
    // Same order and for the same reason: auto-tuning goes to the left of the
    // player's own arguments and stays quiet once the boost mode has already
    // placed its GC profile.
    for (i, a) in tuned_flags(&profile, settings["jvmArgs"].as_str().unwrap_or(""), boost_on)
        .into_iter()
        .enumerate()
    {
        args.insert(1 + i, a);
    }
    // Zero means "let the game decide": passing --width/--height 0 makes
    // Minecraft open a minimum-size window.
    if let (Some(w), Some(h)) = (settings["width"].as_u64(), settings["height"].as_u64()) {
        if w > 0 && h > 0 {
            args.push("--width".into()); args.push(w.to_string());
            args.push("--height".into()); args.push(h.to_string());
        }
    }

    // Captured separately from the game's own log: it also covers crashes that
    // happen before the game logger is initialized.
    let logs = game_dir.join("logs");
    std::fs::create_dir_all(&logs).ok();
    let log_path = logs.join("launcher-latest.log");
    let mut quick_server: Option<String> = None;
    if let Some((w, sv)) = QUICK.lock().unwrap().clone() {
        if let Some(w) = w { args.push("--quickPlaySingleplayer".into()); args.push(w); }
        if let Some(sv) = sv {
            quick_server = Some(sv.clone());
            args.push("--quickPlayMultiplayer".into());
            args.push(sv);
        }
    }
    // Токен для мода — узкий, из /launcher/mod-session; нет его — мод без входа.
    let mod_token = if own_mod { mod_session_token().await } else { None };
    check_cancel()?;
    // Флаги из четырёх источников сводятся под выбранную Java: разблокировка
    // экспериментальных, один сборщик мусора, опции новее этой Java — прочь.
    fit_jvm_args(&mut args, java_major_of_bin(&java));
    /*
     * Сборка со своим classpath не влезает в командную строку Windows: четыреста
     * jar дают 80 000 символов при пределе в 32 767, и процесс не стартует
     * вовсе. Длинный запуск уезжает в файл аргументов, короткий идёт как шёл —
     * файл на каждый обычный старт был бы лишней записью на диск.
     */
    let argfile = if args_need_file(&args) {
        Some(write_argfile(&game_dir, &args)?)
    } else {
        None
    };
    // Файл аргументов убирается при любом выходе из запуска, в том числе по
    // ошибке: в нём ключ подписи сборки.
    let _argfile_guard = ArgfileGuard(argfile.clone());
    let gpu = GpuPref::parse(settings["gpu"].as_str().unwrap_or("auto"));
    let build = |exe: &Path| -> Command {
        let mut cmd = Command::new(exe);
        // CREATE_NO_WINDOW on Windows, otherwise every launch pops a console window.
        quiet(&mut cmd);
        apply_gpu_pref(&mut cmd, exe, gpu);
        match &argfile {
            Some(path) => {
                cmd.arg(format!("@{}", path.to_string_lossy()));
            }
            None => {
                cmd.args(&args);
            }
        }
        cmd.current_dir(&game_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        // Токен мод берёт из окружения запуска: в свой файл настроек он его не
        // пишет, а файл настроек игроки пересылают вместе со сборкой. Это узкий
        // токен мода, не токен аккаунта.
        if let Some(token) = &mod_token {
            cmd.env("MILLIDA_TOKEN", token);
        }
        cmd
    };
    // Одна повторная попытка: занятый антивирусом java.exe — через паузу,
    // пропавший или неполный наш рантайм — после переустановки.
    let mut java = java;
    let mut retried = false;
    let (mut child, start, start_wall, server_now) = loop {
        let log_file = std::fs::File::create(&log_path).map_err(|e| io_fail("Лог запуска", &log_path, &e))?;
        let start = std::time::Instant::now();
        // Wall clock too: crash evidence is filtered by file mtime, and Instant has
        // no common ground with a file timestamp.
        let start_wall = std::time::SystemTime::now();
        let exe = branded_java(&java);
        let spawned = match build(&exe).spawn() {
            Ok(c) => Ok(c),
            // Копию java.exe под нашим именем антивирус блокирует чаще
            // оригинала: без неё теряется только метка в Discord.
            Err(_) if exe != java => build(&java).spawn(),
            Err(e) => Err(e),
        };
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                if !retried && spawn_missing(&e) {
                    if let Some(fresh) = reinstall_managed_java(&app, &java).await {
                        java = fresh?;
                        retried = true;
                        continue;
                    }
                }
                if !retried && spawn_blocked(&e) {
                    retried = true;
                    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                    continue;
                }
                return Err(spawn_failure(&e, &java));
            }
        };
        if cancelled() {
            let _ = child.kill();
            return Err("Запуск отменён".into());
        }
        let _ = app.emit("game-log-start", &profile);
        let log_file = Arc::new(Mutex::new(log_file));
        let server_now: ServerSlot = Arc::new(Mutex::new(quick_server.as_deref().map(canon_addr)));
        if let Some(o) = child.stdout.take() {
            spawn_log_reader(Box::new(o), log_file.clone(), app.clone(), server_now.clone());
        }
        if let Some(e) = child.stderr.take() {
            spawn_log_reader(Box::new(e), log_file.clone(), app.clone(), server_now.clone());
        }
        // Give the JVM a moment: an immediate exit is a launch failure, not a session.
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;
        if let Ok(Some(status)) = child.try_wait() {
            if !status.success() {
                let log = read_log_file(&log_path).unwrap_or_default();
                if !retried && broken_runtime(&log) {
                    if let Some(fresh) = reinstall_managed_java(&app, &java).await {
                        java = fresh?;
                        retried = true;
                        continue;
                    }
                }
                let failure = early_exit_message(status.code(), &log);
                // Проверочная версия узнаёт о своём падении здесь же: «не
                // открылась вовсе» — самый важный из ответов, ради которых её ставили.
                report_review_launch(&profile, false, &failure).await;
                return Err(failure);
            }
        }
        break (child, start, start_wall, server_now);
    };
    let pname = profile.clone();
    let app2 = app.clone();
    let gdir = game_dir.clone();
    let crash_nick = nick.clone();
    let pid = child.id();
    if let Ok(mut v) = RUNNING.lock() {
        v.push((profile.clone(), pid));
    }
    if let Some(spec) = pack.as_ref().filter(|s| s.needs_token && !s.slug.is_empty()) {
        tauri::async_runtime::spawn(watch_pack_access(app.clone(), profile.clone(), spec.slug.clone(), pid));
    }
    std::thread::spawn(move || {
        let mut written = 0u64;
        let mut new_session = true;
        // Hours belong to the server the player was on while they were ticking,
        // so a hop flushes what is owed before the address changes.
        let mut here = current_server(&server_now);
        let mut server_session = here.is_some();
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
                Err(e) => break Err(e),
                Ok(None) => {}
            }
            std::thread::sleep(EXIT_POLL);
            let elapsed = start.elapsed().as_secs();
            let now_here = current_server(&server_now);
            let hopped = now_here != here;
            if elapsed - written >= PLAYTIME_FLUSH.as_secs() || (hopped && elapsed > written) {
                record_playtime(&pname, elapsed - written, here.as_deref(), new_session, server_session);
                written = elapsed;
                new_session = false;
                server_session = false;
            }
            if hopped {
                server_session = now_here.is_some();
                here = now_here;
            }
        };
        forget_running(pid);
        let elapsed = start.elapsed().as_secs();
        if elapsed > written || new_session || server_session {
            record_playtime(&pname, elapsed - written, here.as_deref(), new_session, server_session);
        }
        let _ = app2.emit("game-exit", pname.clone());
        let waker = app2.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            crate::tray::restore_after_game(&waker);
        });
        /*
         * Итог для проверочной версии. Успехом считается либо чистый выход,
         * либо живая сессия: игрок закрывает окно кнопкой, и код возврата в
         * этот момент не говорит ничего, а полторы минуты в игре говорят всё.
         * Отправка живёт в своей задаче: поток выхода не должен ждать сеть.
         */
        let review_ok = matches!(&status, Ok(s) if s.success()) || elapsed >= LAUNCH_CHECK_ALIVE;
        if review_ok {
            let checked = pname.clone();
            tauri::async_runtime::spawn(async move {
                report_review_launch(&checked, true, &format!("сессия {} с", elapsed)).await;
            });
        }
        if was_stopped(pid) {
            return;
        }
        if matches!(&status, Ok(s) if !s.success()) {
            let log_text = crash_text(&gdir, start_wall);
            let verdict = crash_verdict(&log_text);
            let (mut reason, tail, mut kind) = (verdict.reason, verdict.tail, verdict.kind);
            let Blame { skin: skin_blamed, own: own_blamed, others } = blame(&log_text);
            // The injected skin mod must never break a profile permanently: if
            // the crash actually implicates it, remove it and say so. Anything
            // weaker than "implicates" costs the player their skins for nothing.
            if skin_blamed && drop_custom_skin_loader(&pname) {
                if others.is_empty() {
                    reason = "Мод скинов Millida не ужился со сборкой — мы его убрали. Запусти игру ещё раз.".into();
                    kind = "skin_mod";
                } else {
                    reason = mod_fault_reason(&others);
                }
            }
            // Наш мод ставится принудительно, и сломанный выпуск иначе делает
            // сборку неиграбельной навсегда: вернуть её игрок не может ничем.
            // Под карантин попадает конкретная версия — следующая поставится
            // сама, и косметика вернётся без его участия.
            else if own_blamed {
                let jar = own_mod_jar.clone();
                if !jar.is_empty() && quarantine_millida_mod(&pname, &jar) {
                    if others.is_empty() {
                        reason =
                            "Косметика Millida не запустилась на этой сборке — мы её отключили. Запусти игру ещё раз, а мы починим и вернём её сами."
                                .into();
                        kind = "own_mod";
                    } else {
                        // Наш мод убран молча: игроку нужны чужие моды, которые
                        // и держат сборку.
                        reason = mod_fault_reason(&others);
                    }
                }
            }
            let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned());
            let cause = super::crashcause::scrub_cause(&verdict.cause, home.as_deref(), &crash_nick);
            let _ = app2.emit("game-crash", diagnose(&pname, &reason, &tail, &log_text).classified(kind, cause));
            if !review_ok {
                let checked = pname.clone();
                let why = reason.clone();
                tauri::async_runtime::spawn(async move {
                    report_review_launch(&checked, false, &why).await;
                });
            }
        }
    });
    emit(&app, "launch", 100.0, "Игра запущена");
    Ok("started".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn legacy_args_of(mc_args: &str, extra: Value) -> Vec<String> {
        let mut v = serde_json::json!({
            "id": "1.7.10",
            "type": "release",
            "assetIndex": { "id": "1.7.10" },
            "minecraftArguments": mc_args,
        });
        if let Some(obj) = extra.as_object() {
            for (k, val) in obj {
                v[k] = val.clone();
            }
        }
        build_args(
            &v,
            "net.minecraft.client.main.Main",
            &[PathBuf::from("client.jar")],
            "Steve",
            Path::new("/games/build"),
            Path::new("/games/assets"),
            Path::new("/games/natives"),
            Path::new("/games/libraries"),
            &Auth::default(),
        )
    }

    /// вход -> вердикт. Every placeholder the released legacy argument strings
    /// actually use. 1.7.6-1.8.9 hand `--userProperties` straight to Gson, so an
    /// unexpanded `${user_properties}` is a syntax error that kills the game
    /// before the window opens — which is exactly how "не запускается ниже
    /// 1.12.2" looked to players.
    #[test]
    fn legacy_argument_strings_leave_no_placeholder() {
        // (game version, its real minecraftArguments, why the case is pinned)
        let cases: [(&str, &str, &str); 3] = [
            (
                "1.7.10",
                "--username ${auth_player_name} --version ${version_name} --gameDir ${game_directory} \
                 --assetsDir ${assets_root} --assetIndex ${assets_index_name} --uuid ${auth_uuid} \
                 --accessToken ${auth_access_token} --userProperties ${user_properties} --userType ${user_type}",
                "самая популярная старая версия: падала на ${user_properties}",
            ),
            (
                "1.6.4",
                "--username ${auth_player_name} --session ${auth_session} --version ${version_name} \
                 --gameDir ${game_directory} --assetsDir ${game_assets}",
                "виртуальные ассеты и сессия старого формата",
            ),
            (
                "1.5.2",
                "${auth_player_name} ${auth_session} --gameDir ${game_directory} --assetsDir ${game_assets}",
                "ник и сессия идут без имени аргумента — незамена превращается в ник игрока",
            ),
        ];
        for (version, mc_args, why) in cases {
            let args = legacy_args_of(mc_args, Value::Null);
            let left: Vec<&String> = args.iter().filter(|a| a.contains("${")).collect();
            assert!(
                left.is_empty(),
                "{version}: подстановка пропустила {left:?}. Зачем случай закреплён: {why}",
            );
        }
    }

    #[test]
    fn user_properties_expand_to_valid_json_and_session_carries_the_token() {
        let args = legacy_args_of("--userProperties ${user_properties} --session ${auth_session}", Value::Null);
        assert_eq!(args.iter().find(|a| a.starts_with('{')).map(String::as_str), Some("{}"),
                   "Gson разбирает это значение — пустой объект единственное, что она примет без данных");
        assert!(
            args.iter().any(|a| a.starts_with("token:0:")),
            "офлайн-сессия обязана быть в формате token:<токен>:<uuid>, получили {args:?}"
        );
    }

    /// A virtual asset index is laid out on disk during the install; pointing an
    /// old version at the object store instead gives it a world with no textures.
    #[test]
    fn game_assets_point_at_the_laid_out_directory_when_there_is_one() {
        let with = legacy_args_of(
            "--assetsDir ${game_assets}",
            serde_json::json!({ "millidaGameAssets": "/games/assets/virtual/legacy" }),
        );
        assert!(with.contains(&"/games/assets/virtual/legacy".to_string()), "получили {with:?}");
        let without = legacy_args_of("--assetsDir ${game_assets}", Value::Null);
        assert!(
            without.iter().any(|a| a.contains("assets")) && !without.iter().any(|a| a.contains("${")),
            "без разложенных ассетов остаётся обычный каталог, но не плейсхолдер: {without:?}"
        );
    }

    #[test]
    fn log4j_xml_event_becomes_plain_line() {
        let mut f = Log4jFilter::default();
        assert!(f
            .feed("<log4j:Event logger=\"net.minecraft.client.renderer.texture.TextureAtlas\" timestamp=\"1785450042062\" level=\"INFO\" thread=\"Render thread\">\n")
            .is_empty());
        assert_eq!(
            f.feed("  <log4j:Message><![CDATA[Created: 2048x2048x4 minecraft:textures/atlas/blocks.png-atlas]]></log4j:Message>\n"),
            vec!["[Render thread/INFO]: Created: 2048x2048x4 minecraft:textures/atlas/blocks.png-atlas"]
        );
        assert!(f.feed("</log4j:Event>\n").is_empty());
    }

    /// Stack traces arrive as multi-line CDATA.
    #[test]
    fn log4j_multiline_cdata_survives() {
        let mut f = Log4jFilter::default();
        f.feed("<log4j:Event logger=\"mixin\" level=\"ERROR\" thread=\"main\">\n");
        assert!(f.feed("<log4j:Throwable><![CDATA[java.lang.RuntimeException: boom\n").is_empty());
        assert_eq!(
            f.feed("\tat net.minecraft.Foo.bar(Foo.java:1)]]></log4j:Throwable>\n"),
            vec![
                "[main/ERROR]: java.lang.RuntimeException: boom".to_string(),
                "\tat net.minecraft.Foo.bar(Foo.java:1)".to_string()
            ]
        );
    }

    #[test]
    fn jvm_arg_verdicts() {
        // (input, should be accepted, why this case exists)
        let cases: &[(&str, bool, &str)] = &[
            ("-Xmx4G", true, "the memory flag is the main reason this setting exists"),
            ("-Xms512m", true, "initial heap size is a normal tuning flag"),
            ("-XX:+UseG1GC", true, "GC choice is what modded packs are tuned with"),
            ("-XX:MaxGCPauseMillis=200", true, "numeric -XX values must keep working"),
            ("-Dfile.encoding=UTF-8", true, "system properties are harmless and widely used"),
            ("-Dsomething=value", true, "arbitrary -D properties stay allowed"),
            ("--add-opens=java.base/java.lang=ALL-UNNAMED", true, "older mod loaders need this"),
            ("-javaagent:C:/evil.jar", false, "a Java agent runs attacker code inside the JVM"),
            ("-JAVAAGENT:evil.jar", false, "the check must be case-insensitive"),
            ("-agentpath:/tmp/evil.so", false, "a native agent runs attacker code as the user"),
            ("-agentlib:jdwp=transport=dt_socket,server=y", false, "jdwp opens a remote debugger into the JVM"),
            ("-Xrunevil", false, "the pre-JVMTI agent form does the same as -agentlib"),
            ("-XX:OnOutOfMemoryError=calc.exe", false, "the hook is a shell command run by the JVM"),
            ("-XX:OnError=cmd /c whoami", false, "same hook, fired on any VM error"),
            ("-XX:VMOptionsFile=evil.txt", false, "an options file smuggles back every blocked flag"),
            ("-Xbootclasspath/a:evil.jar", false, "boot classpath injects classes ahead of the game"),
            ("@evil.argfile", false, "argument files smuggle back every blocked flag"),
            ("-cp", false, "replacing the classpath would load attacker classes"),
            ("--module-path", false, "module path does the same for modules"),
            ("-p", false, "short form of --module-path"),
            ("evil.jar", false, "a bare token would be taken as the main class"),
            ("", false, "empty tokens are not flags"),
        ];

        for (input, expected_ok, why) in cases {
            let verdict = jvm_arg_allowed(input);
            assert_eq!(
                verdict, *expected_ok,
                "jvm_arg_allowed({input:?}) returned {verdict}, expected {expected_ok}. \
                 Reason this case is pinned: {why}",
            );
        }
    }

    /// Flags a player or a shared build can write: the white list.
    #[test]
    fn user_jvm_args_are_white_listed() {
        let aikar = "-Xms4G -Xmx4G -XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
            -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 \
            -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 \
            -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 \
            -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1 \
            -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true";
        // Aikar's two marker properties are harmless but not on the list: they
        // are dropped, everything that tunes the JVM passes
        let kept = sanitize_jvm_args(aikar);
        assert_eq!(kept.len(), aikar.split_whitespace().count() - 2, "{kept:?}");
        for good in [
            "-Xss4M", "-Xmn512m", "-XX:+UseZGC", "-XX:+ZGenerational", "-XX:+UseShenandoahGC",
            "-XX:ShenandoahGCMode=iu", "-XX:-UseAdaptiveSizePolicy", "-XX:+UseLargePages",
            "-Dfile.encoding=UTF-8", "-Dfml.ignoreInvalidMinecraftCertificates=true",
            "-Djava.net.preferIPv4Stack=true", "-Dlog4j2.formatMsgNoLookups=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
        ] {
            assert!(user_jvm_arg_allowed(good), "{good} — обычный флаг настройки");
        }
        for bad in [
            "-Dfabric.addMods=/tmp/evil.jar",
            "-Djava.library.path=/tmp",
            "-Dlog4j.configurationFile=http://evil/x.xml",
            "-Dlog4j2.configurationFile=/tmp/x.xml",
            "-XX:HeapDumpPath=/Users/x/.ssh/authorized_keys",
            "-Xlog:gc:file=/tmp/x",
            "-Xlog:file=/tmp/x",
            "-Xloggc:/tmp/x",
            "-XX:+HeapDumpOnOutOfMemoryError",
            "-XX:ErrorFile=/tmp/x",
            "-XX:OnError=calc",
            "-javaagent:x.jar",
            "-Dsomething=value",
            "-Dfile.encoding=../../x",
            "-Xmx4G;calc",
            "-XX:MaxGCPauseMillis=/tmp",
            "-cp",
            "@args.txt",
            "-Xbootclasspath/a:x.jar",
            "--add-opens=java.base/java.lang=ALL UNNAMED",
        ] {
            assert!(!user_jvm_arg_allowed(bad), "{bad} обязан отклоняться");
        }
    }

    /// Loader jsons keep the module path Forge needs, lose agents and strays.
    #[test]
    fn loader_jvm_args_keep_forge_module_path_and_drop_the_rest() {
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let forge = v(&["-DignoreList=a,b", "-p", "/libs/a.jar:/libs/b.jar", "--add-modules", "ALL-MODULE-PATH",
            "--add-opens", "java.base/java.util.jar=cpw.mods.securejarhandler"]);
        assert_eq!(filter_loader_jvm_args(forge.clone()), forge);
        let evil = v(&["-javaagent:/tmp/x.jar", "-cp", "/tmp/evil", "stray.Main", "-Dfabric.addMods=/tmp",
            "-Djava.library.path=/tmp", "-XX:HeapDumpPath=/tmp/x", "-Xlog:file=/tmp/x", "-p"]);
        assert!(filter_loader_jvm_args(evil).is_empty());
    }

    #[test]
    fn sanitize_keeps_tuning_and_drops_agents() {
        let raw = "-Xmx6G -javaagent:evil.jar -XX:+UseG1GC @argfile -XX:OnError=calc";
        assert_eq!(
            sanitize_jvm_args(raw),
            vec!["-Xmx6G".to_string(), "-XX:+UseG1GC".to_string()],
            "tuning flags must survive a settings file that also carries dangerous ones"
        );
        assert_eq!(
            rejected_jvm_arg(raw).as_deref(),
            Some("-javaagent:evil.jar"),
            "the first refused argument is reported so the user learns why it disappeared"
        );
        assert_eq!(rejected_jvm_arg("-Xmx6G -XX:+UseG1GC"), None, "a clean setting must not warn");
    }

    #[test]
    fn plain_lines_pass_through() {
        let mut f = Log4jFilter::default();
        assert_eq!(f.feed("[12:00:00] [main/INFO]: Loading\n"), vec!["[12:00:00] [main/INFO]: Loading"]);
    }

    /// Карантин собственного мода: за что он включается, а за что нет.
    ///
    /// Цена ошибки несимметрична. Не сработает — сборка не запускается вовсе и
    /// починить её игрок не может: мод ставится принудительно. Сработает зря —
    /// человек остаётся без косметики до следующего выпуска. Поэтому имя мода в
    /// обычной строке не считается, а отдельно ловится байткод новее игры: так
    /// выглядела поломка 16.09.2026, свалившая все модовые сборки разом.
    #[test]
    fn only_a_real_failure_quarantines_our_own_mod() {
        let cases: [(&str, bool, &str); 6] = [
            (
                "[main/INFO]: Loading 92 mods:
	- millida 0.1.0",
                false,
                "список загруженных модов печатается при КАЖДОМ запуске — это не поломка",
            ),
            (
                r"|  12 | Millida | millida | 0.1.0 | Forge | <game>\mods\millida-mod-forge-1.20.1-0.1.0.jar |",
                false,
                "таблица модов в отчёте о вылете повторяет те же имена",
            ),
            (
                "java.lang.UnsupportedClassVersionError: net/millida/mod/MillidaForge has been compiled by a more recent version of the Java Runtime",
                true,
                "мод собран под Java новее игры — ровно эта поломка валила все сборки",
            ),
            (
                "	at net.millida.mod.cosmetics.CosmeticRenderer.render(CosmeticRenderer.java:88)",
                true,
                "кадр стека в нашем моде — это и есть его отказ",
            ),
            (
                "[main/ERROR]: Mixin apply failed millida.mixins.json:PlayerTabOverlayMixin",
                true,
                "не лёгший мискин — классическое расхождение с версией игры",
            ),
            (
                "java.lang.UnsupportedClassVersionError: net/other/mod/Thing has been compiled by a more recent version",
                false,
                "чужой мод с тем же изъяном нашу косметику не отключает",
            ),
        ];
        for (text, expected, why) in cases {
            assert_eq!(
                own_mod_implicated(text),
                expected,
                "own_mod_implicated({text:?}) обязан быть {expected}. Закреплено потому, что: {why}"
            );
        }
    }

    /// Отказ загрузчика из-за чужого мода не обвиняет наши моды — дословно
    /// из GameCrash 25.09.2026 (Forge 1.20.1, walkers без craftedcore).
    #[test]
    fn a_loader_refusal_over_another_mod_blames_neither_of_ours() {
        let log = "[25сент.2026 13:29:03.409] [main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:\n\
                   \tMod ID: 'minecraft', Requested by: 'walkers', Expected range: '[1.20.4,)', Actual version: '1.20.1'\n\
                   \tMod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'\n\
                   [25сент.2026 13:29:05.189] [main/INFO] [CustomSkinLoader Bootstrap/]: Loaded 4 CustomSkinLoader bootstrap transformer(s)\n\
                   [25сент.2026 13:29:05.300] [main/ERROR] [customskinloader.Bootstrap/]: Failed to transform class: java.lang.IllegalStateException\n\
                   \tat customskinloader.forge.Transformer.apply(Transformer.java:10)";
        let b = blame(log);
        assert!(!b.skin && !b.own, "виноват walkers, скины и косметику не трогаем");
        assert_eq!(b.others.first().map(|f| f.name.as_str()), Some("walkers"));

        let own = "[main/ERROR]: Incompatible mods found!\n\t - Mod 'Millida' (millida) 0.1.11 requires any version of fabric-api, which is missing!";
        let b = blame(own);
        assert!(b.own && b.others.is_empty(), "отказ назвал наш мод — он и уходит в карантин, чтобы не падать каждый запуск");
    }

    /// Окно — только до меню. «GLFW»/«OpenGL» в отчёте о вылете посреди игры
    /// окно не обвиняют (112 из 344 таких вердиктов — после 10 минут игры).
    #[test]
    fn window_failure_is_a_startup_verdict() {
        let early = "[Render thread/ERROR]: GLFW error 65542: WGL: The driver does not appear to support OpenGL";
        assert_eq!(crash_verdict(early).kind, "gpu");
        let late = "[Sound Library Loader/INFO]: Sound engine started\n[Render thread/INFO]: Created: 1024x512x4 minecraft:textures/atlas/blocks.png-atlas\n\
                    ---- Minecraft Crash Report ----\nDescription: Ticking entity\n\njava.lang.NullPointerException: pixel format\n\tat com.foo.Bar.tick(Bar.java:1)";
        let v = crash_verdict(late);
        assert_ne!(v.kind, "gpu", "окно давно открыто — вылет не про него");
        assert!(v.cause.contains("NullPointerException"), "причина достаётся из отчёта: {}", v.cause);
    }

    /// The line the mod is named on decides whether it is the culprit.
    /// Every loader prints its jar list on a healthy launch, so the name by
    /// itself is not evidence — that is what cost players their skins after an
    /// unrelated crash.
    #[test]
    fn only_a_failing_line_blames_the_skin_mod() {
        let cases: &[(&str, bool, &str)] = &[
            (
                "|     4 | CustomSkinLoader | customskinloader | 15.0.1 | Quilt | <game>\\mods\\CustomSkinLoader.jar |",
                false,
                "the loader prints this table on EVERY launch — it is not a crash",
            ),
            (
                "[main/INFO]: Loading 4 mods:\ncustomskinloader: CustomSkinLoader 15.0.1",
                false,
                "the mod list inside a crash report repeats the same names",
            ),
            (
                "\tat customskinloader.fabric.CustomSkinLoader.init(CustomSkinLoader.java:42)",
                true,
                "a stack frame in the mod is what an actual fault looks like",
            ),
            (
                "[main/ERROR]: Mixin apply failed customskinloader.mixins.json:MixinSkinManager",
                true,
                "a mixin that fails to apply is the classic version mismatch",
            ),
            (
                "[main/ERROR]: Could not execute entrypoint stage 'client' due to errors, provided by 'customskinloader'!",
                true,
                "a loader complaint naming the mod is a direct accusation",
            ),
            (
                "[Render thread/ERROR]: java.lang.NullPointerException\n\tat net.minecraft.client.Foo.bar(Foo.java:1)",
                false,
                "a crash that never mentions the mod must leave the skins alone",
            ),
        ];
        for (text, expected, why) in cases {
            assert_eq!(
                skin_mod_implicated(text),
                *expected,
                "skin_mod_implicated({text:?}) must be {expected}. Reason this case is pinned: {why}",
            );
        }
    }

    /// Жалоба 14.08.2026: сборку с Modrinth перенесли на другую версию, игра
    /// вылетала при входе на сервер, а лаунчер отвечал «конфликт модов» — по
    /// такому вердикту пятидесяти модов вручную не разобрать.
    #[test]
    fn resolution_failure_names_the_mods() {
        let cases: &[(&str, &str, bool, &str)] = &[
            (
                "\t - Mod 'Sodium' (sodium) 0.5.8 requires version 1.20.1 of minecraft, but only the wrong version is present: 1.21.1!",
                "Sodium",
                true,
                "Fabric: требование к самой игре = мод собран под другую версию",
            ),
            (
                "\t - Mod 'Iris Shaders' (iris) 1.6.9 requires any version of fabric-api, which is missing!",
                "Iris Shaders",
                false,
                "то же место, но не хватает соседнего мода — это другая починка",
            ),
            (
                "\tMod ID: 'minecraft', Requested by: 'jei', Expected range: '[1.21,1.21.1]', Actual version: '1.21.4'",
                "jei",
                true,
                "NeoForge пишет виновника в Requested by, а требование — в Mod ID",
            ),
            (
                "\tMod ID: 'curios', Requested by: 'artifacts', Expected range: '[5.0,)', Actual version: '[MISSING]'",
                "artifacts",
                false,
                "тот же формат, но не хватает мода-зависимости, а не версии игры",
            ),
        ];
        for (line, name, wrong_version, why) in cases {
            let faults = mod_faults(line);
            assert_eq!(
                faults,
                vec![ModFault { name: name.to_string(), wrong_version: *wrong_version }],
                "строка {line:?} обязана назвать мод. Зачем случай закреплён: {why}",
            );
        }

        assert!(
            mod_faults("[main/INFO]: Loading 4 mods:\n| 1 | Sodium | sodium | 0.5.8 | Fabric |").is_empty(),
            "таблица загруженных модов печатается на каждом здоровом запуске — обвинять по ней нельзя"
        );

        let both = "\t - Mod 'Sodium' (sodium) 0.5.8 requires version 1.20.1 of minecraft, but only the wrong version is present: 1.21.1!\n\
                    \t - Mod 'Iris Shaders' (iris) 1.6.9 requires version 1.20.1 of minecraft, but only the wrong version is present: 1.21.1!";
        let reason = mod_fault_reason(&mod_faults(both));
        assert!(
            reason.contains("Sodium") && reason.contains("Iris Shaders") && reason.contains("другую версию"),
            "вердикт обязан перечислить моды и сказать, что с ними делать; получили: {reason}"
        );
    }

    #[test]
    fn problematic_frame_names_the_native_library() {
        let hs = "#\n# A fatal error has been detected by the Java Runtime Environment:\n#\n#  EXCEPTION_ACCESS_VIOLATION (0xc0000005)\n#\n# Problematic frame:\n# C  [nvoglv64.dll+0x9a1b30]\n#\n";
        assert_eq!(
            problematic_frame(hs).as_deref(),
            Some("C  [nvoglv64.dll+0x9a1b30]"),
            "без кадра падения вылет в драйвере неотличим от любого другого"
        );
        assert_eq!(problematic_frame("just a log"), None);
    }

    /// Вход → вердикт для чтения лога. Закреплено, потому что каждая строка
    /// стоила пустого окна логов у игрока на русской Windows.
    #[test]
    fn log_bytes_survive_console_code_page() {
        let utf8 = "[main/INFO]: Загрузка модов".as_bytes().to_vec();
        assert_eq!(
            decode_log_bytes(&utf8),
            "[main/INFO]: Загрузка модов",
            "UTF-8 обязан читаться как есть — иначе портим то, что не сломано"
        );

        let mut cp1251: Vec<u8> = b"[main/INFO]: ".to_vec();
        cp1251.extend_from_slice(&[0xc7, 0xe0, 0xe3, 0xf0, 0xf3, 0xe7, 0xea, 0xe0]);
        assert_eq!(
            decode_log_bytes(&cp1251),
            "[main/INFO]: Загрузка",
            "строка в кодировке консоли обязана прочитаться словами, а не мусором"
        );

        assert!(
            !decode_log_bytes(&[0xff, 0xfe, 0x00]).is_empty(),
            "нечитаемые байты не повод отдать пустую строку: так лента лога обрывалась молча"
        );
    }

    /// Файл лога в кодировке консоли раньше терялся целиком: `read_to_string`
    /// отдавал ошибку, а вызывающий подставлял пустую строку — и разбор падения
    /// оставался без единственной улики.
    #[test]
    fn crash_text_reads_non_utf8_log() {
        let dir = std::env::temp_dir().join("millida-crash-encoding-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        let mut line = b"[main/ERROR]: ".to_vec();
        line.extend_from_slice(&[0xcc, 0xee, 0xe4, 0x20]);
        line.extend_from_slice(b"customskinloader.CustomSkinLoader.init(X.java:1)");
        std::fs::write(dir.join("logs/latest.log"), &line).unwrap();

        let text = crash_text(&dir, std::time::SystemTime::now());
        assert!(
            text.contains("Мод"),
            "лог в кодировке консоли обязан доехать до разбора; получили: {text:?}"
        );
    }

    /// A crash report left by an earlier run is not evidence about this launch.
    /// Reading it is exactly how a stale CustomSkinLoader crash kept removing the
    /// mod from a build whose current crash had another cause.
    #[test]
    fn stale_evidence_is_not_read() {
        let dir = std::env::temp_dir().join("millida-crash-freshness-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("crash-reports")).unwrap();
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        let stale = dir.join("crash-reports/crash-old.txt");
        std::fs::write(
            &stale,
            "---- Minecraft Crash Report ----\nDescription: Initializing game\n\njava.lang.NullPointerException\n\tat customskinloader.CustomSkinLoader.init(X.java:1)",
        )
        .unwrap();
        std::fs::write(dir.join("logs/latest.log"), "[main/INFO]: Loading 3 mods").unwrap();

        // Дата файлов = «сейчас», а запуск считаем случившимся сильно позже.
        let much_later = std::time::SystemTime::now() + std::time::Duration::from_secs(3600);
        let text = crash_text(&dir, much_later);
        assert!(
            text.trim().is_empty(),
            "логи и отчёты старше запуска обязаны игнорироваться, иначе прошлый вылет объявляется причиной нового; получили: {text:?}"
        );
        assert!(
            !skin_mod_implicated(&text),
            "мод скинов нельзя обвинять по чужому отчёту — именно так сборка теряла скины и продолжала падать"
        );

        let text_now = crash_text(&dir, std::time::SystemTime::now());
        assert!(
            skin_mod_implicated(&text_now),
            "свежий отчёт с кадром в моде обязан читаться, иначе мы перестанем чинить реальный конфликт"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// (кадр падения → вендор, зачем случай закреплён)
    #[test]
    fn driver_frames_are_recognised_by_vendor() {
        let cases: &[(&str, Option<&str>, &str)] = &[
            (
                "C  [atio6axx.dll+0x196200]",
                Some("AMD"),
                "реальный отчёт игрока 09.08.2026: OpenGL-драйвер AMD, MC 1.21.11",
            ),
            ("C  [nvoglv64.dll+0x9a1b30]", Some("NVIDIA"), "тот же вылет на карте NVIDIA"),
            ("C  [igdumdim64.dll+0x1234]", Some("Intel"), "встроенная графика Intel"),
            ("C  [opengl32.dll+0x10]", Some(""), "слой API назван, вендор — нет"),
            ("V  [jvm.dll+0x5f0a2b]", None, "падение в самой JVM драйвером не является"),
            (
                "j  net.minecraft.client.Minecraft.run()V+12",
                None,
                "кадр в коде игры не должен отправлять игрока обновлять драйвер",
            ),
        ];
        for (frame, expected, why) in cases {
            assert_eq!(
                gpu_driver_vendor(frame),
                *expected,
                "gpu_driver_vendor({frame:?}) должен вернуть {expected:?}. Зачем случай закреплён: {why}",
            );
        }
    }

    #[test]
    fn native_driver_crash_gets_its_own_reason() {
        let dir = std::env::temp_dir().join("millida-crash-hserr-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        // Дословно из отчёта игрока (09.08.2026, сборка «vvvv», MC 1.21.11).
        std::fs::write(
            dir.join("hs_err_pid16520.log"),
            "#\n# A fatal error has been detected by the Java Runtime Environment:\n#\n\
             #  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ff93c726200, pid=16520, tid=17728\n#\n\
             # JRE version: OpenJDK Runtime Environment Temurin-25.0.4+7\n# Problematic frame:\n\
             # C  [atio6axx.dll+0x196200]\n#\n",
        )
        .unwrap();

        let (reason, _) = analyze_crash(&dir, std::time::SystemTime::now());
        assert!(
            reason.contains("драйвер") && reason.contains("AMD"),
            "вылет в atio6axx.dll обязан читаться как драйвер AMD, иначе игрок опять услышит «виноват мод скинов»; получили: {reason}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn jvm_history_in_hs_err_is_not_crash_evidence() {
        let process_section = "---------------  P R O C E S S  ---------------\n\
             Internal exceptions (10 events):\n\
             Event: 3.412 Thread 0x000001d2 Exception <a 'java/lang/NoSuchMethodError'{0x00000007}: 'java.lang.Object java.lang.invoke.DirectMethodHandle$Holder.invokeStatic(java.lang.Object, java.lang.Object)'> (0x00000007) thrown [s\\src\\hotspot\\share\\interpreter\\linkResolver.cpp, line 773]\n\
             Event: 3.518 Thread 0x000001d2 Exception <a 'java/lang/ClassNotFoundException'{0x00000008}: net/millida/mod/compat/Probe> (0x00000008) thrown [s\\src\\hotspot\\share\\classfile\\systemDictionary.cpp, line 312]\n\
             Dynamic libraries:\n0x00007ff6 C:\\Windows\\SYSTEM32\\glfw.dll\n";
        let cases: &[(&str, &str, &str)] = &[
            (
                "C  [atio6axx.dll+0x196200]",
                "AMD",
                "вылет в драйвере AMD на свежей сборке NeoForge 1.21.1 (Supra_hab, 19.09.2026) читался как «мод собран под другую версию» из-за NoSuchMethodError в истории JVM",
            ),
            (
                "V  [jvm.dll+0x5f0a2b]",
                "Java аварийно",
                "падение в самой JVM без драйвера — отчёт hs_err нужен поддержке, а не поиск мода",
            ),
        ];
        for (frame, expected, why) in cases {
            let dir = std::env::temp_dir().join(format!("millida-hserr-history-{}", frame.len()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("logs")).unwrap();
            std::fs::write(
                dir.join("logs/latest.log"),
                "[main/INFO]: ModLauncher running\n[main/WARN]: Skipping optional integration: java.lang.NoClassDefFoundError: dev/emi/emi/api/EmiPlugin",
            )
            .unwrap();
            std::fs::write(
                dir.join("hs_err_pid4242.log"),
                format!(
                    "#\n# A fatal error has been detected by the Java Runtime Environment:\n#\n\
                     #  EXCEPTION_ACCESS_VIOLATION (0xc0000005)\n#\n# Problematic frame:\n# {frame}\n#\n{process_section}"
                ),
            )
            .unwrap();

            let (reason, _) = analyze_crash(&dir, std::time::SystemTime::now());
            let text = crash_text(&dir, std::time::SystemTime::now());
            let _ = std::fs::remove_dir_all(&dir);

            assert!(
                reason.contains(expected),
                "кадр {frame:?}: вердикт обязан содержать {expected:?}, получили {reason:?}. Зачем случай закреплён: {why}"
            );
            assert!(
                !own_mod_implicated(&text),
                "кадр {frame:?}: промах поиска класса мода в истории JVM не повод отправлять косметику в карантин. Зачем случай закреплён: {why}"
            );
        }
    }

    /// Тот же отчёт не должен по пути превратиться в обвинение мода скинов:
    /// именно так игрок и потерял скины, ни разу не узнав про драйвер.
    #[test]
    fn a_driver_crash_never_costs_the_player_their_skins() {
        let log = "[main/INFO]: Loading 4 mods:\n\
                   |     4 | CustomSkinLoader | customskinloader | 15.0.1 | Quilt | mods\\CustomSkinLoader.jar |\n\
                   [Render thread/INFO]: Backend library: LWJGL version 3.4.1+2\n\
                   # Problematic frame:\n# C  [atio6axx.dll+0x196200]";
        assert!(
            !skin_mod_implicated(log),
            "мод назван только в таблице загрузки — трогать его нельзя, вылет в драйвере видеокарты"
        );
    }

    #[test]
    fn rejected_auth_server_certificate_gets_its_own_reason() {
        let cases: &[(&str, bool, &str)] = &[
            (
                "[authlib-injector] [INFO] Authentication server: https://api.millida.net/v2/yggdrasil\n\
                 [authlib-injector] [ERROR] Failed to fetch metadata: javax.net.ssl.SSLHandshakeException: sun.security.validator.ValidatorException: PKIX path building failed: sun.security.provider.certpath.SunCertPathBuilderException: unable to find valid certification path to requested target",
                true,
                "дословно из заявки игрока (1.16.5 Fabric на Java 8): агент закрывает JVM через секунды, а окно вылета отвечало «Загляни в лог»",
            ),
            (
                "[authlib-injector] [ERROR] Failed to fetch metadata: javax.net.ssl.SSLHandshakeException: (certificate_unknown) PKIX path building failed",
                true,
                "так тот же отказ пишет Java 11 и новее",
            ),
            (
                "[authlib-injector] [ERROR] Failed to fetch metadata: java.net.UnknownHostException: api.millida.net",
                false,
                "нет связи с сервером — это не сертификат, и совет выключить проверку HTTPS увёл бы игрока не туда",
            ),
            (
                "[main/WARN]: Update check failed: javax.net.ssl.SSLHandshakeException: PKIX path building failed",
                false,
                "мод не проверил своё обновление — игре это не мешает, причину вылета надо искать дальше",
            ),
        ];
        for (i, (log, expected, why)) in cases.iter().enumerate() {
            let dir = std::env::temp_dir().join(format!("millida-crash-auth-cert-{i}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("logs")).unwrap();
            std::fs::write(dir.join("logs/launcher-latest.log"), log).unwrap();

            let (reason, _) = analyze_crash(&dir, std::time::SystemTime::now());
            let _ = std::fs::remove_dir_all(&dir);

            assert_eq!(
                reason.contains("сертификату сервера входа"),
                *expected,
                "лог {log:?}: получили {reason:?}. Зачем случай закреплён: {why}"
            );
            if *expected {
                let diag = diagnose("Test", &reason, "", log);
                assert!(
                    diag.actions.iter().any(|a| a.kind == "install-java"),
                    "кнопка «Поставить Java» — починка в один клик для устаревшей Java 8: она скачивает свежую и закрепляет её за сборкой, поэтому вердикт обязан её показывать"
                );
            }
        }
    }

    #[test]
    fn system_memory_exhaustion_is_not_a_heap_verdict() {
        const HEAP: &str = "Не хватило оперативной памяти. Добавь ОЗУ в настройках сборки.";
        let cases: &[(&str, &str, &str)] = &[
            (
                "[Server thread/WARN] [mixin/]: Method overwrite conflict for removeIf\n\
                 java.lang.OutOfMemoryError\n#\n\
                 # There is insufficient memory for the Java Runtime Environment to continue.\n\
                 # Native memory allocation (malloc) failed to allocate 1107856 bytes. Error detail: Chunk::new",
                SYSTEM_MEMORY_REASON,
                "заявка hnophen 23.09 (Biohazard, 16 ГБ): ставил 12, 10, 8, 4 ГБ — окно каждый раз советовало добавить ОЗУ, а кончилась память Windows",
            ),
            (
                "Error occurred during initialization of VM\nCould not reserve enough space for 12582912KB object heap",
                SYSTEM_MEMORY_REASON,
                "JVM не смогла даже зарезервировать кучу — совет прибавить ОЗУ повторяет ту же ошибку",
            ),
            (
                "# Native memory allocation (mmap) failed to map 268435456 bytes. Error detail: G1 virtual space\n\
                 # The paging file is too small for this operation to complete",
                SYSTEM_MEMORY_REASON,
                "так пишет Windows с выключенным файлом подкачки",
            ),
            (
                "[Server thread/ERROR]: Encountered an unexpected exception\njava.lang.OutOfMemoryError: Java heap space",
                HEAP,
                "настоящая нехватка кучи — тут прибавка ОЗУ и есть лечение",
            ),
        ];
        for (i, (log, expected, why)) in cases.iter().enumerate() {
            let dir = std::env::temp_dir().join(format!("millida-crash-system-memory-{i}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("logs")).unwrap();
            std::fs::write(dir.join("logs/launcher-latest.log"), log).unwrap();

            let (reason, _) = analyze_crash(&dir, std::time::SystemTime::now());
            let _ = std::fs::remove_dir_all(&dir);

            assert_eq!(&reason, expected, "лог {log:?}. Зачем случай закреплён: {why}");
            let offers_more_ram = diagnose("Test", &reason, "", log).actions.iter().any(|a| a.kind == "set-ram");
            assert_eq!(
                offers_more_ram,
                *expected == HEAP,
                "кнопка «Выделить N ГБ» уместна только при нехватке кучи; при нехватке памяти Windows она ускоряет следующий вылет. Зачем случай закреплён: {why}"
            );
        }
    }

    #[test]
    fn missing_dependency_verdict_needs_the_loader_refusal() {
        const VERDICT: &str = "Не хватает зависимости одного из модов.";
        let cases: &[(&str, bool, &str)] = &[
            (
                "[main/WARN] [net.minecraftforge.fml.loading.moddiscovery.ModFileParser/LOADING]: Mod file C:\\Users\\Nest\\AppData\\Roaming\\net.millida.launcher\\minecraft\\libraries\\net\\minecraftforge\\fmlcore\\1.20.1-47.4.10\\fmlcore-1.20.1-47.4.10.jar is missing mods.toml file\n\
                 [main/INFO] [cpw.mods.modlauncher.LaunchServiceHandler/MODLAUNCHER]: Launching target 'forgeclient' with arguments\n\
                 [Render thread/INFO] [minecraft/Minecraft]: Backend library: LWJGL version 3.3.1",
                false,
                "заявка 21.09 (Immortal): Forge пишет «is missing mods.toml file» на каждом здоровом запуске — 1104 вылета Forge за два дня получили ложный вердикт",
            ),
            (
                "[main/INFO]: Loading 258 mods, requires Java 17\n[Render thread/INFO]: Mod 'create' registered 412 blocks",
                false,
                "слова requires и mod в обычных строках загрузки — это не отказ загрузчика",
            ),
            (
                "[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:",
                true,
                "отказ Forge/NeoForge 1.13+, у которого хвост лога срезал строки с именами модов: заголовка достаточно для вердикта",
            ),
            (
                "net.minecraftforge.fml.common.MissingModsException: Mod ic2 (IndustrialCraft 2) requires [forge@[14.23.5.2847,)]",
                true,
                "так отказывает Forge 1.12 — сборки на нём всё ещё в каталоге",
            ),
        ];
        for (i, (log, expected, why)) in cases.iter().enumerate() {
            let dir = std::env::temp_dir().join(format!("millida-crash-missing-dep-{i}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("logs")).unwrap();
            std::fs::write(dir.join("logs/launcher-latest.log"), log).unwrap();

            let (reason, _) = analyze_crash(&dir, std::time::SystemTime::now());
            let _ = std::fs::remove_dir_all(&dir);

            assert_eq!(
                reason == VERDICT,
                *expected,
                "лог {log:?}: получили {reason:?}. Зачем случай закреплён: {why}"
            );
        }
    }
}
