// Timings of the Play button: how long each step of a launch took in the core, how many bytes it downloaded,
// and how long after the process start the game window showed up. Nothing leaves the machine unless usage
// statistics are on: the events go to api.millida.net/v2/launcher/telemetry as `perf` events (what=launch_stages,
// launch_bytes, game_window) with numbers and stage names only. No paths, build names or addresses.
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The steps of a launch in pipeline order. `net` is the time the launch sat waiting for its
/// network checks (they run next to the install, so only the wait counts); `pack` is the
/// preparation of a catalogue build that ships its own game files. Since the launch graph the
/// install stages run side by side and each is the wall time of its own steps, so they overlap;
/// `launch_graph.prep` is the wall time of them all together.
pub(crate) const STAGES: [&str; 10] =
    ["net", "pack", "java", "client", "libs", "natives", "loader", "assets", "mods", "spawn"];

#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub(crate) struct Stage {
    pub ms: u64,
    pub bytes: u64,
}

struct Inner {
    stages: BTreeMap<&'static str, Stage>,
    open: Option<&'static str>,
    since: Instant,
    bytes_since: u64,
    graph: Option<GraphFacts>,
}

/// What the Prepare graph of a launch came to (`launch_graph`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct GraphFacts {
    /// Plan: reading the build and its descriptions, ms.
    pub plan_ms: u64,
    /// Prepare: from the first step started to the last one done, ms.
    pub prep_ms: u64,
    /// The step that finished last: the one the launch waited for.
    pub crit: &'static str,
    pub nodes: u32,
    /// The plan the lobby prepared was still good: nothing was fetched or checked again.
    pub warm: bool,
    /// Mods the launch put in because others in the build require them.
    pub deps: u32,
    /// The account's session, ms (None when there was none to get).
    pub auth_ms: Option<u64>,
}

/// One launch's stopwatch. Cloning shares the same numbers.
#[derive(Clone)]
pub(crate) struct LaunchPerf {
    inner: Arc<Mutex<Inner>>,
    born: Instant,
    prep_ms: u64,
    /// Bytes the launch's own task downloaded; the steps of the launch graph count theirs apart
    /// (`add`), so a download running next to a stage is not charged to it.
    meter: Arc<AtomicU64>,
}

