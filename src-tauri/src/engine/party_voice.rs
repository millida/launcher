//! Party voice in the lobby over the Millida voice relay, the same room the
//! game's mod joins under the same player id. The webview names only a party
//! and its members; the ticket, the secret and the relay address stay here.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use base64::Engine as _;
use millida_voice::client::{Config, Events, VoiceClient};
use millida_voice::dsp::{Noise, Processing};
use millida_voice::link::Session;
use millida_voice::party::{party_voice_player, valid_party_id};
use millida_voice::wire::{parse_uuid, Uuid};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::engine::millida_api_auth;

pub const STATE_EVENT: &str = "party-voice://state";
pub const LEVELS_EVENT: &str = "party-voice://levels";

const CONNECT_WAIT: Duration = Duration::from_secs(8);
const RENEW_BEFORE: Duration = Duration::from_secs(10 * 60);
const MIN_RENEW_WAIT: Duration = Duration::from_secs(60);
const MAX_MEMBERS: usize = 16;

struct Active {
    party: String,
    generation: u64,
    client: VoiceClient,
}

static ACTIVE: Mutex<Option<Active>> = Mutex::new(None);
static MEMBERS: Mutex<Option<HashMap<Uuid, String>>> = Mutex::new(None);
static BOUND_PARTY: Mutex<Option<String>> = Mutex::new(None);
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    party: String,
    state: &'static str,
    reason: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerLevel {
    user_id: String,
    level: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelsPayload {
    me: f32,
    speakers: Vec<SpeakerLevel>,
}

/// The launcher's sound settings as the webview stores them: device labels,
/// not webview device ids, because cpal knows devices only by name.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioPrefs {
    pub input: Option<String>,
    pub output: Option<String>,
    pub noise: String,
    pub agc: bool,
    pub mic_gain: u32,
}

const MAX_DEVICE_LABEL: usize = 256;

fn device_label(raw: Option<String>) -> Result<Option<String>, String> {
    match raw {
        None => Ok(None),
        Some(l) if l.chars().count() > MAX_DEVICE_LABEL || l.chars().any(char::is_control) => {
            Err("Неверное имя звукового устройства".into())
        }
        Some(l) => Ok(Some(l.trim().to_string()).filter(|l| !l.is_empty())),
    }
}

fn processing_of(prefs: &AudioPrefs) -> Result<Processing, String> {
    let noise = Noise::parse(&prefs.noise).ok_or("Неизвестный режим шумоподавления")?;
    if prefs.mic_gain > 300 {
        return Err("Громкость микрофона — от 0 до 300 %".into());
    }
    Ok(Processing { noise, agc: prefs.agc, gain: prefs.mic_gain as f32 / 100.0 })
}

/// The party the next game launch should join by voice: the mod reads it from
/// MILLIDA_PARTY and asks the service for the same room's ticket.
pub fn bound_party() -> Option<String> {
    BOUND_PARTY.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

pub fn bind_party(party: Option<String>) -> Result<(), String> {
    if let Some(p) = &party {
        if !valid_party_id(p) {
            return Err("Неверный идентификатор пати".into());
        }
    }
    *BOUND_PARTY.lock().unwrap_or_else(|e| e.into_inner()) = party;
    Ok(())
}

fn valid_member_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn set_members(members: Vec<String>) -> Result<(), String> {
    if members.len() > MAX_MEMBERS || !members.iter().all(|m| valid_member_id(m)) {
        return Err("Неверный список участников пати".into());
    }
    let map = members.into_iter().map(|m| (party_voice_player(&m), m)).collect();
    *MEMBERS.lock().unwrap_or_else(|e| e.into_inner()) = Some(map);
    Ok(())
}

fn member_of(id: &Uuid) -> Option<String> {
    MEMBERS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(id).cloned())
}

struct AppEvents {
    app: AppHandle,
    party: String,
    generation: u64,
    connected: Mutex<Option<mpsc::Sender<()>>>,
}

impl AppEvents {
    fn state(&self, state: &'static str, reason: Option<String>) {
        let payload = StatePayload { party: self.party.clone(), state, reason };
        if let Err(e) = self.app.emit(STATE_EVENT, payload) {
            eprintln!("[party-voice] state event not delivered: {e}");
        }
    }
}

impl Events for AppEvents {
    fn connected(&self) {
        let waiting = self.connected.lock().unwrap_or_else(|e| e.into_inner()).take();
        match waiting {
            Some(tx) => {
                let _delivered = tx.send(());
            }
            None => self.state("connected", None),
        }
    }

    fn lost(&self, reason: &'static str) {
        self.state("lost", Some(reason.to_string()));
        let generation = self.generation;
        // The client's own network thread is reporting this; dropping the
        // client joins that thread, so it has to happen elsewhere.
        std::thread::spawn(move || drop(take_active(Some(generation))));
    }

