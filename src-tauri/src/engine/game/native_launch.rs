use super::launch::{
    crash_tail, read_log_file, session_uuid, spawn_log_reader, wait_log_readers, was_stopped, watch_session, LAUNCH_CAPTURE,
    LAUNCH_CHECK_ALIVE, LOG_DRAIN_WAIT,
};
use super::pack_launch::{game_args, platform_os_arch};
use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/// A catalogue pack that is not Minecraft at all: a partner's own game engine
/// with an executable per platform. The catalogue gives it this version and
/// loader so nothing on the Minecraft side mistakes it for a game version.
pub const NATIVE_GAME_VERSION: &str = "native";
pub const NATIVE_LOADER: &str = "custom";

const MAX_EXECUTABLE_LEN: usize = 128;
const PLACEHOLDER_NICK: &str = "${auth_player_name}";
const PLACEHOLDER_UUID: &str = "${auth_uuid}";
const PLACEHOLDER_TOKEN: &str = "${auth_access_token}";
const PLACEHOLDERS: [&str; 3] = [PLACEHOLDER_NICK, PLACEHOLDER_UUID, PLACEHOLDER_TOKEN];
const NATIVE_CRASH_ACTIONS: [&str; 3] = ["open-url", "open-folder", "share-log"];

const NEEDS_MILLIDA: &str = "Эта игра запускается только с аккаунтом Millida: войди в Millida и нажми «Играть» ещё раз";
const BROKEN_MANIFEST: &str =
    "Описание запуска этой игры повреждено — удали сборку и установи её из каталога заново";

pub struct NativeLaunch {
    pub slug: String,
    /// Inside the pack folder, checked to be a regular file right there.
    pub executable: PathBuf,
    pub game_args: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
struct NativeManifest {
    executable: String,
    game_args: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum NativeRefusal {
    Invalid,
    NoBuildForPlatform,
}

pub(crate) fn is_native_manifest(v: &Value) -> bool {
    v["type"].as_str() == Some("native")
}

/// The executable is joined onto the pack folder and run: only a bare file
/// name can name it, so the archive cannot point the launcher at a program
/// elsewhere on disk or slip an option in as the program name.
fn executable_name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_EXECUTABLE_LEN
        && name.bytes().all(|b| b.is_ascii_graphic())
        && !name.contains(['/', '\\', ':'])
        && !name.contains("..")
        && !name.starts_with('-')
        && safe_file_name(name).is_ok_and(|n| n == name)
}

/// arm64 Macs run x86_64 builds through Rosetta and arm64 Windows through its
/// emulation, so a pack without a native arm64 build still starts there.
/// Linux has no such layer by default.
fn pick_executable<'a>(table: &'a serde_json::Map<String, Value>, os: &str, arch: &str) -> Option<&'a str> {
    let exact = format!("{}-{}", os, arch);
    let emulated = (arch == "arm64" && matches!(os, "macos" | "windows")).then(|| format!("{}-x86_64", os));
    [Some(exact), emulated].into_iter().flatten().find_map(|key| table.get(&key).and_then(|x| x.as_str()))
}

fn unknown_placeholder(arg: &str) -> bool {
    PLACEHOLDERS.iter().fold(arg.to_string(), |s, p| s.replace(p, "")).contains("${")
}

/// All or nothing: one bad entry anywhere means the manifest was not written
/// for this launcher, and running part of it would be a different command.
fn parse_native_manifest(v: &Value, os: &str, arch: &str) -> Result<NativeManifest, NativeRefusal> {
    if !is_native_manifest(v) {
        return Err(NativeRefusal::Invalid);
    }
    let table = v["executable"].as_object().filter(|t| !t.is_empty()).ok_or(NativeRefusal::Invalid)?;
    if !table.values().all(|x| x.as_str().is_some_and(executable_name_ok)) {
        return Err(NativeRefusal::Invalid);
    }
    let game_args = game_args(v).ok_or(NativeRefusal::Invalid)?;
    if game_args.iter().any(|a| unknown_placeholder(a)) {
        return Err(NativeRefusal::Invalid);
    }
    let executable = pick_executable(table, os, arch).ok_or(NativeRefusal::NoBuildForPlatform)?.to_string();
    Ok(NativeManifest { executable, game_args })
}

