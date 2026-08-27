//! Discord Rich Presence over the local Discord IPC socket. The application id
//! controls the displayed app name and the asset images; override it with
//! `MILLIDA_DISCORD_APP_ID`. Failures are non-fatal and retried no more often
//! than `RETRY_AFTER`.
//!
//! The socket is owned by one worker thread and never touched by a caller. A
//! named pipe that accepts the connection and then answers nothing — a Discord
//! client that is updating, hung, or an impostor squatting `discord-ipc-0` —
//! blocks the reading thread with no timeout of its own. When that thread was
//! the caller's, and Tauri runs a synchronous command on the main thread, the
//! whole window stopped pumping messages: the launcher froze on the login
//! screen with "Не отвечает" in the title and no way out but the task manager.
//!
//! So: commands hand a job over and wait on a channel with a deadline, the
//! socket work happens on the worker, and a worker that stops answering is
//! abandoned (its thread stays parked in the kernel read until the pipe closes)
//! and replaced, a bounded number of times.

use discord_rich_presence::{activity, activity::ActivityType, DiscordIpc, DiscordIpcClient};
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_APP_ID: &str = "1530764069965922354";
const RETRY_AFTER: Duration = Duration::from_secs(30);
const SITE_URL: &str = "https://millida.net/launcher";
const DISCORD_URL: &str = "https://discord.gg/mcru";
const PROFILE_BASE: &str = "https://millida.net/u/";

/// Longest a caller waits for the socket before it is told what is known so
/// far. The frontend gives presence two seconds before it beats without the
/// Discord id, so the answer has to be back before that.
const WAIT: Duration = Duration::from_millis(1200);

/// A worker still inside one job after this long is not slow, it is parked in a
/// read that may never return.
const OP_TIMEOUT: Duration = Duration::from_secs(10);

/// Every abandoned worker leaks a thread, so replacing one cannot be endless.
/// After this many, presence stays off until the launcher is restarted.
const MAX_RESPAWNS: u64 = 3;

fn profile_url(slug: &str) -> Option<String> {
    let ok = (1..=48).contains(&slug.len())
        && slug
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if ok {
        Some(format!("{}{}", PROFILE_BASE, slug.to_ascii_lowercase()))
    } else {
        None
    }
}

fn app_id() -> String {
    std::env::var("MILLIDA_DISCORD_APP_ID").unwrap_or_else(|_| DEFAULT_APP_ID.to_string())
}

static TX: Mutex<Option<Sender<Job>>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static RESPAWNS: AtomicU64 = AtomicU64::new(0);
/// When the live worker entered the job it is running, as millis on the process
/// clock. Zero means idle.
static BUSY_SINCE: AtomicU64 = AtomicU64::new(0);
static CONNECTED: AtomicBool = AtomicBool::new(false);
static LAST_TRY: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());
static LAST_OK: Mutex<String> = Mutex::new(String::new());
static LAST_SLUG: Mutex<String> = Mutex::new(String::new());
/// Discord account the local client is signed in as, taken from the READY
/// frame. The exp bridge pays for hours only while the launcher activity is
/// actually visible on the player's own Discord, so the server has to know
/// whose Discord it is - the id is proof of connection, not a claim.
static USER_ID: Mutex<String> = Mutex::new(String::new());
/// Is our activity on the profile right now. A live socket is not enough: the
/// player can switch presence off, and cleared activity earns nothing.
static VISIBLE: AtomicBool = AtomicBool::new(false);

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn note_err(msg: String) {
    *lock(&LAST_ERROR) = msg;
}

fn started() -> Instant {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    *START.get_or_init(Instant::now)
}

fn now_ms() -> u64 {
    // Zero is the idle marker, so the clock may never read as zero.
    started().elapsed().as_millis() as u64 + 1
}

#[derive(Clone, Default, Debug)]
pub struct Presence {
    pub details: String,
    pub state: String,
    pub playing: bool,
    pub large_image: String,
    pub large_text: String,
    pub join_url: String,
    pub profile_slug: String,
}

enum Work {
    Set(Box<Presence>),
    Reconnect,
    Clear,
}

struct Job {
    work: Work,
    done: Option<tokio::sync::oneshot::Sender<()>>,
}

