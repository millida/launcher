// Command line: `millida-launcher --launch <build>`, `--repair <build>`, `--clean`.
// The first start keeps the action until the webview asks for it; a second start hands it
// to the running copy through the single-instance callback.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliAction {
    pub action: &'static str,
    pub build: Option<String>,
}

const MAX_BUILD_NAME: usize = 200;

static PENDING: Mutex<Option<CliAction>> = Mutex::new(None);
/// The page of the current window has asked for its action once and listens for the next ones. A window built anew
/// starts without that: an action that arrives before it is kept for its first question.
static ASKED: AtomicBool = AtomicBool::new(false);

/// A window was built: its page has not asked yet.
pub fn page_reset() {
    ASKED.store(false, Ordering::SeqCst);
}

fn build_name(value: Option<&String>) -> Option<String> {
    let name = value?.trim();
    let usable = !name.is_empty() && name.chars().count() <= MAX_BUILD_NAME && !name.starts_with("--") && !name.chars().any(char::is_control);
    usable.then(|| name.to_string())
}

/// Reads the first recognised flag. A flag that needs a build and has none is ignored
/// rather than guessed: launching the wrong build is worse than doing nothing.
pub fn parse(args: &[String]) -> Option<CliAction> {
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        let (flag, inline) = match arg.split_once('=') {
            Some((f, v)) if f.starts_with("--") => (f, Some(v.to_string())),
            _ => (arg, None),
        };
        let value = || inline.clone().or_else(|| args.get(i + 1).cloned());
        match flag {
            "--launch" | "--repair" => {
                let action = if flag == "--launch" { "launch" } else { "repair" };
                if let Some(build) = build_name(value().as_ref()) {
                    return Some(CliAction { action, build: Some(build) });
                }
            }
            "--clean" => return Some(CliAction { action: "clean", build: None }),
            _ => {}
        }
        i += 1;
    }
    None
}

pub fn remember_startup_args() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(action) = parse(&args) {
        *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(action);
    }
}

pub fn forward_second_start(app: &tauri::AppHandle, argv: &[String]) {
    let args: Vec<String> = argv.iter().skip(1).cloned().collect();
    crate::background::keep_links(&args);
    if let Some(action) = parse(&args) {
        hand_over(app, action);
    }
}

/// A live page hears the event; an unloaded one takes it on boot. So does a window whose page is still loading and has
/// not asked yet (a rebuilt one, or the first one in its first seconds): it has no listener, and an event sent now would
/// go to nobody («Играть» from the tray pressed twice, a build shortcut clicked while the page loads).
fn hand_over(app: &tauri::AppHandle, action: CliAction) {
    use tauri::Manager;
    if should_keep(crate::background::unloaded(), app.get_webview_window(crate::background::MAIN).is_some(), ASKED.load(Ordering::SeqCst)) {
        *PENDING.lock().unwrap_or_else(|e| e.into_inner()) = Some(action);
    } else {
        let _ = app.emit("cli-action", action);
    }
}

/// True when the action must wait for a page to ask for it instead of being sent as an event.
fn should_keep(unloaded: bool, window: bool, asked: bool) -> bool {
    unloaded || !window || !asked
}

/// The tray's «Играть»: the same path as `--launch <build>`.
pub fn queue_launch(app: &tauri::AppHandle, build: String) {
    if let Some(build) = build_name(Some(&build)) {
        hand_over(app, CliAction { action: "launch", build: Some(build) });
    }
}

#[tauri::command]
pub fn take_cli_action() -> Option<CliAction> {
    ASKED.store(true, Ordering::SeqCst);
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// facts -> the action is kept for the page to take (true) or sent to a page that is listening (false).
    #[test]
    fn an_action_goes_to_a_page_only_when_it_is_listening() {
        let cases: [(bool, bool, bool, bool, &str); 5] = [
            (false, true, true, false, "a page that asked and listens hears the event"),
            (true, false, false, true, "the window is unloaded: the next page takes it on boot"),
            (false, false, true, true, "no window yet"),
            (false, true, false, true, "a window whose page has not asked yet has no listener: keep it"),
            (true, true, true, true, "unloaded wins"),
        ];
        for (unloaded, window, asked, want, why) in cases {
            assert_eq!(should_keep(unloaded, window, asked), want, "{why}");
        }
    }

    #[test]
    fn flags_turn_into_actions() {
        let launch = |b: &str| Some(CliAction { action: "launch", build: Some(b.into()) });
        let cases: [(&[&str], Option<CliAction>, &str); 8] = [
            (&["--launch", "My pack"], launch("My pack"), "build name with a space as the next argument"),
            (&["--launch=Survival"], launch("Survival"), "inline form"),
            (&["--autostart", "--launch", "A"], launch("A"), "other flags before it are skipped"),
            (&["--repair", "A"], Some(CliAction { action: "repair", build: Some("A".into()) }), "repair names its build"),
            (&["--clean"], Some(CliAction { action: "clean", build: None }), "clean needs no build"),
            (&["--launch"], None, "no build: do nothing instead of guessing"),
            (&["--launch", "--clean"], Some(CliAction { action: "clean", build: None }), "a flag is never taken as a build name"),
            (&["millida://join/x"], None, "deep links stay with the deep-link plugin"),
        ];
        for (input, want, why) in cases {
            assert_eq!(parse(&args(input)), want, "{why}");
        }
    }
}
