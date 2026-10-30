// Light background: when nobody looks at the launcher (tray, running game) the main window
// and its WebView2 are destroyed, and the tray click builds them again. While there is no
// window only this core works: the in-game presence beat, one process-memory sample every
// 30 minutes (only when usage statistics are on), an update check every 6 hours and, when a
// release is found and no game runs, its download to the updates folder (checked by signature,
// installed when the player quits from the tray). The network calls go through the same API
// client as the window's.
//! Лёгкий фон лаунчера (решение владельца 26.10.2026).
//!
//! По крестику (если включено «в трей») и при запуске игры окно `main` не прячется, а
//! уничтожается: вместе с ним завершается всё дерево `msedgewebview2.exe`, в диспетчере
//! остаётся один `millida-launcher.exe`. Клик по значку в трее собирает окно заново из той
//! же конфигурации (`tauri.conf.json`), и страница открывается на том экране, где её
//! оставили: экран хранится здесь, в ядре, а не в странице, которой больше нет.
//!
//! Окно не уничтожается, пока ядро что-то ставит (задачи `jobs`) или страница держит то,
//! что живёт только в ней (звонок, установка, которую ведёт интерфейс): тогда оно
//! прячется, WebView2 усыпляется (`TrySuspend`), в трее пишется «Скачивается…», и
//! выгрузка случается сама, когда работа кончится.
//!
//! Что без окна делает ядро:
//! - события, нужные странице, складываются в очередь и отдаются новой странице после
//!   `frontend_ready`: `game-exit` / `game-crash` (телеметрия выхода, экран «Починить»),
//!   `game-perf` (кадры для «Почему лагало», с отметкой времени), `game-server` (куда зашёл
//!   игрок), `session-kicked`, `pack-access-lost`. У каждого своё ограничение размера
//!   (`RULES`), лишнее отбрасывается. Вылет игры и потеря доступа к платной сборке сами
//!   открывают окно, «сервер не принял вход» — системное уведомление;
//! - пока идёт игра — тот же удар присутствия, что слала страница (раз в 50 с, сервер
//!   держит игрока в сети 60 с): друзья видят «в игре», игровые часы засчитываются.
//!   В трее без игры ударов нет;
//! - замер памяти: собственный процесс и процессы WebView2 — при выгрузке, через 20 с
//!   после неё, раз в 30 минут и после открытия окна. Только при включённой статистике;
//! - проверка обновления раз в 6 часов, системное уведомление о новой версии и, пока игра не
//!   идёт, загрузка её на диск (подпись проверяется): скачанное не пропадает с окном, а «Выход»
//!   из трея ставит его.
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const MAIN: &str = "main";

/// The server keeps a friend online for 60 s after the last beat.
const BEAT_EVERY: Duration = Duration::from_secs(50);
const SAMPLE_EVERY: Duration = Duration::from_secs(30 * 60);
/// WebView2 processes take a moment to exit after the window is gone.
const SAMPLE_AFTER_UNLOAD: Duration = Duration::from_secs(20);
const SAMPLE_AFTER_OPEN: Duration = Duration::from_secs(15);
const UPDATE_FIRST: Duration = Duration::from_secs(10 * 60);
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);
/// Local only: how often a parked window looks whether the core's installs are done.
const JOBS_POLL: Duration = Duration::from_secs(5);
/// The page gets its listeners up a moment after it reports ready.
const REPLAY_DELAY: Duration = Duration::from_millis(2500);
/// Replayed events go out in small portions: a fresh page should not choke on an hour of frame reports.
const REPLAY_CHUNK: usize = 30;
const REPLAY_PAUSE: Duration = Duration::from_millis(20);
const MAX_LINKS: usize = 8;
const MAX_SCREEN: usize = 64;
const MAX_BEAT_BYTES: usize = 4096;
const BEAT_PATHS: &[&str] = &["/friends/presence/heartbeat", "/launcher/heartbeat"];

static UNLOADED: AtomicBool = AtomicBool::new(false);
static PARKED: AtomicBool = AtomicBool::new(false);
/// Parked with the page put to sleep (`TrySuspend`): it cannot answer anything, not even a tray «Выход».
static ASLEEP: AtomicBool = AtomicBool::new(false);
static REOPENING: AtomicBool = AtomicBool::new(false);
/// 1 for the window the app started with, +1 for each rebuilt one.
static GENERATION: AtomicU32 = AtomicU32::new(1);
/// A newer unload or a reopened window ends the previous background loop.
static EPOCH: AtomicU64 = AtomicU64::new(0);
static STARTED: Mutex<Option<Instant>> = Mutex::new(None);

struct Resume {
    screen: Option<String>,
    links: Vec<String>,
}

static RESUME: Mutex<Resume> = Mutex::new(Resume { screen: None, links: Vec::new() });
static QUEUE: Mutex<Queue> = Mutex::new(Queue::new());
/// The page of a rebuilt window listens only after it reported ready and got what was queued.
/// The window the app started with is always considered listening, as before.
static PAGE_UP: AtomicBool = AtomicBool::new(true);
static BEAT: Mutex<Option<(String, serde_json::Value)>> = Mutex::new(None);
static NOTIFIED_UPDATE: Mutex<Option<String>> = Mutex::new(None);

/// A result nobody can act on is still written to the log with its reason, never dropped silently.
/// True when it was a failure.
fn log_failure<T, E: std::fmt::Display>(what: &str, result: Result<T, E>) -> bool {
    match result {
        Ok(_) => false,
        Err(e) => {
            eprintln!("[background] {what}: {e}");
            true
        }
    }
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// The main window was destroyed on purpose and the app keeps running in the tray.
pub fn unloaded() -> bool {
    UNLOADED.load(Ordering::SeqCst)
}

/// Hidden, waiting for work that lives in it to finish before it is unloaded.
pub fn parked() -> bool {
    PARKED.load(Ordering::SeqCst)
}

/// Hidden and put to sleep while the core finishes its installs: there is a window, but nobody in it to answer.
pub fn page_asleep() -> bool {
    PARKED.load(Ordering::SeqCst) && ASLEEP.load(Ordering::SeqCst)
}

/// This page is a rebuilt window, not the one the app started with.
pub fn reopened() -> bool {
    GENERATION.load(Ordering::SeqCst) > 1
}

pub fn mark_started() {
    let mut s = lock(&STARTED);
    if s.is_none() {
        *s = Some(Instant::now());
    }
}

fn up_minutes() -> u64 {
    let started = *lock(&STARTED);
    started.map(|s| s.elapsed().as_secs() / 60).unwrap_or(0)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Tray,
    Game,
    Autostart,
}

impl Reason {
    fn as_str(self) -> &'static str {
        match self {
            Reason::Tray => "tray",
            Reason::Game => "game",
            Reason::Autostart => "autostart",
        }
    }

    pub fn parse(s: &str) -> Reason {
        match s {
            "game" => Reason::Game,
            "autostart" => Reason::Autostart,
            _ => Reason::Tray,
        }
    }
}

