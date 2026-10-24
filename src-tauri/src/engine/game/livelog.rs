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

struct Ring {
    profile: String,
    /// Number of the oldest line kept; numbers grow across launches and never repeat.
    first: u64,
    lines: VecDeque<String>,
}

static RING: Mutex<Ring> = Mutex::new(Ring { profile: String::new(), first: 0, lines: VecDeque::new() });

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
    fn reset(&mut self, profile: &str) {
        self.first += self.lines.len() as u64;
        self.lines.clear();
        self.profile = profile.to_string();
    }

    /// Number of the first of `lines`.
    fn push(&mut self, lines: &[String]) -> u64 {
        let seq = self.first + self.lines.len() as u64;
        for line in lines {
            if self.lines.len() >= MAX_LINES {
                self.lines.pop_front();
                self.first += 1;
            }
            self.lines.push_back(clip(line));
        }
        seq
    }

    fn snapshot(&self) -> LiveLogSnapshot {
        LiveLogSnapshot { profile: self.profile.clone(), seq: self.first, lines: self.lines.iter().cloned().collect() }
    }
}

/// A new launch: the buffer starts empty, numbering goes on.
pub fn reset_live_log(profile: &str) {
    RING.lock().unwrap_or_else(|e| e.into_inner()).reset(profile);
}

/// Keeps a batch and announces it with its number. Both happen under one lock,
/// so the stdout and stderr readers cannot announce their batches out of order.
pub fn publish_live_log(app: &AppHandle, lines: &[String]) {
    let mut ring = RING.lock().unwrap_or_else(|e| e.into_inner());
    let seq = ring.push(lines);
    let _ = app.emit(LIVE_LOG_EVENT, Batch { seq, lines });
}

pub fn live_log_snapshot() -> LiveLogSnapshot {
    RING.lock().unwrap_or_else(|e| e.into_inner()).snapshot()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Ring {
        Ring { profile: String::new(), first: 0, lines: VecDeque::new() }
    }

    /// A session of hours writes hundreds of thousands of lines: memory must
    /// stay at the ring's size, and the numbers must stay continuous so a
    /// reader resumes exactly where the snapshot ended.
    #[test]
    fn a_long_session_stays_bounded_and_numbered() {
        let mut r = ring();
        r.reset("Big");
        let batch: Vec<String> = (0..50).map(|i| format!("line {i}")).collect();
        let mut seq = 0;
        for _ in 0..4000 {
            seq = r.push(&batch);
        }
        let snap = r.snapshot();
        assert_eq!(snap.lines.len(), MAX_LINES, "the ring must not grow past its size, whatever the session length");
        assert_eq!(snap.seq + snap.lines.len() as u64, seq + batch.len() as u64, "the snapshot must end where the next batch starts");
        assert_eq!(snap.lines.last().map(String::as_str), Some("line 49"), "the newest lines are the ones kept");
    }

    #[test]
    fn a_new_launch_starts_empty_and_keeps_numbering() {
        let mut r = ring();
        r.reset("A");
        r.push(&["one".into(), "two".into()]);
        r.reset("B");
        let snap = r.snapshot();
        assert!(snap.lines.is_empty(), "the old game's lines must not show under the new launch");
        assert_eq!((snap.profile.as_str(), snap.seq), ("B", 2), "numbers never repeat, or a late batch of the old game would pass for the new one");
        assert_eq!(r.push(&["three".into()]), 2);
    }

    #[test]
    fn one_huge_line_is_cut() {
        let mut r = ring();
        r.push(&["x".repeat(MAX_LINE_CHARS * 10)]);
        assert_eq!(r.snapshot().lines[0].chars().count(), MAX_LINE_CHARS + 1, "a mod dumping a megabyte in one line must not hold it in memory");
    }
}
