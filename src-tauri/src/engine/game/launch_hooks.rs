// "For advanced users": a wrapper command, commands before launch and after exit, and environment
// variables, per build. They run programs, so they live in a file of the core outside the build folder
// (a shared or exported build never carries them), and a change is accepted only after a native dialog
// shows the exact commands: a script in the webview cannot set them on its own.
use crate::engine::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const FILE: &str = "launch-hooks.json";
const MAX_COMMAND: usize = 1024;
const MAX_ENV: usize = 32;
const MAX_ENV_VALUE: usize = 2048;
const PRE_LAUNCH_LIMIT: Duration = Duration::from_secs(120);

/// Variables that would carry JVM options past the argument filter, preload code into Java, or
/// overwrite what the launcher passes to the game itself.
const ENV_DENIED: [&str; 6] = ["JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "CLASSPATH", "LD_PRELOAD", "LD_AUDIT"];
const ENV_DENIED_PREFIXES: [&str; 2] = ["MILLIDA_", "DYLD_"];

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LaunchHooks {
    pub wrapper: String,
    pub pre_launch: String,
    pub post_exit: String,
    pub env: BTreeMap<String, String>,
}

/// Hooks are tied to the build folder they were confirmed for. A build deleted and replaced by
/// another one with the same name (an imported or shared pack) must not inherit them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    hooks: LaunchHooks,
    born: Option<u64>,
}

fn folder_born(profile: &str) -> Option<u64> {
    let created = std::fs::metadata(profile_dir(profile)).ok()?.created().ok()?;
    created.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
}

impl LaunchHooks {
    pub fn is_empty(&self) -> bool {
        self.wrapper.trim().is_empty() && self.pre_launch.trim().is_empty() && self.post_exit.trim().is_empty() && self.env.is_empty()
    }
}

static LOCK: Mutex<()> = Mutex::new(());

fn path() -> std::path::PathBuf {
    data_dir().join(FILE)
}