/// What holds the window: work that lives only in the page.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    Install,
    Call,
    /// «Играть» is pressed and the page has not handed the launch to the core yet (sign-in, pack
    /// refresh, graphics preset). Closing the window now would cancel the launch.
    Launch,
}

impl Hold {
    pub fn parse(s: Option<&str>) -> Option<Hold> {
        match s? {
            "install" => Some(Hold::Install),
            "call" => Some(Hold::Call),
            "launch" => Some(Hold::Launch),
            _ => None,
        }
    }
}

/// Who keeps the window alive. The difference decides how the window waits:
/// - `Page`: work that lives only in the page (an install it drives, a call). The page must keep
///   running, so WebView2 is not put to sleep, and the core does not look at its own jobs: the page
///   calls unload again when its work is over. Cutting in on the page's own steps (a next mod
///   after the core finished the previous one) tore down half-installed builds.
/// - `Core`: installs the core runs itself. They finish without the page, so it may sleep, and the
///   core unloads the window when the last job is done.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Keeper {
    Page(Hold),
    Core,
}

impl Keeper {
    fn sleeps_page(self) -> bool {
        self == Keeper::Core
    }

    fn polls_core_jobs(self) -> bool {
        self == Keeper::Core
    }

    fn status(self) -> Option<&'static str> {
        match self {
            Keeper::Core | Keeper::Page(Hold::Install) => Some("Скачивается… окно закроется само"),
            Keeper::Page(Hold::Call) => Some("Идёт звонок"),
            Keeper::Page(Hold::Launch) => None,
        }
    }
}

/// None: unload now. Some: park the window instead. The page's own work wins over the core's jobs.
fn keeper_for(page: Option<Hold>, core_jobs: usize) -> Option<Keeper> {
    page.map(Keeper::Page).or((core_jobs > 0).then_some(Keeper::Core))
}

/// One look of a parked window at the core's jobs.
#[derive(Debug, PartialEq, Eq)]
enum Poll {
    /// A newer unload or reopened window took over, or the app is leaving.
    Stop,
    /// The player opened the window again: nothing to unload.
    Back,
    Wait,
    Unload,
}

fn poll_step(current_epoch: bool, parked: bool, exiting: bool, visible: bool, jobs_left: usize) -> Poll {
    if !current_epoch || !parked || exiting {
        Poll::Stop
    } else if visible {
        Poll::Back
    } else if jobs_left == 0 {
        Poll::Unload
    } else {
        Poll::Wait
    }
}

fn clean_screen(screen: Option<String>) -> Option<String> {
    let s = screen?.trim().to_string();
    let ok = !s.is_empty()
        && s.len() <= MAX_SCREEN
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'/');
    ok.then_some(s)
}

/// Destroys the main window (or parks it while something still lives in it).
/// Returns "unloaded", "held" or "skipped" (for logs and tests of the callers).
pub fn unload(app: &AppHandle, reason: Reason, page_hold: Option<Hold>, screen: Option<String>) -> &'static str {
    if crate::exiting() {
        return "skipped";
    }
    let Some(window) = app.get_webview_window(MAIN) else { return "skipped" };
    if let Some(s) = clean_screen(screen) {
        lock(&RESUME).screen = Some(s);
    }
    if let Some(keeper) = keeper_for(page_hold, crate::engine::active_jobs().len()) {
        park(app, &window, keeper);
        return "held";
    }
    // The «before» number: the whole tree right before it goes away.
    if crate::engine::game_telemetry_enabled() {
        send_sample(app, "lobby", reason.as_str(), Some(proc_stats()));
    }
    PARKED.store(false, Ordering::SeqCst);
    ASLEEP.store(false, Ordering::SeqCst);
    UNLOADED.store(true, Ordering::SeqCst);
    crate::tray::set_status(None);
    let _ = app.emit("window-visibility", false);
    if window.destroy().is_err() {
        UNLOADED.store(false, Ordering::SeqCst);
        crate::tray::hide_main(app);
        return "skipped";
    }
    crate::overlay::main_unloaded(app);
    run_background(app.clone(), reason);
    "unloaded"
}

fn park(app: &AppHandle, window: &tauri::WebviewWindow, keeper: Keeper) {
    PARKED.store(true, Ordering::SeqCst);
    ASLEEP.store(keeper.sleeps_page(), Ordering::SeqCst);
    crate::tray::hide_main(app);
    if keeper.sleeps_page() {
        crate::webview_health::set_suspended(window, true);
    }
    crate::tray::set_status(keeper.status());
    if !keeper.polls_core_jobs() {
        return;
    }
    // Installs the core runs finish without the page; the page's own ones call
    // unload again when they are done.
    let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(JOBS_POLL).await;
            let step = poll_step(
                EPOCH.load(Ordering::SeqCst) == epoch,
                parked(),
                crate::exiting(),
                crate::tray::main_visible(&app),
                crate::engine::active_jobs().len(),
            );
            match step {
                Poll::Stop => return,
                Poll::Back => {
                    PARKED.store(false, Ordering::SeqCst);
                    ASLEEP.store(false, Ordering::SeqCst);
                    crate::tray::set_status(None);
                    return;
                }
                Poll::Wait => {}
                Poll::Unload => {
                    let h = app.clone();
                    let queued = app.run_on_main_thread(move || {
                        if parked() && !crate::tray::main_visible(&h) {
                            unload(&h, Reason::Tray, None, None);
                        }
                    });
                    log_failure("the parked window was not unloaded", queued);
                    return;
                }
            }
        }
    });
}

/// The parked window came back on screen.
pub fn unpark(app: &AppHandle) {
    if PARKED.swap(false, Ordering::SeqCst) {
        ASLEEP.store(false, Ordering::SeqCst);
        crate::tray::set_status(None);
        if let Some(w) = app.get_webview_window(MAIN) {
            crate::webview_health::set_suspended(&w, false);
        }
    }
}

