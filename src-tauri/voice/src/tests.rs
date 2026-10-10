//! Vectors below were produced by the mod's own Java classes (`VoicePacket`,
//! `VoiceDatagrams`, `VoiceCipher`, Concentus `OpusEncoder` in millida-mod
//! core) from fixed inputs, so these tests pin byte compatibility with the game.

use crate::cipher::{client_datagram, open_client, open_server, server_datagram, ticket_datagram, VoiceCipher};
use crate::codec::{Decoder, Encoder, FRAME_SAMPLES};
use crate::jitter::{Frame, JitterBuffer};
use crate::link::{Event, Link, Lost, Session};
use crate::party::{party_voice_player, valid_party_id};
use crate::resample::Resampler;
use crate::wire::{parse_uuid, uuid_text, Packet, Uuid};

fn hex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("test vector is hex")).collect()
}

fn seq(n: usize, start: u8) -> Vec<u8> {
    (0..n).map(|i| start.wrapping_add(i as u8)).collect()
}

fn id(text: &str) -> Uuid {
    parse_uuid(text).expect("test uuid parses")
}

const PLAYER: &str = "c48ce4c8-7fc7-4eea-ac8a-c1e128115cff";
const CHANNEL: &str = "a2c74096-83ed-9261-c028-a4b53c3ce4ad";
const SENDER: &str = "b4920cf7-47ff-4cc9-9ccc-edbedf1d726d";

fn secret() -> [u8; 16] {
    let mut s = [0u8; 16];
    s.copy_from_slice(&seq(16, 0x10));
    s
}

fn cookie(start: u8) -> [u8; 8] {
    let mut c = [0u8; 8];
    c.copy_from_slice(&seq(8, start));
    c
}

#[test]
fn packets_encode_byte_for_byte_like_the_mod() {
    let cases: Vec<(&str, Packet, &str)> = vec![
        ("mic", Packet::Mic { opus: vec![1, 2, 3], sequence: 42, whispering: false }, "0103010203000000000000002a00"),
        ("end of stream", Packet::Mic { opus: vec![], sequence: 43, whispering: false }, "0100000000000000002b00"),
        ("authenticate", Packet::Authenticate { player: id(PLAYER), secret: secret() }, "05c48ce4c87fc74eeaac8ac1e128115cff101112131415161718191a1b1c1d1e1f"),
        ("cookie echo", Packet::CookieEcho(cookie(0xA0)), "43a0a1a2a3a4a5a6a7"),
        ("connection check", Packet::ConnectionCheck, "09"),
        ("keepalive", Packet::KeepAlive, "08"),
        ("ping", Packet::Ping { id: id(PLAYER), timestamp: 1_234_567_890_123 }, "07c48ce4c87fc74eeaac8ac1e128115cff0000011f71fb04cb"),
        (
            "position with voice off",
            Packet::Position { dimension: "party".into(), x: 0.0, y: 0.0, z: 0.0, flags: 1 },
            "4005706172747900000000000000000000000000000000000000000000000001",
        ),
    ];
    for (name, packet, want) in cases {
        assert_eq!(
            packet.encode(),
            hex(want),
            "{name}: the relay and the mod parse exactly this layout; any drift drops the packet silently"
        );
    }
}

#[test]
fn packets_from_the_relay_decode_like_the_mod() {
    let cases: Vec<(&str, &str, Packet)> = vec![
        (
            "group sound",
            "03a2c7409683ed9261c028a4b53c3ce4adb4920cf747ff4cc99cccedbedf1d726d055051525354000000000000004d00",
            Packet::GroupSound { channel: id(CHANNEL), sender: id(SENDER), opus: seq(5, 0x50), sequence: 77 },
        ),
        (
            "player sound",
            "02b4920cf747ff4cc99cccedbedf1d726db4920cf747ff4cc99cccedbedf1d726d0460616263000000000000000941c0000001",
            Packet::PlayerSound {
                channel: id(SENDER),
                sender: id(SENDER),
                opus: seq(4, 0x60),
                sequence: 9,
                distance: 24.0,
                whispering: true,
            },
        ),
        ("roster", "4102c48ce4c87fc74eeaac8ac1e128115cff00b4920cf747ff4cc99cccedbedf1d726d01", Packet::Roster(vec![(id(PLAYER), false), (id(SENDER), true)])),
        ("cookie", "42b0b1b2b3b4b5b6b7", Packet::Cookie(cookie(0xB0))),
        ("authenticate ack", "06", Packet::AuthenticateAck),
    ];
    for (name, raw, want) in cases {
        let got = Packet::decode(&hex(raw)).expect("vector parses").expect("known type");
        assert_eq!(got, want, "{name}: what the relay sends must read back field for field");
    }
}

