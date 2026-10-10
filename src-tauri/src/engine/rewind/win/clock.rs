use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};

use super::super::ring::{Ticks, TICKS_PER_SECOND};

/// The performance counter in 100 ns units: the clock that capture frames
/// (`SystemRelativeTime`) and audio packets are both stamped with.
pub fn now() -> Ticks {
    let (mut counter, mut frequency) = (0i64, 0i64);
    unsafe {
        let _ = QueryPerformanceCounter(&mut counter);
        let _ = QueryPerformanceFrequency(&mut frequency);
    }
    if frequency <= 0 {
        return 0;
    }
    (counter as i128 * TICKS_PER_SECOND as i128 / frequency as i128) as Ticks
}
