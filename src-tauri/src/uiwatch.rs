//! Watchdog for the thread that pumps the window.
//!
//! A freeze of the UI thread is invisible in every log the launcher keeps: the
//! process is alive, nothing panics, nothing is written, and the only trace is
//! "(Не отвечает)" in the title bar of a window the player then kills. Support
//! gets "лаунчер не запускается" and nothing to work with.
//!
//! A ping is posted to the main thread on a timer; when the answer stops coming
//! back for long enough, the freeze is written to the crash folder, so the next
//! launch reports how long the interface was gone.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime};

use tauri::AppHandle;

const PING_EVERY: Duration = Duration::from_secs(2);

/// A blocking call this long on the UI thread is not slow work, it is a hang:
/// Windows itself starts ghosting the window at five seconds.
const FREEZE_AFTER: Duration = Duration::from_secs(15);

/// The watchdog woke up this late: it was not running either. The machine
/// slept or hibernated (or the OS parked the whole process), and that gap is
/// nobody's freeze. On Windows `Instant` keeps counting through sleep, so a
/// laptop lid closed for 17 minutes read as «интерфейс не отвечал 1019 с» — one
/// fingerprint with 27 378 reports (25.09.2026).
const SUSPEND_GAP: Duration = Duration::from_secs(10);

static PENDING: AtomicBool = AtomicBool::new(false);
static ANSWERED: AtomicBool = AtomicBool::new(false);

/// Silence the UI owes for one watchdog tick. Measured on both clocks: the
/// monotonic one skips sleep on macOS and Linux, the wall clock does not skip
/// it anywhere — a gap on either means the process itself was stopped.
fn owed(mono_gap: Duration, wall_gap: Option<Duration>) -> Duration {
    let suspended = mono_gap > SUSPEND_GAP || wall_gap.is_some_and(|g| g > SUSPEND_GAP);
    if suspended {
        Duration::ZERO
    } else {
        mono_gap
    }
}

pub fn watch(app: &AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("ui-watchdog".into())
        .spawn(move || {
            let mut silent = Duration::ZERO;
            // One report per session: a machine that keeps swapping would
            // otherwise file the same freeze every few minutes.
            let mut reported: Option<u64> = None;
            let mut closed = false;
            let mut last = (Instant::now(), SystemTime::now());
            loop {
                std::thread::sleep(PING_EVERY);
                if crate::exiting() {
                    return;
                }
                let now = (Instant::now(), SystemTime::now());
                let gap = owed(now.0.duration_since(last.0), now.1.duration_since(last.1).ok());
                last = now;
                if ANSWERED.swap(false, Ordering::SeqCst) {
                    // The thread came back: the report gets the full length.
                    if let (Some(stamp), false) = (reported, closed) {
                        crate::engine::record_freeze(stamp, silent, true);
                        closed = true;
                    }
                    silent = Duration::ZERO;
                } else if PENDING.load(Ordering::SeqCst) {
                    silent += gap;
                }
                if silent >= FREEZE_AFTER && reported.is_none() {
                    reported = Some(crate::engine::record_freeze(0, silent, false));
                }
                // One ping at a time: a frozen thread would otherwise be handed a
                // queue of them to run the moment it comes back.
                if PENDING.swap(true, Ordering::SeqCst) {
                    continue;
                }
                let answered = app.run_on_main_thread(|| {
                    ANSWERED.store(true, Ordering::SeqCst);
                    PENDING.store(false, Ordering::SeqCst);
                });
                if answered.is_err() {
                    PENDING.store(false, Ordering::SeqCst);
                    return;
                }
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (monotonic gap, wall gap) -> silence counted, why.
    #[test]
    fn sleep_and_hibernation_are_not_freezes() {
        let s = Duration::from_secs;
        let cases: [(Duration, Option<Duration>, Duration, &str); 5] = [
            (s(2), Some(s(2)), s(2), "обычный тик: две секунды молчания засчитаны"),
            (s(1019), Some(s(1019)), s(0), "Windows: крышку закрыли на 17 минут — Instant шёл во сне"),
            (s(2), Some(s(1019)), s(0), "macOS/Linux: монотонные часы сон пропустили, стенные — нет"),
            (s(3), None, s(3), "часы перевели назад — считаем по монотонным"),
            (s(9), Some(s(9)), s(9), "поток сторожа опоздал, но не спал — это ещё работа машины"),
        ];
        for (mono, wall, want, why) in cases {
            assert_eq!(owed(mono, wall), want, "{why}");
        }
    }

    /// Windows ghosts a window at five seconds, so a report that waits minutes
    /// would miss exactly the freezes players complain about.
    #[test]
    fn the_report_fires_while_the_player_is_still_looking_at_it() {
        assert!(FREEZE_AFTER >= Duration::from_secs(5), "короткая пауза на диске — ещё не зависание");
        assert!(FREEZE_AFTER <= Duration::from_secs(30), "дольше — и жалоба уедет в поддержку раньше отчёта");
        assert!(PING_EVERY < FREEZE_AFTER, "опрос реже порога никогда бы его не заметил");
        assert!(SUSPEND_GAP > PING_EVERY * 2, "обычная задержка планировщика — не сон");
    }
}