#[test]
fn malformed_packets_are_rejected_not_misread() {
    let mut cookie_tail = hex("42b0b1b2b3b4b5b6b7");
    cookie_tail.push(0);
    let mut long_opus = vec![0x01, 0x80, 0x0A];
    long_opus.extend(vec![0u8; 1280]);
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("truncated group sound", hex("03a2c7409683ed9261c028a4b53c3ce4adb4920cf747ff4cc99cccedbedf1d726d055051525354000000000000004d00")[..20].to_vec()),
        ("cookie with a tail", cookie_tail),
        ("varint too long", vec![0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x01]),
        ("opus over the limit", long_opus),
    ];
    for (name, raw) in cases {
        assert!(Packet::decode(&raw).is_err(), "{name}: bytes from the network must fail closed");
    }
    assert_eq!(Packet::decode(&[0x04]).ok(), Some(None), "unknown types are skipped, as the mod skips them");
}

#[test]
fn datagrams_sealed_by_the_mod_open_here() {
    let cipher = VoiceCipher::new(&secret());
    let (player, packet) =
        open_client(&hex("ffc48ce4c87fc74eeaac8ac1e128115cff2a96bdea2466d7d62318164bbec018a607c088d35bb835b2cb376d996909452df414f1b2a0dd32f81aa064"), &cipher).expect("mod client datagram opens with the same secret");
    assert_eq!(player, id(PLAYER), "the relay routes by the UUID in clear in front of the payload");
    assert_eq!(packet, Packet::Mic { opus: vec![1, 2, 3], sequence: 42, whispering: false });
    let sound = open_server(&hex("ff4c206bc08cd8d1d679863ff07a4a1d37baed149900b0312fcd996f3b24bb186721f760f1cbef945f0e2a702ec2e32cf321f5f9d63ad86d048dd5f72429cc9e7e95bfea26bf23969ea68ad8b828"), &cipher).expect("relay-shaped datagram from the mod opens");
    assert_eq!(
        sound,
        Packet::GroupSound { channel: id(CHANNEL), sender: id(SENDER), opus: seq(5, 0x50), sequence: 77 }
    );
    let other = VoiceCipher::new(&[0x99; 16]);
    assert!(open_server(&hex("ff4c206bc08cd8d1d679863ff07a4a1d37baed149900b0312fcd996f3b24bb186721f760f1cbef945f0e2a702ec2e32cf321f5f9d63ad86d048dd5f72429cc9e7e95bfea26bf23969ea68ad8b828"), &other).is_none(), "a datagram under another secret is not ours");
    assert_eq!(ticket_datagram(&seq(10, 1)).expect("ticket frames"), hex("fe0102030405060708090a"));
}

#[test]
fn our_datagrams_round_trip_through_the_same_framing() {
    let cipher = VoiceCipher::new(&secret());
    let mic = Packet::Mic { opus: seq(60, 3), sequence: 7, whispering: false };
    let d = client_datagram(&id(PLAYER), &mic, &cipher);
    assert_eq!(open_client(&d, &cipher), Some((id(PLAYER), mic)));
    let back = server_datagram(&Packet::KeepAlive, &cipher);
    assert_eq!(open_server(&back, &cipher), Some(Packet::KeepAlive));
    let mut tampered = back.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 1;
    assert!(open_server(&tampered, &cipher).is_none(), "GCM must reject a flipped bit");
}

fn opus_frames() -> Vec<Vec<u8>> {
    ["78817bc611355c9a82f75291fd58b8ec410f6f3e4013fe397bb6939dc6f60cb8ff935af1146634e5a686e8e2ce3cd84b12a77764887135702f9f3c208ec417c961ffba65333013de7c1f98a86e3edf772347769f0e377dc0a22e4bacc35d95ffc5384776dfb1a9d750f88da230c9a47d3ba3c66b88328a99fdb0caa314d2f7a5b20af3367de41b5210892f24d39d31a605be79514feb826ef61a75250a1a8c", "78aa3df8052dd9d63e6fc013a5b584afa906ab05029190b2fbb51463a2dcc638ba54058eb783822f3832c336ac104005f9160887194905fe7da00af9fd06377cdaf48b67f99834664af635e2fe79319b60e2e4a862c3ecf0a5", "78aa3df8052dd9d6f2fc9c94869686aff0943cb7d0e75e7085e1d7cccac0afaef9afbb93cef45b8ac095998440e9743aead0e40f7753f5af883d25fa0a5965018d604b1fe2743fcc2cd7bcb1ee75c125f08b1772cfecf6c9"].iter().map(|h| hex(h)).collect()
}