#[derive(serde::Serialize)]
pub struct DiscordStatus {
    pub connected: bool,
    pub app_id: String,
    pub last_error: String,
    pub last_activity: String,
    #[serde(rename = "userId")]
    pub user_id: String,
}

/// Reads only what the worker has published, so a stuck socket cannot hold the
/// caller: this is what the UI gets while the worker is still busy.
pub fn status() -> DiscordStatus {
    DiscordStatus {
        connected: CONNECTED.load(Ordering::SeqCst),
        app_id: app_id(),
        last_error: lock(&LAST_ERROR).clone(),
        last_activity: lock(&LAST_OK).clone(),
        user_id: if VISIBLE.load(Ordering::SeqCst) { lock(&USER_ID).clone() } else { String::new() },
    }
}

/// Whether the worker running `busy_since` (millis, zero when idle) has to be
/// given up on at `now`.
fn is_stuck(busy_since: u64, now: u64, timeout: Duration) -> bool {
    busy_since != 0 && now.saturating_sub(busy_since) >= timeout.as_millis() as u64
}

fn spawn_worker(generation: u64, rx: Receiver<Job>) {
    std::thread::Builder::new()
        .name("discord-ipc".into())
        .spawn(move || worker(generation, rx))
        .ok();
}

/// Hands the job to the worker and answers once it is done or the deadline
/// passes - never later, whatever the socket does.
async fn submit(work: Work) {
    let (tx, rx) = tokio::sync::oneshot::channel();
    if !enqueue(Job { work, done: Some(tx) }) {
        return;
    }
    let _ = tokio::time::timeout(WAIT, rx).await;
}

/// The one place a job reaches the worker: it also decides that a worker which
/// never came back from its last job is not going to, and replaces it.
fn enqueue(job: Job) -> bool {
    let mut guard = lock(&TX);
    if is_stuck(BUSY_SINCE.load(Ordering::SeqCst), now_ms(), OP_TIMEOUT) {
        if RESPAWNS.fetch_add(1, Ordering::SeqCst) >= MAX_RESPAWNS {
            note_err("Discord не отвечает: активность отключена до перезапуска лаунчера".into());
            CONNECTED.store(false, Ordering::SeqCst);
            VISIBLE.store(false, Ordering::SeqCst);
            *guard = None;
            return false;
        }
        note_err("Discord не отвечает: соединение пересоздаётся".into());
        // The abandoned thread is still inside its read. Retiring its
        // generation is what stops it from writing state after we gave up on it.
        GENERATION.fetch_add(1, Ordering::SeqCst);
        BUSY_SINCE.store(0, Ordering::SeqCst);
        CONNECTED.store(false, Ordering::SeqCst);
        VISIBLE.store(false, Ordering::SeqCst);
        *lock(&LAST_TRY) = None;
        *guard = None;
    }
    if guard.is_none() {
        if RESPAWNS.load(Ordering::SeqCst) > MAX_RESPAWNS {
            return false;
        }
        let (tx, rx) = mpsc::channel();
        spawn_worker(GENERATION.load(Ordering::SeqCst), rx);
        *guard = Some(tx);
    }
    match guard.as_ref() {
        // A worker that ended on its own leaves a dead channel behind; the next
        // job builds a new one.
        Some(tx) => match tx.send(job) {
            Ok(()) => true,
            Err(_) => {
                *guard = None;
                false
            }
        },
        None => false,
    }
}

pub async fn set_activity(presence: Presence) {
    *lock(&LAST_SLUG) = presence.profile_slug.clone();
    submit(Work::Set(Box::new(presence))).await;
}

pub async fn reconnect() {
    submit(Work::Reconnect).await;
}

pub async fn clear() {
    submit(Work::Clear).await;
}

