// One progress bar for a launch whose steps run side by side. Each node of the Prepare graph keeps
// reporting the numbers it always did (libraries 15-45 %, assets 55-86 %, Java 0-60 % of its own
// scale); here those become the node's own share done, and the bar shows the node that is
// furthest behind — the one the launch is waiting for — with its message. The bar never moves back.
use std::future::Future;
use std::sync::{Arc, Mutex};

/// Where the bar goes: (stage, percent, message).
pub(crate) type Sink = Arc<dyn Fn(&str, f32, &str) + Send + Sync>;

struct LaneState {
    from: f32,
    to: f32,
    share: f32,
    done: bool,
    stage: String,
    msg: String,
    /// When it last spoke, to break a tie between two lanes equally far behind.
    said_at: u64,
}

#[derive(Default)]
struct State {
    lanes: Vec<LaneState>,
    shown: f32,
    shown_msg: String,
    shown_stage: String,
    clock: u64,
}

pub(crate) struct Board {
    sink: Sink,
    out_from: f32,
    out_to: f32,
    state: Mutex<State>,
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Board {
    /// The bar runs from `out_from` to `out_to` percent while the graph works.
    pub(crate) fn new(sink: Sink, out_from: f32, out_to: f32) -> Arc<Board> {
        Arc::new(Board { sink, out_from, out_to, state: Mutex::new(State { shown: out_from, ..State::default() }) })
    }

    /// A lane for work that used to report from `range.0` to `range.1` percent.
    pub(crate) fn lane(self: &Arc<Self>, range: (f32, f32)) -> Lane {
        let mut st = locked(&self.state);
        st.lanes.push(LaneState { from: range.0, to: range.1, share: 0.0, done: false, stage: String::new(), msg: String::new(), said_at: 0 });
        Lane { board: self.clone(), idx: st.lanes.len() - 1 }
    }

    fn said(&self, idx: usize, stage: &str, pct: f32, msg: &str) {
        let mut st = locked(&self.state);
        st.clock += 1;
        let clock = st.clock;
        if let Some(l) = st.lanes.get_mut(idx) {
            let span = (l.to - l.from).max(f32::EPSILON);
            l.share = l.share.max(((pct - l.from) / span).clamp(0.0, 1.0));
            l.stage = stage.to_string();
            if !msg.is_empty() {
                l.msg = msg.to_string();
            }
            l.said_at = clock;
        }
        self.show(&mut st);
    }

    fn finished(&self, idx: usize) {
        let mut st = locked(&self.state);
        if let Some(l) = st.lanes.get_mut(idx) {
            l.done = true;
            l.share = 1.0;
        }
        self.show(&mut st);
    }

    fn show(&self, st: &mut State) {
        let behind = st
            .lanes
            .iter()
            .filter(|l| !l.done)
            .min_by(|a, b| a.share.partial_cmp(&b.share).unwrap_or(std::cmp::Ordering::Equal).then(b.said_at.cmp(&a.said_at)));
        let share = behind.map(|l| l.share).unwrap_or(1.0);
        let pct = (self.out_from + (self.out_to - self.out_from) * share).max(st.shown);
        // The lane we wait for may not have said anything yet (a Java check): the latest words of
        // any lane stand in for it.
        let latest = st.lanes.iter().filter(|l| !l.msg.is_empty()).max_by_key(|l| l.said_at);
        let (stage, msg) = match (behind, latest) {
            (Some(l), _) if !l.msg.is_empty() => (l.stage.clone(), l.msg.clone()),
            (_, Some(l)) => (l.stage.clone(), l.msg.clone()),
            _ => (st.shown_stage.clone(), st.shown_msg.clone()),
        };
        if (pct - st.shown).abs() < 0.25 && msg == st.shown_msg {
            return;
        }
        st.shown = pct;
        st.shown_msg = msg.clone();
        st.shown_stage = stage.clone();
        if !msg.is_empty() {
            (self.sink)(if stage.is_empty() { "files" } else { &stage }, pct, &msg);
        }
    }

    /// How many lanes are still at work.
    #[cfg(test)]
    fn open(&self) -> usize {
        locked(&self.state).lanes.iter().filter(|l| !l.done).count()
    }
}

/// One node's share of the bar. Progress messages sent while its future runs land here.
#[derive(Clone)]
pub(crate) struct Lane {
    board: Arc<Board>,
    idx: usize,
}

tokio::task_local! {
    static LANE: Lane;
}

impl Lane {
    pub(crate) async fn run<F: Future>(self, fut: F) -> F::Output {
        LANE.scope(self, fut).await
    }

    pub(crate) fn finish(&self) {
        self.board.finished(self.idx);
    }
}

/// Takes a progress message of the work running in a lane. False outside a lane: the message goes
/// to the window as it is.
pub(crate) fn lane_emit(stage: &str, pct: f32, msg: &str) -> bool {
    LANE.try_with(|l| l.board.said(l.idx, stage, pct, msg)).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    type Seen = Arc<Mutex<Vec<(String, f32, String)>>>;

    fn recorder() -> (Sink, Seen) {
        let seen: Seen = Arc::default();
        let s = seen.clone();
        (Arc::new(move |stage: &str, pct: f32, msg: &str| locked(&s).push((stage.to_string(), pct, msg.to_string()))), seen)
    }

    #[test]
    fn the_bar_follows_the_slowest_lane_and_never_goes_back() {
        let (sink, seen) = recorder();
        let board = Board::new(sink, 12.0, 90.0);
        let libs = board.lane((15.0, 45.0));
        let assets = board.lane((55.0, 86.0));
        board.said(libs.idx, "files", 45.0, "Библиотеки…");
        assert_eq!(locked(&seen).last().map(|s| s.2.clone()), Some("Библиотеки…".into()), "assets have not spoken yet");
        board.said(assets.idx, "assets", 55.0 + 31.0 * 0.5, "Ассеты 2500/5147");
        libs.finish();
        let last = locked(&seen).last().cloned().unwrap();
        assert_eq!(last.2, "Ассеты 2500/5147", "with the libraries done the bar waits for the assets");
        assert!((last.1 - (12.0 + 78.0 * 0.5)).abs() < 0.6, "half of the assets is half the bar: {last:?}");
        // A lane that starts late below the shown share does not pull the bar back.
        let java = board.lane((0.0, 60.0));
        board.said(java.idx, "java", 6.0, "Скачиваем Java 21… 10%");
        let pcts: Vec<f32> = locked(&seen).iter().map(|s| s.1).collect();
        assert!(pcts.windows(2).all(|w| w[1] >= w[0]), "monotonic: {pcts:?}");
        assert_eq!(locked(&seen).last().map(|s| s.0.clone()), Some("java".into()), "the step shown is the one waited for");
        assets.finish();
        java.finish();
        assert_eq!(board.open(), 0);
        assert!(locked(&seen).last().is_some_and(|s| (s.1 - 90.0).abs() < 0.01), "all done is the end of the range");
    }

    #[tokio::test]
    async fn messages_inside_a_lane_do_not_reach_the_window_directly() {
        let (sink, seen) = recorder();
        let board = Board::new(sink, 12.0, 90.0);
        let lane = board.lane((15.0, 45.0));
        let inside = lane.clone().run(async { lane_emit("files", 30.0, "Библиотеки…") }).await;
        assert!(inside, "taken by the lane");
        assert!(!lane_emit("files", 30.0, "x"), "outside a lane the caller sends it itself");
        assert_eq!(locked(&seen).len(), 1);
    }
}
