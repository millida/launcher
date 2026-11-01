// How many files the launcher writes at once. On a spinning disk (HDD) hundreds of small files
// written in parallel are a storm of head moves: every file waits for the others, antivirus scans
// each of them, and the installation gets slower, not faster. On an SSD there is no such limit.
// Only writing is held back: the connections stay open and keep their own pace (core/pace.rs).
use std::sync::{Arc, OnceLock};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Files written at once on a spinning disk.
const HDD_WRITERS: usize = 8;

/// A body up to this size is read from the network first and written afterwards, so a waiting
/// writer does not hold a half-read connection idle (Mojang assets are mostly a few kilobytes).
pub(crate) const SMALL_BODY: u64 = 1 << 20;

/// None: no limit (SSD, or the drive could not be told).
fn slots_for(kind: &str) -> Option<usize> {
    (kind == "hdd").then_some(HDD_WRITERS)
}

static GATE: OnceLock<Option<Arc<Semaphore>>> = OnceLock::new();

async fn gate() -> Option<Arc<Semaphore>> {
    if let Some(known) = GATE.get() {
        return known.clone();
    }
    // The drive query opens the volume: once per run, off the async threads.
    let kind = tokio::task::spawn_blocking(|| super::diskkind::disk_kind(&super::paths::game_root()))
        .await
        .unwrap_or("unknown");
    GATE.get_or_init(|| slots_for(kind).map(|n| Arc::new(Semaphore::new(n)))).clone()
}

/// Whether writes are limited on this machine.
pub(crate) async fn limited() -> bool {
    gate().await.is_some()
}

/// A place to write a file. None where writes are not limited; hold it until the file is closed.
pub(crate) async fn write_permit() -> Option<OwnedSemaphorePermit> {
    let gate = gate().await?;
    gate.acquire_owned().await.ok()
}

/// Whether the whole body is read before the file is opened: only where writes are limited, only
/// for a small body of known length, and never when an earlier part of the file is being continued.
pub(crate) fn buffers_body(limited: bool, length: Option<u64>, resumed: bool) -> bool {
    limited && !resumed && length.is_some_and(|n| n <= SMALL_BODY)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_spinning_disk_limits_writes() {
        assert_eq!(slots_for("hdd"), Some(8));
        assert_eq!(slots_for("ssd"), None, "на SSD всё как было");
        assert_eq!(slots_for("unknown"), None, "не знаем диск — не тормозим установку");
    }

    #[test]
    fn small_bodies_are_buffered_so_the_network_is_not_held_by_the_disk() {
        assert!(buffers_body(true, Some(4096), false));
        assert!(buffers_body(true, Some(SMALL_BODY), false));
        assert!(!buffers_body(true, Some(SMALL_BODY + 1), false), "большой файл пишется по ходу");
        assert!(!buffers_body(true, None, false), "длина неизвестна — по ходу");
        assert!(!buffers_body(true, Some(10), true), "докачка идёт в уже лежащий файл");
        assert!(!buffers_body(false, Some(10), false), "на SSD путь не меняется");
    }

    #[tokio::test]
    async fn no_more_writers_than_slots_run_at_once() {
        let gate = Arc::new(Semaphore::new(HDD_WRITERS));
        let mut held = Vec::new();
        for _ in 0..HDD_WRITERS {
            held.push(gate.clone().acquire_owned().await.unwrap());
        }
        let waiting = tokio::time::timeout(std::time::Duration::from_millis(50), gate.clone().acquire_owned()).await;
        assert!(waiting.is_err(), "девятый писатель ждёт, пока кто-то не закроет файл");
        held.pop();
        let next = tokio::time::timeout(std::time::Duration::from_millis(500), gate.clone().acquire_owned()).await;
        assert!(next.is_ok(), "освободилось место — следующий пишет");
    }
}
