use base64::Engine as _;
use serde_json::{json, Value};
use sha1::{Digest as _, Sha1};
use std::sync::Arc;
use std::time::Instant;

pub const PATH: &str = "/media";
pub const MAX_MESSAGE: usize = 64 * 1024;
pub const MAX_TEXT: usize = 128;
pub const MAX_COVER: u32 = 64;
pub const KEY_BYTES: usize = 32;
const ACCEPT_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const NUDGE_MILLIS: u64 = 1500;

pub const OP_TEXT: u8 = 0x1;
pub const OP_CLOSE: u8 = 0x8;
pub const OP_PING: u8 = 0x9;
pub const OP_PONG: u8 = 0xA;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Play,
    Pause,
    Next,
    Previous,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Cover {
    pub key: String,
    pub size: u32,
    pub argb: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub app: String,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub playing: bool,
    pub sampled: Instant,
    pub cover: Option<Arc<Cover>>,
}

impl NowPlaying {
    pub fn position_at(&self, now: Instant) -> u64 {
        let at = if self.playing {
            self.position_ms.saturating_add(now.saturating_duration_since(self.sampled).as_millis() as u64)
        } else {
            self.position_ms
        };
        if self.duration_ms > 0 { at.min(self.duration_ms) } else { at }
    }

    /// A reading that only confirms where the track was expected to be is not worth a message.
    pub fn same_as(&self, other: &NowPlaying) -> bool {
        self.title == other.title
            && self.artist == other.artist
            && self.app == other.app
            && self.playing == other.playing
            && self.duration_ms == other.duration_ms
            && self.cover.as_ref().map(|c| &c.key) == other.cover.as_ref().map(|c| &c.key)
            && self.position_at(other.sampled).abs_diff(other.position_ms) < NUDGE_MILLIS
    }
}

pub fn clip(text: &str) -> String {
    text.trim().chars().filter(|c| !c.is_control()).take(MAX_TEXT).collect()
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

pub fn new_key() -> String {
    use aes_gcm::aead::rand_core::RngCore;
    let mut bytes = [0u8; KEY_BYTES];
    aes_gcm::aead::OsRng.fill_bytes(&mut bytes);
    hex(&bytes)
}

pub fn state_message(now_playing: Option<&NowPlaying>, now: Instant) -> String {
    match now_playing {
        Some(np) if !np.title.is_empty() => json!({
            "type": "state",
            "title": clip(&np.title),
            "artist": clip(&np.artist),
            "app": clip(&np.app),
            "positionMs": np.position_at(now),
            "durationMs": np.duration_ms,
            "playing": np.playing,
            "coverKey": np.cover.as_ref().map(|c| c.key.clone()),
        })
        .to_string(),
        _ => json!({ "type": "state", "title": "" }).to_string(),
    }
}

pub fn cover_message(cover: &Cover) -> String {
    json!({
        "type": "cover",
        "key": cover.key,
        "size": cover.size,
        "argb": base64::engine::general_purpose::STANDARD.encode(&cover.argb),
    })
    .to_string()
}

pub fn parse_command(text: &str) -> Option<Command> {
    if text.len() > MAX_MESSAGE {
        return None;
    }
    let value: Value = serde_json::from_str(text).ok()?;
    if value.get("type")?.as_str()? != "command" {
        return None;
    }
    match value.get("command")?.as_str()? {
        "play" => Some(Command::Play),
        "pause" => Some(Command::Pause),
        "next" => Some(Command::Next),
        "previous" => Some(Command::Previous),
        _ => None,
    }
}

pub fn cover_key(source: &[u8]) -> String {
    hex(&Sha1::digest(source))
}

/// Both sides are compared in full so the time taken does not reveal how much of the key matched.
pub fn key_matches(offered: &str, key: &str) -> bool {
    let (a, b) = (offered.as_bytes(), key.as_bytes());
    if a.len() != b.len() || b.is_empty() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    BadRequest,
    Unauthorized,
    NotFound,
}

pub fn accept_value(client_key: &str) -> String {
    let mut sha = Sha1::new();
    sha.update(client_key.as_bytes());
    sha.update(ACCEPT_GUID.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(sha.finalize())
}

/// Checks an upgrade request head and returns the Sec-WebSocket-Accept value to answer with.
pub fn check_upgrade(head: &str, key: &str) -> Result<String, Refusal> {
    let mut lines = head.split("\r\n");
    let request = lines.next().unwrap_or_default();
    let mut parts = request.split(' ');
    let (method, target, version) = (parts.next(), parts.next(), parts.next());
    if method != Some("GET") || !version.is_some_and(|v| v.starts_with("HTTP/1.1")) {
        return Err(Refusal::BadRequest);
    }
    let (mut upgrade, mut connection, mut client_key, mut authorization, mut ws_version) =
        (false, false, None, None, None);
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "upgrade" => upgrade = value.eq_ignore_ascii_case("websocket"),
            "connection" => connection = value.to_ascii_lowercase().split(',').any(|t| t.trim() == "upgrade"),
            "sec-websocket-key" => client_key = Some(value.to_string()),
            "sec-websocket-version" => ws_version = Some(value.to_string()),
            "authorization" => authorization = Some(value.to_string()),
            _ => {}
        }
    }
    let offered = authorization.as_deref().and_then(|a| a.strip_prefix("Bearer ")).map(str::trim);
    if !offered.is_some_and(|o| key_matches(o, key)) {
        return Err(Refusal::Unauthorized);
    }
    if target != Some(PATH) {
        return Err(Refusal::NotFound);
    }
    let client_key = client_key.filter(|k| !k.is_empty() && k.len() <= 64);
    match (upgrade && connection && ws_version.as_deref() == Some("13"), client_key) {
        (true, Some(k)) => Ok(accept_value(&k)),
        _ => Err(Refusal::BadRequest),
    }
}

