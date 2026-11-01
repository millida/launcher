// Launch guard against races: launch cancel, one launch of a modpack at a time, cleaning an unfinished Fabric remap cache.
// Only in-memory state and the .fabric/remappedJars folder of this modpack.
use std::future::Future;
use std::path::Path;
use crate::engine::Halt;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use crate::engine::zip_readable;

pub(crate) const LAUNCH_CANCELLED: &str = "Запуск отменён";

/// A second launch of a build whose first one has not reached the game process yet.
pub(crate) const ALREADY_STARTING: &str = "Эта сборка уже запускается — дождись окна игры";

/// How long a new launch waits for a cancelled launch of the same build to
/// unwind before taking its place. A launch stuck in a download can sit there
/// far longer, and refusing after 20 s was the most common failed start on PC
/// (telemetry 01–10.10.2026: 36% of failed launches). The old launch is already
/// cancelled, so it stops at its next cancel check and never reaches the JVM.
const UNWIND_WAIT: Duration = Duration::from_secs(6);
const UNWIND_POLL: Duration = Duration::from_millis(150);

tokio::task_local! {
    static CURRENT: Arc<Halt>;
}

/// Every launch owns its own cancel flag. One shared flag cleared by the next
/// launch revived a cancelled one still stuck in a download: it went on to
/// start the game next to the retry.
static LIVE: Mutex<Vec<Arc<Halt>>> = Mutex::new(Vec::new());

/// A build whose launch is under way, or whose blocking work (a loader installer, an unpack) is still running after the
/// launch was cancelled or failed. `holds` counts the slot itself and every `SlotHold`; the entry goes with the last.
struct Taken {
    profile: String,
    flag: Arc<Halt>,
    holds: usize,
    /// The launch that owned the slot is gone; only blocking work keeps the entry.
    orphan: bool,
}

static STARTING: Mutex<Vec<Taken>> = Mutex::new(Vec::new());

/// What the registry says about one build: (build, "the launch is cancelled or gone") for each entry.
fn view(starting: &[Taken]) -> Vec<(String, bool)> {
    starting.iter().map(|t| (t.profile.clone(), t.flag.cancelled() || t.orphan)).collect()
}

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

/// A launch is under way (from the click until the game has started or the launch gave up).
pub(crate) fn launch_underway() -> bool {
    !locked(&LIVE).is_empty()
}

pub fn cancel_launch() {
    for flag in locked(&LIVE).iter() {
        flag.cancel();
    }
}

/// A task that belongs to the launch running in this one: it sees the same cancel flag, which a
/// plain `tokio::spawn` would drop.
pub(crate) fn spawn_in_launch<F>(fut: F) -> tokio::task::JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    match launch_cancel_flag() {
        Some(flag) => tokio::spawn(CURRENT.scope(flag, fut)),
        None => tokio::spawn(fut),
    }
}

/// `fut` as part of the launch running here, for a task that is spawned some other way (a node of
/// the launch graph): it sees the same cancel flag.
pub(crate) fn carry_launch<F: Future>(fut: F) -> impl Future<Output = F::Output> {
    let flag = launch_cancel_flag();
    async move {
        match flag {
            Some(flag) => CURRENT.scope(flag, fut).await,
            None => fut.await,
        }
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
        let mut starting = locked(&STARTING);
        let Some(at) = starting.iter().position(|t| t.profile == self.profile && Arc::ptr_eq(&t.flag, &self.flag)) else { return };
        starting[at].holds -= 1;
        if starting[at].holds == 0 {
            starting.remove(at);
        } else {
            // Blocking work of this launch is still running (the launch was cancelled or failed under it). The build
            // stays taken until it ends, and the work is told to stop now: an installer child is killed, not waited for.
            starting[at].orphan = true;
            starting[at].flag.cancel();
        }
    }
}

/// Blocking work of a launch (a loader installer, an unpack) that must finish, or be killed, before the build can be
/// started again. Dropping the launch's future does not stop a thread: without this the slot was free the moment the
/// player cancelled, and a second launch ran the same installer over the same `libraries/` and `versions/` folders.
pub(crate) struct SlotHold {
    held: Option<(String, Arc<Halt>)>,
}

impl SlotHold {
    /// Takes a hold on the slot of the launch running in this task. Outside a launch it holds nothing.
    pub(crate) fn take() -> SlotHold {
        let Some(flag) = launch_cancel_flag() else { return SlotHold { held: None } };
        let mut starting = locked(&STARTING);
        match starting.iter_mut().find(|t| Arc::ptr_eq(&t.flag, &flag)) {
            Some(t) => {
                t.holds += 1;
                SlotHold { held: Some((t.profile.clone(), flag)) }
            }
            None => SlotHold { held: None },
        }
    }

    /// The flag that says "stop" to the work this hold guards: a cancel of the launch, or the launch going away.
    pub(crate) fn stop_flag(&self) -> Option<Arc<Halt>> {
        self.held.as_ref().map(|(_, flag)| flag.clone())
    }
}

impl Drop for SlotHold {
    fn drop(&mut self) {
        let Some((profile, flag)) = self.held.take() else { return };
        let mut starting = locked(&STARTING);
        if let Some(at) = starting.iter().position(|t| t.profile == profile && Arc::ptr_eq(&t.flag, &flag)) {
            starting[at].holds -= 1;
            if starting[at].holds == 0 {
                starting.remove(at);
            }
        }
    }
}

