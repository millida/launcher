use std::future::Future;
use std::path::Path;
use crate::engine::Halt;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use crate::engine::zip_readable;

pub(crate) const LAUNCH_CANCELLED: &str = "Запуск отменён";

/// How long a new launch waits for a cancelled launch of the same build to
/// unwind before giving up on it.
const UNWIND_WAIT: Duration = Duration::from_secs(20);
const UNWIND_POLL: Duration = Duration::from_millis(150);

tokio::task_local! {
    static CURRENT: Arc<Halt>;
}

/// Every launch owns its own cancel flag. One shared flag cleared by the next
/// launch revived a cancelled one still stuck in a download: it went on to
/// start the game next to the retry.
static LIVE: Mutex<Vec<Arc<Halt>>> = Mutex::new(Vec::new());

static STARTING: Mutex<Vec<(String, Arc<Halt>)>> = Mutex::new(Vec::new());

fn locked<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub struct LaunchTicket {
    flag: Arc<Halt>,
}

pub fn begin_launch() -> LaunchTicket {
    let flag = Arc::new(Halt::default());
    locked(&LIVE).push(flag.clone());
    LaunchTicket { flag }
}

impl LaunchTicket {
    pub async fn run<F: Future>(self, fut: F) -> F::Output {
        CURRENT.scope(self.flag.clone(), fut).await
    }
}

impl Drop for LaunchTicket {
    fn drop(&mut self) {
        locked(&LIVE).retain(|f| !Arc::ptr_eq(f, &self.flag));
    }
}

pub fn cancel_launch() {
    for flag in locked(&LIVE).iter() {
        flag.cancel();
    }
}

pub(crate) fn launch_cancel_flag() -> Option<Arc<Halt>> {
    CURRENT.try_with(|f| f.clone()).ok()
}

pub(crate) fn cancelled() -> bool {
    CURRENT.try_with(|f| f.cancelled()).unwrap_or(false)
}

pub(crate) fn check_cancel() -> Result<(), String> {
    if cancelled() { Err(LAUNCH_CANCELLED.into()) } else { Ok(()) }
}

#[derive(Debug, PartialEq, Eq)]
enum Slot {
    Free,
    Busy,
    Unwinding,
}

fn slot_of(starting: &[(String, bool)], profile: &str) -> Slot {
    let mine: Vec<bool> = starting.iter().filter(|(p, _)| p == profile).map(|(_, c)| *c).collect();
    if mine.is_empty() {
        Slot::Free
    } else if mine.iter().any(|c| !c) {
        Slot::Busy
    } else {
        Slot::Unwinding
    }
}

pub(crate) struct StartSlot {
    profile: String,
    flag: Arc<Halt>,
}

impl Drop for StartSlot {
    fn drop(&mut self) {
        locked(&STARTING).retain(|(p, f)| !(p == &self.profile && Arc::ptr_eq(f, &self.flag)));
    }
}

/// One launch per build at a time. Two JVMs of one build remap the game into
/// the same `.fabric/remappedJars` and the loser dies with "error remapping
/// game jars". A launch the player already cancelled is waited out, not
/// refused: it only needs a moment to notice.
pub(crate) async fn claim_profile_start(profile: &str, on_wait: impl Fn()) -> Result<StartSlot, String> {
    let flag = launch_cancel_flag().unwrap_or_else(|| Arc::new(Halt::default()));
    let deadline = tokio::time::Instant::now() + UNWIND_WAIT;
    let mut told = false;
    loop {
        check_cancel()?;
        {
            let mut starting = locked(&STARTING);
            let view: Vec<(String, bool)> =
                starting.iter().map(|(p, f)| (p.clone(), f.cancelled())).collect();
            match slot_of(&view, profile) {
                Slot::Free => {
                    starting.push((profile.to_string(), flag.clone()));
                    return Ok(StartSlot { profile: profile.to_string(), flag });
                }
                Slot::Busy => return Err("Эта сборка уже запускается — дождись окна игры".into()),
                Slot::Unwinding => {}
            }
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Прошлый запуск этой сборки ещё останавливается — подожди несколько секунд и запусти снова".into());
        }
        if !told {
            told = true;
            on_wait();
        }
        tokio::time::sleep(UNWIND_POLL).await;
    }
}