/// Builds the main window again from its configuration. Runs off the main
/// thread: building a window synchronously from an event handler deadlocks on
/// Windows (tauri#4121).
pub fn reopen(app: &AppHandle) {
    if crate::exiting() || app.get_webview_window(MAIN).is_some() {
        return;
    }
    if REOPENING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let built = build_main(&app);
        REOPENING.store(false, Ordering::SeqCst);
        if built {
            crate::tray::show_main(&app);
        }
    });
}

fn build_main(app: &AppHandle) -> bool {
    if crate::exiting() {
        return false;
    }
    let Some(config) = app.config().app.windows.iter().find(|w| w.label == MAIN).cloned() else { return false };
    let window = match tauri::WebviewWindowBuilder::from_config(app, &config).and_then(|b| b.build()) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("[background] main window was not rebuilt: {e}");
            return false;
        }
    };
    GENERATION.fetch_add(1, Ordering::SeqCst);
    EPOCH.fetch_add(1, Ordering::SeqCst);
    // Set before the window counts as alive: events wait for the page's frontend_ready.
    PAGE_UP.store(false, Ordering::SeqCst);
    crate::cli::page_reset();
    UNLOADED.store(false, Ordering::SeqCst);
    crate::attach_main(app, &window);
    let h = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAMPLE_AFTER_OPEN).await;
        if !unloaded() {
            sample(&h, "open", "open");
        }
    });
    true
}

/// How the core keeps one kind of event for a page that is not there. Every kind has its own
/// room, so a long session's frame reports cannot push out the game's exit.
struct Rule {
    event: &'static str,
    /// How many are kept at most.
    cap: usize,
    /// When full: drop the oldest (true: the newest facts matter) or refuse the new one.
    keep_newest: bool,
    /// What a repeat of the same payload means for the queue.
    repeat: Repeat,
    /// Add `at` (ms since epoch) to an object payload: the page judges old reports by their own time.
    stamp: bool,
    /// Older entries are not worth showing; 0 keeps them.
    max_age_ms: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Repeat {
    /// Every one counts.
    Keep,
    /// Same as the last queued one: skipped (the player only walked into the same server again).
    SkipLast,
    /// Same as any queued one: skipped (one question per refused server).
    SkipAny,
}

const HOUR_MS: u64 = 60 * 60 * 1000;

const RULES: &[Rule] = &[
    Rule { event: "game-exit", cap: 16, keep_newest: false, repeat: Repeat::Keep, stamp: false, max_age_ms: 0 },
    Rule { event: "game-crash", cap: 16, keep_newest: false, repeat: Repeat::Keep, stamp: false, max_age_ms: 0 },
    Rule { event: "overlay-open", cap: 16, keep_newest: false, repeat: Repeat::Keep, stamp: false, max_age_ms: 0 },
    Rule { event: "pack-access-lost", cap: 8, keep_newest: false, repeat: Repeat::Keep, stamp: false, max_age_ms: 0 },
    Rule { event: "session-kicked", cap: 8, keep_newest: true, repeat: Repeat::SkipAny, stamp: false, max_age_ms: 0 },
    Rule { event: "game-server", cap: 16, keep_newest: true, repeat: Repeat::SkipLast, stamp: false, max_age_ms: 12 * HOUR_MS },
    // The mod reports every 5 s: an hour of play is 720 reports.
    Rule { event: "game-perf", cap: 720, keep_newest: true, repeat: Repeat::Keep, stamp: true, max_age_ms: 6 * HOUR_MS },
];

fn rule_for(event: &str) -> Option<&'static Rule> {
    RULES.iter().find(|r| r.event == event)
}

#[derive(Clone, Debug, PartialEq)]
struct Queued {
    event: String,
    payload: serde_json::Value,
    at: u64,
}

#[derive(Debug, Default)]
struct Queue {
    items: Vec<Queued>,
}

impl Queue {
    const fn new() -> Queue {
        Queue { items: Vec::new() }
    }

    /// True when the event was kept; false when the rules have no room or no use for it.
    fn push(&mut self, event: &str, mut payload: serde_json::Value, at: u64) -> bool {
        let Some(rule) = rule_for(event) else { return false };
        let same = |q: &Queued| q.event == event && q.payload == payload;
        match rule.repeat {
            Repeat::Keep => {}
            Repeat::SkipLast => {
                if self.items.iter().rev().find(|q| q.event == event).is_some_and(same) {
                    return false;
                }
            }
            Repeat::SkipAny => {
                if self.items.iter().any(same) {
                    return false;
                }
            }
        }
        if self.items.iter().filter(|q| q.event == event).count() >= rule.cap {
            if !rule.keep_newest {
                return false;
            }
            if let Some(oldest) = self.items.iter().position(|q| q.event == event) {
                self.items.remove(oldest);
            }
        }
        if rule.stamp {
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("at".into(), serde_json::json!(at));
            }
        }
        self.items.push(Queued { event: event.to_string(), payload, at });
        true
    }

    /// Everything still worth showing, in the order it happened.
    fn take(&mut self, now: u64) -> Vec<Queued> {
        let mut items = std::mem::take(&mut self.items);
        items.retain(|q| match rule_for(&q.event) {
            Some(r) => r.max_age_ms == 0 || now.saturating_sub(q.at) <= r.max_age_ms,
            None => false,
        });
        items
    }
}

/// The page can hear an event right now. The window is there, and a rebuilt one got its queue.
fn page_listens(app: &AppHandle) -> bool {
    !unloaded() && PAGE_UP.load(Ordering::SeqCst) && app.get_webview_window(MAIN).is_some()
}

/// Emits to the main window, or keeps the events the next page must hear (`RULES`) and does
/// what cannot wait for a page: a crash or a lost paid pack opens the window, a refused
/// session shows a system notification.
pub fn emit_main<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    {
        let mut q = lock(&QUEUE);
        if !page_listens(app) {
            let Some(rule) = rule_for(event) else { return };
            let kept = match serde_json::to_value(payload) {
                Ok(value) => {
                    let notice = (event == "session-kicked").then(|| value.as_str().unwrap_or_default().to_string());
                    let kept = q.push(rule.event, value, now_ms());
                    drop(q);
                    if kept {
                        if let Some(addr) = notice {
                            notify_refused(&addr);
                        }
                    }
                    kept
                }
                Err(e) => {
                    eprintln!("[background] event {event} was not queued: {e}");
                    false
                }
            };
            // A crash wants the «Починить» screen (a card click has shown it already);
            // a lost paid pack was deleted under the player, who has to be told.
            if kept && (event == "game-crash" || event == "pack-access-lost") {
                crate::tray::show_main(app);
            }
            return;
        }
    }
    // overlay-open is the overlay's own event name too: only the launcher may hear it here.
    let sent = if event == "overlay-open" { app.emit_to(MAIN, event, payload) } else { app.emit(event, payload) };
    log_failure(&format!("event {event} was not delivered"), sent);
}