fn rms(pcm: &[f32]) -> f32 {
    (pcm.iter().map(|s| s * s).sum::<f32>() / pcm.len() as f32).sqrt()
}

#[test]
fn concentus_frames_from_the_mod_decode_to_the_tone() {
    let mut decoder = Decoder::new().expect("decoder");
    let mut last = [0f32; FRAME_SAMPLES];
    for frame in opus_frames() {
        last = decoder.decode(Some(&frame));
    }
    let level = rms(&last);
    let expected = 8000.0 / 32768.0 / std::f32::consts::SQRT_2;
    assert!(
        (level - expected).abs() < expected * 0.35,
        "440 Hz at -12 dBFS from the game decoded to rms {level}, want about {expected}: the lobby would play the game's voice wrong"
    );
    let concealed = decoder.decode(None);
    assert_eq!(concealed.len(), FRAME_SAMPLES, "a lost frame still yields one 20 ms frame");
}

#[test]
fn our_opus_round_trips() {
    let mut encoder = Encoder::new(1024).expect("encoder");
    let mut decoder = Decoder::new().expect("decoder");
    let mut pcm = [0f32; FRAME_SAMPLES];
    for (i, s) in pcm.iter_mut().enumerate() {
        *s = 0.25 * (2.0 * std::f32::consts::PI * 300.0 * i as f32 / 48_000.0).sin();
    }
    let mut out = [0f32; FRAME_SAMPLES];
    for _ in 0..5 {
        let packet = encoder.encode(&pcm).expect("encode");
        assert!(!packet.is_empty() && packet.len() <= 1024, "a frame fits the ticket MTU");
        out = decoder.decode(Some(&packet));
    }
    assert!(rms(&out) > 0.1, "a 300 Hz tone survives our own encode and decode");
}

