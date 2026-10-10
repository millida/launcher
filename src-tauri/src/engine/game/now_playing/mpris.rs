use super::cover::{CoverCache, MAX_SOURCE_BYTES};
use super::protocol::{clip, Command, NowPlaying};
use super::{Control, Controller, Reading};
use futures::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{mpsc, watch};
use zbus::zvariant::{OwnedValue, Value};
use zbus::{Connection, MatchRule, MessageStream};

const PREFIX: &str = "org.mpris.MediaPlayer2.";
const PATH: &str = "/org/mpris/MediaPlayer2";
const PLAYER: &str = "org.mpris.MediaPlayer2.Player";

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
                    if let Some(name) = &player {
                        let _ = conn.call_method(Some(name.as_str()), PATH, Some(PLAYER), method(command), &()).await;
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

fn method(command: Command) -> &'static str {
    match command {
        Command::Play => "Play",
        Command::Pause => "Pause",
        Command::Next => "Next",
        Command::Previous => "Previous",
    }
}

struct Candidate {
    name: String,
    playing: bool,
    properties: HashMap<String, OwnedValue>,
}

async fn refresh(conn: &Connection, publish: &watch::Sender<Reading>, covers: &mut CoverCache) -> Option<String> {
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
    chosen.map(|c| c.name)
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
    let metadata = candidate.properties.get("Metadata").map(|v| entries(v)).unwrap_or_default();
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
    fn remote_art_is_not_fetched() {
        assert!(local_art("https://i.scdn.co/image/abc").is_none(), "the launcher must not fetch URLs a player names");
    }
}
