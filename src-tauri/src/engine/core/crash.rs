// Launcher crash reports: writes a panic or a hang into the crashes folder in the launcher data and reads it at the next start.
// The report text has the version, OS, CPU architecture, the place in the code and the stack. No network here.
use serde::Serialize;
use std::path::PathBuf;

use crate::engine::data_dir;

#[derive(Serialize)]
pub struct CrashEntry {
    pub file: String,
    /// "panic" | "freeze".
    pub kind: String,
    pub message: String,
    pub details: String,
}

pub(crate) fn crash_dir() -> PathBuf {
    data_dir().join("crashes")
}

/// Persists panics to disk so the next launch can report them.
pub fn install_panic_hook(version: String) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let dir = crash_dir();
        let _ = std::fs::create_dir_all(&dir);
        let when = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "паника без сообщения".to_string());
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let body = format!(
            "millida-launcher {}\nos: {} {}\nместо: {}\nсообщение: {}\n\n{}",
            version,
            std::env::consts::OS,
            std::env::consts::ARCH,
            place,
            msg,
            std::backtrace::Backtrace::force_capture()
        );
        let _ = std::fs::write(dir.join(format!("crash-{}.log", when)), body);
        #[cfg(windows)]
        if webview_failed_to_open(&msg) {
            webview_failure_box(&msg);
        }
        prev(info);
    }));
}

/// Tauri builds the window from its config before any of our code runs, and a
/// WebView2 that does not start (runtime missing or broken, its data folder
/// locked, a policy) ends in a panic there. With no console the process just
/// vanished: players saw «the launcher does not open» and wrote that WebView2
/// was installed. Only that failure is told to the player; other panics stay
/// in the crash folder as before.
#[cfg(any(windows, test))]
fn webview_failed_to_open(msg: &str) -> bool {
    let at_start = msg.starts_with("Failed to setup app") || msg.starts_with("error while running tauri application");
    at_start && msg.to_lowercase().contains("webview")
}

#[cfg(windows)]
fn webview_failure_box(msg: &str) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONERROR, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO};
    static SHOWN: AtomicBool = AtomicBool::new(false);
    if SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    let detail: String = msg.chars().take(400).collect();
    // Both languages at once: the page and its translations are exactly what did not start.
    let text = [WEBVIEW_FAILED_RU, WEBVIEW_FAILED_EN, detail.as_str()].join("\n\n");
    let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
    let (body, title) = (wide(&text), wide("Millida Launcher"));
    let answer = unsafe { MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONERROR | MB_SETFOREGROUND | MB_TOPMOST) };
    if answer == IDYES {
        let _ = crate::engine::open_external(WEBVIEW2_PAGE);
    }
}

#[cfg(windows)]
const WEBVIEW2_PAGE: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";
#[cfg(windows)]
const WEBVIEW_FAILED_RU: &str = "Лаунчер не смог открыть окно: не запустился компонент Microsoft WebView2.\n\nЧто поможет:\n1. Перезагрузи компьютер и запусти лаунчер ещё раз.\n2. Переустанови WebView2 Runtime с сайта Microsoft.\n\nОткрыть страницу загрузки WebView2?";
#[cfg(windows)]
const WEBVIEW_FAILED_EN: &str = "The launcher could not open its window: Microsoft WebView2 did not start. Restart the computer or reinstall the WebView2 Runtime. Open the download page?";

/// A frozen interface leaves no other trace: the process is alive and nothing
/// panics, so the freeze is written where the next launch already looks. It is
/// written the moment the threshold is crossed (the player may kill the window
/// next) and rewritten under the same stamp once the thread answers, with the
/// full length. Returns the stamp to pass back for that rewrite.
pub fn record_freeze(stamp: u64, stalled: std::time::Duration, recovered: bool) -> u64 {
    let stamp = if stamp == 0 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    } else {
        stamp
    };
    let dir = crash_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return stamp;
    }
    let body = format!(
        "millida-launcher {}\nos: {} {}\nместо: главный поток\nсообщение: интерфейс не отвечал {} с\nитог: {}\n",
        env!("MILLIDA_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        stalled.as_secs(),
        if recovered { "отвис сам" } else { "висел на момент записи" },
    );
    let _ = std::fs::write(dir.join(format!("{}{}.log", FREEZE_PREFIX, stamp)), body);
    stamp
}

const FREEZE_PREFIX: &str = "freeze-";

/// "freeze" for a hung UI thread, "panic" for everything else. A freeze is not
/// a crash: the launcher kept running, and reporting it as RustPanic mixed the
/// two in one list.
fn entry_kind(file: &str) -> &'static str {
    if file.starts_with(FREEZE_PREFIX) {
        "freeze"
    } else {
        "panic"
    }
}

pub fn read_crashes() -> Vec<CrashEntry> {
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(crash_dir()) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().map(|x| x != "log").unwrap_or(true) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&p) else { continue };
        let message = text
            .lines()
            .find(|l| l.starts_with("сообщение: "))
            .map(|l| l.trim_start_matches("сообщение: ").to_string())
            .unwrap_or_else(|| "паника лаунчера".to_string());
        let file = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
        out.push(CrashEntry {
            kind: entry_kind(&file).to_string(),
            file,
            message,
            details: text.chars().take(4000).collect(),
        });
    }
    out
}

pub fn clear_crashes() {
    // Cleans our own crashes folder when the user asks.
    let _ = std::fs::remove_dir_all(crash_dir());
}

#[cfg(test)]
mod tests {
    use super::{entry_kind, webview_failed_to_open};

    #[test]
    fn a_freeze_is_not_reported_as_a_panic() {
        assert_eq!(entry_kind("freeze-1790329325.log"), "freeze");
        assert_eq!(entry_kind("crash-1790329325.log"), "panic");
    }

    #[test]
    fn only_a_webview_that_did_not_open_the_window_asks_the_player() {
        let cases = [
            ("Failed to setup app: error encountered during setup hook: WebView2 error: WindowsError(0x80070005)", true),
            ("error while running tauri application: Runtime(CreateWebview(WebView2Error(...)))", true),
            ("Failed to setup app: error encountered during setup hook: tray icon", false),
            ("called `Option::unwrap()` on a `None` value in webview_health", false),
        ];
        for (msg, want) in cases {
            assert_eq!(webview_failed_to_open(msg), want, "{msg}");
        }
    }
}
