use super::cover::{CoverCache, MAX_SOURCE_BYTES};
use super::protocol::{clip, Command, NowPlaying};
use super::{Control, Controller, Reading};
use futures::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use zbus::zvariant::{ObjectPath, OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream};

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";
const NO_TRACK: &str = "/org/mpris/MediaPlayer2/TrackList/NoTrack";

pub(super) fn spawn(publish: watch::Sender<Reading>) -> Option<Controller> {
    let (tx, rx) = mpsc::unbounded_channel();
    tauri::async_runtime::spawn(run(rx, publish));
    Some(Box::new(move |control| {
        let _ = tx.send(control);
    }))
}

async fn run(mut control: mpsc::UnboundedReceiver<Control>, publish: watch::Sender<Reading>) {
    let Ok(conn) = Connection::session().await else { return };
    let Some(mut signals) = signals(&conn).await else { return };
    let mut covers = CoverCache::default();
    let mut player = refresh(&conn, &publish, &mut covers).await;
    loop {
        tokio::select! {
            next = control.recv() => match next {
                Some(Control::Command(command)) => {
                    if let Some(target) = &player {
                        send(&conn, target, command).await;
                    }
                }
                Some(Control::Stop) | None => return,
            },
            signal = signals.next() => {
                if signal.is_none() {
                    return;
                }
                player = refresh(&conn, &publish, &mut covers).await;
            }
        }
    }
}

async fn signals(conn: &Connection) -> Option<futures::stream::SelectAll<std::pin::Pin<Box<MessageStream>>>> {
    let rules = [
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface("org.freedesktop.DBus.Properties")
            .ok()?
            .member("PropertiesChanged")
            .ok()?
            .path(PATH)
            .ok()?
            .build(),
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface(PLAYER)
            .ok()?
            .member("Seeked")
            .ok()?
            .build(),
        MatchRule::builder()
            .msg_type(zbus::message::Type::Signal)
            .interface("org.freedesktop.DBus")
            .ok()?
            .member("NameOwnerChanged")
            .ok()?
            .arg0ns("org.mpris.MediaPlayer2")
            .ok()?
            .build(),
    ];
    let mut streams = Vec::new();
    for rule in rules {
        streams.push(Box::pin(MessageStream::for_match_rule(rule, conn, Some(64)).await.ok()?));
    }
    Some(futures::stream::select_all(streams))
}

struct Target {
    name: String,
    track: Option<String>,
}

async fn send(conn: &Connection, target: &Target, command: Command) {
    let name = Some(target.name.as_str());
    let _ = match command {
        Command::Play => conn.call_method(name, PATH, Some(PLAYER), "Play", &()).await,
        Command::Pause => conn.call_method(name, PATH, Some(PLAYER), "Pause", &()).await,
        Command::Next => conn.call_method(name, PATH, Some(PLAYER), "Next", &()).await,
        Command::Previous => conn.call_method(name, PATH, Some(PLAYER), "Previous", &()).await,
        Command::Seek(ms) => {
            let Some(track) = target.track.as_deref().and_then(|t| ObjectPath::try_from(t).ok()) else { return };
            conn.call_method(name, PATH, Some(PLAYER), "SetPosition", &(track, micros(ms))).await
        }
    };
}

fn micros(ms: u64) -> i64 {
    i64::try_from(ms).unwrap_or(i64::MAX).saturating_mul(1000)
}

struct Candidate {
    name: String,
    playing: bool,
    properties: HashMap<String, OwnedValue>,
}

async fn refresh(conn: &Connection, publish: &watch::Sender<Reading>, covers: &mut CoverCache) -> Option<Target> {
    let chosen = choose(conn).await;
    let reading = chosen.as_ref().and_then(|c| reading(c, covers));
    publish.send_if_modified(|current| {
        let same = match (current.as_deref(), reading.as_deref()) {
            (None, None) => true,
            (Some(a), Some(b)) => a.same_as(b),
            _ => false,
        };
        if !same {
            *current = reading;
        }
        !same
    });
    chosen.map(|c| Target { track: track_id(&c), name: c.name })
}

fn metadata(candidate: &Candidate) -> HashMap<String, Value<'static>> {
    candidate.properties.get("Metadata").map(|v| entries(v)).unwrap_or_default()
}

/// SetPosition names the track it means, so a seek that arrives after the track changed is dropped by the player.
fn track_id(candidate: &Candidate) -> Option<String> {
    metadata(candidate).get("mpris:trackid").and_then(|v| text(v)).and_then(|id| known_track(&id))
}

fn known_track(id: &str) -> Option<String> {
    (id != NO_TRACK && ObjectPath::try_from(id).is_ok()).then(|| id.to_string())
}

fn can_seek(candidate: &Candidate, duration_ms: u64) -> bool {
    let flag = candidate.properties.get("CanSeek").is_some_and(|v| matches!(plain(v), Value::Bool(true)));
    seekable(flag, duration_ms, track_id(candidate).as_deref())
}

fn seekable(flag: bool, duration_ms: u64, track: Option<&str>) -> bool {
    flag && duration_ms > 0 && track.is_some()
}