fn worker(generation: u64, rx: Receiver<Job>) {
    let mut client: Option<DiscordIpcClient> = None;
    let mut since: Option<i64> = None;
    while let Ok(mut job) = rx.recv() {
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        BUSY_SINCE.store(now_ms(), Ordering::SeqCst);
        match job.work {
            Work::Set(presence) => apply(&mut client, &mut since, &presence),
            Work::Reconnect => {
                *lock(&LAST_TRY) = None;
                let slug = lock(&LAST_SLUG).clone();
                let presence = Presence {
                    details: "В лаунчере".into(),
                    state: "Millida Launcher".into(),
                    profile_slug: slug,
                    ..Presence::default()
                };
                apply(&mut client, &mut since, &presence);
            }
            Work::Clear => {
                if let Some(c) = client.as_mut() {
                    let _ = c.clear_activity();
                }
                since = None;
                VISIBLE.store(false, Ordering::SeqCst);
            }
        }
        // A retired generation must publish nothing: its replacement owns the
        // state now.
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        BUSY_SINCE.store(0, Ordering::SeqCst);
        if let Some(done) = job.done.take() {
            let _ = done.send(());
        }
    }
}

fn ensure_connected(client: &mut Option<DiscordIpcClient>) -> bool {
    if client.is_some() {
        return true;
    }
    let id = app_id();
    if id.trim().is_empty() {
        return false;
    }
    {
        let mut last = lock(&LAST_TRY);
        if let Some(t) = *last {
            if t.elapsed() < RETRY_AFTER {
                return false;
            }
        }
        *last = Some(Instant::now());
    }

    match DiscordIpcClient::new(&id) {
        Ok(mut c) => match handshake(&mut c, &id) {
            Ok(user) => {
                *lock(&USER_ID) = user;
                CONNECTED.store(true, Ordering::SeqCst);
                *client = Some(c);
                true
            }
            Err(e) => {
                lock(&USER_ID).clear();
                CONNECTED.store(false, Ordering::SeqCst);
                VISIBLE.store(false, Ordering::SeqCst);
                note_err(format!("нет соединения с Discord: {}", e));
                false
            }
        },
        Err(e) => {
            note_err(format!("клиент не создан: {}", e));
            false
        }
    }
}

fn drop_client(client: &mut Option<DiscordIpcClient>) {
    if let Some(c) = client.as_mut() {
        let _ = c.close();
    }
    *client = None;
    CONNECTED.store(false, Ordering::SeqCst);
    VISIBLE.store(false, Ordering::SeqCst);
    lock(&USER_ID).clear();
}

/// `DiscordIpc::connect` swallows the READY frame, and with it the only proof
/// of which Discord account the socket belongs to: the handshake is done by
/// hand so that id survives.
fn handshake(c: &mut DiscordIpcClient, id: &str) -> Result<String, Box<dyn std::error::Error>> {
    c.connect_ipc()?;
    c.send(json!({ "v": 1, "client_id": id }), 0)?;
    let (_, val) = c.recv()?;
    Ok(val["data"]["user"]["id"].as_str().unwrap_or_default().to_string())
}

const JOIN_PREFIX: &str = "https://millida.net/join?";