tokio::task_local! {
    static CURRENT: LaunchPerf;
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl LaunchPerf {
    /// `prep_ms`: what the window spent between the click and the call into the core.
    pub(crate) fn new(prep_ms: u64) -> Self {
        let now = Instant::now();
        LaunchPerf {
            inner: Arc::new(Mutex::new(Inner {
                stages: BTreeMap::new(),
                open: None,
                since: now,
                bytes_since: 0,
                graph: None,
            })),
            born: now,
            prep_ms,
            meter: Arc::new(AtomicU64::new(0)),
        }
    }

    fn bytes(&self) -> u64 {
        self.meter.load(Ordering::Relaxed)
    }

    /// Closes the stage that was running and opens `stage`; returns the one that was closed.
    /// A stage entered twice adds up.
    pub(crate) fn enter(&self, stage: &'static str) -> Option<&'static str> {
        let now = Instant::now();
        let bytes = self.bytes();
        let mut g = locked(&self.inner);
        close(&mut g, now, bytes);
        g.stages.entry(stage).or_default();
        g.open.replace(stage)
    }

    /// Closes the stage that was running without opening another: the launch now waits for the
    /// steps of its graph, which time themselves.
    pub(crate) fn pause(&self) {
        let now = Instant::now();
        let bytes = self.bytes();
        let mut g = locked(&self.inner);
        close(&mut g, now, bytes);
        g.open = None;
    }

    /// Time and bytes of one step of the launch graph. Steps run side by side, so the stages of a
    /// graph launch overlap: each is the wall time of its own steps, not a slice of the total.
    pub(crate) fn add(&self, stage: &'static str, took: Duration, bytes: u64) {
        let mut g = locked(&self.inner);
        let st = g.stages.entry(stage).or_default();
        st.ms += took.as_millis() as u64;
        st.bytes += bytes;
    }

    pub(crate) fn graph(&self, facts: GraphFacts) {
        locked(&self.inner).graph = Some(facts);
    }

    pub(crate) fn graph_facts(&self) -> Option<GraphFacts> {
        locked(&self.inner).graph.clone()
    }

    pub(crate) fn snapshot(&self) -> BTreeMap<&'static str, Stage> {
        let bytes = self.bytes();
        let mut g = locked(&self.inner);
        let open = g.open;
        close(&mut g, Instant::now(), bytes);
        g.open = open;
        g.stages.clone()
    }

    pub(crate) fn core_ms(&self) -> u64 {
        self.born.elapsed().as_millis() as u64
    }

    pub(crate) fn prep_ms(&self) -> u64 {
        self.prep_ms
    }
}

fn close(g: &mut Inner, now: Instant, bytes: u64) {
    if let Some(name) = g.open {
        let st = g.stages.entry(name).or_default();
        st.ms += now.saturating_duration_since(g.since).as_millis() as u64;
        st.bytes += bytes.saturating_sub(g.bytes_since);
    }
    g.since = now;
    g.bytes_since = bytes;
}

/// Runs `fut` with a stopwatch for this task and everything it awaits inline.
pub(crate) async fn scope<F: Future>(perf: LaunchPerf, fut: F) -> F::Output {
    let meter = perf.meter.clone();
    CURRENT.scope(perf, crate::engine::metered(meter, fut)).await
}

/// Marks the start of `stage` for the launch running in this task. Does nothing elsewhere
/// (a modpack install that reuses the same install code has no stopwatch).
pub(crate) fn enter(stage: &'static str) {
    let _ = CURRENT.try_with(|p| p.enter(stage));
}

/// Runs `fut` as `stage` and goes back to the stage that was running before it. For waits that
/// sit in the middle of another stage (a network check awaited during the install).
pub(crate) async fn detour<F: Future>(stage: &'static str, fut: F) -> F::Output {
    let before = CURRENT.try_with(|p| p.enter(stage)).ok().flatten();
    let out = fut.await;
    if let Some(prev) = before {
        enter(prev);
    }
    out
}

/// The `launch_stages` event. Only the stages the launch passed through are present, with zero
/// where the step had nothing to do. At most 12 data keys: the collector keeps no more.
pub(crate) fn stages_event(stages: &BTreeMap<&'static str, Stage>, ok: bool, total_ms: u64) -> Value {
    let mut data = Map::new();
    data.insert("what".into(), json!("launch_stages"));
    for name in STAGES {
        if let Some(st) = stages.get(name) {
            data.insert(name.into(), json!(st.ms));
        }
    }
    let kb: u64 = stages.values().map(|s| s.bytes).sum::<u64>() / 1024;
    data.insert("kb".into(), json!(kb));
    json!({ "data": Value::Object(data), "durationMs": total_ms, "ok": ok })
}

/// Bytes per stage, only when the launch downloaded something.
pub(crate) fn bytes_event(stages: &BTreeMap<&'static str, Stage>, total_ms: u64) -> Option<Value> {
    let total: u64 = stages.values().map(|s| s.bytes).sum();
    if total == 0 {
        return None;
    }
    let mut data = Map::new();
    data.insert("what".into(), json!("launch_bytes"));
    for name in STAGES {
        let bytes = stages.get(name).map(|s| s.bytes).unwrap_or(0);
        if bytes > 0 {
            data.insert(name.into(), json!(bytes / 1024));
        }
    }
    data.insert("totalKb".into(), json!(total / 1024));
    let kbps = (total * 1000 / 1024).checked_div(total_ms).unwrap_or(0);
    data.insert("kbps".into(), json!(kbps));
    Some(json!({ "data": Value::Object(data), "durationMs": total_ms }))
}

/// Sends what the launch measured. Statistics off: not even built.
pub(crate) fn report(app: &tauri::AppHandle, perf: &LaunchPerf, ok: bool) {
    if !crate::engine::game_telemetry_enabled() {
        return;
    }
    let stages = perf.snapshot();
    if stages.is_empty() {
        return;
    }
    let total = perf.core_ms();
    let mut events = vec![stages_event(&stages, ok, total)];
    events.extend(bytes_event(&stages, total));
    events.extend(perf.graph_facts().map(|g| graph_event(&g, ok)));
    crate::background::send_perf(app, events);
}

/// The `launch_graph` event: how the steps of the launch overlapped. Numbers and step names only.
pub(crate) fn graph_event(g: &GraphFacts, ok: bool) -> Value {
    let mut data = Map::new();
    data.insert("what".into(), json!("launch_graph"));
    data.insert("plan".into(), json!(g.plan_ms));
    data.insert("prep".into(), json!(g.prep_ms));
    data.insert("crit".into(), json!(g.crit));
    data.insert("nodes".into(), json!(g.nodes));
    data.insert("warm".into(), json!(u8::from(g.warm)));
    data.insert("deps".into(), json!(g.deps));
    if let Some(ms) = g.auth_ms {
        data.insert("auth".into(), json!(ms));
    }
    json!({ "data": Value::Object(data), "durationMs": g.plan_ms + g.prep_ms, "ok": ok })
}

/// Lines the game prints right as its window is made: the first sign of a window on systems
/// where the process cannot be asked (macOS, Linux), and a second opinion on Windows.
pub(crate) fn window_log_marker(line: &str) -> bool {
    let low = line.to_ascii_lowercase();
    low.contains("backend library: lwjgl") || low.contains("lwjgl version:")
}

/// Filled by the log readers when the game says it made its window.
#[derive(Default)]
pub(crate) struct WindowProbe {
    log_ms: AtomicU64,
    born: Option<Instant>,
}

impl WindowProbe {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(WindowProbe { log_ms: AtomicU64::new(0), born: Some(Instant::now()) })
    }

    /// Looks at one line of the game's output; the first match is remembered.
    pub(crate) fn feed(&self, line: &str) {
        if self.log_ms.load(Ordering::Relaxed) != 0 || !window_log_marker(line) {
            return;
        }
        let ms = self.born.map(|b| b.elapsed().as_millis() as u64).unwrap_or(1).max(1);
        let _ = self.log_ms.compare_exchange(0, ms, Ordering::Relaxed, Ordering::Relaxed);
    }

    pub(crate) fn log_ms(&self) -> Option<u64> {
        match self.log_ms.load(Ordering::Relaxed) {
            0 => None,
            ms => Some(ms),
        }
    }
}