/// One pass over each argument: a value put in never gets read as another
/// placeholder.
fn substitute_args(args: &[String], nick: &str, uuid: &str, token: &str) -> Vec<String> {
    let values = [(PLACEHOLDER_NICK, nick), (PLACEHOLDER_UUID, uuid), (PLACEHOLDER_TOKEN, token)];
    args.iter()
        .map(|arg| {
            let mut out = String::with_capacity(arg.len());
            let mut rest = arg.as_str();
            while let Some(i) = rest.find("${") {
                out.push_str(&rest[..i]);
                let tail = &rest[i..];
                match values.iter().find(|(key, _)| tail.starts_with(key)) {
                    Some((key, value)) => {
                        out.push_str(value);
                        rest = &tail[key.len()..];
                    }
                    None => {
                        out.push_str("${");
                        rest = &tail[2..];
                    }
                }
            }
            out.push_str(rest);
            out
        })
        .collect()
}

fn platform_name(os: &str, arch: &str) -> String {
    let os = match os {
        "windows" => "Windows",
        "macos" => "macOS",
        _ => "Linux",
    };
    format!("{} {}", os, arch)
}

fn refusal_text(r: NativeRefusal, os: &str, arch: &str) -> String {
    match r {
        NativeRefusal::Invalid => BROKEN_MANIFEST.into(),
        NativeRefusal::NoBuildForPlatform => format!(
            "У этой игры нет версии для твоей системы ({}) — запустить её на этом компьютере нельзя",
            platform_name(os, arch)
        ),
    }
}

/// The executable must sit right in the pack folder once links are resolved:
/// a symlink shipped in the archive could otherwise run any program on disk.
fn resolve_executable(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let missing = || format!("В сборке нет файла игры «{}» — архив распакован не полностью. Удали сборку и установи её заново", name);
    let path = safe_child(dir, name).map_err(|_| BROKEN_MANIFEST.to_string())?;
    let real = path.canonicalize().map_err(|_| missing())?;
    let home = dir.canonicalize().map_err(|_| missing())?;
    if real.parent() != Some(home.as_path()) {
        return Err(BROKEN_MANIFEST.into());
    }
    if !real.is_file() {
        return Err(missing());
    }
    Ok(path)
}

fn trusted_manifest(profile: &str) -> Option<(String, Value)> {
    let slug = trusted_pack_slug(profile)?;
    let raw = std::fs::read(profile_dir(profile).join(PACK_LAUNCH_FILE)).ok()?;
    let v: Value = serde_json::from_slice(&raw).ok()?;
    is_native_manifest(&v).then_some((slug, v))
}

/// A catalogue build the core installed whose description says it is a native
/// game. Cheap enough for the places that only need to know which kind it is.
pub fn trusted_native_pack(profile: &str) -> bool {
    trusted_manifest(profile).is_some()
}

/// None for anything that is not a trusted native game; an error when it is
/// one but cannot start on this machine.
pub fn trusted_native_launch(profile: &str) -> Option<Result<NativeLaunch, String>> {
    let (slug, v) = trusted_manifest(profile)?;
    let (os, arch) = platform_os_arch();
    Some(
        parse_native_manifest(&v, os, arch)
            .map_err(|r| refusal_text(r, os, arch))
            .and_then(|m| {
                let executable = resolve_executable(&profile_dir(profile), &m.executable)?;
                Ok(NativeLaunch { slug, executable, game_args: m.game_args })
            }),
    )
}