pub fn switching(accept: &str) -> String {
    format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n",
        accept
    )
}

pub fn refusal(reason: &Refusal) -> &'static str {
    match reason {
        Refusal::BadRequest => "HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        Refusal::Unauthorized => "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
        Refusal::NotFound => "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    }
}

/// A server frame: unmasked, never fragmented.
pub fn frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 10);
    out.push(0x80 | opcode);
    match payload.len() {
        n if n < 126 => out.push(n as u8),
        n if n <= 0xFFFF => {
            out.push(126);
            out.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            out.push(127);
            out.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    out.extend_from_slice(payload);
    out
}

pub fn close_frame(code: u16) -> Vec<u8> {
    frame(OP_CLOSE, &code.to_be_bytes())
}

#[derive(Debug, PartialEq, Eq)]
pub struct FrameHead {
    pub fin: bool,
    pub opcode: u8,
    pub length: u64,
    pub extra: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    Reserved,
    Unmasked,
    TooBig,
    Control,
}

/// Reads the first two bytes of a client frame; `extra` is how many length bytes follow.
pub fn frame_head(first: u8, second: u8) -> Result<FrameHead, FrameError> {
    if first & 0x70 != 0 {
        return Err(FrameError::Reserved);
    }
    if second & 0x80 == 0 {
        return Err(FrameError::Unmasked);
    }
    let fin = first & 0x80 != 0;
    let opcode = first & 0x0F;
    let (length, extra) = match second & 0x7F {
        126 => (0, 2),
        127 => (0, 8),
        n => (n as u64, 0),
    };
    if opcode & 0x08 != 0 && (!fin || extra != 0) {
        return Err(FrameError::Control);
    }
    Ok(FrameHead { fin, opcode, length, extra })
}

pub fn frame_length(head: &FrameHead, extended: &[u8]) -> Result<usize, FrameError> {
    let length = if head.extra == 0 {
        head.length
    } else {
        extended.iter().fold(0u64, |acc, b| (acc << 8) | *b as u64)
    };
    if length > MAX_MESSAGE as u64 {
        return Err(FrameError::TooBig);
    }
    Ok(length as usize)
}

pub fn unmask(mask: [u8; 4], payload: &mut [u8]) {
    for (i, byte) in payload.iter_mut().enumerate() {
        *byte ^= mask[i & 3];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const KEY: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    fn head(auth: Option<&str>, path: &str) -> String {
        let mut h = format!(
            "GET {} HTTP/1.1\r\nHost: 127.0.0.1:5000\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n",
            path
        );
        if let Some(a) = auth {
            h.push_str(&format!("Authorization: {}\r\n", a));
        }
        h.push_str("\r\n");
        h
    }

    fn track(playing: bool, at: Instant) -> NowPlaying {
        NowPlaying {
            title: "Blinding Lights".into(),
            artist: "The Weeknd".into(),
            app: "Spotify".into(),
            position_ms: 72_000,
            duration_ms: 200_000,
            playing,
            sampled: at,
            cover: None,
        }
    }

    #[test]
    fn upgrade_verdicts() {
        let cases: [(&str, String, Result<String, Refusal>); 7] = [
            ("the right key upgrades with the RFC 6455 sample accept", head(Some(&format!("Bearer {}", KEY)), PATH),
                Ok("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=".into())),
            ("no key is the reason the server exists to refuse", head(None, PATH), Err(Refusal::Unauthorized)),
            ("a wrong key of the same length must not pass", head(Some(&format!("Bearer {}", KEY.replace('0', "1"))), PATH),
                Err(Refusal::Unauthorized)),
            ("a key prefix must not pass", head(Some(&format!("Bearer {}", &KEY[..32])), PATH), Err(Refusal::Unauthorized)),
            ("another scheme is not the bearer key", head(Some(&format!("Basic {}", KEY)), PATH), Err(Refusal::Unauthorized)),
            ("the key is checked before the path, so paths cannot be probed", head(None, "/other"), Err(Refusal::Unauthorized)),
            ("only /media is served", head(Some(&format!("Bearer {}", KEY)), "/other"), Err(Refusal::NotFound)),
        ];
        for (why, request, expected) in cases {
            assert_eq!(check_upgrade(&request, KEY), expected, "{}", why);
        }
        let plain = "GET /media HTTP/1.1\r\nAuthorization: Bearer ".to_string() + KEY + "\r\n\r\n";
        assert_eq!(check_upgrade(&plain, KEY), Err(Refusal::BadRequest), "a plain HTTP request is not an upgrade");
    }

    #[test]
    fn empty_key_never_matches() {
        assert!(!key_matches("", ""), "an empty launcher key would let every connection in");
    }

    #[test]
    fn keys_are_fresh_hex() {
        let (a, b) = (new_key(), new_key());
        assert_eq!(a.len(), KEY_BYTES * 2, "the mod and docs/media.md expect 32 bytes in hex");
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()), "the key travels in an env var and a header");
        assert_ne!(a, b, "a key repeated between launches could be reused by another process");
    }

    #[test]
    fn command_verdicts() {
        let cases = [
            (r#"{"type":"command","command":"play"}"#, Some(Command::Play), "play"),
            (r#"{"type":"command","command":"pause"}"#, Some(Command::Pause), "pause"),
            (r#"{"type":"command","command":"next","extra":1}"#, Some(Command::Next), "extra fields are ignored"),
            (r#"{"type":"command","command":"previous"}"#, Some(Command::Previous), "previous"),
            (r#"{"type":"command","command":"stop"}"#, None, "only the four commands of the protocol reach the player"),
            (r#"{"type":"state","command":"play"}"#, None, "a command needs its own type"),
            ("not json", None, "garbage is ignored, not fatal"),
        ];
        for (text, expected, why) in cases {
            assert_eq!(parse_command(text), expected, "{}", why);
        }
    }

    #[test]
    fn state_runs_on_while_playing() {
        let at = Instant::now();
        let later = at + Duration::from_millis(3000);
        let playing: Value = serde_json::from_str(&state_message(Some(&track(true, at)), later)).unwrap();
        assert_eq!(playing["positionMs"], 75_000, "a pulse must carry where the track is now, not where it was read");
        assert_eq!(playing["durationMs"], 200_000);
        assert_eq!(playing["playing"], true);
        assert_eq!(playing["coverKey"], Value::Null, "no cover is null, as docs/media.md says");
        let paused: Value = serde_json::from_str(&state_message(Some(&track(false, at)), later)).unwrap();
        assert_eq!(paused["positionMs"], 72_000, "a paused track stays where it stopped");
        let end = at + Duration::from_secs(1000);
        let past: Value = serde_json::from_str(&state_message(Some(&track(true, at)), end)).unwrap();
        assert_eq!(past["positionMs"], 200_000, "the position never runs past the end");
    }

    #[test]
    fn nothing_playing_is_an_empty_title() {
        let none: Value = serde_json::from_str(&state_message(None, Instant::now())).unwrap();
        assert_eq!(none, json!({"type": "state", "title": ""}), "the mod reads an empty title as nothing plays");
    }

    #[test]
    fn strings_are_clipped() {
        let mut long = track(true, Instant::now());
        long.title = "я".repeat(300);
        long.artist = "a\u{0}b".into();
        let value: Value = serde_json::from_str(&state_message(Some(&long), Instant::now())).unwrap();
        assert_eq!(value["title"].as_str().unwrap().chars().count(), MAX_TEXT, "strings are cut to 128 characters");
        assert_eq!(value["artist"], "ab", "control characters never reach the HUD font");
    }

    #[test]
    fn cover_message_is_base64_argb() {
        let cover = Cover { key: cover_key(b"jpeg"), size: 1, argb: vec![0xFF, 1, 2, 3] };
        let value: Value = serde_json::from_str(&cover_message(&cover)).unwrap();
        assert_eq!(value["argb"], "/wECAw==");
        assert_eq!(value["size"], 1);
        assert_eq!(value["key"].as_str().unwrap().len(), 40, "the key is a hex SHA-1");
    }

    #[test]
    fn same_reading_is_not_news() {
        let at = Instant::now();
        let first = track(true, at);
        let mut drift = track(true, at + Duration::from_millis(2000));
        drift.position_ms = 74_300;
        assert!(first.same_as(&drift), "a timeline tick that agrees with the clock must not spam the game");
        let mut seek = drift.clone();
        seek.position_ms = 10_000;
        assert!(!first.same_as(&seek), "a seek has to reach the game");
        let mut pause = drift.clone();
        pause.playing = false;
        assert!(!first.same_as(&pause), "a pause has to reach the game");
    }

    #[test]
    fn frames_round_trip() {
        assert_eq!(frame(OP_TEXT, b"hi"), vec![0x81, 2, b'h', b'i']);
        let medium = frame(OP_TEXT, &[0u8; 300]);
        assert_eq!(&medium[..4], &[0x81, 126, 0x01, 0x2C], "lengths over 125 use the 16-bit form");
        assert_eq!(close_frame(1000), vec![0x88, 2, 0x03, 0xE8]);
        let head = frame_head(0x81, 0x80 | 126).unwrap();
        assert_eq!(frame_length(&head, &[0x01, 0x2C]), Ok(300));
        let mut payload = *b"ok";
        let mask = [1, 2, 3, 4];
        unmask(mask, &mut payload);
        unmask(mask, &mut payload);
        assert_eq!(&payload, b"ok");
    }

    #[test]
    fn frame_head_verdicts() {
        let cases = [
            (0x81, 0x05, Err(FrameError::Unmasked), "a client frame must be masked"),
            (0xC1, 0x85, Err(FrameError::Reserved), "no extension was negotiated"),
            (0x09, 0x80, Err(FrameError::Control), "control frames are never fragmented"),
            (0x89, 0x80 | 126, Err(FrameError::Control), "control frames are short"),
        ];
        for (first, second, expected, why) in cases {
            assert_eq!(frame_head(first, second), expected, "{}", why);
        }
        let big = frame_head(0x81, 0x80 | 127).unwrap();
        assert_eq!(frame_length(&big, &[0, 0, 0, 0, 0, 1, 0, 1]), Err(FrameError::TooBig), "messages stop at 64 KB");
    }
}