    fn levels(&self, own: f32, speakers: &[(Uuid, f32)]) {
        let speakers = speakers
            .iter()
            .filter_map(|(id, level)| member_of(id).map(|user_id| SpeakerLevel { user_id, level: *level }))
            .collect();
        if let Err(e) = self.app.emit(LEVELS_EVENT, LevelsPayload { me: own, speakers }) {
            eprintln!("[party-voice] levels event not delivered: {e}");
        }
    }

    fn mic_failed(&self, reason: String) {
        self.state("mic_failed", Some(reason));
    }

    fn device_fallback(&self, reason: String) {
        self.state("device_fallback", Some(reason));
    }
}

fn take_active(generation: Option<u64>) -> Option<Active> {
    let mut slot = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    if generation.is_some_and(|g| slot.as_ref().is_some_and(|a| a.generation != g)) {
        return None;
    }
    slot.take()
}

struct Ticket {
    session: Session,
    relay: Vec<SocketAddr>,
    mtu: usize,
    lifetime: Duration,
}

/// Milliseconds since the epoch of the `toISOString()` form the service sends.
fn iso_millis(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (h, mi, sec) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let ms = if b[19] == b'.' { num(20..23).unwrap_or(0) } else { 0 };
    let y = if mo <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (mo + if mo > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 24 + h) * 60 + mi) * 60_000 + sec * 1000 + ms)
}

/// Relay hosts the client will talk to; the ticket answer names one of them.
const RELAY_DOMAINS: [&str; 2] = ["millida.host", "millida.net"];

fn relay_host_allowed(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    RELAY_DOMAINS.iter().any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// Defence in depth behind the host allowlist: the client must never be aimed
/// at the player's own network or a special-purpose range, however the address
/// is spelled (IPv4-mapped, IPv4-compatible, NAT64 or 6to4 IPv6 included).
fn public_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => public_v6(v6),
    }
}

fn public_v4(ip: &Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 168)
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113))
}

fn embedded_v4(seg: &[u16; 8]) -> Ipv4Addr {
    Ipv4Addr::new((seg[6] >> 8) as u8, seg[6] as u8, (seg[7] >> 8) as u8, seg[7] as u8)
}

fn public_v6(ip: &Ipv6Addr) -> bool {
    let seg = ip.segments();
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(&v4);
    }
    if seg[..6] == [0; 6] {
        return seg[6] != 0 && public_v4(&embedded_v4(&seg));
    }
    if seg[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
        return public_v4(&embedded_v4(&seg));
    }
    if seg[0] == 0x2002 {
        let v4 = Ipv4Addr::new((seg[1] >> 8) as u8, seg[1] as u8, (seg[2] >> 8) as u8, seg[2] as u8);
        return public_v4(&v4);
    }
    !((seg[0] & 0xfe00) == 0xfc00
        || (seg[0] & 0xffc0) == 0xfe80
        || (seg[0] & 0xff00) == 0xff00
        || (seg[0] == 0x64 && seg[1] == 0xff9b)
        || (seg[0] == 0x2001 && seg[1] == 0x0db8)
        || (seg[0] == 0x2001 && seg[1] < 0x0200)
        || seg[0] == 0x0100)
}

fn parse_ticket(v: &Value) -> Result<(Ticket, String, u16), String> {
    let broken = || "Сервис голоса прислал неполный билет".to_string();
    let b64 = |key: &str| {
        v.get(key)
            .and_then(Value::as_str)
            .and_then(|s| base64::engine::general_purpose::STANDARD.decode(s.trim()).ok())
    };
    if v.get("group").and_then(Value::as_bool) != Some(true) {
        return Err(broken());
    }
    let ticket = b64("ticket").filter(|t| (1..=1024).contains(&t.len())).ok_or_else(broken)?;
    let secret: [u8; 16] = b64("secret").and_then(|s| s.try_into().ok()).ok_or_else(broken)?;
    let host = v.get("host").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    if host.is_empty() || host.len() > 253 || !host.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-') {
        return Err(broken());
    }
    if !relay_host_allowed(&host) {
        return Err("Сервис голоса назвал чужой сервер голоса — подключение отменено".into());
    }
    let port = v.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).filter(|p| *p > 0).ok_or_else(broken)?;
    let player = v.get("playerUuid").and_then(Value::as_str).and_then(parse_uuid).ok_or_else(broken)?;
    let keep_alive = v.get("keepAlive").and_then(Value::as_u64).unwrap_or(1000).clamp(200, 60_000);
    let mtu = v.get("mtu").and_then(Value::as_u64).unwrap_or(1024).clamp(16, 1275) as usize;
    let expires = v.get("expiresAt").and_then(Value::as_str).and_then(iso_millis);
    let now = v.get("now").and_then(Value::as_str).and_then(iso_millis);
    let lifetime = match (expires, now) {
        (Some(e), Some(n)) if e > n => Duration::from_millis((e - n) as u64),
        _ => return Err(broken()),
    };
    let literals = v
        .get("addresses")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .filter_map(|s| s.trim().parse::<IpAddr>().ok())
                .filter(public_ip)
                .take(4)
                .map(|ip| SocketAddr::new(ip, port))
                .collect()
        })
        .unwrap_or_default();
    let ticket = Ticket { session: Session::new(player, secret, ticket, keep_alive), relay: literals, mtu, lifetime };
    Ok((ticket, host, port))
}

