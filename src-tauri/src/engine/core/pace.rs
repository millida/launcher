// How many downloads of a batch run at once. A fixed 64 at once is fine on a good line and
// the very thing that gets a player rate-limited (HTTP 429 from the mirror after ~200 requests)
// or cut by a filter that drops connections under load. So a batch starts with a few, adds more
// while everything succeeds, and falls back to the start at the first sign of trouble. No disk,
// no network here; http.rs reports trouble through `pressure()`.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;

/// Counts every sign of trouble on the wire: a 429, a connection that dropped, a transfer that
/// went silent. A batch compares it with what it saw last and steps back when it moved.
static PRESSURE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn pressure() {
    PRESSURE.fetch_add(1, Ordering::Relaxed);
}

struct State {
    limit: usize,
    running: usize,
    streak: usize,
    seen: u64,
}

pub(crate) struct Pace {
    state: Mutex<State>,
    wake: Notify,
    start: usize,
    max: usize,
    grow_after: usize,
    grow_by: usize,
    signal: &'static AtomicU64,
}

impl Pace {
    /// The usual batch: 16 at once, +8 after every 24 clean finishes, never above `max`.
    pub(crate) fn new(max: usize) -> Arc<Pace> {
        Self::with(16, max, 24, 8, &PRESSURE)
    }

    /// A batch of big transfers (ranges of one archive): fewer at a time than small files, same fall-back rule.
    pub(crate) fn tuned(start: usize, max: usize, grow_after: usize, grow_by: usize) -> Arc<Pace> {
        Self::with(start, max, grow_after, grow_by, &PRESSURE)
    }

    fn with(start: usize, max: usize, grow_after: usize, grow_by: usize, signal: &'static AtomicU64) -> Arc<Pace> {
        let start = start.clamp(1, max.max(1));
        Arc::new(Pace {
            state: Mutex::new(State { limit: start, running: 0, streak: 0, seen: signal.load(Ordering::Relaxed) }),
            wake: Notify::new(),
            start,
            max: max.max(start),
            grow_after,
            grow_by,
            signal,
        })
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Back to the start if trouble was reported since the last look.
    fn feel_pressure(&self, g: &mut State) {
        let now = self.signal.load(Ordering::Relaxed);
        if now != g.seen {
            g.seen = now;
            g.limit = self.start;
            g.streak = 0;
        }
    }

    #[cfg(test)]
    pub(crate) fn limit(&self) -> usize {
        self.locked().limit
    }

    /// Waits for a free place. The place is given back by finishing it (`good`, `bad`) or by dropping it.
    pub(crate) async fn enter(self: &Arc<Self>) -> Place {
        loop {
            let notified = self.wake.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let mut g = self.locked();
                self.feel_pressure(&mut g);
                if g.running < g.limit {
                    g.running += 1;
                    return Place { pace: self.clone(), settled: false };
                }
            }
            notified.await;
        }
    }

    fn settle(&self, outcome: Outcome) {
        let mut g = self.locked();
        g.running = g.running.saturating_sub(1);
        match outcome {
            Outcome::Clean => {
                g.streak += 1;
                if g.streak >= self.grow_after && g.limit < self.max {
                    g.limit = (g.limit + self.grow_by).min(self.max);
                    g.streak = 0;
                }
            }
            Outcome::Trouble => {
                g.limit = self.start;
                g.streak = 0;
            }
            Outcome::Neutral => {}
        }
        drop(g);
        self.wake.notify_waiters();
    }
}

enum Outcome {
    Clean,
    Trouble,
    Neutral,
}

/// One running download of a batch.
pub(crate) struct Place {
    pace: Arc<Pace>,
    settled: bool,
}

impl Place {
    /// The file arrived: the batch may speed up.
    pub(crate) fn good(mut self) {
        self.settled = true;
        self.pace.settle(Outcome::Clean);
    }

    /// The file ran into throttling or a dropped line: the batch falls back to its start.
    pub(crate) fn bad(mut self) {
        self.settled = true;
        self.pace.settle(Outcome::Trouble);
    }
}

impl Drop for Place {
    fn drop(&mut self) {
        // Left without a verdict (a 404, a cancel, a dropped future): the place is freed, the pace stays.
        if !self.settled {
            self.pace.settle(Outcome::Neutral);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn quiet() -> &'static AtomicU64 {
        Box::leak(Box::new(AtomicU64::new(0)))
    }

    #[tokio::test]
    async fn a_batch_starts_small_and_waits_at_its_limit() {
        let pace = Pace::with(2, 8, 100, 2, quiet());
        let a = pace.enter().await;
        let _b = pace.enter().await;
        let third = tokio::time::timeout(Duration::from_millis(150), pace.enter()).await;
        assert!(third.is_err(), "two places, the third waits");
        drop(a);
        let freed = tokio::time::timeout(Duration::from_millis(500), pace.enter()).await;
        assert!(freed.is_ok(), "a finished download frees its place at once");
    }

    #[tokio::test]
    async fn clean_finishes_open_the_throttle_step_by_step_up_to_the_cap() {
        let pace = Pace::with(2, 6, 3, 2, quiet());
        assert_eq!(pace.limit(), 2);
        for _ in 0..3 {
            pace.enter().await.good();
        }
        assert_eq!(pace.limit(), 4, "three clean files add two places");
        for _ in 0..30 {
            pace.enter().await.good();
        }
        assert_eq!(pace.limit(), 6, "and never above the cap");
    }

    #[tokio::test]
    async fn a_file_that_met_throttling_sends_the_batch_back_to_the_start() {
        let pace = Pace::with(2, 8, 2, 3, quiet());
        for _ in 0..4 {
            pace.enter().await.good();
        }
        assert!(pace.limit() > 2);
        pace.enter().await.bad();
        assert_eq!(pace.limit(), 2, "a 429 or a dropped line at the top speed is answered with the slowest one");
        pace.enter().await.good();
        assert_eq!(pace.limit(), 2, "the climb starts from zero again");
    }

    #[tokio::test]
    async fn trouble_seen_by_any_download_steps_back_before_the_next_place_is_given() {
        let signal = quiet();
        let pace = Pace::with(2, 8, 1, 3, signal);
        for _ in 0..3 {
            pace.enter().await.good();
        }
        assert_eq!(pace.limit(), 8);
        signal.fetch_add(1, Ordering::Relaxed);
        let _next = pace.enter().await;
        assert_eq!(pace.limit(), 2, "no waiting for a file to give up its three tries first");
    }

    #[tokio::test]
    async fn a_place_dropped_without_a_verdict_changes_nothing() {
        let pace = Pace::with(2, 8, 1, 3, quiet());
        pace.enter().await.good();
        let after_growth = pace.limit();
        drop(pace.enter().await);
        assert_eq!(pace.limit(), after_growth, "a 404 or a cancel says nothing about the line");
        let _a = pace.enter().await;
        let _b = pace.enter().await;
    }

    #[tokio::test]
    async fn many_waiters_all_get_their_turn() {
        let pace = Pace::with(1, 1, 100, 1, quiet());
        let mut tasks = Vec::new();
        let done = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        for _ in 0..20 {
            let (pace, done) = (pace.clone(), done.clone());
            tasks.push(tokio::spawn(async move {
                let place = pace.enter().await;
                tokio::time::sleep(Duration::from_millis(2)).await;
                place.good();
                done.fetch_add(1, Ordering::Relaxed);
            }));
        }
        for t in tasks {
            tokio::time::timeout(Duration::from_secs(5), t).await.expect("no waiter is left asleep").unwrap();
        }
        assert_eq!(done.load(Ordering::Relaxed), 20);
    }
}
