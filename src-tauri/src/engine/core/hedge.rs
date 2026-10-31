// Duplicate requests for the slow end of a batch of downloads. The last few percent of a stage
// (the final assets, the final libraries) decide when the progress bar finally moves: one hung
// connection holds the whole launch. When the batch is nearly done, a file that is still
// running gets a second try on the other route; the first answer wins and the other is dropped.
// This file only decides when; the downloads themselves are in http.rs.
use std::future::Future;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// A batch counts as "in its tail" when this share of its files (or fewer) is left.
const TAIL_PERCENT: usize = 5;

/// A file in the tail is duplicated only after it has been running this long, so ordinary small
/// files that are about to finish anyway cost nothing.
pub(crate) const HEDGE_AFTER: Duration = Duration::from_secs(3);

const TAIL_POLL: Duration = Duration::from_millis(200);

/// Progress of one batch: how many of its files are not finished yet.
pub(crate) struct Tail {
    total: usize,
    left: AtomicUsize,
}

impl Tail {
    pub(crate) fn new(total: usize) -> Arc<Tail> {
        Arc::new(Tail { total, left: AtomicUsize::new(total) })
    }

    /// One file of the batch is done (finished or given up on).
    pub(crate) fn finished(&self) {
        // A plain CAS loop: `fetch_update` is deprecated on newer stable (renamed `try_update`),
        // and CI builds with the latest stable while local toolchains may lag behind.
        let mut n = self.left.load(Ordering::Relaxed);
        while n > 0 {
            match self.left.compare_exchange_weak(n, n - 1, Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => break,
                Err(cur) => n = cur,
            }
        }
    }

    pub(crate) fn in_tail(&self) -> bool {
        let limit = (self.total * TAIL_PERCENT).div_ceil(100).max(1);
        self.left.load(Ordering::Relaxed) <= limit
    }

    /// Completes once the batch is in its tail and the file has been running for `after`.
    pub(crate) async fn due(&self, started: Instant, after: Duration) {
        loop {
            if self.in_tail() && started.elapsed() >= after {
                return;
            }
            tokio::time::sleep(TAIL_POLL).await;
        }
    }
}

/// The first success of two attempts. The second starts only when `trigger` completes and the
/// first is still running. If one fails, the other is awaited; if both fail, the first one's
/// error is returned. Whatever loses is dropped, which cancels it.
pub(crate) async fn first_ok<T, E, A, B, W>(primary: A, trigger: W, backup: B) -> Result<T, E>
where
    A: Future<Output = Result<T, E>>,
    B: Future<Output = Result<T, E>>,
    W: Future<Output = ()>,
{
    tokio::pin!(primary);
    tokio::pin!(trigger);
    tokio::select! {
        r = &mut primary => return r,
        _ = &mut trigger => {}
    }
    tokio::pin!(backup);
    tokio::select! {
        r = &mut primary => match r {
            Ok(v) => Ok(v),
            Err(e) => backup.await.or(Err(e)),
        },
        r = &mut backup => match r {
            Ok(v) => Ok(v),
            Err(e) => primary.await.or(Err(e)),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn the_tail_is_the_last_five_percent_and_never_less_than_one_file() {
        let big = Tail::new(100);
        for _ in 0..94 {
            big.finished();
        }
        assert!(!big.in_tail(), "6 of 100 left is still the body of the batch");
        big.finished();
        assert!(big.in_tail(), "5 of 100 left is the tail");

        let small = Tail::new(8);
        for _ in 0..6 {
            small.finished();
        }
        assert!(!small.in_tail(), "2 of 8 left is not yet the tail");
        small.finished();
        assert!(small.in_tail(), "the very last file of a small batch is its tail");

        let one = Tail::new(1);
        assert!(one.in_tail(), "a single file is all tail");
        one.finished();
        one.finished();
        assert!(one.in_tail(), "finishing more than there were never underflows");
    }

    #[tokio::test]
    async fn a_file_is_duplicated_only_in_the_tail_and_only_when_it_runs_long() {
        let tail = Tail::new(100);
        let started = Instant::now();
        let early = tokio::time::timeout(Duration::from_millis(300), tail.due(started, Duration::ZERO)).await;
        assert!(early.is_err(), "the body of a batch never duplicates");
        for _ in 0..97 {
            tail.finished();
        }
        let young = tokio::time::timeout(Duration::from_millis(250), tail.due(Instant::now(), Duration::from_secs(5))).await;
        assert!(young.is_err(), "a file that has just started is left alone even in the tail");
        let old = tokio::time::timeout(Duration::from_millis(500), tail.due(started, Duration::from_millis(100))).await;
        assert!(old.is_ok(), "a long runner in the tail is duplicated");
    }

    #[tokio::test]
    async fn the_backup_wins_when_the_first_attempt_hangs() {
        let backup_started = AtomicBool::new(false);
        let got: Result<&str, String> = first_ok(
            async {
                tokio::time::sleep(Duration::from_secs(30)).await;
                Ok("slow")
            },
            tokio::time::sleep(Duration::from_millis(50)),
            async {
                backup_started.store(true, Ordering::Relaxed);
                Ok("quick")
            },
        )
        .await;
        assert_eq!(got, Ok("quick"));
        assert!(backup_started.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn a_first_attempt_that_finishes_in_time_never_starts_the_backup() {
        let backup_started = AtomicBool::new(false);
        let got: Result<&str, String> = first_ok(
            async {
                tokio::time::sleep(Duration::from_millis(20)).await;
                Ok("first")
            },
            tokio::time::sleep(Duration::from_millis(500)),
            async {
                backup_started.store(true, Ordering::Relaxed);
                Ok("backup")
            },
        )
        .await;
        assert_eq!(got, Ok("first"));
        assert!(!backup_started.load(Ordering::Relaxed), "nothing is duplicated while the first is on time");
    }

    #[tokio::test]
    async fn an_early_failure_is_the_callers_to_retry_not_the_backups() {
        let backup_started = AtomicBool::new(false);
        let got: Result<&str, String> = first_ok(
            async { Err("refused".to_string()) },
            tokio::time::sleep(Duration::from_millis(500)),
            async {
                backup_started.store(true, Ordering::Relaxed);
                Ok("backup")
            },
        )
        .await;
        assert_eq!(got, Err("refused".to_string()), "the normal retry path handles a quick failure");
        assert!(!backup_started.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn one_failing_attempt_waits_for_the_other_and_both_failing_report_the_first() {
        let ok: Result<&str, String> = first_ok(
            async {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Err("first failed".to_string())
            },
            tokio::time::sleep(Duration::from_millis(10)),
            async {
                tokio::time::sleep(Duration::from_millis(200)).await;
                Ok("backup")
            },
        )
        .await;
        assert_eq!(ok, Ok("backup"), "the late success of the backup still counts");

        let both: Result<&str, String> = first_ok(
            async {
                tokio::time::sleep(Duration::from_millis(100)).await;
                Err("first failed".to_string())
            },
            tokio::time::sleep(Duration::from_millis(10)),
            async {
                tokio::time::sleep(Duration::from_millis(150)).await;
                Err("backup failed".to_string())
            },
        )
        .await;
        assert_eq!(both, Err("first failed".to_string()));
    }
}