fn drain(buffer: &mut JitterBuffer, polls: usize) -> String {
    (0..polls)
        .map(|_| match buffer.poll() {
            Frame::Audio(opus) => opus[0].to_string(),
            Frame::None => "NONE".into(),
            Frame::Lost => "LOST".into(),
            Frame::End => "END".into(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn jitter_buffer_matches_the_mod_case_by_case() {
    type Step = (Vec<i64>, usize, &'static str);
    let cases: Vec<(&str, Vec<Step>)> = vec![
        ("reorders by sequence: UDP reorders, the speaker must not", vec![(vec![2, 0, 1, 3], 4, "0 1 2 3")]),
        (
            "waits for three frames of prebuffer",
            vec![(vec![10], 1, "NONE"), (vec![11], 1, "NONE"), (vec![12], 3, "10 11 12")],
        ),
        ("a hole becomes concealment, not silence", vec![(vec![0, 1, 3, 4], 5, "0 1 LOST 3 4")]),
        ("late frames are dropped", vec![(vec![0, 1, 2], 2, "0 1"), (vec![0, 3], 2, "2 3")]),
        (
            "end of stream flushes, a new stream restarts numbering",
            vec![(vec![5, -6], 3, "5 END NONE"), (vec![0, 1, 2], 3, "0 1 2")],
        ),
        ("an underrun ends after three concealed frames", vec![(vec![0, 1, 2], 8, "0 1 2 LOST LOST LOST END NONE")]),
        ("a long gap jumps ahead", vec![(vec![0, 1, 2, 50], 4, "0 1 2 50")]),
    ];
    for (name, steps) in cases {
        let mut buffer = JitterBuffer::default();
        for (offers, polls, want) in steps {
            for s in offers {
                let opus = if s < 0 { vec![] } else { vec![s as u8] };
                buffer.offer(s.abs(), opus);
            }
            assert_eq!(drain(&mut buffer, polls), want, "{name}");
        }
    }
}

#[test]
fn party_player_ids_match_trade_api() {
    let cases = [
        ("cmacc0unt1d", "b4920cf7-47ff-4cc9-9ccc-edbedf1d726d"),
        ("acc-1", "c48ce4c8-7fc7-4eea-ac8a-c1e128115cff"),
    ];
    for (account, want) in cases {
        assert_eq!(
            uuid_text(&party_voice_player(account)),
            want,
            "trade-api voice-party.spec.ts pins the same id; if they differ the lobby cannot tell who is speaking"
        );
    }
    for (raw, ok) in [("cmparty01", true), ("a-b_C9", true), ("", false), ("../x", false), ("a b", false)] {
        assert_eq!(valid_party_id(raw), ok, "{raw:?}: the same rule as the service DTO");
    }
}

#[test]
fn resampler_keeps_duration() {
    for (from, to) in [(44_100u32, 48_000u32), (48_000, 44_100), (16_000, 48_000), (48_000, 48_000)] {
        let mut r = Resampler::new(from, to);
        let mut out = Vec::new();
        for _ in 0..50 {
            r.push(&vec![0.5f32; from as usize / 50], &mut out);
        }
        let want = to as i64;
        assert!(
            (out.len() as i64 - want).abs() <= 2,
            "{from}->{to}: one second in must stay one second out, got {}",
            out.len()
        );
        assert!(
            out.iter().skip(4).all(|s| (s - 0.5).abs() < 1e-6),
            "{from}->{to}: past the start-up sample a constant stays constant, across chunk borders too"
        );
    }
}

struct FakeRelay {
    cipher: VoiceCipher,
}

impl FakeRelay {
    fn send(&self, p: Packet) -> Vec<u8> {
        server_datagram(&p, &self.cipher)
    }

    fn read(&self, d: &[u8]) -> Option<Packet> {
        open_client(d, &self.cipher).map(|(_, p)| p)
    }
}

fn kinds(relay: &FakeRelay, out: &[Vec<u8>]) -> Vec<String> {
    out.iter()
        .map(|d| {
            if d[0] == 0xFE {
                "ticket".into()
            } else {
                relay.read(d).map(|p| format!("{:02x}", p.kind())).unwrap_or_else(|| "?".into())
            }
        })
        .collect()
}

fn connected_link() -> (Link, FakeRelay, u64) {
    let session = Session::new(id(PLAYER), secret(), seq(40, 1), 1000);
    let relay = FakeRelay { cipher: VoiceCipher::new(&secret()) };
    let mut link = Link::new(session, id(SENDER), 1);
    let mut out = Vec::new();
    let mut ev = Vec::new();
    link.poll(1, &mut out).expect("handshake starts");
    link.receive(&relay.send(Packet::AuthenticateAck), 2, &mut out, &mut ev);
    link.receive(&relay.send(Packet::Cookie(cookie(0xC0))), 3, &mut out, &mut ev);
    link.receive(&relay.send(Packet::ConnectionCheckAck), 4, &mut out, &mut ev);
    assert_eq!(ev, vec![Event::Connected]);
    (link, relay, 4)
}

#[test]
fn handshake_follows_the_relay_order() {
    let session = Session::new(id(PLAYER), secret(), seq(40, 1), 1000);
    let relay = FakeRelay { cipher: VoiceCipher::new(&secret()) };
    let mut link = Link::new(session, id(SENDER), 1);
    let mut out = Vec::new();
    let mut ev = Vec::new();
    link.poll(1, &mut out).expect("start");
    assert_eq!(kinds(&relay, &out), ["ticket", "05"], "ticket first, then Authenticate");
    out.clear();
    link.receive(&relay.send(Packet::ConnectionCheckAck), 2, &mut out, &mut ev);
    assert!(ev.is_empty() && !link.connected(), "an Ack before Authenticate completed proves nothing");
    link.receive(&relay.send(Packet::AuthenticateAck), 3, &mut out, &mut ev);
    assert!(out.is_empty(), "AuthenticateAck alone is half of the answer on the relay; wait for the Cookie");
    link.receive(&relay.send(Packet::Cookie(cookie(0xC0))), 4, &mut out, &mut ev);
    assert_eq!(kinds(&relay, &out), ["43", "09"], "CookieEcho goes right away, then ConnectionCheck");
    assert_eq!(relay.read(&out[0]), Some(Packet::CookieEcho(cookie(0xC0))), "the echo carries exactly the cookie");
    out.clear();
    link.poll(1004, &mut out).expect("resend");
    assert_eq!(
        kinds(&relay, &out),
        ["43", "09"],
        "every ConnectionCheck resend repeats the echo: a lost echo makes the relay drop the check"
    );
    out.clear();
    assert!(link.seal(&Packet::KeepAlive).is_none(), "nothing but the handshake before the Ack");
    link.receive(&relay.send(Packet::ConnectionCheckAck), 1005, &mut out, &mut ev);
    assert_eq!(ev, vec![Event::Connected]);
    assert!(link.seal(&Packet::KeepAlive).is_some());
}

#[test]
fn keepalive_is_echoed_and_silence_resyncs_then_drops() {
    let (mut link, relay, t) = connected_link();
    let mut out = Vec::new();
    let mut ev = Vec::new();
    link.receive(&relay.send(Packet::KeepAlive), t + 500, &mut out, &mut ev);
    assert_eq!(kinds(&relay, &out), ["08"], "a KeepAlive from the relay is reflected");
    out.clear();
    link.poll(t + 500 + 3001, &mut out).expect("resync is not a drop");
    assert_eq!(
        kinds(&relay, &out),
        ["ticket", "05"],
        "after three silent intervals the ticket and Authenticate go again: a restarted relay forgot us"
    );
    let mut lost = None;
    for step in 0..40 {
        out.clear();
        if let Err(e) = link.poll(t + 4000 + step * 1000, &mut out) {
            lost = Some(e);
            break;
        }
    }
    assert_eq!(
        lost,
        Some(Lost::Timeout),
        "a relay that never answers again ends the link; the launcher then decides (handoff to the game or retry)"
    );
}

#[test]
fn sounds_reach_the_listener_once_connected() {
    let (mut link, relay, t) = connected_link();
    let mut out = Vec::new();
    let mut ev = Vec::new();
    let sound = Packet::GroupSound { channel: id(CHANNEL), sender: id(SENDER), opus: vec![9], sequence: 3 };
    link.receive(&relay.send(sound), t + 1, &mut out, &mut ev);
    assert_eq!(ev, vec![Event::Sound { sender: id(SENDER), sequence: 3, opus: vec![9] }]);
}

#[test]
fn renewal_keeps_audio_on_the_old_secret_until_the_ack() {
    let (mut link, relay, t) = connected_link();
    let mut next_secret = secret();
    next_secret[0] ^= 0xFF;
    let next_relay = FakeRelay { cipher: VoiceCipher::new(&next_secret) };
    link.renew(Session::new(id(PLAYER), next_secret, seq(40, 7), 1000), t + 1);
    let mut out = Vec::new();
    let mut ev = Vec::new();
    link.poll(t + 1, &mut out).expect("renew handshake");
    assert_eq!(kinds(&next_relay, &out), ["ticket", "05"], "the new ticket and Authenticate go under the new secret");
    let keep = link.seal(&Packet::KeepAlive).expect("still connected");
    assert!(relay.read(&keep).is_some(), "until the relay confirms, traffic stays under the old secret it still routes by");
    link.receive(&next_relay.send(Packet::AuthenticateAck), t + 2, &mut out, &mut ev);
    link.receive(&next_relay.send(Packet::Cookie(cookie(0xD0))), t + 3, &mut out, &mut ev);
    link.receive(&next_relay.send(Packet::ConnectionCheckAck), t + 4, &mut out, &mut ev);
    let after = link.seal(&Packet::KeepAlive).expect("connected");
    assert!(next_relay.read(&after).is_some(), "after the Ack the old secret is forgotten");
    assert!(ev.is_empty(), "a renewal is not a second connect");
}

#[test]
fn speaker_table_stays_bounded() {
    use crate::client::{make_room, MAX_SPEAKERS, SPEAKER_IDLE};
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    let start = Instant::now();
    let sender = |i: u8| -> Uuid { [i; 16] };
    let mut map: HashMap<Uuid, Instant> = HashMap::new();
    for i in 0..200u8 {
        let now = start + Duration::from_millis(u64::from(i));
        make_room(&mut map, &sender(i), now, |t| *t);
        map.insert(sender(i), now);
        assert!(map.len() <= MAX_SPEAKERS, "after {i} senders the table holds {}: each entry is a decoder, a flood of ids must not grow it", map.len());
    }
    assert!(map.contains_key(&sender(199)), "the newest sender is always admitted");
    assert!(!map.contains_key(&sender(0)), "the least recently heard one makes room");

    let mut known: HashMap<Uuid, Instant> = (0..4u8).map(|i| (sender(i), start)).collect();
    make_room(&mut known, &sender(1), start + SPEAKER_IDLE * 2, |t| *t);
    assert_eq!(known.len(), 4, "a sender already in the table never evicts anyone");
    make_room(&mut known, &sender(9), start + SPEAKER_IDLE * 2, |t| *t);
    assert!(known.is_empty(), "senders silent past the idle limit are dropped before a new one comes in");
}

#[test]
fn device_labels_from_the_webview_find_cpal_devices() {
    use crate::dsp::match_device;
    let names: Vec<String> = ["Speakers (Realtek(R) Audio)", "Microphone (USB Audio Device)", "Headset Microphone (Arctis 7 Chat)"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let cases = [
        ("Speakers (Realtek(R) Audio)", Some(0), "same friendly name on Windows"),
        ("microphone (usb audio device) (0d8c:0014)", Some(1), "Chromium's USB vid:pid suffix and case are ignored"),
        ("Arctis 7 Chat", Some(2), "a shorter label still finds its device"),
        ("Studio Mic (dead:beef)", None, "an unplugged device falls back to the default, with a reason"),
        ("", None, "no choice in the settings means the default"),
        ("Микрофон (Ä) (zzzz:1234)", None, "a non-hex tail is part of the name and must not panic on multibyte text"),
    ];
    for (label, want, why) in cases {
        assert_eq!(match_device(label, &names), want, "{label:?}: {why}");
    }
}

fn tone(amplitude: f32) -> [f32; FRAME_SAMPLES] {
    let mut f = [0f32; FRAME_SAMPLES];
    for (i, s) in f.iter_mut().enumerate() {
        *s = amplitude * (2.0 * std::f32::consts::PI * 220.0 * i as f32 / 48_000.0).sin();
    }
    f
}

fn noise(amplitude: f32, seed: &mut u32) -> [f32; FRAME_SAMPLES] {
    let mut f = [0f32; FRAME_SAMPLES];
    for s in f.iter_mut() {
        *seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        *s = amplitude * ((*seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0);
    }
    f
}

#[test]
fn mic_chain_follows_the_settings() {
    use crate::dsp::{AutoGain, MicChain, Noise, Processing};
    assert_eq!(Noise::parse("strong"), Some(Noise::Strong));
    assert_eq!(Noise::parse("loud"), None, "only the launcher's three noise modes are accepted");

    let mut chain = MicChain::default();
    let mut f = tone(0.1);
    chain.process(&mut f, &Processing { noise: Noise::Off, agc: false, gain: 2.0 });
    assert!((rms(&f) - rms(&tone(0.2))).abs() < 1e-3, "with everything off the slider gain is all that applies");

    let mut seed = 7;
    let mut standard = MicChain::default();
    let mut before = 0.0;
    let mut after = 0.0;
    for _ in 0..100 {
        let mut f = noise(0.05, &mut seed);
        before = rms(&f);
        standard.process(&mut f, &Processing { noise: Noise::Standard, agc: false, gain: 1.0 });
        after = rms(&f);
    }
    assert!(after < before * 0.5, "RNNoise must take most of steady hiss away: {before} -> {after}");

    let mut strong = MicChain::default();
    let mut last = 1.0;
    for _ in 0..100 {
        let mut f = noise(0.05, &mut seed);
        strong.process(&mut f, &Processing { noise: Noise::Strong, agc: false, gain: 1.0 });
        last = rms(&f);
    }
    assert_eq!(last, 0.0, "the strong mode closes the gate on non-speech once the hangover is over");

    let mut agc = AutoGain::default();
    for _ in 0..400 {
        let mut f = tone(0.01).map(|s| s * 32768.0);
        agc.process(&mut f, true);
    }
    assert!((agc.gain_db() - AutoGain::MAX_GAIN_DB).abs() < 0.5, "a quiet voice is raised up to the cap, got {}", agc.gain_db());
    let mut loud = AutoGain::default();
    let mut f = tone(1.0).map(|s| s * 32767.0);
    for _ in 0..20 {
        f = tone(1.0).map(|s| s * 32767.0);
        loud.process(&mut f, true);
    }
    assert!(loud.gain_db() < -5.0, "a shout is brought down");
    assert!(f.iter().all(|s| s.abs() <= AutoGain::LIMIT), "the limiter keeps every sample under the ceiling");
}