/// How the window time was learned: asking the system for the process's windows, or reading
/// the game's log. `exit` means the game ended before any window.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Via {
    Window,
    Log,
    Exit,
}

impl Via {
    fn as_str(self) -> &'static str {
        match self {
            Via::Window => "win",
            Via::Log => "log",
            Via::Exit => "exit",
        }
    }
}

/// The first signal wins; the system's own window beats the log when both are there at once.
pub(crate) fn pick_window(os_ms: Option<u64>, log_ms: Option<u64>) -> Option<(u64, Via)> {
    match (os_ms, log_ms) {
        (Some(w), _) => Some((w, Via::Window)),
        (None, Some(l)) => Some((l, Via::Log)),
        (None, None) => None,
    }
}

pub(crate) fn window_event(prep_ms: u64, core_ms: u64, after_spawn_ms: u64, via: Via) -> Value {
    let total = prep_ms + core_ms + after_spawn_ms;
    json!({
        "data": {
            "what": "game_window",
            "prep": prep_ms,
            "core": core_ms,
            "win": after_spawn_ms,
            "total": total,
            "via": via.as_str(),
        },
        "durationMs": total,
        "ok": via != Via::Exit,
    })
}

const WINDOW_POLL: Duration = Duration::from_millis(250);
const WINDOW_GIVE_UP: Duration = Duration::from_secs(180);

fn still_running(pid: u32) -> bool {
    super::launch::RUNNING.lock().map(|v| v.iter().any(|(_, id)| *id == pid)).unwrap_or(false)
}

