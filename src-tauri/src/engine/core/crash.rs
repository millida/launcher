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
        prev(info);
    }));
}

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
        env!("CARGO_PKG_VERSION"),
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
    let _ = std::fs::remove_dir_all(crash_dir());
}

#[cfg(test)]
mod tests {
    use super::entry_kind;

    #[test]
    fn a_freeze_is_not_reported_as_a_panic() {
        assert_eq!(entry_kind("freeze-1790329325.log"), "freeze");
        assert_eq!(entry_kind("crash-1790329325.log"), "panic");
    }
}