fn load_all() -> BTreeMap<String, Stored> {
    std::fs::read_to_string(path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Splits a command line into program and arguments without a shell: quotes group words,
/// nothing is expanded, so `&&`, pipes and redirects are plain arguments.
pub(crate) fn split_command(line: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut started = false;
    for c in line.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                started = true;
            }
            (None, c) if c.is_whitespace() => {
                if started {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            (None, c) => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(cur);
    }
    out
}

/// Characters that make the confirmation dialog show something other than what runs:
/// control and line-separator characters, and bidi marks, embeddings, overrides and isolates
/// that reorder the visible text.
fn display_unsafe(c: char) -> bool {
    c.is_control()
        || matches!(c, '\u{2028}' | '\u{2029}' | '\u{200E}' | '\u{200F}' | '\u{061C}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}')
}

pub(crate) fn display_safe(text: &str) -> bool {
    !text.chars().any(display_unsafe)
}

/// For text the player did not type into the hooks form (the build name): shown escaped, never refused.
fn display_escaped(text: &str) -> String {
    text.chars().map(|c| if display_unsafe(c) { format!("\\u{{{:04X}}}", c as u32) } else { c.to_string() }).collect()
}

fn env_name_ok(name: &str) -> bool {
    let mut chars = name.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    let upper = name.to_ascii_uppercase();
    first_ok
        && name.len() <= 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !ENV_DENIED.contains(&upper.as_str())
        && !ENV_DENIED_PREFIXES.iter().any(|p| upper.starts_with(p))
}

pub(crate) fn validate(h: &LaunchHooks) -> Result<LaunchHooks, String> {
    let mut clean = LaunchHooks::default();
    for (field, value) in [(&mut clean.wrapper, &h.wrapper), (&mut clean.pre_launch, &h.pre_launch), (&mut clean.post_exit, &h.post_exit)] {
        let v = value.trim();
        if v.chars().count() > MAX_COMMAND {
            return Err(format!("Команда длиннее {} символов", MAX_COMMAND));
        }
        if !display_safe(v) {
            return Err("Команда должна быть одной строкой".into());
        }
        if !v.is_empty() && split_command(v).is_empty() {
            return Err("В команде нет программы".into());
        }
        *field = v.to_string();
    }
    if h.env.len() > MAX_ENV {
        return Err(format!("Переменных окружения больше {}", MAX_ENV));
    }
    for (k, v) in &h.env {
        let k = k.trim();
        if !env_name_ok(k) {
            return Err(format!("Переменную {} задать нельзя", display_escaped(k)));
        }
        if v.chars().count() > MAX_ENV_VALUE || !display_safe(v) {
            return Err(format!("Значение переменной {} не подходит", k));
        }
        clean.env.insert(k.to_string(), v.to_string());
    }
    Ok(clean)
}

pub fn launch_hooks(profile: &str) -> LaunchHooks {
    let Some(stored) = load_all().remove(profile) else { return LaunchHooks::default() };
    match (stored.born, folder_born(profile)) {
        (Some(was), Some(now)) if was != now => LaunchHooks::default(),
        // Checked again on use: the file may predate a rule, and nothing that fails it may run.
        _ => validate(&stored.hooks).unwrap_or_default(),
    }
}

fn store(profile: &str, hooks: LaunchHooks) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = load_all();
    if hooks.is_empty() {
        all.remove(profile);
    } else {
        all.insert(profile.to_string(), Stored { hooks, born: folder_born(profile) });
    }
    write_json_atomic(&path(), &all)
}

/// The dialog text never goes through the webview's translations: a script there could reword
/// it into "safe, press OK". Both languages are written here, and the buttons are the system's own.
fn describe(profile: &str, h: &LaunchHooks) -> String {
    let mut lines = vec![format!("Сборка / Build «{}»", display_escaped(profile)), String::new()];
    let mut push = |label: &str, v: &str| {
        if !v.is_empty() {
            lines.push(format!("{}: {}", label, v));
        }
    };
    push("Обёртка / Wrapper", &h.wrapper);
    push("Перед запуском / Before launch", &h.pre_launch);
    push("После выхода / After exit", &h.post_exit);
    for (k, v) in &h.env {
        lines.push(format!("{}={}", k, v));
    }
    lines.push(String::new());
    lines.push("Лаунчер будет запускать эти программы от твоего имени. Нажми OK, только если вписал их сам.".into());
    lines.push("The launcher will run these programs as you. Press OK only if you typed them yourself.".into());
    lines.join("\n")
}

/// Saves after the player confirms in a native dialog. Clearing needs no confirmation.
/// Returns false when the player declined.
pub async fn set_launch_hooks(profile: String, hooks: LaunchHooks) -> Result<bool, String> {
    let clean = validate(&hooks)?;
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    if clean == launch_hooks(&profile) {
        return Ok(true);
    }
    if !clean.is_empty() {
        let answer = message_dialog()
            .set_title("Millida Launcher")
            .set_description(describe(&profile, &clean))
            .set_level(rfd::MessageLevel::Warning)
            .set_buttons(rfd::MessageButtons::OkCancel)
            .show()
            .await;
        let saved = matches!(answer, rfd::MessageDialogResult::Ok | rfd::MessageDialogResult::Yes);
        if !saved {
            return Ok(false);
        }
    }
    store(&profile, clean)?;
    Ok(true)
}

fn hook_command(line: &str, game_dir: &Path, profile: &str) -> Option<Command> {
    let parts = split_command(line);
    let (program, args) = parts.split_first()?;
    let mut cmd = Command::new(program);
    cmd.args(args).current_dir(game_dir).env("MILLIDA_PROFILE", profile).env("MILLIDA_GAME_DIR", game_dir);
    quiet(&mut cmd);
    Some(cmd)
}

/// Runs the pre-launch command and waits for it; a failure stops the launch, since the player
/// put it there to prepare something the game needs.
pub(crate) async fn run_pre_launch(h: &LaunchHooks, game_dir: &Path, profile: &str) -> Result<(), String> {
    let Some(mut cmd) = hook_command(&h.pre_launch, game_dir, profile) else { return Ok(()) };
    let mut child = cmd.spawn().map_err(|e| format!("Команда перед запуском не запустилась: {}", e))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                let code = status.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into());
                return Err(format!("Команда перед запуском завершилась с кодом {}", code));
            }
            Ok(None) if started.elapsed() > PRE_LAUNCH_LIMIT => {
                let _ = child.kill();
                return Err(format!("Команда перед запуском не закончилась за {} с", PRE_LAUNCH_LIMIT.as_secs()));
            }
            Ok(None) => tokio::time::sleep(Duration::from_millis(200)).await,
            Err(e) => return Err(format!("Команда перед запуском: {}", e)),
        }
    }
}