/// After the game process starts: waits for its window and reports how long that took. Gives up
/// after three minutes. Statistics off: the wait is not even started.
pub(crate) fn watch_window(app: tauri::AppHandle, pid: u32, probe: Arc<WindowProbe>, perf: &LaunchPerf) {
    if !crate::engine::game_telemetry_enabled() {
        return;
    }
    let (prep, core) = (perf.prep_ms(), perf.core_ms());
    tauri::async_runtime::spawn(async move {
        let t0 = Instant::now();
        loop {
            tokio::time::sleep(WINDOW_POLL).await;
            let os_ms = super::gamewin::has_window(pid).then(|| t0.elapsed().as_millis() as u64);
            if let Some((ms, via)) = pick_window(os_ms, probe.log_ms()) {
                crate::background::send_perf(&app, vec![window_event(prep, core, ms, via)]);
                return;
            }
            if !still_running(pid) {
                let ms = t0.elapsed().as_millis() as u64;
                crate::background::send_perf(&app, vec![window_event(prep, core, ms, Via::Exit)]);
                return;
            }
            if t0.elapsed() > WINDOW_GIVE_UP {
                return;
            }
        }
    });
}

/// Time between the click and the call into the core, handed over by the window: it measures the
/// checks it runs first. Kept per build and taken once by the launch that follows.
static PREP: Mutex<Vec<(String, u64)>> = Mutex::new(Vec::new());

pub fn note_launch_prep(profile: &str, ms: Option<u64>) {
    let mut v = locked(&PREP);
    v.retain(|(p, _)| p != profile);
    if let Some(ms) = ms {
        v.push((profile.to_string(), ms.min(10 * 60 * 1000)));
    }
}

