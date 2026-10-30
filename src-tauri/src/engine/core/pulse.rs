// Honest time left for a download: a speed measured over the last seconds, not over the whole transfer, and no promise
// until there is enough to base one on. No disk, no network. The install bar shows the number next to the bytes.
use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// Samples older than this do not speak for the line any more: a pack download changes speed in minutes, not hours.
const WINDOW: Duration = Duration::from_secs(15);
/// No promise before this much time and data: the first seconds are a TLS handshake and a slow start, and an estimate
/// built on them swings by an order of magnitude.
const WARM_UP: Duration = Duration::from_secs(4);
const WARM_UP_BYTES: u64 = 1 << 20;
/// Below this the line is stalled rather than slow, and a time left computed from it would be days.
const STALLED_BPS: f64 = 4.0 * 1024.0;
/// Longer than this is not a promise anyone can keep.
const GIVE_UP: Duration = Duration::from_secs(12 * 3600);
/// How strongly a new reading pulls the smoothed speed: high enough to follow a real change, low enough that one
/// burst or one pause does not move the number the player reads.
const SMOOTH: f64 = 0.25;
/// The stretch that decides whether the line has stopped.
const RECENT: Duration = Duration::from_secs(3);

pub(crate) struct Pulse {
    born: Instant,
    samples: VecDeque<(Instant, u64)>,
    smooth: f64,
    seen: u64,
}

impl Pulse {
    pub(crate) fn new(now: Instant) -> Pulse {
        Pulse { born: now, samples: VecDeque::new(), smooth: 0.0, seen: 0 }
    }

    /// `done` is the total of network bytes received so far (not a delta), `now` the moment of the reading.
    pub(crate) fn push(&mut self, now: Instant, done: u64) {
        self.seen = done;
        self.samples.push_back((now, done));
        while self.samples.len() > 2 && self.samples.front().is_some_and(|(t, _)| now.duration_since(*t) > WINDOW) {
            self.samples.pop_front();
        }
        let Some(&(t0, b0)) = self.samples.front() else { return };
        let secs = now.duration_since(t0).as_secs_f64();
        if secs < 0.5 {
            return;
        }
        let rate = done.saturating_sub(b0) as f64 / secs;
        self.smooth = if self.smooth == 0.0 { rate } else { self.smooth + SMOOTH * (rate - self.smooth) };
    }

    /// Seconds left for `remaining` network bytes, or None when saying a number would be a guess.
    pub(crate) fn eta(&self, now: Instant, remaining: u64) -> Option<u64> {
        if now.duration_since(self.born) < WARM_UP || self.seen < WARM_UP_BYTES || self.smooth < STALLED_BPS {
            return None;
        }
        // A stall that began a moment ago is not in the smoothed number yet: the newest three seconds decide.
        let &(t_last, b_last) = self.samples.back()?;
        if let Some(&(t_back, b_back)) = self.samples.iter().rev().find(|(t, _)| t_last.duration_since(*t) >= RECENT) {
            let span = t_last.duration_since(t_back).as_secs_f64();
            if (b_last.saturating_sub(b_back)) as f64 / span < STALLED_BPS {
                return None;
            }
        }
        let secs = remaining as f64 / self.smooth;
        if !secs.is_finite() || secs > GIVE_UP.as_secs_f64() {
            return None;
        }
        Some(secs.ceil() as u64)
    }
}

/// What the install bar is told: seconds are rounded so the number does not flicker on every chunk, and rounded
/// up, because "5 seconds left" shown for ten is worse than "10" shown for ten.
pub(crate) fn round_eta(secs: u64) -> u64 {
    match secs {
        0..=59 => secs.div_ceil(5) * 5,
        60..=599 => secs.div_ceil(10) * 10,
        600..=3599 => secs.div_ceil(60) * 60,
        _ => secs.div_ceil(300) * 300,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(t0: Instant, ms: u64) -> Instant {
        t0 + Duration::from_millis(ms)
    }

    /// speed over time -> ETA. The promise appears only after warm-up, follows the current line and goes away when
    /// the line stops.
    #[test]
    fn eta_waits_for_warm_up_follows_the_line_and_stays_silent_on_a_stall() {
        let t0 = Instant::now();
        let mut p = Pulse::new(t0);
        let mib = 1u64 << 20;
        for s in 1..=3 {
            p.push(at(t0, s * 1000), s * 4 * mib);
        }
        assert_eq!(p.eta(at(t0, 3000), 100 * mib), None, "три секунды — рано что-то обещать");
        for s in 4..=10 {
            p.push(at(t0, s * 1000), s * 4 * mib);
        }
        let eta = p.eta(at(t0, 10_000), 100 * mib).expect("после прогрева число есть");
        assert!((24..=26).contains(&eta), "100 МиБ при 4 МиБ/с — около 25 с, получили {eta}");

        let mut done = 40 * mib;
        for s in 11..=20 {
            p.push(at(t0, s * 1000), done);
            done += 0;
        }
        assert_eq!(p.eta(at(t0, 20_000), 60 * mib), None, "связь стоит — времени не называем");
    }

    #[test]
    fn a_slower_line_moves_the_number_up() {
        let t0 = Instant::now();
        let mut p = Pulse::new(t0);
        let mib = 1u64 << 20;
        let mut done = 0;
        for s in 1..=8 {
            done += 8 * mib;
            p.push(at(t0, s * 1000), done);
        }
        let fast = p.eta(at(t0, 8000), 100 * mib).unwrap();
        for s in 9..=30 {
            done += mib;
            p.push(at(t0, s * 1000), done);
        }
        let slow = p.eta(at(t0, 30_000), 100 * mib).unwrap();
        assert!(slow > fast * 3, "скорость упала в 8 раз: {fast} -> {slow}");
    }

    #[test]
    fn rounding_never_promises_less_than_the_estimate() {
        for secs in [1, 4, 5, 6, 59, 61, 95, 599, 601, 3599, 3601, 7300] {
            let r = round_eta(secs);
            assert!(r >= secs, "{secs} округлилось вниз до {r}");
            assert!(r - secs <= secs / 4 + 5, "{secs} округлилось слишком грубо до {r}");
        }
        assert_eq!(round_eta(23), 25);
        assert_eq!(round_eta(61), 70);
        assert_eq!(round_eta(601), 660);
    }
}