/// Fire and forget: the game has already exited and nothing waits for this.
pub(crate) fn run_post_exit(h: &LaunchHooks, game_dir: &Path, profile: &str) {
    if let Some(mut cmd) = hook_command(&h.post_exit, game_dir, profile) {
        if let Err(e) = cmd.spawn() {
            eprintln!("[hooks] post-exit command failed to start: {}", e);
        }
    }
}

/// The game command starts through the wrapper when one is set: `wrapper args… java …`.
pub(crate) fn game_command(h: &LaunchHooks, java: &Path) -> Command {
    let parts = split_command(&h.wrapper);
    match parts.split_first() {
        Some((program, args)) => {
            let mut cmd = Command::new(program);
            cmd.args(args).arg(java);
            cmd
        }
        None => Command::new(java),
    }
}

pub(crate) fn apply_env(h: &LaunchHooks, cmd: &mut Command) {
    for (k, v) in &h.env {
        cmd.env(k, v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_split_without_a_shell() {
        let cases: [(&str, &[&str], &str); 4] = [
            ("gamemoderun", &["gamemoderun"], "one word"),
            ("prime-run  --flag x", &["prime-run", "--flag", "x"], "runs of spaces separate once"),
            ("\"C:\\Program Files\\OBS\\obs.exe\" --startreplaybuffer", &["C:\\Program Files\\OBS\\obs.exe", "--startreplaybuffer"], "quoted path with spaces"),
            ("a && b", &["a", "&&", "b"], "shell operators stay plain arguments"),
        ];
        for (line, want, why) in cases {
            assert_eq!(split_command(line), want.iter().map(|s| s.to_string()).collect::<Vec<_>>(), "{why}");
        }
    }

    #[test]
    fn variables_that_bypass_the_jvm_filter_are_refused() {
        let with = |k: &str| LaunchHooks { env: BTreeMap::from([(k.to_string(), "x".to_string())]), ..Default::default() };
        let cases: [(&str, bool, &str); 6] = [
            ("MESA_GL_VERSION_OVERRIDE", true, "an ordinary driver variable"),
            ("JAVA_TOOL_OPTIONS", false, "would inject JVM options past the argument filter"),
            ("_java_options", false, "names compare without case"),
            ("MILLIDA_TOKEN", false, "the launcher's own variables are not overridable"),
            ("DYLD_INSERT_LIBRARIES", false, "preloads code into Java on macOS"),
            ("1BAD", false, "not a valid name"),
        ];
        for (k, ok, why) in cases {
            assert_eq!(validate(&with(k)).is_ok(), ok, "{why}");
        }
        let rlo = LaunchHooks { env: BTreeMap::from([("A".to_string(), "x\u{202E}y".to_string())]), ..Default::default() };
        assert!(validate(&rlo).is_err(), "a bidi override in a value would reorder what the dialog shows");
        let multiline = LaunchHooks { pre_launch: "a\nb".into(), ..Default::default() };
        assert!(validate(&multiline).is_err(), "a second line would hide a command from the confirmation dialog");
    }
}

#[cfg(test)]
mod display_tests {
    use super::*;

    #[test]
    fn the_dialog_shows_exactly_what_runs() {
        let cases: [(&str, bool, &str); 10] = [
            ("gamemoderun", true, "plain command"),
            ("C:\\Игры\\obs.exe --start", true, "non-Latin letters are honest text"),
            ("safe.exe\u{202E}gpj.exe", false, "RIGHT-TO-LEFT OVERRIDE flips the shown file name"),
            ("a\u{2066}b\u{2069}", false, "isolates reorder text"),
            ("a\u{200F}b", false, "RIGHT-TO-LEFT MARK"),
            ("a\u{061C}b", false, "ARABIC LETTER MARK"),
            ("a\u{2028}b", false, "LINE SEPARATOR starts a hidden second line"),
            ("a\u{2029}b", false, "PARAGRAPH SEPARATOR as well"),
            ("a\tb", false, "control characters"),
            ("a\u{1b}[2Kb", false, "terminal escape sequences"),
        ];
        for (text, ok, why) in cases {
            assert_eq!(display_safe(text), ok, "{why}");
            let hooks = LaunchHooks { wrapper: text.to_string(), ..Default::default() };
            assert_eq!(validate(&hooks).is_ok(), ok, "wrapper: {why}");
        }
        assert_eq!(display_escaped("x\u{202E}y"), "x\\u{202E}y", "a build name is shown with the override visible, not obeyed");
    }
}
