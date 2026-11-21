// Scheduled world backups of a build: after the game exits, or once a day or a week. Zips go into the same
// backups folder as the player's own; only the automatic ones are rotated. Optional upload to the Millida cloud.
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::backups::{now_secs, zip_world_where};
use crate::engine::*;

/// In the launcher's own folder of the build, apart from `millida-settings.json`: a change
/// there drops the launch plan the lobby prepared.
const SETTINGS_FILE: &str = "world-autobackup.json";
/// Beside `.auto-snapshots.json`, and separate from it: the two schedules keep their own copies.
const RECORD_FILE: &str = ".auto-world-backups.json";
const DAY: u64 = 24 * 60 * 60;
const KEEP_CHOICES: [u32; 3] = [3, 5, 10];
const DEFAULT_KEEP: u32 = 5;
/// The start of the launcher is busy enough; a backup of a big world can wait.
const START_DELAY: Duration = Duration::from_secs(90);
const ZIP_TRIES: usize = 2;

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "lowercase")]
pub enum AutoBackupMode {
    #[default]
    Off,
    Exit,
    Daily,
    Weekly,
}

impl AutoBackupMode {
    fn period(self) -> Option<u64> {
        match self {
            AutoBackupMode::Daily => Some(DAY),
            AutoBackupMode::Weekly => Some(7 * DAY),
            AutoBackupMode::Off | AutoBackupMode::Exit => None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct WorldAutoBackup {
    pub mode: AutoBackupMode,
    pub keep: u32,
    /// Also upload each automatic backup to the Millida cloud (PLUS).
    pub cloud: bool,
}

impl Default for WorldAutoBackup {
    fn default() -> Self {
        WorldAutoBackup { mode: AutoBackupMode::Off, keep: DEFAULT_KEEP, cloud: false }
    }
}

impl WorldAutoBackup {
    fn normalized(mut self) -> Self {
        if !KEEP_CHOICES.contains(&self.keep) {
            self.keep = DEFAULT_KEEP;
        }
        self
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Eq, Debug)]
pub(crate) struct AutoEntry {
    pub world: String,
    pub file: String,
    pub at: u64,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupReport {
    pub profile: String,
    pub worlds: Vec<String>,
    pub failed: Vec<String>,
    pub uploaded: u32,
    pub cloud_error: String,
    #[serde(skip)]
    pub files: Vec<(String, PathBuf)>,
}

fn settings_path(profile: &str) -> PathBuf {
    profile_dir(profile).join("millida").join(SETTINGS_FILE)
}

/// A file written by another version or edited by hand falls back to "off": a schedule
/// nobody chose must never start copying gigabytes.
pub fn world_autobackup(profile: &str) -> WorldAutoBackup {
    std::fs::read(settings_path(profile))
        .ok()
        .and_then(|b| serde_json::from_slice::<WorldAutoBackup>(&b).ok())
        .unwrap_or_default()
        .normalized()
}

pub fn set_world_autobackup(profile: &str, settings: WorldAutoBackup) -> Result<WorldAutoBackup, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let settings = settings.normalized();
    write_json_atomic(&settings_path(profile), &settings)
        .map_err(|e| format!("Не удалось сохранить настройку автобэкапа: {}", e))?;
    Ok(settings)
}

pub(crate) fn last_auto_at(record: &[AutoEntry], world: &str) -> u64 {
    record.iter().filter(|e| e.world == world).map(|e| e.at).max().unwrap_or(0)
}

/// Which worlds get a backup now. `worlds` pairs a folder with the time its level.dat was
/// last written (0 when it has none); `since` is the start of the play session that just
/// ended, absent when the check runs at the start of the launcher.
pub(crate) fn worlds_due(
    mode: AutoBackupMode,
    worlds: &[(String, u64)],
    record: &[AutoEntry],
    now: u64,
    since: Option<u64>,
) -> Vec<String> {
    worlds
        .iter()
        .filter(|(world, played)| {
            let last = last_auto_at(record, world);
            if *played == 0 || *played <= last {
                return false;
            }
            match (mode, mode.period(), since) {
                (AutoBackupMode::Exit, _, Some(start)) => *played >= start,
                (_, Some(period), _) => now.saturating_sub(last) >= period,
                _ => false,
            }
        })
        .map(|(world, _)| world.clone())
        .collect()
}

/// Splits the record into what stays and what goes: only this world's automatic copies are
/// counted, the newest `keep` survive. Backups the player made are not in the record at all.
pub(crate) fn rotate_world(record: Vec<AutoEntry>, world: &str, keep: usize) -> (Vec<AutoEntry>, Vec<AutoEntry>) {
    let mut mine: Vec<&AutoEntry> = record.iter().filter(|e| e.world == world).collect();
    mine.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.file.cmp(&a.file)));
    let dropped: Vec<AutoEntry> = mine.into_iter().skip(keep).cloned().collect();
    let kept = record.into_iter().filter(|e| !dropped.contains(e)).collect();
    (kept, dropped)
}

fn load_record(dir: &Path) -> Vec<AutoEntry> {
    let record: Vec<AutoEntry> = std::fs::read(dir.join(RECORD_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    // A copy the player deleted by hand no longer counts as the last backup of its world.
    record.into_iter().filter(|e| safe_child(dir, &e.file).is_ok_and(|p| p.is_file())).collect()
}

fn level_written(world: &Path) -> Option<SystemTime> {
    std::fs::metadata(world.join("level.dat")).and_then(|m| m.modified()).ok()
}

fn as_secs(t: Option<SystemTime>) -> u64 {
    t.and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

fn saved_worlds(saves: &Path) -> Vec<(String, PathBuf, u64)> {
    let Ok(rd) = std::fs::read_dir(saves) else { return vec![] };
    rd.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || safe_file_name(&name).is_err() {
                return None;
            }
            Some((name, e.path(), as_secs(level_written(&e.path()))))
        })
        .collect()
}

fn free_name(dir: &Path, world: &str) -> Result<(String, PathBuf), String> {
    let mut at = now_secs();
    loop {
        let file = format!("{}-{}.zip", world, at);
        let path = safe_child(dir, &file)?;
        if !path.exists() {
            return Ok((file, path));
        }
        at += 1;
    }
}

/// The game may be started again while the zip is written. It only writes files when it
/// saves, and every save rewrites level.dat: a zip taken across a save could mix two states
/// of the world, so it is thrown away and taken again. session.lock is never read: the
/// running game holds it locked.
fn zip_world_consistent(src: &Path, dir: &Path, world: &str) -> Result<String, String> {
    for _ in 0..ZIP_TRIES {
        let before = level_written(src);
        let (file, out) = free_name(dir, world)?;
        zip_world_where(src, &out, |rel| rel != "session.lock")?;
        if level_written(src) == before {
            return Ok(file);
        }
        if let Err(e) = std::fs::remove_file(&out) {
            eprintln!("[autobackup] a torn copy {} stays: {e}", out.display());
        }
    }
    Err("мир сохранялся во время копирования, попробуем в следующий раз".into())
}

/// One run at a time across the app: the exit of a game and the start check never zip the
/// same world side by side.
fn run_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn run_world_autobackups(profile: &str, since: Option<u64>) -> AutoBackupReport {
    let _one = run_lock();
    let mut report = AutoBackupReport { profile: profile.to_string(), ..Default::default() };
    let settings = world_autobackup(profile);
    if settings.mode == AutoBackupMode::Off {
        return report;
    }
    let worlds = saved_worlds(&profile_dir(profile).join("saves"));
    let dir = backups_dir(profile);
    let mut record = load_record(&dir);
    let stamps: Vec<(String, u64)> = worlds.iter().map(|(n, _, at)| (n.clone(), *at)).collect();
    let due = worlds_due(settings.mode, &stamps, &record, now_secs(), since);
    for (world, src, _) in worlds.iter().filter(|(n, _, _)| due.contains(n)) {
        let file = match zip_world_consistent(src, &dir, world) {
            Ok(f) => f,
            Err(e) => {
                report.failed.push(format!("{}: {}", world, e));
                continue;
            }
        };
        record.push(AutoEntry { world: world.clone(), file: file.clone(), at: now_secs() });
        let (kept, dropped) = rotate_world(record, world, settings.keep as usize);
        record = kept;
        for old in dropped {
            if let Ok(p) = safe_child(&dir, &old.file) {
                if let Err(e) = std::fs::remove_file(&p) {
                    eprintln!("[autobackup] an old copy {} stays: {e}", p.display());
                }
            }
        }
        if let Err(e) = write_json_atomic(&dir.join(RECORD_FILE), &record) {
            report.failed.push(format!("{}: {}", world, e));
        }
        report.worlds.push(world.clone());
        report.files.push((world.clone(), dir.join(&file)));
    }
    report
}

/// Uploads what the run produced when the player asked for it; a lapsed PLUS or a dead
/// network leaves the copies on this PC and says so once.
async fn upload_report(app: &AppHandle, report: &mut AutoBackupReport) {
    if report.files.is_empty() || !world_autobackup(&report.profile).cloud {
        return;
    }
    for (world, path) in report.files.clone() {
        match upload_world_zip(app, &report.profile, &world, path).await {
            Ok(_) => report.uploaded += 1,
            Err(e) => {
                report.cloud_error = e;
                return;
            }
        }
    }
}

fn finish(app: &AppHandle, mut report: AutoBackupReport) {
    if report.worlds.is_empty() && report.failed.is_empty() {
        return;
    }
    tauri::async_runtime::block_on(upload_report(app, &mut report));
    crate::background::emit_main(app, "world-autobackup", report);
}

/// Called when a game of `profile` has exited after `played_secs` of play.
pub fn world_backups_after_exit(app: &AppHandle, profile: &str, played_secs: u64) {
    if world_autobackup(profile).mode == AutoBackupMode::Off {
        return;
    }
    let app = app.clone();
    let profile = profile.to_string();
    let since = now_secs().saturating_sub(played_secs);
    std::thread::spawn(move || {
        let report = run_world_autobackups(&profile, Some(since));
        finish(&app, report);
    });
}

/// The daily and weekly schedules are checked once after the launcher starts.
pub fn world_backups_on_start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(START_DELAY);
        for p in load_profiles() {
            if world_autobackup(&p.name).mode.period().is_none() {
                continue;
            }
            let report = run_world_autobackups(&p.name, None);
            finish(&app, report);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(world: &str, at: u64) -> AutoEntry {
        AutoEntry { world: world.into(), file: format!("{world}-{at}.zip"), at }
    }

    struct Case<'a> {
        why: &'a str,
        mode: AutoBackupMode,
        worlds: &'a [(&'a str, u64)],
        since: Option<u64>,
        want: &'a [&'a str],
    }

    const NOW: u64 = 100 * DAY;

    #[test]
    fn worlds_due_follow_the_schedule() {
        let record = vec![entry("Old", NOW - 2 * DAY), entry("Fresh", NOW - DAY / 2), entry("Week", NOW - 3 * DAY)];
        let cases = [
            Case { why: "off never copies", mode: AutoBackupMode::Off, worlds: &[("New", NOW)], since: Some(0), want: &[] },
            Case {
                why: "on exit: only worlds written during the session",
                mode: AutoBackupMode::Exit,
                worlds: &[("Played", NOW - 60), ("Untouched", NOW - 5 * DAY)],
                since: Some(NOW - 3600),
                want: &["Played"],
            },
            Case {
                why: "on exit: a world unchanged since its last automatic copy is skipped",
                mode: AutoBackupMode::Exit,
                worlds: &[("Fresh", NOW - DAY / 2)],
                since: Some(NOW - DAY),
                want: &[],
            },
            Case { why: "on exit: the start check copies nothing", mode: AutoBackupMode::Exit, worlds: &[("New", NOW)], since: None, want: &[] },
            Case {
                why: "daily: a day passed and the world changed",
                mode: AutoBackupMode::Daily,
                worlds: &[("Old", NOW - DAY), ("Fresh", NOW - 60)],
                since: None,
                want: &["Old"],
            },
            Case { why: "daily: a day passed but nobody played", mode: AutoBackupMode::Daily, worlds: &[("Old", NOW - 3 * DAY)], since: None, want: &[] },
            Case { why: "weekly: three days are not a week", mode: AutoBackupMode::Weekly, worlds: &[("Week", NOW - 60)], since: None, want: &[] },
            Case {
                why: "a world never copied before is copied by a periodic schedule",
                mode: AutoBackupMode::Weekly,
                worlds: &[("New", NOW - 60)],
                since: None,
                want: &["New"],
            },
            Case { why: "a folder without level.dat is not a world", mode: AutoBackupMode::Daily, worlds: &[("Empty", 0)], since: None, want: &[] },
        ];
        for c in cases {
            let worlds: Vec<(String, u64)> = c.worlds.iter().map(|(n, t)| (n.to_string(), *t)).collect();
            let got = worlds_due(c.mode, &worlds, &record, NOW, c.since);
            assert_eq!(got, c.want.iter().map(|s| s.to_string()).collect::<Vec<_>>(), "{}", c.why);
        }
    }

    #[test]
    fn rotation_never_touches_other_worlds_or_manual_backups() {
        let record = vec![entry("W", 1), entry("W", 3), entry("W", 2), entry("W", 4), entry("W-2", 1), entry("Other", 1)];
        let (kept, dropped) = rotate_world(record, "W", 3);
        assert_eq!(dropped, vec![entry("W", 1)], "only the oldest automatic copy of this world goes");
        assert!(kept.contains(&entry("W-2", 1)), "a world whose name starts like this one keeps its copies");
        assert!(kept.contains(&entry("Other", 1)), "another world's copies are not touched");
        assert_eq!(kept.len(), 5);
        let (_, none) = rotate_world(vec![entry("W", 1)], "W", 3);
        assert!(none.is_empty(), "under the limit nothing is removed");
    }

    #[test]
    fn unknown_settings_fall_back_to_off() {
        let parsed: WorldAutoBackup = serde_json::from_str(r#"{"mode":"hourly","keep":5}"#).unwrap_or_default();
        assert_eq!(parsed.mode, AutoBackupMode::Off, "an unknown schedule must not start copying");
        let odd = WorldAutoBackup { mode: AutoBackupMode::Daily, keep: 1000, cloud: false }.normalized();
        assert_eq!(odd.keep, DEFAULT_KEEP, "keep is one of the offered choices");
    }

    #[test]
    fn automatic_copy_skips_the_lock_of_a_running_game() {
        let root = std::env::temp_dir().join("millida-autobackup-test");
        let _ = std::fs::remove_dir_all(&root);
        let world = root.join("saves").join("W");
        let dir = root.join("backups");
        std::fs::create_dir_all(&world).unwrap();
        std::fs::write(world.join("level.dat"), b"level").unwrap();
        std::fs::write(world.join("session.lock"), b"lock").unwrap();
        let file = zip_world_consistent(&world, &dir, "W").expect("a quiet world is copied");
        let zip = zip::ZipArchive::new(std::fs::File::open(dir.join(&file)).unwrap()).unwrap();
        let names: Vec<&str> = zip.file_names().collect();
        assert!(names.contains(&"level.dat"));
        assert!(!names.contains(&"session.lock"), "the running game holds session.lock: reading it fails on Windows");
    }
}
