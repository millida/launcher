use super::cover::{CoverCache, MAX_SOURCE_BYTES};
use super::protocol::{clip, Command, Cover, NowPlaying};
use super::{Control, Controller, Reading};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

const TICKS_PER_MS: i64 = 10_000;
const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

enum Event {
    Control(Control),
    Session,
    Media,
    Playback,
}

pub(super) fn spawn(publish: watch::Sender<Reading>) -> Option<Controller> {
    let (tx, rx) = channel();
    let events = tx.clone();
    std::thread::Builder::new()
        .name("millida-now-playing".into())
        .spawn(move || {
            let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            run(&events, rx, &publish);
            if com.is_ok() {
                unsafe { CoUninitialize() };
            }
        })
        .ok()?;
    Some(Box::new(move |control| {
        let _ = tx.send(Event::Control(control));
    }))
}

struct Media {
    title: String,
    artist: String,
    cover: Option<Arc<Cover>>,
}

struct Watched {
    session: Session,
    media: i64,
    playback: i64,
    timeline: i64,
}

impl Watched {
    fn attach(manager: &Manager, events: &Sender<Event>) -> Option<Watched> {
        let session = manager.GetCurrentSession().ok()?;
        let media = session.MediaPropertiesChanged(&notify(events, || Event::Media)).ok()?;
        let playback = session.PlaybackInfoChanged(&notify(events, || Event::Playback)).unwrap_or_default();
        let timeline = session.TimelinePropertiesChanged(&notify(events, || Event::Playback)).unwrap_or_default();
        Some(Watched { session, media, playback, timeline })
    }

    fn detach(self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.media);
        let _ = self.session.RemovePlaybackInfoChanged(self.playback);
        let _ = self.session.RemoveTimelinePropertiesChanged(self.timeline);
    }
}

fn notify<S, A>(events: &Sender<Event>, event: fn() -> Event) -> TypedEventHandler<S, A>
where
    S: windows::core::RuntimeType + 'static,
    A: windows::core::RuntimeType + 'static,
{
    let events = events.clone();
    TypedEventHandler::new(move |_, _| {
        let _ = events.send(event());
        Ok(())
    })
}

fn run(events: &Sender<Event>, rx: Receiver<Event>, publish: &watch::Sender<Reading>) {
    let Ok(manager) = Manager::RequestAsync().and_then(|op| op.get()) else { return };
    let session_token = manager.CurrentSessionChanged(&notify(events, || Event::Session)).ok();
    let mut covers = CoverCache::default();
    let mut watched = Watched::attach(&manager, events);
    let mut media = watched.as_ref().and_then(|w| read_media(&w.session, &mut covers));
    publish_reading(publish, read(watched.as_ref(), media.as_ref()));
    while let Ok(first) = rx.recv() {
        let (mut session_changed, mut media_changed) = (false, false);
        let mut next = Some(first);
        while let Some(event) = next {
            match event {
                Event::Control(Control::Stop) => {
                    if let Some(w) = watched.take() {
                        w.detach();
                    }
                    if let Some(token) = session_token {
                        let _ = manager.RemoveCurrentSessionChanged(token);
                    }
                    return;
                }
                Event::Control(Control::Command(command)) => {
                    if let Some(w) = &watched {
                        send_command(&w.session, command);
                    }
                }
                Event::Session => session_changed = true,
                Event::Media => media_changed = true,
                Event::Playback => {}
            }
            next = rx.try_recv().ok();
        }
        if session_changed {
            if let Some(w) = watched.take() {
                w.detach();
            }
            watched = Watched::attach(&manager, events);
            media_changed = true;
        }
        if media_changed {
            media = watched.as_ref().and_then(|w| read_media(&w.session, &mut covers));
        }
        publish_reading(publish, read(watched.as_ref(), media.as_ref()));
    }
}

fn publish_reading(publish: &watch::Sender<Reading>, reading: Reading) {
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
}

fn send_command(session: &Session, command: Command) {
    let _ = match command {
        Command::Play => session.TryPlayAsync(),
        Command::Pause => session.TryPauseAsync(),
        Command::Next => session.TrySkipNextAsync(),
        Command::Previous => session.TrySkipPreviousAsync(),
    };
}

