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

fn read_fresh(path: &Path, since: std::time::SystemTime) -> Option<String> {
    is_fresh(path, since).then(|| std::fs::read_to_string(path).ok())?
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
    std::fs::read_to_string(&p).ok()
}

/// Captured stdout plus the game's own latest.log, the newest crash report and a
/// JVM fatal-error log — all of them only if written by THIS launch. Fabric and
/// Quilt report mod resolution and mixin failures only in latest.log.
pub(crate) fn crash_text(game_dir: &Path, since: std::time::SystemTime) -> String {
    let mut text = read_fresh(&game_dir.join("logs/launcher-latest.log"), since).unwrap_or_default();
    for extra in [
        read_fresh(&game_dir.join("logs/latest.log"), since),
        newest_crash_report(game_dir, since).and_then(|p| std::fs::read_to_string(p).ok()),
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

/// Lines that carry a failure. A mod is named on plenty of healthy lines — the
/// loader prints a table of every jar it loaded, and a crash report repeats that
/// list — so the name alone proves nothing.
const FAILURE_MARKERS: [&str; 8] =
    ["/error]", "/fatal]", "exception", "caused by", "\tat ", "error:", "failed", "could not"];

/// True only when the injected skin mod appears in a line that is itself a
/// failure: a stack frame, a mixin apply error, a loader complaint.
///
/// Matching the bare name anywhere in the log blamed the mod for every crash in
/// a build that merely had it installed — the loader's "Loading N mods" table
/// names it on every single launch. The build then lost its skins and kept
/// crashing for the original, still undiagnosed reason.
fn skin_mod_implicated(text: &str) -> bool {
    text.lines().any(|l| {
        let low = l.to_lowercase();
        low.contains("customskinloader") && FAILURE_MARKERS.iter().any(|m| low.contains(m))
    })
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

pub(crate) fn analyze_crash(game_dir: &Path, since: std::time::SystemTime) -> (String, String) {
    let text = crash_text(game_dir, since);
    let low = text.to_lowercase();
    // "Problematic frame" is written by nothing but a JVM fatal-error log, so it
    // stands on its own: a truncated hs_err (the header cut off by a rotating
    // tail, a report the player pasted from the middle) must still be diagnosed.
    let fatal_jvm = low.contains("a fatal error has been detected by the java runtime")
        || low.contains("# problematic frame:");
    let gpu_vendor = fatal_jvm
        .then(|| problematic_frame(&text))
        .flatten()
        .and_then(|f| gpu_driver_vendor(&f));
    let faults = mod_faults(&text);
    let reason = if low.contains("outofmemoryerror") || low.contains("could not reserve enough space") || low.contains("out of memory") {
        "Не хватило оперативной памяти. Добавь ОЗУ в настройках сборки."
    } else if low.contains("unsupportedclassversionerror") || low.contains("class file version") || low.contains("compiled by a more recent version of the java") {
        "Нужна другая версия Java для этой сборки."
    } else if !faults.is_empty() {
        return (mod_fault_reason(&faults), crash_tail(&text));
    } else if low.contains("mandatory dependencies") || low.contains("missing mods") || (low.contains("requires") && low.contains("mod")) {
        "Не хватает зависимости одного из модов."
    } else if low.contains("duplicate mods") || low.contains("incompatible mod") || low.contains("found a duplicate mod")
        || low.contains("mod resolution encountered an incompatible mod set") || low.contains("duplicate mod") {
        "Конфликт модов — есть дубли или несовместимые моды."
    } else if low.contains("mixin apply failed") || low.contains("mixinapplyerror") || low.contains("mixintransformererror") {
        "Один из модов не подошёл к этой версии игры (ошибка миксина)."
    } else if low.contains("nosuchmethoderror")
        || low.contains("noclassdeffounderror")
        || low.contains("nosuchfielderror")
        || low.contains("incompatibleclasschangeerror")
    {
        // Загрузчик пропустил мод, а код внутри него зовёт то, чего в этой версии
        // игры уже нет. Так падает сборка, перенесённая на другую версию, — часто
        // не на запуске, а при входе на сервер, когда мод впервые доходит до дела.
        "Один из модов собран под другую версию игры: он зовёт код, которого в ней нет. Обнови моды сборки под её версию."
    } else if let Some(vendor) = gpu_vendor {
        return (driver_crash_reason(vendor), crash_tail(&text));
    } else if low.contains("glfw") || low.contains("pixel format") || low.contains("failed to create window") || low.contains("no opengl") {
        "Игра не смогла открыть окно — дело в видеокарте или её драйвере. Обнови драйвер видеокарты."
    } else if fatal_jvm {
        "Java аварийно завершилась. Отчёт hs_err_pid лежит в папке сборки — пришли его в поддержку."
    } else if text.trim().is_empty() {
        "Игра закрылась без единой строчки в логе — чаще всего её закрыл антивирус. Добавь папку игры в исключения."
    } else {
        "Игра вылетела. Загляни в лог — там причина."
    };
    (reason.to_string(), crash_tail(&text))
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

fn spawn_log_reader(reader: Box<dyn std::io::Read + Send>, file: Arc<Mutex<std::fs::File>>, app: AppHandle) {
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

    std::thread::spawn(move || {
        use std::io::{BufRead, Write};
        let mut buf = std::io::BufReader::new(reader);
        let mut line = String::new();
        let mut filter = Log4jFilter::default();
        loop {
            line.clear();
            match buf.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
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
/// fired on VM errors, and options that decide which classes get loaded. Stored
/// settings are replayed on every launch, so one accepted flag would be code
/// execution on every start.
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

/// The first argument the launcher refuses to pass on, if any.
pub fn rejected_jvm_arg(raw: &str) -> Option<String> {
    raw.split_whitespace().find(|a| !jvm_arg_allowed(a)).map(str::to_string)
}

pub fn sanitize_jvm_args(raw: &str) -> Vec<String> {
    raw.split_whitespace().filter(|a| jvm_arg_allowed(a)).map(str::to_string).collect()
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
    if v["arguments"].is_object() {
        collect(&v["arguments"]["jvm"], &mut args);
        if let Some(fj) = v.get("fabricArguments") {
            collect(&fj["jvm"], &mut args);
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
            collect(&fj["jvm"], &mut args);
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
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
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
    let (v, main_class, classpath, java) =
        install_loader_with_java(&app, &version_id, &loader_id, loader_ver.as_deref(), java_pick).await?;
    check_cancel()?;
    let root = game_root_ready()?;
    let game_dir = profile_dir(&profile);
    std::fs::create_dir_all(game_dir.join("mods")).ok();
    let assets_root = game_root().join("assets");
    let resolved_vid = v["id"].as_str().unwrap_or(&version_id).to_string();
    let natives_dir = root.join("versions").join(&resolved_vid).join("natives");
    let libraries_dir = root.join("libraries");

    check_cancel()?;
    emit(&app, "launch", 92.0, "Запускаем игру…");
    // authlib-injector redirects Yggdrasil to a custom auth server. Without the
    // agent the game would authenticate against Mojang with a non-Mojang token
    // and fail session checks, so a failure here falls back to offline mode.
    let mut auth = auth;
    let mut agent: Option<String> = None;
    if !auth.yggdrasil.is_empty() {
        match ensure_authlib_injector().await {
            Ok(jar) => agent = Some(format!("-javaagent:{}={}", jar.to_string_lossy(), auth.yggdrasil)),
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
    if matches!(loader_id.as_str(), "fabric" | "quilt" | "forge" | "neoforge") {
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
    } else if let Some(why) = in_game_skin_blocker(&loader_id, !auth.token.is_empty(), want_skin) {
        warn(&app, why);
    }
    let mut args = build_args(&v, &main_class, &classpath, &nick, &game_dir, &assets_root, &natives_dir, &libraries_dir, &auth);
    args.insert(0, format!("-Xmx{}M", tuned_ram_mb(&profile, ram_mb)));
    if let Some(a) = agent { args.insert(1, a); }
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
    let log_file = std::fs::File::create(logs.join("launcher-latest.log")).map_err(|e| e.to_string())?;
    let mut quick_server: Option<String> = None;
    if let Some((w, sv)) = QUICK.lock().unwrap().clone() {
        if let Some(w) = w { args.push("--quickPlaySingleplayer".into()); args.push(w); }
        if let Some(sv) = sv {
            quick_server = Some(sv.clone());
            args.push("--quickPlayMultiplayer".into());
            args.push(sv);
        }
    }
    check_cancel()?;
    let exe = branded_java(&java);
    let mut cmd = Command::new(&exe);
    // CREATE_NO_WINDOW on Windows, otherwise every launch pops a console window.
    quiet(&mut cmd);
    apply_gpu_pref(&mut cmd, &exe, GpuPref::parse(settings["gpu"].as_str().unwrap_or("auto")));
    cmd.args(&args)
        .current_dir(&game_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let start = std::time::Instant::now();
    // Wall clock too: crash evidence is filtered by file mtime, and Instant has
    // no common ground with a file timestamp.
    let start_wall = std::time::SystemTime::now();
    let mut child = cmd.spawn().map_err(|e| format!("Запуск Java: {}", e))?;
    if cancelled() {
        let _ = child.kill();
        return Err("Запуск отменён".into());
    }
    let _ = app.emit("game-log-start", &profile);
    let log_file = Arc::new(Mutex::new(log_file));
    if let Some(o) = child.stdout.take() {
        spawn_log_reader(Box::new(o), log_file.clone(), app.clone());
    }
    if let Some(e) = child.stderr.take() {
        spawn_log_reader(Box::new(e), log_file.clone(), app.clone());
    }
    // Give the JVM a moment: an immediate exit is a launch failure, not a session.
    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    if let Ok(Some(status)) = child.try_wait() {
        if !status.success() {
            let log = std::fs::read_to_string(logs.join("launcher-latest.log")).unwrap_or_default();
            let tail: Vec<&str> = log.lines().rev().take(20).collect();
            let tail: String = tail.into_iter().rev().collect::<Vec<_>>().join("\n");
            return Err(format!("Игра не запустилась (код {:?}).\n{}", status.code(), tail));
        }
    }
    let pname = profile.clone();
    let app2 = app.clone();
    let gdir = game_dir.clone();
    let pid = child.id();
    if let Ok(mut v) = RUNNING.lock() {
        v.push((profile.clone(), pid));
    }
    std::thread::spawn(move || {
        let mut written = 0u64;
        let mut new_session = true;
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
                Err(e) => break Err(e),
                Ok(None) => {}
            }
            std::thread::sleep(EXIT_POLL);
            let elapsed = start.elapsed().as_secs();
            if elapsed - written >= PLAYTIME_FLUSH.as_secs() {
                record_playtime(&pname, elapsed - written, quick_server.as_deref(), new_session);
                written = elapsed;
                new_session = false;
            }
        };
        forget_running(pid);
        let elapsed = start.elapsed().as_secs();
        if elapsed > written || new_session {
            record_playtime(&pname, elapsed - written, quick_server.as_deref(), new_session);
        }
        let _ = app2.emit("game-exit", pname.clone());
        let waker = app2.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            crate::tray::restore_after_game(&waker);
        });
        if was_stopped(pid) {
            return;
        }
        if matches!(&status, Ok(s) if !s.success()) {
            let (mut reason, tail) = analyze_crash(&gdir, start_wall);
            // The injected skin mod must never break a profile permanently: if
            // the crash actually implicates it, remove it and say so. Anything
            // weaker than "implicates" costs the player their skins for nothing.
            let log_text = crash_text(&gdir, start_wall);
            if skin_mod_implicated(&log_text) && drop_custom_skin_loader(&pname) {
                reason = "Мод скинов Millida не ужился со сборкой — мы его убрали. Запусти игру ещё раз.".into();
            }
            let _ = app2.emit("game-crash", diagnose(&pname, &reason, &tail, &log_text));
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
        std::fs::write(&stale, "\tat customskinloader.CustomSkinLoader.init(X.java:1)").unwrap();
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
}