/// `spawn_blocking` for the blocking work of a launch: the build's slot stays taken until `f` returns, even if the
/// launch itself is gone by then. `f` gets the flag it should watch to stop early (None outside a launch).
pub(crate) fn spawn_blocking_held<F, R>(f: F) -> tokio::task::JoinHandle<R>
where
    F: FnOnce(Option<Arc<Halt>>) -> R + Send + 'static,
    R: Send + 'static,
{
    let hold = SlotHold::take();
    tokio::task::spawn_blocking(move || {
        let stop = hold.stop_flag();
        let out = f(stop);
        drop(hold);
        out
    })
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
            match slot_of(&view(&starting), profile) {
                Slot::Free => {
                    starting.push(Taken { profile: profile.to_string(), flag: flag.clone(), holds: 1, orphan: false });
                    return Ok(StartSlot { profile: profile.to_string(), flag });
                }
                Slot::Busy => return Err(ALREADY_STARTING.into()),
                Slot::Unwinding => {}
            }
        }
        if tokio::time::Instant::now() >= deadline {
            let mut starting = locked(&STARTING);
            if slot_of(&view(&starting), profile) == Slot::Busy {
                return Err(ALREADY_STARTING.into());
            }
            eprintln!("[launch] отменённый запуск «{}» не остановился за {:?} — запускаем поверх него", profile, UNWIND_WAIT);
            starting.push(Taken { profile: profile.to_string(), flag: flag.clone(), holds: 1, orphan: false });
            return Ok(StartSlot { profile: profile.to_string(), flag });
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
        // Deletes the unfinished Fabric cache folder (.fabric/remappedJars) inside the modpack. The game builds it again.
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

    /// `cancel_launch` cancels every live ticket, so tests that begin tickets run one at a time: a cancel from one
    /// would otherwise land on another's launch halfway through.
    static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

    /// All ticket cases live in one test: the registry is global, and a
    /// cancel from a parallel test would leak into another's ticket.
    #[tokio::test]
    async fn a_cancelled_launch_stays_cancelled_when_the_next_one_begins() {
        let _alone = ONE_AT_A_TIME.lock().await;
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
        let cases: [SlotCase; 6] = [
            (&[], Slot::Free, "nothing starting"),
            (&[("Other".into(), false)], Slot::Free, "another build does not block this one"),
            (&[(a.into(), false)], Slot::Busy, "a live launch of the same build owns .fabric/remappedJars"),
            (&[(a.into(), true)], Slot::Unwinding, "a cancelled launch is waited out, not refused"),
            (&[(a.into(), true), (a.into(), false)], Slot::Busy, "any live launch of the build wins over waiting"),
            (&[(a.into(), true), (a.into(), true)], Slot::Unwinding, "several stuck cancelled launches still only delay the next one"),
        ];
        for (starting, want, why) in cases {
            assert_eq!(slot_of(starting, a), want, "{}", why);
        }
    }

    fn state_of(profile: &str) -> Slot {
        slot_of(&view(&locked(&STARTING)), profile)
    }

    /// Finding М1 of the second review: cancelling «Играть» freed the build at once while the Forge installer thread went
    /// on, and a second launch ran a second installer over the same libraries. The slot now stays taken until the
    /// blocking work ends, and that work is told to stop.
    #[tokio::test]
    async fn blocking_work_keeps_the_build_taken_after_the_launch_is_gone() {
        let _alone = ONE_AT_A_TIME.lock().await;
        let profile = "hold-test-build";
        let ticket = begin_launch();
        let (release, released) = std::sync::mpsc::channel::<()>();
        let (began_tx, began) = std::sync::mpsc::channel::<()>();
        let (job, slot_gone_state) = ticket
            .run(async {
                let slot = claim_profile_start(profile, || {}).await.expect("a free build is claimed");
                assert_eq!(state_of(profile), Slot::Busy);
                // An installer that does not look at any flag: it ends when it is released.
                let job = spawn_blocking_held(move |stop| {
                    began_tx.send(()).unwrap();
                    let _ = released.recv();
                    stop.is_some_and(|s| s.cancelled())
                });
                began.recv().unwrap();
                // The player cancels and the launch unwinds: its slot is dropped while the work runs.
                drop(slot);
                (job, state_of(profile))
            })
            .await;
        assert_eq!(slot_gone_state, Slot::Unwinding, "the build is still taken while its installer runs");

        // A second launch of the same build waits for the work instead of starting a second installer beside it.
        let second = begin_launch();
        let began_waiting = std::time::Instant::now();
        let claimed = tokio::spawn(second.run(async move { claim_profile_start(profile, || {}).await.is_ok() }));
        tokio::time::sleep(Duration::from_millis(400)).await;
        assert!(!claimed.is_finished(), "the second launch must not claim the build while the first one's work runs");
        release.send(()).unwrap();
        let stopped = job.await.unwrap();
        assert!(stopped, "the work was told to stop when its launch went away");
        assert!(claimed.await.unwrap(), "the second launch takes the build once the work has ended");
        assert!(began_waiting.elapsed() >= Duration::from_millis(400));
        assert_eq!(state_of(profile), Slot::Free, "the last hold clears the entry");
    }

    /// Work that is not part of a launch holds nothing and is not told to stop.
    #[tokio::test]
    async fn blocking_work_outside_a_launch_holds_nothing() {
        let stop = spawn_blocking_held(|stop| stop.is_some()).await.unwrap();
        assert!(!stop);
        let hold = SlotHold::take();
        assert!(hold.stop_flag().is_none());
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