/// The server refused the session of a game that runs without the launcher window.
fn notify_refused(addr: &str) {
    crate::notify::show(
        &crate::engine::ui("Сессия устарела"),
        &format!("{} {}", crate::engine::ui("Сервер не принял вход. Откройте лаунчер, чтобы обновить его:"), addr),
    );
}

/// The page is up: hand it what happened while there was none, then let events go straight to it.
pub fn replay(app: &AppHandle) {
    if !reopened() && lock(&QUEUE).items.is_empty() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REPLAY_DELAY).await;
        loop {
            let batch = {
                let mut q = lock(&QUEUE);
                let batch = q.take(now_ms());
                if batch.is_empty() {
                    // Under the same lock as the pushes: nothing can slip in between.
                    PAGE_UP.store(true, Ordering::SeqCst);
                }
                batch
            };
            if batch.is_empty() {
                return;
            }
            for (i, q) in batch.into_iter().enumerate() {
                if i > 0 && i % REPLAY_CHUNK == 0 {
                    tokio::time::sleep(REPLAY_PAUSE).await;
                }
                if let Err(e) = app.emit_to(MAIN, &q.event, q.payload) {
                    eprintln!("[background] queued {} was not delivered: {e}", q.event);
                }
            }
        }
    });
}

/// A second start or a link that came while there was no page to hear it.
pub fn keep_links(argv: &[String]) {
    if !unloaded() {
        return;
    }
    let mut r = lock(&RESUME);
    for a in argv.iter().filter(|a| a.starts_with("millida:")) {
        if r.links.len() < MAX_LINKS && a.len() <= 2048 {
            r.links.push(a.clone());
        }
    }
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowResume {
    /// The page is a rebuilt window, not the first one of this run.
    pub reopened: bool,
    pub screen: Option<String>,
    pub links: Vec<String>,
}

pub fn take_resume() -> WindowResume {
    let mut r = lock(&RESUME);
    WindowResume {
        reopened: reopened(),
        screen: r.screen.take(),
        links: std::mem::take(&mut r.links),
    }
}

/// The page's last presence beat, repeated by the core while the game runs without a window.
pub fn remember_beat(path: String, body: serde_json::Value) -> Result<(), String> {
    if !BEAT_PATHS.contains(&path.as_str()) || !body.is_object() {
        return Err("bad beat".into());
    }
    if body.to_string().len() > MAX_BEAT_BYTES {
        return Err("beat too large".into());
    }
    *lock(&BEAT) = Some((path, body));
    Ok(())
}

/// The beat with the server the player is on now. The page's last beat names the server the game started on; a hop
/// inside a network (a lobby, then a mode) would stay on the friends' screens until the game ended.
fn with_server(mut body: serde_json::Value, addr: &str) -> serde_json::Value {
    if let Some(obj) = body.as_object_mut() {
        let value = if addr.is_empty() { serde_json::Value::Null } else { serde_json::json!(addr) };
        obj.insert("server".into(), value.clone());
        obj.insert("serverIp".into(), value);
    }
    body
}

/// The game moved to another server (an empty address: back to the menu). Only the presence beat names a server.
pub fn follow_server(addr: &str) {
    follow_server_in(&mut lock(&BEAT), addr);
}

fn follow_server_in(beat: &mut Option<(String, serde_json::Value)>, addr: &str) {
    if let Some((path, body)) = beat.as_mut() {
        if path == "/friends/presence/heartbeat" {
            *body = with_server(std::mem::take(body), addr);
        }
    }
}

/// The page sends `status: lobby` right before the game window shows up; once
/// the game runs the beat says so.
fn beat_body(mut body: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = body.as_object_mut() {
        // Both routes name a running game the same way.
        obj.insert("status".into(), serde_json::json!("playing"));
        // Telemetry inside the presence beat is only refreshed by the page.
        obj.remove("telemetry");
    }
    body
}

async fn send_beat() {
    let Some((path, body)) = lock(&BEAT).clone() else { return };
    if path == "/launcher/heartbeat" && !crate::engine::game_telemetry_enabled() {
        return;
    }
    let body = beat_body(body);
    let _ = crate::engine::millida_api_auth_in(path, "POST".into(), Some(body), None, None).await;
}

/// Wakes the tray loop when the core has finished staging an update: the quiet-install clock starts from there.
static STAGED: tokio::sync::Notify = tokio::sync::Notify::const_new();

fn run_background(app: AppHandle, reason: Reason) {
    let epoch = EPOCH.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        let live = || EPOCH.load(Ordering::SeqCst) == epoch && unloaded() && !crate::exiting();
        let start = Instant::now();
        let mut next_beat = start;
        let mut next_sample = start + SAMPLE_AFTER_UNLOAD;
        let mut next_update = start + UPDATE_FIRST;
        let mut first_sample = true;
        // An update on disk that nobody has quit for: the tray looks once a minute, only while there is one.
        let mut watch = crate::engine::tray_should_watch(&app);
        let mut next_look = start + crate::engine::TRAY_LOOK;
        let mut quiet = crate::engine::Quiet::default();
        loop {
            if !live() {
                return;
            }
            let now = Instant::now();
            let playing = !crate::engine::running_games().is_empty();
            if playing && now >= next_beat {
                send_beat().await;
                next_beat = now + BEAT_EVERY;
            }
            if now >= next_sample {
                let why = if first_sample { reason.as_str() } else { "timer" };
                first_sample = false;
                sample(&app, if playing { "game" } else { "tray" }, why);
                next_sample = now + SAMPLE_EVERY;
            }
            if now >= next_update {
                check_update(&app).await;
                next_update = now + UPDATE_EVERY;
                watch = crate::engine::tray_should_watch(&app);
            }
            if watch && now >= next_look {
                next_look = now + crate::engine::TRAY_LOOK;
                let idle = quiet.look(now, crate::engine::busy_now(STAGING.load(Ordering::SeqCst)));
                if crate::engine::tray_install_due(idle, 0) && live() {
                    if install_when_quiet(&app, idle).await {
                        return;
                    }
                    // It did not go in: another ten quiet minutes before the next try, if tries are left.
                    quiet.look(Instant::now(), true);
                    watch = crate::engine::tray_should_watch(&app);
                }
            }
            // Only a running game needs a short tick; the tray sleeps until the next sample.
            let mut wake = next_sample.min(next_update);
            if playing {
                wake = wake.min(next_beat);
            }
            if watch {
                wake = wake.min(next_look);
            }
            let wait = wake.saturating_duration_since(Instant::now()).max(Duration::from_secs(1));
            tokio::select! {
                _ = tokio::time::sleep(wait) => {}
                _ = STAGED.notified() => {
                    // The download just ended: the quiet minutes are counted from now, not from before it.
                    watch = crate::engine::tray_should_watch(&app);
                    quiet.look(Instant::now(), true);
                    next_look = Instant::now() + crate::engine::TRAY_LOOK;
                }
            }
        }
    });
}