pub(crate) fn take_launch_prep(profile: &str) -> u64 {
    let mut v = locked(&PREP);
    match v.iter().position(|(p, _)| p == profile) {
        Some(i) => v.remove(i).1,
        None => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(ms: u64, bytes: u64) -> Stage {
        Stage { ms, bytes }
    }

    #[test]
    fn a_stage_entered_twice_adds_up_and_the_open_one_is_counted_on_a_snapshot() {
        let perf = LaunchPerf::new(0);
        perf.enter("java");
        std::thread::sleep(Duration::from_millis(25));
        perf.enter("libs");
        std::thread::sleep(Duration::from_millis(25));
        perf.enter("java");
        std::thread::sleep(Duration::from_millis(25));
        let snap = perf.snapshot();
        assert!(snap["java"].ms >= 40, "two visits to java are summed: {:?}", snap["java"]);
        assert!(snap["libs"].ms >= 20, "{:?}", snap["libs"]);
        let again = perf.snapshot();
        assert!(again["java"].ms >= snap["java"].ms, "a snapshot does not reset the stopwatch");
    }

    #[test]
    fn a_launch_that_failed_mid_stage_still_charges_that_stage() {
        let perf = LaunchPerf::new(0);
        perf.enter("assets");
        std::thread::sleep(Duration::from_millis(20));
        let snap = perf.snapshot();
        assert!(snap["assets"].ms >= 15, "the stage that was running when the launch ended gets its time");
    }

    #[test]
    fn stages_event_lists_only_visited_stages_and_stays_within_twelve_keys() {
        let mut all = BTreeMap::new();
        for name in STAGES {
            all.insert(name, st(7, 2048));
        }
        let ev = stages_event(&all, true, 1234);
        let data = ev["data"].as_object().unwrap();
        assert_eq!(data["what"], "launch_stages");
        assert!(data.len() <= 12, "the collector keeps 12 keys, got {}", data.len());
        assert_eq!(ev["durationMs"], 1234);
        assert_eq!(ev["ok"], true);

        let mut warm = BTreeMap::new();
        warm.insert("java", st(0, 0));
        warm.insert("spawn", st(310, 0));
        let ev = stages_event(&warm, false, 900);
        let data = ev["data"].as_object().unwrap();
        assert_eq!(data["java"], 0, "a visited step with nothing to do is a zero, not a gap");
        assert_eq!(data["spawn"], 310);
        assert!(!data.contains_key("libs"), "a step the launch never reached is absent");
        assert_eq!(ev["ok"], false);
    }

    #[test]
    fn bytes_event_exists_only_when_something_was_downloaded() {
        let mut none = BTreeMap::new();
        none.insert("libs", st(5, 0));
        assert!(bytes_event(&none, 1000).is_none());

        let mut some = BTreeMap::new();
        some.insert("libs", st(500, 10 * 1024 * 1024));
        some.insert("assets", st(500, 30 * 1024 * 1024));
        let ev = bytes_event(&some, 2000).expect("downloads are reported");
        let d = &ev["data"];
        assert_eq!(d["libs"], 10 * 1024);
        assert_eq!(d["assets"], 30 * 1024);
        assert_eq!(d["totalKb"], 40 * 1024);
        assert_eq!(d["kbps"], 20 * 1024, "40 MiB over 2 s is 20 MiB/s");
        assert!(d.as_object().unwrap().len() <= 12);
    }

    #[test]
    fn the_window_comes_from_the_system_first_then_the_log() {
        assert_eq!(pick_window(Some(900), Some(700)), Some((900, Via::Window)));
        assert_eq!(pick_window(None, Some(700)), Some((700, Via::Log)));
        assert_eq!(pick_window(None, None), None);
    }

    #[test]
    fn the_log_marks_the_window_once() {
        let probe = WindowProbe::new();
        assert_eq!(probe.log_ms(), None);
        probe.feed("[10:00:01] [main/INFO]: Loading Minecraft 1.20.1");
        assert_eq!(probe.log_ms(), None, "loading is not a window");
        probe.feed("[10:00:05] [Render thread/INFO]: Backend library: LWJGL version 3.3.1 build 7");
        let first = probe.log_ms().expect("the backend line marks the window");
        std::thread::sleep(Duration::from_millis(10));
        probe.feed("[10:00:06] [Client thread/INFO]: LWJGL Version: 2.9.4");
        assert_eq!(probe.log_ms(), Some(first), "the first mark stands");
    }

    #[test]
    fn the_window_event_adds_the_three_legs_up() {
        let ev = window_event(400, 1800, 2500, Via::Window);
        assert_eq!(ev["data"]["total"], 4700);
        assert_eq!(ev["data"]["via"], "win");
        assert_eq!(ev["ok"], true);
        let gone = window_event(0, 100, 900, Via::Exit);
        assert_eq!(gone["data"]["via"], "exit");
        assert_eq!(gone["ok"], false, "a game that ended before any window is a failed launch");
    }

    #[test]
    fn prep_is_handed_over_once_per_build() {
        note_launch_prep("perf-test-a", Some(420));
        note_launch_prep("perf-test-b", Some(5));
        assert_eq!(take_launch_prep("perf-test-a"), 420);
        assert_eq!(take_launch_prep("perf-test-a"), 0, "taken once");
        assert_eq!(take_launch_prep("perf-test-b"), 5);
        note_launch_prep("perf-test-a", Some(10 * 3600 * 1000));
        assert_eq!(take_launch_prep("perf-test-a"), 600_000, "a clock gone wild does not poison the numbers");
    }

    #[tokio::test]
    async fn a_detour_is_its_own_stage_and_hands_the_clock_back() {
        let perf = LaunchPerf::new(0);
        scope(perf.clone(), async {
            enter("libs");
            tokio::time::sleep(Duration::from_millis(20)).await;
            detour("net", tokio::time::sleep(Duration::from_millis(40))).await;
            tokio::time::sleep(Duration::from_millis(20)).await;
            enter("spawn");
        })
        .await;
        let snap = perf.snapshot();
        assert!(snap["net"].ms >= 35, "the wait is charged to net: {:?}", snap["net"]);
        assert!(snap["libs"].ms >= 35, "both halves of libs are counted, the wait is not: {:?}", snap["libs"]);
        assert!(snap["libs"].ms < 38 + 30, "{:?}", snap["libs"]);
    }

    #[tokio::test]
    async fn free_functions_work_only_inside_a_scope() {
        enter("java");
        let perf = LaunchPerf::new(0);
        scope(perf.clone(), async {
            enter("libs");
            tokio::time::sleep(Duration::from_millis(20)).await;
            enter("assets");
        })
        .await;
        let snap = perf.snapshot();
        assert!(snap["libs"].ms >= 15);
        assert!(snap.contains_key("assets"));
    }
}
