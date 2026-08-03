use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// Running games: profile name -> JVM process pid.
pub static RUNNING: Mutex<Vec<(String, u32)>> = Mutex::new(Vec::new());

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

fn newest_crash_report(game_dir: &Path) -> Option<PathBuf> {
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    if let Ok(rd) = std::fs::read_dir(game_dir.join("crash-reports")) {
        for e in rd.flatten() {
            if let Ok(md) = e.metadata() {
                let mt = md.modified().unwrap_or(std::time::UNIX_EPOCH);
                if newest.as_ref().map(|(_, t)| mt > *t).unwrap_or(true) {
                    newest = Some((e.path(), mt));
                }
            }
        }
    }
    newest.map(|(p, _)| p)
}

/// Captured stdout plus the game's own latest.log and newest crash report:
/// Fabric reports mod resolution and mixin failures only in latest.log.
fn crash_text(game_dir: &Path) -> String {
    let mut text = std::fs::read_to_string(game_dir.join("logs/launcher-latest.log")).unwrap_or_default();
    if let Ok(l) = std::fs::read_to_string(game_dir.join("logs/latest.log")) {
        text.push('\n');
        text.push_str(&l);
    }
    if let Some(cr) = newest_crash_report(game_dir) {
        if let Ok(c) = std::fs::read_to_string(&cr) {
            text.push('\n');
            text.push_str(&c);
        }
    }
    text
}

fn analyze_crash(game_dir: &Path) -> (String, String) {
    let text = crash_text(game_dir);
    let low = text.to_lowercase();
    let reason = if low.contains("outofmemoryerror") || low.contains("could not reserve enough space") || low.contains("out of memory") {
        "Не хватило оперативной памяти. Добавь ОЗУ в настройках сборки."
    } else if low.contains("unsupportedclassversionerror") || low.contains("class file version") || low.contains("compiled by a more recent version of the java") {
        "Нужна другая версия Java для этой сборки."
    } else if low.contains("mandatory dependencies") || low.contains("missing mods") || (low.contains("requires") && low.contains("mod")) {
        "Не хватает зависимости одного из модов."
    } else if low.contains("duplicate mods") || low.contains("incompatible mod") || low.contains("found a duplicate mod")
        || low.contains("mod resolution encountered an incompatible mod set") || low.contains("duplicate mod") {
        "Конфликт модов — есть дубли или несовместимые моды."
    } else if low.contains("mixin apply failed") || low.contains("mixinapplyerror") || low.contains("mixintransformererror") {
        "Один из модов не подошёл к этой версии игры (ошибка миксина)."
    } else if low.contains("glfw") || low.contains("pixel format") || low.contains("failed to create window") || low.contains("no opengl") {
        "Проблема с графикой или драйверами видеокарты."
    } else {
        "Игра вылетела. Загляни в лог — там причина."
    };
    let tail: String = text
        .lines()
        .rev()
        .take(18)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    (reason.to_string(), tail)
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
    let subst = |s: &str| -> String {
        s.replace("${auth_player_name}", nick)
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

/// Auto memory: half of physical RAM, clamped to 2-8 GB.
pub(crate) fn resolve_ram_mb(requested: u32) -> u32 {
    if requested > 0 {
        return requested.clamp(512, 65536);
    }
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    let total_mb = sys.total_memory() / 1024 / 1024;
    if total_mb == 0 {
        return 4096;
    }
    (total_mb / 2).clamp(2048, 8192) as u32
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
    let java_pick = profile_java(&profile);
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
    if matches!(loader_id.as_str(), "fabric" | "quilt" | "forge" | "neoforge") {
        let root = if agent.is_some() && !auth.yggdrasil.is_empty() {
            Some(format!("{}/csl/", auth.yggdrasil.trim_end_matches('/')))
        } else { None };
        if want_in_game_skins(root.as_deref()) {
            if let Err(e) = ensure_custom_skin_loader(&profile, &loader_id, root.as_deref(), &nick).await {
                warn(&app, &format!("Мод скинов не поставлен: {}", e));
            }
        }
    }
    let mut args = build_args(&v, &main_class, &classpath, &nick, &game_dir, &assets_root, &natives_dir, &libraries_dir, &auth);
    args.insert(0, format!("-Xmx{}M", resolve_ram_mb(ram_mb)));
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
    if settings["fpsBoost"].as_bool().unwrap_or(false) {
        let own = settings["jvmArgs"].as_str().unwrap_or("");
        let taken: Vec<&str> = own.split_whitespace().collect();
        let flags: Vec<String> = BOOST_FLAGS
            .iter()
            .filter(|f| !taken.iter().any(|a| a.eq_ignore_ascii_case(f)))
            .map(|f| f.to_string())
            .collect();
        for (i, a) in flags.into_iter().enumerate() { args.insert(1 + i, a); }
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
    let mut cmd = Command::new(branded_java(&java));
    // CREATE_NO_WINDOW on Windows, otherwise every launch pops a console window.
    quiet(&mut cmd);
    cmd.args(&args)
        .current_dir(&game_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let start = std::time::Instant::now();
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
        let status = child.wait();
        forget_running(pid);
        record_playtime(&pname, start.elapsed().as_secs(), quick_server.as_deref());
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
            let (mut reason, tail) = analyze_crash(&gdir);
            // The injected skin mod must never break a profile permanently:
            // if it appears in the crash, remove it and say so.
            if crash_text(&gdir).to_lowercase().contains("customskinloader") && drop_custom_skin_loader(&pname) {
                reason = "Мод скинов Millida не ужился со сборкой — мы его убрали. Запусти игру ещё раз.".into();
            }
            let _ = app2.emit(
                "game-crash",
                serde_json::json!({ "profile": pname, "reason": reason, "tail": tail }),
            );
        }
    });
    emit(&app, "launch", 100.0, "Игра запущена");
    Ok("started".into())
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