/// The core's own record of a quiet install, for the usage statistics: no text, no addresses.
pub(crate) fn install_event(how: &str, idle_s: u64) -> serde_json::Value {
    serde_json::json!({
        "data": { "what": "update_install", "where": "core", "how": how },
        "durationMs": idle_s * 1000,
        "ok": true,
    })
}

/// The update on disk goes in while nobody looks, and the launcher comes back to the tray. `true`: the installer is
/// under way and this process is leaving.
async fn install_when_quiet(app: &AppHandle, idle: Duration) -> bool {
    let probe = app.clone();
    // Checking the file's signature reads the whole installer: not on the event thread.
    let started = tauri::async_runtime::spawn_blocking(move || crate::engine::install_staged_quietly(&probe, crate::engine::Restart::Tray)).await;
    if !started.as_ref().is_ok_and(|s| *s) {
        if let Err(e) = started {
            eprintln!("[background] the quiet install was interrupted: {e}");
        }
        return false;
    }
    send_perf(app, vec![install_event("tray_idle", idle.as_secs())]);
    crate::mark_exiting();
    // The statistics batch leaves from its own task: give it a moment before the process ends.
    tokio::time::sleep(Duration::from_millis(600)).await;
    app.exit(0);
    true
}

/// Whether the failure of an update check should be reported: the first one of a series.
/// A check that works ends the series. A phone-home that fails every 6 hours for a player
/// behind a blocked network is one fact, not 4 events a day.
fn first_of_series(failing: &AtomicBool, ok: bool) -> bool {
    if ok {
        failing.store(false, Ordering::Relaxed);
        return true;
    }
    !failing.swap(true, Ordering::Relaxed)
}

/// The class of a failure for statistics: no text, no addresses.
fn failure_class(err: &str) -> &'static str {
    let low = err.to_lowercase();
    if low.contains("dns") || low.contains("lookup") || low.contains("resolve") || low.contains("не удается разрешить") {
        "dns"
    } else if low.contains("timed out") || low.contains("timeout") || low.contains("время ожидания") {
        "timeout"
    } else if low.contains("reset") || low.contains("обрыв") || low.contains("разорв") {
        "reset"
    } else if low.contains("http") || low.contains("→") {
        "http"
    } else if low.contains("нет связи") || low.contains("connect") {
        "network"
    } else {
        "other"
    }
}

fn update_check_event(ms: u64, result: &Result<Option<crate::engine::FallbackUpdate>, String>) -> serde_json::Value {
    match result {
        Ok(found) => serde_json::json!({
            "data": {
                "what": "update_check",
                "where": "core",
                "found": found.is_some(),
                "critical": found.as_ref().is_some_and(|u| u.critical),
            },
            "durationMs": ms,
            "ok": true,
        }),
        Err(e) => serde_json::json!({
            "data": { "what": "update_check", "where": "core", "kind": failure_class(e) },
            "durationMs": ms,
            "ok": false,
        }),
    }
}

static UPDATE_CHECK_FAILING: AtomicBool = AtomicBool::new(false);

async fn check_update(app: &AppHandle) {
    if crate::engine::is_flatpak() {
        return;
    }
    let started = Instant::now();
    let checked = crate::engine::fallback_check(app).await;
    if first_of_series(&UPDATE_CHECK_FAILING, checked.is_ok()) {
        send_perf(app, vec![update_check_event(started.elapsed().as_millis() as u64, &checked)]);
    }
    let Ok(Some(update)) = checked else { return };
    stage_in_background(app, update.clone());
    {
        let mut seen = lock(&NOTIFIED_UPDATE);
        if seen.as_deref() == Some(update.version.as_str()) {
            return;
        }
        *seen = Some(update.version.clone());
    }
    crate::tray::set_update(Some(&update.version));
    crate::notify::show(
        &crate::engine::ui("Вышло обновление лаунчера"),
        &format!("{} {}", crate::engine::ui("Откройте лаунчер, чтобы поставить версию"), update.version),
    );
}

static STAGING: AtomicBool = AtomicBool::new(false);

/// Download for the sake of a tray quit: only while nobody plays, so the installer does not compete
/// with the game for the disk and the network.
fn should_stage(game_running: bool) -> bool {
    !game_running
}

/// The window that would download the update is not there, and what it downloaded lived in its
/// memory. The core fetches the installer itself; a file already on disk with a good signature is
/// not fetched again, so the check every 6 hours costs nothing once it is there.
fn stage_in_background(app: &AppHandle, update: crate::engine::FallbackUpdate) {
    if !should_stage(!crate::engine::running_games().is_empty()) || STAGING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // A patch from the installed exe first, as the window does; the installer only when there is none. Taking the
        // installer outright threw away a patch the window had already built (finding С2 of the second review).
        match crate::engine::fallback_stage_prefer_delta(&app, &update).await {
            Ok(_) => STAGED.notify_one(),
            Err(e) => eprintln!("[background] update {} was not staged: {e}", update.version),
        }
        STAGING.store(false, Ordering::SeqCst);
    });
}

/// Memory of the launcher's own process tree, in MB.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProcStats {
    pub self_mb: u64,
    pub webview_count: u32,
    pub webview_mb: u64,
}