/// A remap cut short (the second JVM of a double launch, a kill mid-start)
/// leaves a jar the loader trusts on the next start and fails on again.
pub(crate) fn drop_broken_remap_cache(game_dir: &Path) -> bool {
    let root = game_dir.join(".fabric").join("remappedJars");
    let Ok(dirs) = std::fs::read_dir(&root) else { return false };
    let mut dropped = false;
    for dir in dirs.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        if remap_dir_broken(&dir) && std::fs::remove_dir_all(&dir).is_ok() {
            dropped = true;
        }
    }
    dropped
}

fn remap_dir_broken(dir: &Path) -> bool {
    let Ok(files) = std::fs::read_dir(dir) else { return false };
    files.flatten().map(|e| e.path()).any(|p| {
        let name = p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        name.ends_with(".tmp") || (name.ends_with(".jar") && !zip_readable(&p))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// All ticket cases live in one test: the registry is global, and a
    /// cancel from a parallel test would leak into another's ticket.
    #[tokio::test]
    async fn a_cancelled_launch_stays_cancelled_when_the_next_one_begins() {
        struct Case {
            name: &'static str,
            cancel_first: bool,
            want_old: bool,
            want_new: bool,
            why: &'static str,
        }
        let cases = [
            Case {
                name: "cancel then retry",
                cancel_first: true,
                want_old: true,
                want_new: false,
                why: "retry must not revive the cancelled launch, or two games start",
            },
            Case {
                name: "no cancel",
                cancel_first: false,
                want_old: false,
                want_new: false,
                why: "a second launch must not cancel the first by itself",
            },
        ];
        for case in cases {
            let old = begin_launch();
            let old_flag = old.flag.clone();
            if case.cancel_first {
                cancel_launch();
            }
            let new = begin_launch();
            let new_seen = new.run(async { cancelled() }).await;
            let old_seen = old.run(async { cancelled() }).await;
            assert_eq!(old_seen, case.want_old, "{}: old launch cancelled = {}; {}", case.name, old_seen, case.why);
            assert_eq!(new_seen, case.want_new, "{}: new launch cancelled = {}; {}", case.name, new_seen, case.why);
            assert!(
                !locked(&LIVE).iter().any(|f| Arc::ptr_eq(f, &old_flag)),
                "{}: a finished launch must leave the registry, or later cancels pile up on dead flags",
                case.name
            );
        }
        assert!(!cancelled(), "outside a launch nothing is cancelled: repair and downloads run there");
    }

    type SlotCase<'a> = (&'a [(String, bool)], Slot, &'a str);

    #[test]
    fn one_launch_per_build() {
        let a = "Minecraft1211";
        let cases: [SlotCase; 5] = [
            (&[], Slot::Free, "nothing starting"),
            (&[("Other".into(), false)], Slot::Free, "another build does not block this one"),
            (&[(a.into(), false)], Slot::Busy, "a live launch of the same build owns .fabric/remappedJars"),
            (&[(a.into(), true)], Slot::Unwinding, "a cancelled launch is waited out, not refused"),
            (&[(a.into(), true), (a.into(), false)], Slot::Busy, "any live launch of the build wins over waiting"),
        ];
        for (starting, want, why) in cases {
            assert_eq!(slot_of(starting, a), want, "{}", why);
        }
    }

    #[test]
    fn half_written_remap_cache_is_dropped() {
        let base = std::env::temp_dir().join(format!("millida-remap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join(".fabric").join("remappedJars");
        let good = root.join("minecraft-1.21.1-0.19.5");
        let cut = root.join("minecraft-1.21.1-0.19.4");
        let tmp = root.join("minecraft-1.21.1-0.19.3");
        for d in [&good, &cut, &tmp] {
            std::fs::create_dir_all(d).unwrap();
        }
        {
            let f = std::fs::File::create(good.join("client-intermediary.jar")).unwrap();
            let mut z = zip::ZipWriter::new(f);
            z.start_file("a.class", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut z, b"x").unwrap();
            z.finish().unwrap();
        }
        std::fs::write(cut.join("client-intermediary.jar"), b"PK\x03\x04half").unwrap();
        std::fs::write(tmp.join("client-intermediary.jar.tmp"), b"x").unwrap();
        assert!(drop_broken_remap_cache(&base), "a broken cache must be reported as dropped");
        assert!(good.exists(), "a complete remap is kept: redoing it costs the player a slow start");
        assert!(!cut.exists(), "a cut jar makes Fabric fail the same way on every start");
        assert!(!tmp.exists(), "a leftover temp file means the remap never finished");
        assert!(!drop_broken_remap_cache(&base), "a clean cache is left alone");
        let _ = std::fs::remove_dir_all(&base);
    }
}