fn read_media(session: &Session, covers: &mut CoverCache) -> Option<Media> {
    let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = properties.Title().map(|t| t.to_string()).unwrap_or_default();
    let artist = properties.Artist().map(|a| a.to_string()).unwrap_or_default();
    let cover = covers.get(thumbnail(&properties).as_deref());
    Some(Media { title, artist, cover })
}

fn thumbnail(
    properties: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<Vec<u8>> {
    let stream = properties.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > MAX_SOURCE_BYTES as u64 {
        return None;
    }
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()?;
    let mut bytes = vec![0u8; loaded as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    Some(bytes)
}

fn read(watched: Option<&Watched>, media: Option<&Media>) -> Reading {
    let (watched, media) = (watched?, media?);
    if media.title.trim().is_empty() {
        return None;
    }
    let session = &watched.session;
    let playing = session
        .GetPlaybackInfo()
        .and_then(|p| p.PlaybackStatus())
        .is_ok_and(|s| s == Status::Playing);
    let (position_ms, duration_ms) = session
        .GetTimelineProperties()
        .ok()
        .and_then(|t| {
            Some(timeline(
                t.StartTime().ok()?.Duration,
                t.EndTime().ok()?.Duration,
                t.Position().ok()?.Duration,
                t.LastUpdatedTime().ok()?.UniversalTime,
                playing,
                now_ticks(),
            ))
        })
        .unwrap_or((0, 0));
    let app = session.SourceAppUserModelId().map(|id| app_name(&id.to_string())).unwrap_or_default();
    Some(Arc::new(NowPlaying {
        title: clip(&media.title),
        artist: clip(&media.artist),
        app,
        position_ms,
        duration_ms,
        playing,
        sampled: Instant::now(),
        cover: media.cover.clone(),
    }))
}

fn now_ticks() -> i64 {
    let since = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    UNIX_EPOCH_TICKS + (since.as_nanos() / 100) as i64
}

/// SMTC reports the position as of its last update, so a playing track has moved on since.
fn timeline(start: i64, end: i64, position: i64, updated: i64, playing: bool, now: i64) -> (u64, u64) {
    let duration = (end - start).max(0) / TICKS_PER_MS;
    let mut at = (position - start).max(0) / TICKS_PER_MS;
    if playing && updated > 0 {
        at += (now - updated).max(0) / TICKS_PER_MS;
    }
    if duration > 0 {
        at = at.min(duration);
    }
    (at as u64, duration as u64)
}

fn app_name(id: &str) -> String {
    let tail = id.rsplit(['\\', '/', '!']).next().unwrap_or(id);
    let name = tail.strip_suffix(".exe").or_else(|| tail.strip_suffix(".EXE")).unwrap_or(tail);
    clip(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_verdicts() {
        let s = 10_000_000;
        let cases = [
            ((0, 200 * s, 72 * s, 1000, true, 1000 + 3 * s), (75_000, 200_000), "playing runs on from the last update"),
            ((0, 200 * s, 72 * s, 1000, false, 1000 + 3 * s), (72_000, 200_000), "paused stays put"),
            ((0, 200 * s, 199 * s, 1000, true, 1000 + 30 * s), (200_000, 200_000), "never past the end"),
            ((0, 200 * s, 72 * s, 1000, true, 0), (72_000, 200_000), "a clock behind the update adds nothing"),
            ((0, 0, 5 * s, 0, true, 50 * s), (5_000, 0), "a live stream without length keeps its position"),
        ];
        for ((start, end, position, updated, playing, now), expected, why) in cases {
            assert_eq!(timeline(start, end, position, updated, playing, now), expected, "{}", why);
        }
    }

    #[test]
    fn app_names() {
        let cases = [
            ("Spotify.exe", "Spotify"),
            ("C:\\Program Files\\Yandex\\browser.exe", "browser"),
            ("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify", "Spotify"),
            ("Chrome", "Chrome"),
        ];
        for (id, expected) in cases {
            assert_eq!(app_name(id), expected, "the island shows the player's name, not its path: {}", id);
        }
    }
}
