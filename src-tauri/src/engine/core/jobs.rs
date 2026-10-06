use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

// Registry of running installs keyed by name: a second install of the same pack
// would share one temp archive, one .part file and one profile directory.

const BUSY: &str = "Эта установка уже идёт — дождись её или отмени";
pub const CANCELLED: &str = "Установка отменена";

const GATE_POLL: std::time::Duration = std::time::Duration::from_millis(200);

/// Stop signals of one transfer. A pause keeps every byte already on disk: the
/// download drops its connection and asks for the rest from the same byte once
/// resumed, so an hour-long game download survives a pause of any length.
#[derive(Default)]
pub(crate) struct Halt {
    cancel: AtomicBool,
    paused: AtomicBool,
}

impl Halt {
    pub(crate) fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub(crate) fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
    }

    pub(crate) fn paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst) && !self.cancelled()
    }

    /// Holds the caller for as long as the transfer is paused; a cancel ends
    /// the wait at once.
    pub(crate) async fn gate(&self) -> Result<(), String> {
        loop {
            if self.cancelled() {
                return Err(CANCELLED.into());
            }
            if !self.paused() {
                return Ok(());
            }
            tokio::time::sleep(GATE_POLL).await;
        }
    }
}

#[derive(Clone)]
struct Entry {
    halt: Arc<Halt>,
    pausable: bool,
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
    pub paused: bool,
    pub pausable: bool,
}

#[derive(Clone, serde::Serialize)]
struct JobProgress {
    key: String,
    title: String,
    pct: f32,
    msg: String,
    done: bool,
    error: String,
    pausable: bool,
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
    halt: Arc<Halt>,
}

impl Job {
    pub(crate) fn start(key: impl Into<String>, title: impl Into<String>) -> Result<Job, String> {
        let key = key.into();
        let mut m = lock();
        if m.contains_key(&key) {
            return Err(BUSY.into());
        }
        let halt = Arc::new(Halt::default());
        m.insert(
            key.clone(),
            Entry { halt: halt.clone(), pausable: true, title: title.into(), pct: 0.0, msg: String::new() },
        );
        Ok(Job { key, halt })
    }

    /// Handed to the transfer layer so a long download stops mid-body instead
    /// of only between files.
    pub(crate) fn cancel_flag(&self) -> &Halt {
        &self.halt
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.halt.cancelled()
    }

    /// For jobs whose work runs outside our downloader (winget, local copies):
    /// a pause there would stop nothing, so the button is not offered.
    pub(crate) fn not_pausable(&self) {
        if let Some(e) = lock().get_mut(&self.key) {
            e.pausable = false;
        }
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
        let (title, pausable) = {
            let mut m = lock();
            match m.get_mut(&self.key) {
                Some(e) => {
                    e.pct = pct;
                    e.msg = msg.to_string();
                    (e.title.clone(), e.pausable)
                }
                None => (String::new(), false),
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
                pausable,
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
                pausable: false,
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
            e.halt.cancel();
            true
        }
        None => false,
    }
}

/// False when the job is gone or cannot be paused, so the screen drops a
/// button that would do nothing.
pub fn pause_job(key: &str, paused: bool) -> bool {
    match lock().get(key) {
        Some(e) if e.pausable => {
            e.halt.set_paused(paused);
            true
        }
        _ => false,
    }
}

pub fn active_jobs() -> Vec<JobInfo> {
    let mut out: Vec<JobInfo> = lock()
        .iter()
        .map(|(key, e)| JobInfo {
            key: key.clone(),
            title: e.title.clone(),
            pct: e.pct,
            msg: e.msg.clone(),
            paused: e.halt.paused(),
            pausable: e.pausable,
        })
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

/// Готовая сборка из каталога Millida: slug карточки, а не id Modrinth.
pub(crate) fn job_key_modpack_millida(slug: &str) -> String {
    format!("millida-modpack:{}", slug)
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

    /// action -> what the registry reports. The screen restores the pause
    /// button from this after a reload, and a pause must never read as a cancel.
    #[test]
    fn pause_holds_the_job_without_cancelling_it() {
        let job = Job::start("test:pause", "Пак").unwrap();
        let paused = |key: &str| active_jobs().iter().any(|j| j.key == key && j.paused);
        assert!(pause_job("test:pause", true), "a running job must accept a pause");
        assert!(paused("test:pause"), "a paused job must say so, or the screen offers pause again");
        assert!(job.check().is_ok(), "a pause is not a cancel: the install must not end");
        assert!(pause_job("test:pause", false), "a paused job must accept a resume");
        assert!(!paused("test:pause"), "a resumed job must not stay paused");
        job.not_pausable();
        assert!(!pause_job("test:pause", true), "a job outside our downloader must refuse a pause it cannot honour");
        assert!(!pause_job("test:nobody", true), "an unknown job is not paused");
    }

    #[tokio::test]
    async fn gate_waits_out_a_pause_and_yields_to_a_cancel() {
        let halt = Arc::new(Halt::default());
        halt.set_paused(true);
        let h = halt.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            h.set_paused(false);
        });
        let started = std::time::Instant::now();
        assert!(halt.gate().await.is_ok(), "a resume must let the download go on");
        assert!(started.elapsed() >= std::time::Duration::from_millis(250), "nothing may pass the gate while paused");
        halt.set_paused(true);
        halt.cancel();
        assert_eq!(halt.gate().await.unwrap_err(), CANCELLED, "a cancel during a pause must end the install");
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