/// `large_image` may be an https URL: Discord proxies external images itself.
/// `join_url` replaces the download button while the player is on a server; it is
/// restricted to our own join page because the value comes from the webview.
/// `profile_slug` is a slug, not a URL: the address is built here so the webview
/// cannot point the button anywhere else. Empty slug keeps the Discord button.
fn apply(client: &mut Option<DiscordIpcClient>, since: &mut Option<i64>, p: &Presence) {
    if !ensure_connected(client) {
        return;
    }
    if p.playing {
        if since.is_none() {
            *since = Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
            );
        }
    } else {
        *since = None;
    }

    let big = if p.large_image.starts_with("https://") { p.large_image.as_str() } else { "logo" };
    let big_text = if p.large_text.is_empty() { "Millida Launcher" } else { p.large_text.as_str() };
    let join_ok = p.playing && p.join_url.starts_with(JOIN_PREFIX) && p.join_url.len() <= 512;
    let profile = profile_url(&p.profile_slug);
    let buttons = if join_ok {
        vec![
            activity::Button::new("Зайти на сервер", p.join_url.as_str()),
            activity::Button::new("Скачать лаунчер", SITE_URL),
        ]
    } else {
        vec![
            activity::Button::new("Скачать лаунчер", SITE_URL),
            match profile.as_deref() {
                Some(url) => activity::Button::new("Профиль Millida", url),
                None => activity::Button::new("Discord Millida", DISCORD_URL),
            },
        ]
    };
    let mut act = activity::Activity::new()
        .activity_type(ActivityType::Playing)
        .details(&p.details)
        .state(&p.state)
        .assets(
            activity::Assets::new()
                .large_image(big)
                .large_text(big_text)
                .small_image("logo")
                .small_text(if p.playing { "В игре" } else { "В лаунчере" }),
        )
        .buttons(buttons);
    if let Some(ts) = *since {
        act = act.timestamps(activity::Timestamps::new().start(ts));
    }

    if let Err(e) = client.as_mut().map(|c| c.set_activity(act)).unwrap_or(Ok(())) {
        note_err(format!("активность не поставилась: {}", e));
        drop_client(client);
        return;
    }
    // The crate ignores Discord's reply, so rejected activities would pass
    // silently: read the response frame ourselves.
    match client.as_mut().map(|c| c.recv()) {
        Some(Ok((_, val))) => {
            if val["evt"].as_str() == Some("ERROR") {
                VISIBLE.store(false, Ordering::SeqCst);
                note_err(format!(
                    "Discord отклонил активность: {}",
                    val["data"]["message"].as_str().unwrap_or("?")
                ));
                return;
            }
        }
        Some(Err(e)) => note_err(format!("нет ответа от Discord: {}", e)),
        None => return,
    }
    VISIBLE.store(true, Ordering::SeqCst);
    *lock(&LAST_OK) = format!("{} · {}", p.details, p.state);
    lock(&LAST_ERROR).clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_button_points_only_at_our_profile_page() {
        let cases: [(&str, Option<&str>); 7] = [
            ("danielgrash", Some("https://millida.net/u/danielgrash")),
            ("DanielGrash", Some("https://millida.net/u/danielgrash")),
            ("some_nick-2", Some("https://millida.net/u/some_nick-2")),
            ("", None),
            ("../admin", None),
            ("a b", None),
            ("evil.com/x", None),
        ];
        for (slug, want) in cases {
            assert_eq!(
                profile_url(slug).as_deref(),
                want,
                "slug «{}» must not escape {}: the value comes from the webview",
                slug,
                super::PROFILE_BASE
            );
        }
    }

    /// A worker parked in a read that never returns is how the window froze:
    /// nothing may wait on it forever, and an idle worker may never be taken
    /// for one.
    #[test]
    fn a_worker_is_given_up_on_only_after_the_deadline() {
        let cases: [(u64, u64, bool, &str); 4] = [
            (0, 60_000, false, "idle worker: there is nothing to give up on"),
            (1_000, 1_500, false, "half a second in: the socket is merely slow"),
            (1_000, 11_000, true, "past the deadline: the read is not coming back"),
            (1_000, 1_000 + OP_TIMEOUT.as_millis() as u64, true, "exactly at the deadline"),
        ];
        for (busy_since, now, want, why) in cases {
            assert_eq!(
                is_stuck(busy_since, now, OP_TIMEOUT),
                want,
                "is_stuck({busy_since}, {now}) must be {want}: {why}",
            );
        }
    }

    /// The caller's deadline has to fire before the frontend stops waiting,
    /// otherwise the answer arrives after the heartbeat already left without it.
    #[test]
    fn callers_stop_waiting_before_the_frontend_does() {
        const FRONTEND_WAIT: Duration = Duration::from_millis(2000);
        assert!(
            WAIT < FRONTEND_WAIT,
            "ожидание ядра ({:?}) должно кончаться раньше гонки во фронте ({:?}): иначе id аккаунта \
             приходит уже после удара присутствия и час опыта не засчитывается",
            WAIT,
            FRONTEND_WAIT,
        );
        assert!(
            WAIT < OP_TIMEOUT,
            "ждать дольше, чем живёт сама операция, значит держать вызывающего до самого отказа",
        );
    }

    /// Discord going quiet must cost a bounded number of threads: each
    /// abandoned worker stays parked in the kernel until the pipe closes.
    #[test]
    fn abandoned_workers_are_bounded() {
        const {
            assert!(MAX_RESPAWNS >= 1, "одна пересборка соединения обязана быть: сокет мог просто умереть");
            assert!(MAX_RESPAWNS <= 5, "каждый брошенный поток живёт до конца процесса — их не может быть много");
        }
    }
}