/// Archives and object storage drop the exec bit, and a downloaded macOS
/// binary carries the quarantine flag that makes Gatekeeper refuse it. Only
/// the chosen executable is touched; assets stay as they came.
#[cfg(unix)]
fn make_runnable(exe: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(exe, std::fs::Permissions::from_mode(0o755)).map_err(|e| io_fail("Подготовка игры", exe, &e))?;
    #[cfg(target_os = "macos")]
    {
        // exits non-zero when the flag is not there, which is the usual case
        if let Err(e) = Command::new("/usr/bin/xattr")
            .args(["-d", "com.apple.quarantine"])
            .arg(exe)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
        {
            eprintln!("[native] карантин не снят с «{}»: {}", exe.display(), e);
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn make_runnable(_exe: &Path) -> Result<(), String> {
    Ok(())
}

fn spawn_failure_text(e: &std::io::Error, exe: &Path) -> String {
    let name = exe.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let hint = if e.kind() == std::io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5) | Some(225)) {
        ". Запуск запретил антивирус — добавь папку лаунчера в его исключения и запусти ещё раз"
    } else {
        ""
    };
    format!("Не удалось запустить игру «{}»: {}{}", name, e, hint)
}

/// Starts a native catalogue game. None of the Minecraft preparation applies:
/// no Java, vanilla, loader, auth agent, skin or cosmetics mod, JVM flags or
/// memory. What stays is everything the launcher keeps around a running game.
pub(crate) async fn launch_native(
    app: AppHandle,
    profile: String,
    nick: String,
    auth: Auth,
    settings: &Value,
    spec: NativeLaunch,
) -> Result<String, String> {
    // The partner's server checks the session against our account, so a
    // licence token or an offline nick never gets in.
    if auth.token.is_empty() || auth.yggdrasil.is_empty() {
        return Err(NEEDS_MILLIDA.into());
    }
    // the registry slug, not the one in the build's settings: those are a
    // file on the player's disk
    pack_launch_gate(&spec.slug).await?;
    check_cancel()?;
    emit(&app, "launch", 92.0, "Запускаем игру…");
    make_runnable(&spec.executable)?;
    let args = substitute_args(&spec.game_args, &nick, &session_uuid(&auth, &nick), &auth.token);
    let game_dir = profile_dir(&profile);
    let log_path = game_dir.join(LAUNCH_CAPTURE);
    if let Some(logs) = log_path.parent() {
        std::fs::create_dir_all(logs).ok();
    }
    let log_file = std::fs::File::create(&log_path).map_err(|e| io_fail("Лог запуска", &log_path, &e))?;
    let gpu = GpuPref::parse(settings["gpu"].as_str().unwrap_or("auto"));
    check_cancel()?;
    let start = std::time::Instant::now();
    let mut child = {
        let mut cmd = Command::new(&spec.executable);
        quiet(&mut cmd);
        apply_gpu_pref(&mut cmd, &spec.executable, gpu);
        cmd.args(&args)
            .current_dir(&game_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        cmd.spawn().map_err(|e| spawn_failure_text(&e, &spec.executable))?
    };
    if cancelled() {
        let _ = child.kill();
        return Err(LAUNCH_CANCELLED.into());
    }
    let _ = app.emit("game-log-start", &profile);
    let log_file = Arc::new(Mutex::new(log_file));
    let server_now: ServerSlot = Arc::new(Mutex::new(None));
    let mut readers = Vec::new();
    if let Some(o) = child.stdout.take() {
        readers.push(spawn_log_reader(Box::new(o), log_file.clone(), app.clone(), server_now.clone()));
    }
    if let Some(e) = child.stderr.take() {
        readers.push(spawn_log_reader(Box::new(e), log_file.clone(), app.clone(), server_now.clone()));
    }
    // An immediate exit is a launch failure, not a session.
    tokio::time::sleep(std::time::Duration::from_millis(900)).await;
    if cancelled() {
        let _ = child.kill();
        return Err(LAUNCH_CANCELLED.into());
    }
    if let Ok(Some(status)) = child.try_wait() {
        if !status.success() {
            let failure = early_exit_message(status.code(), &read_log_file(&log_path).unwrap_or_default());
            report_review_launch(&profile, false, &failure).await;
            return Err(failure);
        }
    }
    let pid = child.id();
    if let Ok(mut v) = RUNNING.lock() {
        v.push((profile.clone(), pid));
    }
    let pname = profile.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let (status, log_text, elapsed) = watch_session(&mut child, start, pid, &pname, &server_now, &app2, |status| {
            if status.is_ok() {
                wait_log_readers(&readers, LOG_DRAIN_WAIT);
                read_log_file(&log_path).unwrap_or_default()
            } else {
                String::new()
            }
        });
        let failed = matches!(&status, Ok(s) if !s.success());
        let review_ok = (status.is_ok() && !failed) || elapsed >= LAUNCH_CHECK_ALIVE;
        if review_ok {
            let checked = pname.clone();
            tauri::async_runtime::spawn(async move {
                report_review_launch(&checked, true, &format!("сессия {} с", elapsed)).await;
            });
        }
        if was_stopped(pid) || !failed {
            return;
        }
        let (code, what) = exit_code_text(status.as_ref().ok().and_then(|s| s.code()));
        let reason = match what {
            Some(w) => format!("Игра закрылась с ошибкой (код {} — {})", code, w),
            None => format!("Игра закрылась с ошибкой (код {})", code),
        };
        // Repairs, Java and mod fixes rebuild a Minecraft profile; on a native
        // game they would only break the folder.
        let mut diag = diagnose(&pname, &reason, &crash_tail(&log_text), &log_text).classified("native", String::new());
        diag.actions.retain(|a| NATIVE_CRASH_ACTIONS.contains(&a.kind.as_str()));
        let _ = app2.emit("game-crash", diag);
        if !review_ok {
            tauri::async_runtime::spawn(async move {
                report_review_launch(&pname, false, &reason).await;
            });
        }
    });
    emit(&app, "launch", 100.0, "Игра запущена");
    Ok("started".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest(executable: Value, args: Value) -> Value {
        json!({ "type": "native", "executable": executable, "gameArgs": args })
    }

    fn prison() -> Value {
        manifest(
            json!({
                "windows-x86_64": "PrisonRPG.exe",
                "linux-x86_64": "PrisonRPG",
                "macos-arm64": "PrisonRPG-mac-arm64",
                "macos-x86_64": "PrisonRPG-mac-x64"
            }),
            json!(["--username", "${auth_player_name}", "--uuid", "${auth_uuid}", "--accessToken", "${auth_access_token}"]),
        )
    }

    /// manifest -> verdict. Each case pins one way an archive could turn the
    /// launch into something other than "run this file from the pack folder".
    #[test]
    fn manifest_is_taken_whole_or_refused() {
        let too_many: Vec<String> = (0..65).map(|i| format!("a{}", i)).collect();
        let cases: Vec<(Value, Result<&str, NativeRefusal>, &str)> = vec![
            (prison(), Ok("PrisonRPG.exe"), "контракт партнёра принимается как есть"),
            (
                manifest(json!({ "linux-x86_64": "PrisonRPG" }), json!([])),
                Err(NativeRefusal::NoBuildForPlatform),
                "нет сборки под систему — ясный отказ, а не чужой файл",
            ),
            (
                manifest(json!({ "windows-x86_64": "bin/PrisonRPG.exe" }), json!([])),
                Err(NativeRefusal::Invalid),
                "слэш уводит в подпапку или наружу",
            ),
            (
                manifest(json!({ "windows-x86_64": "bin\\PrisonRPG.exe" }), json!([])),
                Err(NativeRefusal::Invalid),
                "обратный слэш на Windows — тот же путь",
            ),
            (
                manifest(json!({ "windows-x86_64": "..exe" }), json!([])),
                Err(NativeRefusal::Invalid),
                "две точки в имени не пропускаются вовсе",
            ),
            (
                manifest(json!({ "windows-x86_64": "-Xrun.exe" }), json!([])),
                Err(NativeRefusal::Invalid),
                "имя с минуса читается как ключ",
            ),
            (
                manifest(json!({ "windows-x86_64": "C:PrisonRPG.exe" }), json!([])),
                Err(NativeRefusal::Invalid),
                "буква диска — абсолютный путь на Windows",
            ),
            (
                manifest(json!({ "windows-x86_64": "/usr/bin/sh" }), json!([])),
                Err(NativeRefusal::Invalid),
                "абсолютный путь запускает чужую программу",
            ),
            (
                manifest(json!({ "windows-x86_64": "Prison RPG.exe" }), json!([])),
                Err(NativeRefusal::Invalid),
                "пробел в имени — ловушка Windows с хвостовым пробелом",
            ),
            (
                manifest(json!({ "windows-x86_64": "PrisonRPG.exe", "linux-x86_64": "../sh" }), json!([])),
                Err(NativeRefusal::Invalid),
                "плохая запись под чужую систему портит весь манифест",
            ),
            (
                manifest(json!({ "windows-x86_64": "PrisonRPG.exe" }), json!(["--server", "${server_ip}"])),
                Err(NativeRefusal::Invalid),
                "неизвестная подстановка ушла бы в игру буквально",
            ),
            (
                manifest(json!({ "windows-x86_64": "PrisonRPG.exe" }), json!(too_many)),
                Err(NativeRefusal::Invalid),
                "аргументов больше предела",
            ),
            (
                manifest(json!({ "windows-x86_64": "PrisonRPG.exe" }), json!(["--name\nx"])),
                Err(NativeRefusal::Invalid),
                "управляющий символ в аргументе",
            ),
            (manifest(json!({}), json!([])), Err(NativeRefusal::Invalid), "пустая таблица — не манифест"),
            (
                json!({ "type": "java", "executable": { "windows-x86_64": "PrisonRPG.exe" } }),
                Err(NativeRefusal::Invalid),
                "без type=native это не родная игра",
            ),
        ];
        for (v, want, why) in cases {
            let got = parse_native_manifest(&v, "windows", "x86_64").map(|m| m.executable);
            assert_eq!(got.as_deref(), want.as_ref().map(|s| *s), "{why}");
        }
    }

    /// (os, arch) -> executable. Emulation covers arm64 only where the system
    /// has it built in.
    type PickCase<'a> = (&'a serde_json::Map<String, Value>, &'a str, &'a str, Option<&'a str>, &'a str);

    #[test]
    fn platform_pick_falls_back_only_where_emulation_exists() {
        let full = prison();
        let full = full["executable"].as_object().unwrap();
        let x64_only = manifest(json!({ "windows-x86_64": "W.exe", "macos-x86_64": "M", "linux-x86_64": "L" }), json!([]));
        let x64_only = x64_only["executable"].as_object().unwrap();
        let cases: [PickCase; 7] = [
            (full, "windows", "x86_64", Some("PrisonRPG.exe"), "точный ключ Windows"),
            (full, "linux", "x86_64", Some("PrisonRPG"), "точный ключ Linux"),
            (full, "macos", "arm64", Some("PrisonRPG-mac-arm64"), "родная arm64-сборка важнее Rosetta"),
            (full, "macos", "x86_64", Some("PrisonRPG-mac-x64"), "Intel-мак"),
            (x64_only, "macos", "arm64", Some("M"), "Apple Silicon запускает x86_64 через Rosetta"),
            (x64_only, "windows", "arm64", Some("W.exe"), "Windows на ARM эмулирует x86_64"),
            (x64_only, "linux", "arm64", None, "на Linux arm64 эмуляции нет — отказ"),
        ];
        for (table, os, arch, want, why) in cases {
            assert_eq!(pick_executable(table, os, arch), want, "{why}");
        }
    }

    /// args -> command line. Only the three account values are filled in, and
    /// a filled value is never read again as a placeholder.
    #[test]
    fn substitution_fills_only_account_values() {
        let args: Vec<String> = prison()["gameArgs"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect();
        assert_eq!(
            substitute_args(&args, "Steve", "0123abcd", "tok"),
            vec!["--username", "Steve", "--uuid", "0123abcd", "--accessToken", "tok"],
            "контракт партнёра обязан получить ник, uuid и токен сессии Millida"
        );
        let cases: [(&str, &str, &str, &str); 3] = [
            ("--who=${auth_player_name}!", "${auth_uuid}", "--who=${auth_uuid}!", "значение не подставляется второй раз"),
            ("${auth_uuid}${auth_access_token}", "n", "U T", "подстановки подряд в одном аргументе"),
            ("$${x", "n", "$${x", "чужой текст остаётся как был"),
        ];
        for (arg, nick, want, why) in cases {
            assert_eq!(substitute_args(&[arg.to_string()], nick, "U", " T"), vec![want.to_string()], "{why}");
        }
    }

    /// file layout -> verdict. The executable has to be a real file directly in
    /// the pack folder.
    #[test]
    fn executable_must_be_a_file_right_in_the_pack() {
        let root = std::env::temp_dir().join(format!("millida-native-{}", std::process::id()));
        let pack = root.join("pack");
        std::fs::create_dir_all(pack.join("assets")).unwrap();
        std::fs::write(pack.join("PrisonRPG"), b"bin").unwrap();
        std::fs::write(root.join("outside"), b"bin").unwrap();
        assert!(resolve_executable(&pack, "PrisonRPG").is_ok(), "файл в корне сборки запускается");
        assert!(resolve_executable(&pack, "Missing").is_err(), "нет файла — нет запуска");
        assert!(resolve_executable(&pack, "assets").is_err(), "папка не исполняемый файл");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("outside"), pack.join("link")).unwrap();
            assert!(resolve_executable(&pack, "link").is_err(), "ссылка из архива не уводит за пределы сборки");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_native_manifest_never_reaches_the_jvm() {
        let mut v = prison();
        v["mainClass"] = json!("net.minecraft.client.main.Main");
        v["classPath"] = json!(["libraries"]);
        assert!(parse_pack_launch(&v).is_none(), "родная игра с полями Java всё равно не запускается через JVM");
    }

    #[test]
    fn unknown_placeholder_is_found_next_to_known_ones() {
        assert!(!unknown_placeholder("${auth_uuid}"), "известная подстановка не отказ");
        assert!(unknown_placeholder("${auth_uuid}${user_type}"), "неизвестная рядом с известной всё равно отказ");
        assert!(unknown_placeholder("${${auth_uuid}}"), "склейка после удаления известной не проходит");
    }
}
