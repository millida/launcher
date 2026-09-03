use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

// Registry of running installs keyed by name: a second install of the same pack
// would share one temp archive, one .part file and one profile directory.

const BUSY: &str = "Эта установка уже идёт — дождись её или отмени";
pub const CANCELLED: &str = "Установка отменена";

#[derive(Clone)]
struct Entry {
    cancel: Arc<AtomicBool>,
    title: String,
    pct: f32,
    msg: String,
}

#[derive(Clone, serde::Serialize)]
pub struct JobInfo {
    pub key: String,
    pub title: String,
    pub pct: f32,
    pub msg: String,
}

#[derive(Clone, serde::Serialize)]
struct JobProgress {
    key: String,
    title: String,
    pct: f32,
    msg: String,
    done: bool,
    error: String,
}

fn registry() -> &'static Mutex<HashMap<String, Entry>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Entry>>> = OnceLock::new();
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, Entry>> {
    registry().lock().unwrap_or_else(|e| e.into_inner())
}

/// Deregisters itself on drop, whichever way the installer returns.
pub(crate) struct Job {
    key: String,
    cancel: Arc<AtomicBool>,
}

impl Job {
    pub(crate) fn start(key: impl Into<String>, title: impl Into<String>) -> Result<Job, String> {
        let key = key.into();
        let mut m = lock();
        if m.contains_key(&key) {
            return Err(BUSY.into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        m.insert(
            key.clone(),
            Entry { cancel: cancel.clone(), title: title.into(), pct: 0.0, msg: String::new() },
        );
        Ok(Job { key, cancel })
    }

    /// Handed to the transfer layer so a long download stops mid-body instead
    /// of only between files.
    pub(crate) fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    pub(crate) fn check(&self) -> Result<(), String> {
        if self.cancelled() {
            return Err(CANCELLED.into());
        }
        Ok(())
    }

    /// The real pack name is only known after the manifest is parsed, while the
    /// progress entry already exists.
    pub(crate) fn rename(&self, title: &str) {
        if title.is_empty() {
            return;
        }
        if let Some(e) = lock().get_mut(&self.key) {
            e.title = title.to_string();
        }
    }

    pub(crate) fn emit(&self, app: &AppHandle, pct: f32, msg: &str) {
        let title = {
            let mut m = lock();
            match m.get_mut(&self.key) {
                Some(e) => {
                    e.pct = pct;
                    e.msg = msg.to_string();
                    e.title.clone()
                }
                None => String::new(),
            }
        };
        let _ = app.emit(
            "install-progress",
            JobProgress {
                key: self.key.clone(),
                title,
                pct,
                msg: msg.to_string(),
                done: false,
                error: String::new(),
            },
        );
    }

    pub(crate) fn finish<T>(self, app: &AppHandle, res: Result<T, String>) -> Result<T, String> {
        let title = lock().get(&self.key).map(|e| e.title.clone()).unwrap_or_default();
        let _ = app.emit(
            "install-progress",
            JobProgress {
                key: self.key.clone(),
                title,
                pct: 100.0,
                msg: String::new(),
                done: true,
                error: res.as_ref().err().cloned().unwrap_or_default(),
            },
        );
        res
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        lock().remove(&self.key);
    }
}

pub fn cancel_job(key: &str) -> bool {
    match lock().get(key) {
        Some(e) => {
            e.cancel.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

pub fn active_jobs() -> Vec<JobInfo> {
    let mut out: Vec<JobInfo> = lock()
        .iter()
        .map(|(key, e)| JobInfo { key: key.clone(), title: e.title.clone(), pct: e.pct, msg: e.msg.clone() })
        .collect();
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

/// Keys must stay in sync with src/lib/installKeys.ts.
pub(crate) fn job_key_modpack_cf(mod_id: u32) -> String {
    format!("cf-modpack:{}", mod_id)
}

pub(crate) fn job_key_modpack_mr(slug: &str, target: Option<&str>) -> String {
    match target {
        Some(t) => format!("mr-modpack:{}:{}", slug, t),
        None => format!("mr-modpack:{}", slug),
    }
}

pub(crate) fn job_key_content(source: &str, profile: &str, kind: &str, project: &str) -> String {
    format!("{}-{}:{}:{}", source, kind, profile, project)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_start_of_the_same_key_is_refused() {
        let first = Job::start("test:dup", "Пак").unwrap();
        assert!(Job::start("test:dup", "Пак").is_err());
        drop(first);
        assert!(Job::start("test:dup", "Пак").is_ok());
    }

    #[test]
    fn different_keys_run_side_by_side() {
        let a = Job::start("test:a", "A").unwrap();
        let b = Job::start("test:b", "B").unwrap();
        assert!(active_jobs().iter().any(|j| j.key == "test:a"));
        assert!(active_jobs().iter().any(|j| j.key == "test:b"));
        drop(a);
        drop(b);
    }

    #[test]
    fn cancel_stops_the_running_job() {
        let job = Job::start("test:cancel", "Пак").unwrap();
        assert!(job.check().is_ok());
        assert!(cancel_job("test:cancel"));
        assert_eq!(job.check().unwrap_err(), CANCELLED);
    }

    #[test]
    fn cancel_of_unknown_job_is_not_an_error() {
        assert!(!cancel_job("test:nobody"));
    }

    #[test]
    fn job_is_released_even_when_installer_fails() {
        let r: Result<(), String> = (|| {
            let _job = Job::start("test:fail", "Пак")?;
            Err("сеть отвалилась".into())
        })();
        assert!(r.is_err());
        assert!(!active_jobs().iter().any(|j| j.key == "test:fail"));
    }
}
