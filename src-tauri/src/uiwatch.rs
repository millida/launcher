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

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::AppHandle;

const PING_EVERY: Duration = Duration::from_secs(2);

/// A blocking call this long on the UI thread is not slow work, it is a hang:
/// Windows itself starts ghosting the window at five seconds.
const FREEZE_AFTER: Duration = Duration::from_secs(15);

static LAST_TICK: AtomicU64 = AtomicU64::new(0);
static PENDING: AtomicBool = AtomicBool::new(false);
static REPORTED: AtomicBool = AtomicBool::new(false);

fn started() -> Instant {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    *START.get_or_init(Instant::now)
}

fn now_ms() -> u64 {
    started().elapsed().as_millis() as u64
}

fn frozen_for(last_tick: u64, now: u64) -> Duration {
    Duration::from_millis(now.saturating_sub(last_tick))
}

pub fn watch(app: &AppHandle) {
    LAST_TICK.store(now_ms(), Ordering::SeqCst);
    let app = app.clone();
    std::thread::Builder::new()
        .name("ui-watchdog".into())
        .spawn(move || loop {
            std::thread::sleep(PING_EVERY);
            let stalled = frozen_for(LAST_TICK.load(Ordering::SeqCst), now_ms());
            if stalled >= FREEZE_AFTER && !REPORTED.swap(true, Ordering::SeqCst) {
                crate::engine::record_freeze(stalled);
            }
            // One ping at a time: a frozen thread would otherwise be handed a
            // queue of them to run the moment it comes back.
            if PENDING.swap(true, Ordering::SeqCst) {
                continue;
            }
            let answered = app.run_on_main_thread(|| {
                LAST_TICK.store(now_ms(), Ordering::SeqCst);
                REPORTED.store(false, Ordering::SeqCst);
                PENDING.store(false, Ordering::SeqCst);
            });
            if answered.is_err() {
                PENDING.store(false, Ordering::SeqCst);
                return;
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole point is the gap between the last answer and now — a running
    /// clock must never read as a freeze, and a stopped one must.
    #[test]
    fn a_freeze_is_the_silence_since_the_last_answer() {
        let cases: [(u64, u64, bool, &str); 4] = [
            (10_000, 10_100, false, "ответ пришёл 100 мс назад — поток жив"),
            (10_000, 24_000, false, "14 с: до порога, окно ещё может отвиснуть само"),
            (10_000, 25_000, true, "15 с молчания — это зависание, а не медленная работа"),
            (0, 60_000, true, "поток не ответил ни разу с самого старта"),
        ];
        for (last, now, want, why) in cases {
            assert_eq!(
                frozen_for(last, now) >= FREEZE_AFTER,
                want,
                "frozen_for({last}, {now}) должен считаться зависанием = {want}: {why}",
            );
        }
    }

    /// Windows ghosts a window at five seconds, so a report that waits minutes
    /// would miss exactly the freezes players complain about.
    #[test]
    fn the_report_fires_while_the_player_is_still_looking_at_it() {
        assert!(FREEZE_AFTER >= Duration::from_secs(5), "короткая пауза на диске — ещё не зависание");
        assert!(FREEZE_AFTER <= Duration::from_secs(30), "дольше — и жалоба уедет в поддержку раньше отчёта");
        assert!(PING_EVERY < FREEZE_AFTER, "опрос реже порога никогда бы его не заметил");
    }
}