async fn fetch_ticket(party: &str) -> Result<Ticket, String> {
    let body = serde_json::json!({ "party": party });
    let v = millida_api_auth("/voice/ticket".into(), "POST".into(), Some(body)).await?;
    let (mut ticket, host, port) = parse_ticket(&v)?;
    let resolved = tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), port).to_socket_addrs().map(|it| it.filter(|a| public_ip(&a.ip())).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| format!("фоновая задача прервалась: {e}"))?;
    let mut relay = resolved.unwrap_or_default();
    relay.append(&mut ticket.relay);
    if relay.is_empty() {
        return Err("Не удалось найти адрес сервера голоса: проверьте интернет или DNS".into());
    }
    ticket.relay = relay;
    Ok(ticket)
}

pub async fn join(app: AppHandle, party: String, members: Vec<String>, audio: AudioPrefs) -> Result<(), String> {
    if !valid_party_id(&party) {
        return Err("Неверный идентификатор пати".into());
    }
    let processing = processing_of(&audio)?;
    let input = device_label(audio.input)?;
    let output = device_label(audio.output)?;
    set_members(members)?;
    drop(take_active(None));
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let ticket = fetch_ticket(&party).await?;
    let (tx, rx) = mpsc::channel();
    let events = Arc::new(AppEvents { app, party: party.clone(), generation, connected: Mutex::new(Some(tx)) });
    let Ticket { session, relay, mtu, lifetime } = ticket;
    let first = relay.first().copied().ok_or("Не удалось найти адрес сервера голоса")?;
    let started = tauri::async_runtime::spawn_blocking(move || -> Result<VoiceClient, String> {
        let config = Config { relay: first, session, mtu, input, output, processing };
        let client = VoiceClient::start(config, events)?;
        match rx.recv_timeout(CONNECT_WAIT) {
            Ok(()) => Ok(client),
            Err(_) => Err("Сервер голоса Millida не ответил за 8 секунд".into()),
        }
    })
    .await
    .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
    if GENERATION.load(Ordering::SeqCst) != generation {
        return Err("Голос пати уже перезапущен".into());
    }
    *ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some(Active { party: party.clone(), generation, client: started });
    tauri::async_runtime::spawn(renew_loop(party, generation, lifetime));
    Ok(())
}

/// A failed renewal keeps the live link: the current ticket is still good for
/// at least ten minutes, and the next attempt comes a minute later.
async fn renew_loop(party: String, generation: u64, mut lifetime: Duration) {
    loop {
        let wait = lifetime.saturating_sub(RENEW_BEFORE).max(MIN_RENEW_WAIT);
        tokio::time::sleep(wait).await;
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        match fetch_ticket(&party).await {
            Ok(next) => {
                lifetime = next.lifetime;
                let slot = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
                match slot.as_ref() {
                    Some(a) if a.generation == generation && a.party == party => a.client.renew(next.session),
                    _ => return,
                }
            }
            Err(e) => {
                eprintln!("[party-voice] ticket renewal failed: {e}");
                lifetime = RENEW_BEFORE + MIN_RENEW_WAIT;
            }
        }
    }
}

pub fn leave() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    drop(take_active(None));
}

pub fn set_transmit(open: bool) -> Result<(), String> {
    with_client(|c| c.set_transmit(open))
}

/// Noise, AGC and gain apply at once; a device change takes a rejoin.
pub fn set_audio(audio: AudioPrefs) -> Result<(), String> {
    let processing = processing_of(&audio)?;
    with_client(|c| c.set_processing(processing))
}

pub fn set_deafened(on: bool) -> Result<(), String> {
    with_client(|c| c.set_deafened(on))
}