/// The player that is playing wins; otherwise the first paused one.
async fn choose(conn: &Connection) -> Option<Candidate> {
    let names: Vec<String> = conn
        .call_method(Some("org.freedesktop.DBus"), "/org/freedesktop/DBus", Some("org.freedesktop.DBus"), "ListNames", &())
        .await
        .ok()?
        .body()
        .deserialize()
        .ok()?;
    let mut paused = None;
    for name in names.into_iter().filter(|n| n.starts_with(PREFIX)) {
        let Ok(reply) = conn
            .call_method(Some(name.as_str()), PATH, Some("org.freedesktop.DBus.Properties"), "GetAll", &(PLAYER,))
            .await
        else {
            continue;
        };
        let Ok(properties) = reply.body().deserialize::<HashMap<String, OwnedValue>>() else { continue };
        let status = properties.get("PlaybackStatus").and_then(|v| text(v)).unwrap_or_default();
        match status.as_str() {
            "Playing" => return Some(Candidate { name, playing: true, properties }),
            "Paused" if paused.is_none() => paused = Some(Candidate { name, playing: false, properties }),
            _ => {}
        }
    }
    paused
}

fn reading(candidate: &Candidate, covers: &mut CoverCache) -> Reading {
    let metadata = metadata(candidate);
    let title = metadata.get("xesam:title").and_then(|v| text(v)).unwrap_or_default();
    if title.trim().is_empty() {
        return None;
    }
    let artist = metadata.get("xesam:artist").map(|v| texts(v).join(", ")).unwrap_or_default();
    let duration_ms = metadata.get("mpris:length").and_then(|v| number(v)).map(|us| us.max(0) as u64 / 1000).unwrap_or(0);
    let position_ms = candidate.properties.get("Position").and_then(|v| number(v)).map(|us| us.max(0) as u64 / 1000).unwrap_or(0);
    let art = metadata.get("mpris:artUrl").and_then(|v| text(v)).and_then(|url| local_art(&url));
    Some(Arc::new(NowPlaying {
        title: clip(&title),
        artist: clip(&artist),
        app: clip(app_name(&candidate.name)),
        position_ms: if duration_ms > 0 { position_ms.min(duration_ms) } else { position_ms },
        duration_ms,
        playing: candidate.playing,
        can_seek: can_seek(candidate, duration_ms),
        sampled: Instant::now(),
        cover: covers.get(art.as_deref()),
    }))
}

fn app_name(bus_name: &str) -> &str {
    let tail = bus_name.strip_prefix(PREFIX).unwrap_or(bus_name);
    tail.split('.').next().unwrap_or(tail)
}

/// Only art the player saved to disk: fetching a remote URL would make the launcher a fetcher for any player.
fn local_art(url: &str) -> Option<Vec<u8>> {
    let path = url::Url::parse(url).ok().filter(|u| u.scheme() == "file")?.to_file_path().ok()?;
    let meta = std::fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() > MAX_SOURCE_BYTES as u64 {
        return None;
    }
    std::fs::read(path).ok()
}

fn plain<'a>(value: &'a Value<'a>) -> &'a Value<'a> {
    match value {
        Value::Value(inner) => plain(inner),
        other => other,
    }
}

fn text(value: &Value<'_>) -> Option<String> {
    match plain(value) {
        Value::Str(s) => Some(s.as_str().to_string()),
        Value::ObjectPath(p) => Some(p.as_str().to_string()),
        _ => None,
    }
}

fn texts(value: &Value<'_>) -> Vec<String> {
    match plain(value) {
        Value::Array(items) => items.inner().iter().filter_map(text).collect(),
        other => text(other).into_iter().collect(),
    }
}

fn number(value: &Value<'_>) -> Option<i64> {
    match plain(value) {
        Value::I64(n) => Some(*n),
        Value::U64(n) => i64::try_from(*n).ok(),
        Value::I32(n) => Some(*n as i64),
        Value::U32(n) => Some(*n as i64),
        _ => None,
    }
}

fn entries(value: &Value<'_>) -> HashMap<String, Value<'static>> {
    let mut out = HashMap::new();
    if let Value::Dict(dict) = plain(value) {
        for (key, item) in dict.iter() {
            if let (Some(key), Ok(item)) = (text(key), item.try_to_owned()) {
                out.insert(key, Value::from(item));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_names() {
        assert_eq!(app_name("org.mpris.MediaPlayer2.spotify"), "spotify");
        assert_eq!(app_name("org.mpris.MediaPlayer2.firefox.instance_1_42"), "firefox", "instance suffixes are not names");
    }

    #[test]
    fn seek_micros() {
        assert_eq!(micros(72_000), 72_000_000, "MPRIS positions are in microseconds");
        assert_eq!(micros(u64::MAX), i64::MAX, "an absurd target saturates instead of wrapping to a negative position");
    }

    #[test]
    fn can_seek_verdicts() {
        let cases = [
            ((true, 200_000, Some("/track/1")), true, "a player that seeks and names its track"),
            ((false, 200_000, Some("/track/1")), false, "CanSeek false keeps the bar static"),
            ((true, 200_000, None), false, "SetPosition needs the track id, without it a seek cannot be sent"),
            ((true, 200_000, Some(NO_TRACK)), false, "NoTrack is no track"),
            ((true, 0, Some("/track/1")), false, "a stream without length has nowhere to seek to"),
        ];
        for ((flag, duration, track), expected, why) in cases {
            assert_eq!(seekable(flag, duration, track.and_then(known_track).as_deref()), expected, "{}", why);
        }
    }

    #[test]
    fn remote_art_is_not_fetched() {
        assert!(local_art("https://i.scdn.co/image/abc").is_none(), "the launcher must not fetch URLs a player names");
    }
}
