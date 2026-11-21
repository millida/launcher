//! The game log kept by the core from the first line of a launch. The log tab
//! and the live log window open whenever the player wants and still see the
//! start: they read this buffer, then follow numbered batches, so no line is
//! lost or shown twice. The full log is on disk next to the build; this ring
//! only bounds what stays in memory for a session of any length.

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

pub const LIVE_LOG_EVENT: &str = "game-log-seq";
const MAX_LINES: usize = 4000;
const MAX_LINE_CHARS: usize = 2000;

/// What is cut out of every line before it is kept and shown (see `redact_live_line`).
#[derive(Default)]
struct Mask {
    home: Option<String>,
    /// Only when the player turned on «hide nick in log».
    nick: Option<String>,
}

/// The settings switch «Скрывать ник в логе» (Settings → live log), off by default.
pub const HIDE_NICK_PREF: &str = "m-log-hide-nick";

struct Ring {
    profile: String,
    mask: Mask,
    /// Number of the oldest line kept; numbers grow across launches and never repeat.
    first: u64,
    lines: VecDeque<String>,
}

static RING: Mutex<Ring> = Mutex::new(Ring { profile: String::new(), mask: Mask { home: None, nick: None }, first: 0, lines: VecDeque::new() });

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LiveLogSnapshot {
    pub profile: String,
    /// Number of the first line in `lines`.
    pub seq: u64,
    pub lines: Vec<String>,
}

#[derive(Serialize, Clone)]
struct Batch<'a> {
    seq: u64,
    lines: &'a [String],
}

fn clip(line: &str) -> String {
    match line.char_indices().nth(MAX_LINE_CHARS) {
        Some((at, _)) => format!("{}…", &line[..at]),
        None => line.to_string(),
    }
}

impl Ring {
    fn reset(&mut self, profile: &str, mask: Mask) {
        self.first += self.lines.len() as u64;
        self.lines.clear();
        self.profile = profile.to_string();
        self.mask = mask;
    }

    /// Masks the batch, keeps it and returns the masked lines with the number of the first one.
    fn push(&mut self, lines: &[String]) -> (u64, Vec<String>) {
        let seq = self.first + self.lines.len() as u64;
        let shown: Vec<String> = lines
            .iter()
            .map(|l| clip(&crate::engine::redact_live_line(l, self.mask.home.as_deref(), self.mask.nick.as_deref())))
            .collect();
        for line in &shown {
            if self.lines.len() >= MAX_LINES {
                self.lines.pop_front();
                self.first += 1;
            }
            self.lines.push_back(line.clone());
        }
        (seq, shown)
    }

    fn snapshot(&self) -> LiveLogSnapshot {
        LiveLogSnapshot { profile: self.profile.clone(), seq: self.first, lines: self.lines.iter().cloned().collect() }
    }
}

/// A new launch: the buffer starts empty, numbering goes on. `nick` is the player's
/// name in this game; it is hidden from the screen only if the player asked for it.
pub fn reset_live_log(profile: &str, nick: &str) {
    let hide_nick = crate::engine::ui_pref(HIDE_NICK_PREF).as_deref() == Some("1");
    let mask = Mask {
        home: dirs::home_dir().map(|h| h.to_string_lossy().into_owned()),
        nick: hide_nick.then(|| nick.to_string()),
    };
    RING.lock().unwrap_or_else(|e| e.into_inner()).reset(profile, mask);
}

/// Masks a batch, keeps it and announces it with its number. All happen under one lock,
/// so the stdout and stderr readers cannot announce their batches out of order.
/// Returns the masked lines: nothing else may show the raw ones.
pub fn publish_live_log(app: &AppHandle, lines: &[String]) -> Vec<String> {
    let mut ring = RING.lock().unwrap_or_else(|e| e.into_inner());
    let (seq, shown) = ring.push(lines);
    let _ = app.emit(LIVE_LOG_EVENT, Batch { seq, lines: &shown });
    shown
}

pub fn live_log_snapshot() -> LiveLogSnapshot {
    RING.lock().unwrap_or_else(|e| e.into_inner()).snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Ring {
        Ring { profile: String::new(), mask: Mask::default(), first: 0, lines: VecDeque::new() }
    }

    /// A session of hours writes hundreds of thousands of lines: memory must
    /// stay at the ring's size, and the numbers must stay continuous so a
    /// reader resumes exactly where the snapshot ended.
    #[test]
    fn a_long_session_stays_bounded_and_numbered() {
        let mut r = ring();
        r.reset("Big", Mask::default());
        let batch: Vec<String> = (0..50).map(|i| format!("line {i}")).collect();
        let mut seq = 0;
        for _ in 0..4000 {
            seq = r.push(&batch).0;
        }
        let snap = r.snapshot();
        assert_eq!(snap.lines.len(), MAX_LINES, "the ring must not grow past its size, whatever the session length");
        assert_eq!(snap.seq + snap.lines.len() as u64, seq + batch.len() as u64, "the snapshot must end where the next batch starts");
        assert_eq!(snap.lines.last().map(String::as_str), Some("line 49"), "the newest lines are the ones kept");
    }

    #[test]
    fn a_new_launch_starts_empty_and_keeps_numbering() {
        let mut r = ring();
        r.reset("A", Mask::default());
        r.push(&["one".into(), "two".into()]);
        r.reset("B", Mask::default());
        let snap = r.snapshot();
        assert!(snap.lines.is_empty(), "the old game's lines must not show under the new launch");
        assert_eq!((snap.profile.as_str(), snap.seq), ("B", 2), "numbers never repeat, or a late batch of the old game would pass for the new one");
        assert_eq!(r.push(&["three".into()]).0, 2);
    }

    #[test]
    fn one_huge_line_is_cut() {
        let mut r = ring();
        r.push(&["x".repeat(MAX_LINE_CHARS * 10)]);
        assert_eq!(r.snapshot().lines[0].chars().count(), MAX_LINE_CHARS + 1, "a mod dumping a megabyte in one line must not hold it in memory");
    }

    /// A 1.8.9 game prints the session into its log; a streamer has the log on screen.
    #[test]
    fn the_screen_never_gets_the_session_and_gets_the_nick_only_when_asked() {
        let lines: Vec<String> = vec![
            "[Client thread/INFO]: Setting user: Steve".into(),
            "[Client thread/INFO]: (Session ID is token:eyJhbGciOi.secret.part:8667ba71b85a4004af54457a9734eed7)".into(),
            "--username Steve --accessToken eyJhbGciOi.secret.part --userType msa".into(),
            "Loading C:\\Users\\steve\\AppData\\Roaming\\x.jar".into(),
        ];
        let mut r = ring();
        r.reset("A", Mask { home: None, nick: None });
        let (_, plain) = r.push(&lines);
        assert!(plain.iter().all(|l| !l.contains("secret")), "the token must never reach the screen: {plain:?}");
        assert!(plain[0].contains("Steve"), "the nick stays unless the player hides it");
        assert!(!plain[3].contains("steve"), "the Windows user folder is masked");

        r.reset("A", Mask { home: None, nick: Some("Steve".into()) });
        let (_, hidden) = r.push(&lines);
        assert!(hidden.iter().all(|l| !l.to_lowercase().contains("steve")), "with the switch on no form of the nick is left: {hidden:?}");
        assert!(hidden[0].ends_with("Setting user: Player"));
        assert_eq!(r.snapshot().lines[r.snapshot().lines.len() - 4..], hidden[..], "the kept ring and the announced batch carry the same masked lines");
    }
}