fn with_client(f: impl FnOnce(&VoiceClient)) -> Result<(), String> {
    let slot = ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
    match slot.as_ref() {
        Some(a) if a.client.running() => {
            f(&a.client);
            Ok(())
        }
        _ => Err("Голос пати не подключён".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_times_from_the_service_parse() {
        let cases = [
            ("1970-01-01T00:00:00.000Z", Some(0)),
            ("2026-10-09T12:00:00.250Z", Some(1_791_547_200_250)),
            ("2024-02-29T23:59:59.999Z", Some(1_709_251_199_999)),
            ("not a date", None),
        ];
        for (raw, want) in cases {
            assert_eq!(iso_millis(raw), want, "{raw}: the renewal is scheduled from this, a wrong value renews in a loop or too late");
        }
    }

    #[test]
    fn sound_settings_from_the_webview_are_checked() {
        let base = AudioPrefs { input: None, output: None, noise: "standard".into(), agc: true, mic_gain: 100 };
        assert_eq!(processing_of(&base), Ok(Processing { noise: Noise::Standard, agc: true, gain: 1.0 }));
        assert!(processing_of(&AudioPrefs { noise: "max".into(), ..base.clone() }).is_err(), "unknown noise mode");
        assert!(processing_of(&AudioPrefs { mic_gain: 301, ..base.clone() }).is_err(), "gain past the slider");
        assert_eq!(device_label(Some("  ".into())), Ok(None), "a blank label is the system default");
        assert!(device_label(Some("Mic\u{0}".into())).is_err(), "control characters never reach the device list");
        assert!(device_label(Some("x".repeat(300))).is_err(), "an endless label is refused");
    }

    #[test]
    fn relay_host_must_be_ours() {
        let cases = [
            ("voice.millida.host", true, "the production relay"),
            ("millida.host", true, "the apex itself"),
            ("VOICE.Millida.NET.", true, "case and a trailing dot change nothing"),
            ("millida.host.evil.com", false, "our name as a prefix of someone else's domain"),
            ("evilmillida.host", false, "a suffix without the dot boundary"),
            ("localhost", false, "anything outside our domains"),
        ];
        for (host, ok, why) in cases {
            assert_eq!(relay_host_allowed(host), ok, "{host}: {why}");
        }
    }

    #[test]
    fn relay_addresses_must_be_public() {
        let cases = [
            ("185.16.39.106", true),
            ("8.8.8.8", true),
            ("2a01:4f8::1", true),
            ("::ffff:185.16.39.106", true),
            ("64:ff9b::808:808", true),
            ("0.1.2.3", false),
            ("10.0.0.1", false),
            ("100.64.0.1", false),
            ("100.127.255.254", false),
            ("127.0.0.1", false),
            ("169.254.1.1", false),
            ("172.16.0.1", false),
            ("172.31.255.1", false),
            ("192.0.0.8", false),
            ("192.0.2.1", false),
            ("192.168.1.10", false),
            ("198.18.0.1", false),
            ("198.19.255.1", false),
            ("198.51.100.1", false),
            ("203.0.113.5", false),
            ("224.0.0.1", false),
            ("240.0.0.1", false),
            ("255.255.255.255", false),
            ("::", false),
            ("::1", false),
            ("::ffff:127.0.0.1", false),
            ("::ffff:10.0.0.1", false),
            ("::127.0.0.1", false),
            ("64:ff9b::7f00:1", false),
            ("64:ff9b::a00:1", false),
            ("64:ff9b:1::1", false),
            ("2002:7f00:1::1", false),
            ("fc00::1", false),
            ("fd00::1", false),
            ("fe80::1", false),
            ("ff02::1", false),
            ("2001:db8::1", false),
            ("2001::1", false),
            ("100::1", false),
        ];
        for (raw, ok) in cases {
            let ip: IpAddr = raw.parse().expect("test ip parses");
            assert_eq!(public_ip(&ip), ok, "{raw}: a ticket answer must never aim the client into the player's own network");
        }
    }

    #[test]
    fn only_complete_group_tickets_are_accepted() {
        let good = serde_json::json!({
            "ticket": "AQID", "secret": "AAECAwQFBgcICQoLDA0ODw==", "host": "voice.millida.host", "port": 14997,
            "playerUuid": "c48ce4c8-7fc7-4eea-ac8a-c1e128115cff", "keepAlive": 1000, "mtu": 1024,
            "expiresAt": "2026-10-09T13:00:00.000Z", "now": "2026-10-09T12:00:00.000Z", "group": true,
            "addresses": ["185.16.39.106", "10.0.0.1"]
        });
        let (t, host, port) = parse_ticket(&good).expect("a full group ticket parses");
        assert_eq!((host.as_str(), port), ("voice.millida.host", 14997));
        assert_eq!(t.lifetime, Duration::from_secs(3600));
        assert_eq!(t.relay.len(), 1, "the private literal is dropped");
        for (key, value) in [
            ("group", serde_json::json!(false)),
            ("secret", serde_json::json!("AAEC")),
            ("host", serde_json::json!("evil host/")),
            ("expiresAt", serde_json::json!("2026-10-09T11:00:00.000Z")),
            ("host", serde_json::json!("voice.attacker.example")),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(parse_ticket(&bad).is_err(), "{key}: a half-valid ticket would only fail later at the relay");
        }
    }
}
