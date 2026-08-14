//! Discord Rich Presence over the local Discord IPC socket. The application id
//! controls the displayed app name and the asset images; override it with
//! `MILLIDA_DISCORD_APP_ID`. Failures are non-fatal and retried no more often
//! than `RETRY_AFTER`.

use discord_rich_presence::{activity, activity::ActivityType, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEFAULT_APP_ID: &str = "1530764069965922354";
const RETRY_AFTER: Duration = Duration::from_secs(30);
const SITE_URL: &str = "https://millida.net/launcher";
const DISCORD_URL: &str = "https://discord.gg/mcru";
const PROFILE_BASE: &str = "https://millida.net/u/";

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

static CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
static SINCE: Mutex<Option<i64>> = Mutex::new(None);
static LAST_TRY: Mutex<Option<Instant>> = Mutex::new(None);
static LAST_ERROR: Mutex<String> = Mutex::new(String::new());
static LAST_OK: Mutex<String> = Mutex::new(String::new());
static LAST_SLUG: Mutex<String> = Mutex::new(String::new());

fn note_err(msg: String) {
    if let Ok(mut e) = LAST_ERROR.lock() {
        *e = msg;
    }
}

#[derive(serde::Serialize)]
pub struct DiscordStatus {
    pub connected: bool,
    pub app_id: String,
    pub last_error: String,
    pub last_activity: String,
}

pub fn status() -> DiscordStatus {
    DiscordStatus {
        connected: CLIENT.lock().map(|g| g.is_some()).unwrap_or(false),
        app_id: app_id(),
        last_error: LAST_ERROR.lock().map(|e| e.clone()).unwrap_or_default(),
        last_activity: LAST_OK.lock().map(|e| e.clone()).unwrap_or_default(),
    }
}

pub fn reconnect() -> DiscordStatus {
    if let Ok(mut t) = LAST_TRY.lock() {
        *t = None;
    }
    let slug = LAST_SLUG.lock().map(|s| s.clone()).unwrap_or_default();
    set_activity("В лаунчере", "Millida Launcher", false, "", "", "", &slug);
    status()
}

fn ensure_connected(guard: &mut Option<DiscordIpcClient>) -> bool {
    if guard.is_some() {
        return true;
    }
    let id = app_id();
    if id.trim().is_empty() {
        return false;
    }
    {
        let mut last = LAST_TRY.lock().unwrap();
        if let Some(t) = *last {
            if t.elapsed() < RETRY_AFTER {
                return false;
            }
        }
        *last = Some(Instant::now());
    }

    match DiscordIpcClient::new(&id) {
        Ok(mut c) => match c.connect() {
            Ok(_) => {
                *guard = Some(c);
                true
            }
            Err(e) => {
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

const JOIN_PREFIX: &str = "https://millida.net/join?";

/// `large_image` may be an https URL: Discord proxies external images itself.
/// `join_url` replaces the download button while the player is on a server; it is
/// restricted to our own join page because the value comes from the webview.
/// `profile_slug` is a slug, not a URL: the address is built here so the webview
/// cannot point the button anywhere else. Empty slug keeps the Discord button.
pub fn set_activity(
    details: &str,
    state: &str,
    playing: bool,
    large_image: &str,
    large_text: &str,
    join_url: &str,
    profile_slug: &str,
) {
    let mut guard = match CLIENT.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if !ensure_connected(&mut guard) {
        return;
    }
    let client = guard.as_mut().unwrap();

    let mut since = match SINCE.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if playing {
        if since.is_none() {
            *since = Some(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0));
        }
    } else {
        *since = None;
    }

    let big = if large_image.starts_with("https://") { large_image } else { "logo" };
    let big_text = if large_text.is_empty() { "Millida Launcher" } else { large_text };
    let join_ok = playing && join_url.starts_with(JOIN_PREFIX) && join_url.len() <= 512;
    let profile = profile_url(profile_slug);
    if let Ok(mut s) = LAST_SLUG.lock() {
        *s = profile_slug.to_string();
    }
    let buttons = if join_ok {
        vec![
            activity::Button::new("Зайти на сервер", join_url),
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
        .details(details)
        .state(state)
        .assets(
            activity::Assets::new()
                .large_image(big)
                .large_text(big_text)
                .small_image("logo")
                .small_text(if playing { "В игре" } else { "В лаунчере" }),
        )
        .buttons(buttons);
    if let Some(ts) = *since {
        act = act.timestamps(activity::Timestamps::new().start(ts));
    }

    if let Err(e) = client.set_activity(act) {
        note_err(format!("активность не поставилась: {}", e));
        let _ = client.close();
        *guard = None;
        return;
    }
    // The crate ignores Discord's reply, so rejected activities would pass
    // silently: read the response frame ourselves.
    match client.recv() {
        Ok((_, val)) => {
            if val["evt"].as_str() == Some("ERROR") {
                note_err(format!("Discord отклонил активность: {}", val["data"]["message"].as_str().unwrap_or("?")));
                return;
            }
        }
        Err(e) => note_err(format!("нет ответа от Discord: {}", e)),
    }
    if let Ok(mut ok) = LAST_OK.lock() {
        *ok = format!("{} · {}", details, state);
    }
    if let Ok(mut e) = LAST_ERROR.lock() {
        e.clear();
    }
}

pub fn clear() {
    let mut guard = match CLIENT.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some(c) = guard.as_mut() {
        let _ = c.clear_activity();
    }
    if let Ok(mut s) = SINCE.lock() {
        *s = None;
    }
}

#[cfg(test)]
mod tests {
    use super::profile_url;

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
}