fn is_webview_process(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n.starts_with("msedgewebview2") || n.starts_with("webkitwebprocess") || n.starts_with("webkitnetworkprocess")
}

/// (pid, parent, name, bytes) -> stats for `root` and its descendants. Game
/// processes are children too; only WebView processes are counted besides the root.
fn tree_stats(root: u32, procs: &[(u32, Option<u32>, String, u64)]) -> ProcStats {
    let mut inside = std::collections::HashSet::from([root]);
    // Parents can be listed after their children: repeat until nothing is added.
    loop {
        let before = inside.len();
        for (pid, parent, _, _) in procs {
            if parent.is_some_and(|p| inside.contains(&p)) {
                inside.insert(*pid);
            }
        }
        if inside.len() == before {
            break;
        }
    }
    let mut out = ProcStats::default();
    for (pid, _, name, bytes) in procs {
        if *pid == root {
            out.self_mb = bytes / 1024 / 1024;
        } else if inside.contains(pid) && is_webview_process(name) {
            out.webview_count += 1;
            out.webview_mb += bytes / 1024 / 1024;
        }
    }
    out
}

pub fn proc_stats() -> ProcStats {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_memory());
    let procs: Vec<(u32, Option<u32>, String, u64)> = sys
        .processes()
        .iter()
        .map(|(pid, p)| (pid.as_u32(), p.parent().map(|x| x.as_u32()), p.name().to_string_lossy().into_owned(), p.memory()))
        .collect();
    tree_stats(std::process::id(), &procs)
}

fn os_name() -> &'static str {
    match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "macos",
        _ => "linux",
    }
}

/// A v4-shaped id for this run of the core, so its samples group as one session.
fn session_id() -> &'static str {
    use sha2::{Digest, Sha256};
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let mut h = Sha256::new();
        h.update(nanos.to_le_bytes());
        h.update(std::process::id().to_le_bytes());
        let mut b: [u8; 16] = h.finalize()[..16].try_into().unwrap_or([0; 16]);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
        format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The device block of a collector batch: the least that ties events to an install and a run.
fn device_block(app_version: &str, install_id: &str) -> serde_json::Value {
    serde_json::json!({
        "installId": install_id,
        "sessionId": session_id(),
        "os": os_name(),
        "appVersion": app_version,
        "themePack": "",
        "themeMode": "dark",
    })
}

/// A batch of `perf` events from the core. Each item brings `data` and may bring `durationMs`
/// and `ok`; the type, the time and the version are added here.
pub fn perf_body(app_version: &str, install_id: &str, items: Vec<serde_json::Value>, at: u64) -> serde_json::Value {
    let events: Vec<serde_json::Value> = items
        .into_iter()
        .map(|mut item| {
            if let Some(o) = item.as_object_mut() {
                o.insert("type".into(), "perf".into());
                o.insert("at".into(), at.into());
                o.insert("appVersion".into(), app_version.into());
            }
            item
        })
        .collect();
    serde_json::json!({ "device": device_block(app_version, install_id), "events": events })
}

/// Sends timings the core measured itself (launch stages, game window, updater checks).
/// Usage statistics off, or no install id yet: nothing is built and nothing is sent.
pub fn send_perf(app: &AppHandle, items: Vec<serde_json::Value>) {
    if items.is_empty() || !crate::engine::game_telemetry_enabled() {
        return;
    }
    let Some(install_id) = crate::engine::stored_install_id_value() else { return };
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn(async move {
        let body = perf_body(&version, &install_id, items, now_ms());
        // Telemetry endpoint of our own API; the batch holds numbers and stage names only.
        let _ = crate::engine::millida_api_auth_in("/launcher/telemetry".into(), "POST".into(), Some(body), None, None).await;
    });
}

fn sample_event(app_version: &str, install_id: &str, state: &str, why: &str, stats: &ProcStats, up_min: u64) -> serde_json::Value {
    serde_json::json!({
        "device": device_block(app_version, install_id),
        "events": [{
            "type": "perf",
            "data": {
                "what": "proc",
                "state": state,
                "why": why,
                "selfMb": stats.self_mb,
                "webviewCount": stats.webview_count,
                "webviewMb": stats.webview_mb,
                "totalMb": stats.self_mb + stats.webview_mb,
                "upMin": up_min,
            },
            "at": now_ms(),
            "appVersion": app_version,
        }],
    })
}

/// One sample of the process tree to telemetry. Usage statistics off (the same
/// switch the game mod reads) or no install id yet: nothing is measured or sent.
pub fn sample(app: &AppHandle, state: &'static str, why: &'static str) {
    send_sample(app, state, why, None);
}

/// `measured`: stats taken by the caller at the exact moment that matters.
fn send_sample(app: &AppHandle, state: &'static str, why: &'static str, measured: Option<ProcStats>) {
    if !crate::engine::game_telemetry_enabled() {
        return;
    }
    let Some(install_id) = crate::engine::stored_install_id_value() else { return };
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn(async move {
        let stats = match measured {
            Some(s) => s,
            None => tauri::async_runtime::spawn_blocking(proc_stats).await.unwrap_or_default(),
        };
        let body = sample_event(&version, &install_id, state, why, &stats, up_minutes());
        let _ = crate::engine::millida_api_auth_in("/launcher/telemetry".into(), "POST".into(), Some(body), None, None).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_webview_processes_of_our_tree_are_counted() {
        let mb = 1024 * 1024;
        let procs = vec![
            (10, Some(1), "millida-launcher.exe".to_string(), 30 * mb),
            (11, Some(10), "msedgewebview2.exe".to_string(), 90 * mb),
            (12, Some(11), "msedgewebview2.exe".to_string(), 120 * mb),
            (13, Some(10), "javaw.exe".to_string(), 2000 * mb),
            (14, Some(1), "msedgewebview2.exe".to_string(), 500 * mb),
            // A child listed before its parent is still part of the tree.
            (9, Some(15), "msedgewebview2.exe".to_string(), 10 * mb),
            (15, Some(11), "msedgewebview2.exe".to_string(), 10 * mb),
        ];
        let s = tree_stats(10, &procs);
        assert_eq!(s.self_mb, 30, "свой процесс — это корень дерева");
        assert_eq!(
            s.webview_count, 4,
            "WebView2 Edge-браузера и чужих программ (pid 14) не наш, а игра (java) — не вебвью: \
             иначе замер «до/после» врёт",
        );
        assert_eq!(s.webview_mb, 230);
    }

    #[test]
    fn page_work_or_core_installs_hold_the_window() {
        assert_eq!(keeper_for(None, 0), None, "ничего не идёт — окно выгружается сразу");
        assert_eq!(keeper_for(None, 2), Some(Keeper::Core), "ядро ставит — нельзя рвать прогресс на экране");
        assert_eq!(keeper_for(Some(Hold::Call), 0), Some(Keeper::Page(Hold::Call)), "звонок живёт только в странице");
        assert_eq!(keeper_for(Some(Hold::Launch), 0), Some(Keeper::Page(Hold::Launch)), "подготовка запуска живёт только в странице");
    }

    #[test]
    fn a_failed_result_is_reported_not_swallowed() {
        assert!(log_failure("test", Err::<(), _>("нет окна")));
        assert!(!log_failure("test", Ok::<_, String>(1)));
    }

    #[test]
    fn the_update_is_downloaded_in_the_tray_only_while_nobody_plays() {
        assert!(should_stage(false));
        assert!(!should_stage(true), "установщик не мешает игре диском и сетью");
    }

    #[test]
    fn the_page_is_never_put_to_sleep_under_its_own_work() {
        for hold in [Hold::Install, Hold::Call, Hold::Launch] {
            let k = Keeper::Page(hold);
            assert!(!k.sleeps_page(), "{hold:?}: TrySuspend останавливает таймеры и ожидания страницы, следующий шаг не стартует");
            assert!(!k.polls_core_jobs(), "{hold:?}: пустая очередь ядра между шагами страницы не конец её работы");
        }
        assert!(Keeper::Core.sleeps_page() && Keeper::Core.polls_core_jobs(), "ядро доделывает установку без страницы");
    }

    #[test]
    fn the_page_install_wins_over_the_core_jobs() {
        // Страница ведёт установку (мод за модом), а ядро в этот миг ещё качает один из модов:
        // решает страница, иначе опрос ядра выгрузил бы окно, как только скачивание кончилось.
        assert_eq!(keeper_for(Some(Hold::Install), 3), Some(Keeper::Page(Hold::Install)));
        assert!(!keeper_for(Some(Hold::Install), 3).unwrap().polls_core_jobs());
    }

    #[test]
    fn a_core_hold_unloads_only_when_the_jobs_are_over_and_nobody_looks() {
        assert_eq!(poll_step(true, true, false, false, 2), Poll::Wait);
        assert_eq!(poll_step(true, true, false, false, 0), Poll::Unload);
        assert_eq!(poll_step(true, true, false, true, 0), Poll::Back, "игрок открыл окно сам — выгружать нечего");
        assert_eq!(poll_step(false, true, false, false, 0), Poll::Stop, "новая выгрузка или пересозданное окно сняли опрос");
        assert_eq!(poll_step(true, false, false, false, 0), Poll::Stop);
        assert_eq!(poll_step(true, true, true, false, 0), Poll::Stop, "приложение закрывается");
    }

    #[test]
    fn only_page_holds_the_tray_does_not_call_a_download() {
        assert_eq!(Keeper::Page(Hold::Launch).status(), None);
        assert_eq!(Keeper::Page(Hold::Call).status(), Some("Идёт звонок"));
        assert!(Keeper::Core.status().is_some());
        assert_eq!(Hold::parse(Some("launch")), Some(Hold::Launch));
        assert_eq!(Hold::parse(Some("sudo")), None);
    }

    #[test]
    fn resume_screen_is_a_plain_slug() {
        assert_eq!(clean_screen(Some("builds".into())), Some("builds".into()));
        assert_eq!(clean_screen(Some("  ".into())), None);
        assert_eq!(clean_screen(Some("<script>".into())), None, "экран приходит из страницы и уходит в новую");
        assert_eq!(clean_screen(Some("x".repeat(65))), None);
    }

    #[test]
    fn beats_go_only_to_presence_routes() {
        assert!(remember_beat("/friends/presence/heartbeat".into(), serde_json::json!({"status": "playing"})).is_ok());
        assert!(
            remember_beat("/account/delete".into(), serde_json::json!({})).is_err(),
            "ядро повторяет удар без окна — он не должен стать дверью для любого запроса",
        );
        let body = beat_body(serde_json::json!({"status": "lobby", "telemetry": {"a": 1}}));
        assert_eq!(body["status"], "playing", "без окна ядро бьёт только пока идёт игра");
        assert!(body.get("telemetry").is_none());
    }

    #[test]
    fn sample_has_the_collector_shape() {
        let s = ProcStats { self_mb: 30, webview_count: 0, webview_mb: 0 };
        let v = sample_event("2.0.300", "abc-1", "game", "timer", &s, 61);
        assert_eq!(v["events"][0]["type"], "perf");
        assert_eq!(v["events"][0]["data"]["what"], "proc");
        assert_eq!(v["events"][0]["data"]["totalMb"], 30);
        assert_eq!(v["device"]["installId"], "abc-1");
        assert_eq!(session_id().len(), 36);
    }

    #[test]
    fn a_failing_update_check_is_reported_once_per_series() {
        let failing = AtomicBool::new(false);
        assert!(first_of_series(&failing, true), "a working check is always a fact");
        assert!(first_of_series(&failing, false), "the first failure of a series is reported");
        assert!(!first_of_series(&failing, false), "the second one is the same story");
        assert!(!first_of_series(&failing, false));
        assert!(first_of_series(&failing, true), "recovery is reported and ends the series");
        assert!(first_of_series(&failing, false), "and a new failure starts a new one");
    }

    #[test]
    fn a_quiet_install_is_reported_without_text() {
        let e = install_event("tray_idle", 612);
        assert_eq!(e["data"]["what"], "update_install");
        assert_eq!(e["data"]["how"], "tray_idle");
        assert_eq!(e["durationMs"], 612_000);
        assert_eq!(e["ok"], true);
        assert_eq!(e["data"].as_object().unwrap().len(), 3, "type, place, way — no version text, no path");
    }

    /// Finding Н5: a hop to another server inside the game reaches the beat the core repeats without a window.
    #[test]
    fn the_core_beat_follows_the_server_the_player_moves_to() {
        let page = serde_json::json!({"status": "playing", "server": "Lobby", "serverIp": "lobby.example", "build": "Survival"});
        let moved = with_server(page.clone(), "play.example:25565");
        assert_eq!(moved["server"], "play.example:25565");
        assert_eq!(moved["serverIp"], "play.example:25565");
        assert_eq!(moved["build"], "Survival", "the rest of the beat is the page's");
        let menu = with_server(page, "");
        assert!(menu["server"].is_null() && menu["serverIp"].is_null(), "back in the menu: no server");
        assert_eq!(with_server(serde_json::json!("not an object"), "a"), serde_json::json!("not an object"));

        // through the stored beat: only the presence route names a server
        let mut beat = Some(("/launcher/heartbeat".to_string(), serde_json::json!({"server": "x"})));
        follow_server_in(&mut beat, "other.example");
        assert_eq!(beat.as_ref().unwrap().1["server"], "x", "the launcher heartbeat is left as the page wrote it");
        let mut beat = Some(("/friends/presence/heartbeat".to_string(), serde_json::json!({"status": "playing", "server": "x"})));
        follow_server_in(&mut beat, "other.example");
        assert_eq!(beat.as_ref().unwrap().1["server"], "other.example");
        follow_server_in(&mut None, "nobody.example");
    }

    #[test]
    fn update_check_events_carry_a_class_and_no_text() {
        let failed = update_check_event(5200, &Err("https://launcher-storage.millida.net/v2/latest.json: нет связи (dns error)".into()));
        assert_eq!(failed["data"]["kind"], "dns");
        assert_eq!(failed["ok"], false);
        assert!(!failed.to_string().contains("launcher-storage"), "no address in statistics");
        assert_eq!(update_check_event(90, &Ok(None))["data"]["found"], false);
        assert_eq!(failure_class("operation timed out"), "timeout");
        assert_eq!(failure_class("что-то странное"), "other");
    }

    #[test]
    fn core_perf_batches_carry_type_time_and_version() {
        let body = perf_body(
            "2.0.300",
            "abc-1",
            vec![serde_json::json!({"data": {"what": "launch_stages"}, "durationMs": 1200, "ok": true})],
            1_700_000_000_000,
        );
        let ev = &body["events"][0];
        assert_eq!(ev["type"], "perf");
        assert_eq!(ev["at"], 1_700_000_000_000u64);
        assert_eq!(ev["appVersion"], "2.0.300");
        assert_eq!(ev["data"]["what"], "launch_stages");
        assert_eq!(ev["durationMs"], 1200);
        assert_eq!(body["device"]["installId"], "abc-1");
    }

    #[test]
    fn events_the_page_needs_wait_for_it_and_the_rest_do_not() {
        for e in ["game-exit", "game-crash", "overlay-open", "game-perf", "game-server", "session-kicked", "pack-access-lost"] {
            assert!(rule_for(e).is_some(), "{e} без окна теряется");
        }
        for e in ["game-log", "launch-progress", "install-progress", "window-visibility", "rewind-clip"] {
            assert!(rule_for(e).is_none(), "{e} живёт, пока окно открыто, или читается с ядра при открытии");
        }
    }

    fn q() -> Queue {
        Queue::new()
    }

    #[test]
    fn frame_reports_cannot_push_out_the_exit_of_the_game() {
        let mut queue = q();
        assert!(queue.push("game-exit", json!("Мир"), 1));
        for i in 0..5000u64 {
            queue.push("game-perf", json!({ "fps": 60, "i": i }), 2 + i);
        }
        let all = queue.take(10_000);
        assert_eq!(all[0].event, "game-exit", "порядок событий сохраняется");
        let perf: Vec<_> = all.iter().filter(|e| e.event == "game-perf").collect();
        assert_eq!(perf.len(), 720, "кадры ограничены часом игры");
        assert_eq!(perf.last().unwrap().payload["i"], 4999, "при переполнении уходят старые кадры, а не свежие");
        assert_eq!(perf[0].payload["i"], 5000 - 720);
    }

    #[test]
    fn frame_reports_carry_their_own_time_for_the_late_judge() {
        let mut queue = q();
        queue.push("game-perf", json!({ "fps": 20 }), 1_700_000_005_000);
        queue.push("game-exit", json!("Мир"), 1_700_000_006_000);
        let all = queue.take(1_700_000_010_000);
        assert_eq!(all[0].payload["at"], 1_700_000_005_000u64);
        assert!(all[1].payload.get("at").is_none(), "выход игры остаётся как был: имя сборки строкой");
    }

    #[test]
    fn the_same_server_is_not_queued_twice_in_a_row_but_a_return_counts() {
        let mut queue = q();
        assert!(queue.push("game-server", json!("a.example"), 1));
        assert!(!queue.push("game-server", json!("a.example"), 2));
        assert!(queue.push("game-server", json!(""), 3), "выход в меню — тоже факт");
        assert!(queue.push("game-server", json!("a.example"), 4), "вернулся на тот же сервер");
        assert_eq!(queue.take(5).len(), 3);
    }

    #[test]
    fn a_refused_server_is_asked_about_once() {
        let mut queue = q();
        assert!(queue.push("session-kicked", json!("a.example"), 1));
        assert!(!queue.push("session-kicked", json!("a.example"), 2), "второй вопрос о том же сервере не нужен (и второго уведомления тоже)");
        assert!(queue.push("session-kicked", json!("b.example"), 3));
    }

    #[test]
    fn full_critical_room_refuses_new_events_and_keeps_the_first_facts() {
        let mut queue = q();
        for i in 0..16 {
            assert!(queue.push("game-crash", json!(i), 1));
        }
        assert!(!queue.push("game-crash", json!(99), 2));
        assert_eq!(queue.take(3).len(), 16);
    }

    #[test]
    fn old_reports_of_a_forgotten_session_are_not_replayed() {
        let mut queue = q();
        queue.push("game-perf", json!({ "fps": 20 }), 1_000);
        queue.push("game-server", json!("a.example"), 1_000);
        queue.push("game-exit", json!("Мир"), 1_000);
        let day = 24 * HOUR_MS;
        let all = queue.take(1_000 + day);
        assert_eq!(all.len(), 1, "кадры и адрес суточной давности устарели, выход игры нет");
        assert_eq!(all[0].event, "game-exit");
    }

    #[test]
    fn unknown_events_are_not_kept() {
        let mut queue = q();
        assert!(!queue.push("rewind-clip", json!({}), 1));
        assert!(queue.take(2).is_empty());
    }
}
