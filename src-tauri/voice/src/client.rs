//! The running voice client: one network thread that owns the socket and the
//! [`Link`], one audio thread that owns the cpal streams (they are not `Send`
//! on every platform), encodes the microphone and mixes what it hears.

use std::collections::hash_map::Entry;
use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

use crate::codec::{Decoder, Encoder, FRAME_SAMPLES, SAMPLE_RATE};
use crate::dsp::{match_device, MicChain, Processing};
use crate::jitter::{Frame, JitterBuffer};
use crate::link::{Event, Link, Lost, Session};
use crate::resample::Resampler;
use crate::wire::{Packet, Uuid, POSITION_DISABLED};

const NET_TICK: Duration = Duration::from_millis(10);
const AUDIO_TICK: Duration = Duration::from_millis(5);
const LEVEL_EVERY: Duration = Duration::from_millis(100);
const SPEAKING_HOLD: Duration = Duration::from_millis(300);
const SPEAKING_LEVEL: f32 = 0.02;
const PLAYBACK_LEAD_MS: usize = 60;
const QUEUE_LIMIT_MS: usize = 500;
/// The relay caps a party room at its audible limit; more distinct senders than
/// that can only be noise, and each one costs a decoder.
pub const MAX_SPEAKERS: usize = 16;
pub const SPEAKER_IDLE: Duration = Duration::from_secs(10);

pub trait Events: Send + Sync + 'static {
    fn connected(&self);
    /// The link is over. A game that took the party id over looks exactly like this.
    fn lost(&self, reason: &'static str);
    /// Own microphone level and everyone heard in the last moment, 0..1.
    fn levels(&self, own: f32, speakers: &[(Uuid, f32)]);
    /// The microphone could not be opened; the client keeps listening.
    fn mic_failed(&self, reason: String);
    /// A device chosen in the settings is gone; the system default plays instead.
    fn device_fallback(&self, reason: String);
}

pub struct Config {
    pub relay: SocketAddr,
    pub session: Session,
    pub mtu: usize,
    /// Device names picked in the launcher's sound settings; `None` is the system default.
    pub input: Option<String>,
    pub output: Option<String>,
    pub processing: Processing,
}

enum Cmd {
    Opus(Vec<u8>),
    Renew(Box<Session>),
    Deafen(bool),
}

#[derive(Default)]
struct Control {
    stop: AtomicBool,
    transmit: AtomicBool,
    deafened: AtomicBool,
    processing: Mutex<Processing>,
}

struct Speaker {
    jitter: JitterBuffer,
    decoder: Decoder,
    level: f32,
    heard: Option<Instant>,
    last_packet: Instant,
}

type Speakers = Arc<Mutex<HashMap<Uuid, Speaker>>>;

pub struct VoiceClient {
    control: Arc<Control>,
    cmds: Sender<Cmd>,
    threads: Vec<JoinHandle<()>>,
}

impl VoiceClient {
    /// Opens the socket and both audio directions. Fails only when nothing can
    /// be heard: no socket or no output device. A missing microphone is
    /// reported through [`Events::mic_failed`] and the client listens.
    pub fn start(config: Config, events: Arc<dyn Events>) -> Result<VoiceClient, String> {
        let bind: SocketAddr = if config.relay.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }
            .parse()
            .map_err(|e| format!("адрес сокета: {e}"))?;
        let socket = UdpSocket::bind(bind).map_err(|e| format!("Не удалось открыть сокет голоса: {e}"))?;
        socket.connect(config.relay).map_err(|e| format!("Сервер голоса недоступен: {e}"))?;
        socket.set_read_timeout(Some(NET_TICK)).map_err(|e| format!("Сокет голоса: {e}"))?;

        let control = Arc::new(Control::default());
        *control.processing.lock().unwrap_or_else(|e| e.into_inner()) = config.processing;
        let speakers: Speakers = Arc::new(Mutex::new(HashMap::new()));
        let (cmds, cmd_rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);

        let audio = {
            let control = control.clone();
            let speakers = speakers.clone();
            let events = events.clone();
            let cmds = cmds.clone();
            let devices = Devices { mtu: config.mtu, input: config.input.clone(), output: config.output.clone() };
            std::thread::Builder::new()
                .name("millida-voice-audio".into())
                .spawn(move || audio_thread(control, speakers, events, cmds, devices, ready_tx))
                .map_err(|e| format!("поток звука: {e}"))?
        };
        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(())) => {}
            Ok(Err(reason)) => {
                control.stop.store(true, Ordering::SeqCst);
                let _joined = audio.join();
                return Err(reason);
            }
            Err(_) => {
                control.stop.store(true, Ordering::SeqCst);
                return Err("Звуковое устройство не ответило за 10 секунд".into());
            }
        }

        let net = {
            let control = control.clone();
            std::thread::Builder::new()
                .name("millida-voice-udp".into())
                .spawn(move || net_thread(socket, config.session, control, speakers, events, cmd_rx))
                .map_err(|e| format!("поток сети голоса: {e}"))?
        };
        Ok(VoiceClient { control, cmds, threads: vec![audio, net] })
    }

    /// Push-to-talk and mute both come down to whether the microphone goes out.
    pub fn set_transmit(&self, open: bool) {
        self.control.transmit.store(open, Ordering::SeqCst);
    }

    pub fn set_deafened(&self, on: bool) {
        self.control.deafened.store(on, Ordering::SeqCst);
        if on {
            self.control.transmit.store(false, Ordering::SeqCst);
        }
        let _sent = self.cmds.send(Cmd::Deafen(on));
    }

    pub fn renew(&self, session: Session) {
        let _sent = self.cmds.send(Cmd::Renew(Box::new(session)));
    }

    pub fn set_processing(&self, processing: Processing) {
        *self.control.processing.lock().unwrap_or_else(|e| e.into_inner()) = processing;
    }

    pub fn running(&self) -> bool {
        !self.control.stop.load(Ordering::SeqCst)
    }
}

impl Drop for VoiceClient {
    fn drop(&mut self) {
        self.control.stop.store(true, Ordering::SeqCst);
        for t in self.threads.drain(..) {
            let _joined = t.join();
        }
    }
}

fn millis(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64 + 1
}

fn net_thread(
    socket: UdpSocket,
    session: Session,
    control: Arc<Control>,
    speakers: Speakers,
    events: Arc<dyn Events>,
    cmds: Receiver<Cmd>,
) {
    let start = Instant::now();
    let ping_id = session.player;
    let mut link = Link::new(session, ping_id, millis(start));
    let mut out = Vec::new();
    let mut heard = Vec::new();
    let mut buf = [0u8; 4096];
    let mut sequence: i64 = 0;
    while !control.stop.load(Ordering::SeqCst) {
        let now = millis(start);
        while let Ok(cmd) = cmds.try_recv() {
            match cmd {
                Cmd::Opus(opus) => {
                    if let Some(d) = link.seal(&Packet::Mic { opus, sequence, whispering: false }) {
                        out.push(d);
                    }
                    sequence += 1;
                }
                Cmd::Renew(next) => link.renew(*next, now),
                Cmd::Deafen(on) => {
                    let flags = if on { POSITION_DISABLED } else { 0 };
                    let position = Packet::Position { dimension: "party".into(), x: 0.0, y: 0.0, z: 0.0, flags };
                    if let Some(d) = link.seal(&position) {
                        out.push(d);
                    }
                }
            }
        }
        if let Err(Lost::Timeout) = link.poll(now, &mut out) {
            control.stop.store(true, Ordering::SeqCst);
            events.lost("timeout");
            return;
        }
        for d in out.drain(..) {
            if let Err(e) = socket.send(&d) {
                if e.kind() != std::io::ErrorKind::ConnectionRefused {
                    control.stop.store(true, Ordering::SeqCst);
                    events.lost("socket");
                    return;
                }
            }
        }
        match socket.recv(&mut buf) {
            Ok(n) => {
                let was = link.connected();
                link.receive(&buf[..n], millis(start), &mut out, &mut heard);
                for event in heard.drain(..) {
                    match event {
                        Event::Connected if !was => events.connected(),
                        Event::Sound { sender, sequence, opus } if !control.deafened.load(Ordering::SeqCst) => {
                            offer(&speakers, sender, sequence, opus);
                        }
                        _ => {}
                    }
                }
            }
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {}
            Err(_) => {
                control.stop.store(true, Ordering::SeqCst);
                events.lost("socket");
                return;
            }
        }
    }
}

/// Sounds reach here only after the link opened them under the session's
/// AES-GCM secret, so every sender is one the relay forwarded. The table is
/// still bounded: idle senders go first, then the least recently heard one.
fn offer(speakers: &Speakers, sender: Uuid, sequence: i64, opus: Vec<u8>) {
    let now = Instant::now();
    let mut map = speakers.lock().unwrap_or_else(|e| e.into_inner());
    make_room(&mut map, &sender, now, |s| s.last_packet);
    let speaker = match map.entry(sender) {
        Entry::Occupied(e) => e.into_mut(),
        Entry::Vacant(e) => match Decoder::new() {
            Ok(decoder) => e.insert(Speaker {
                jitter: JitterBuffer::default(),
                decoder,
                level: 0.0,
                heard: None,
                last_packet: now,
            }),
            Err(reason) => {
                eprintln!("[voice] {reason}");
                return;
            }
        },
    };
    speaker.last_packet = now;
    speaker.jitter.offer(sequence, opus);
}

/// Leaves room for `sender` in a table of at most [`MAX_SPEAKERS`] entries.
pub fn make_room<V>(map: &mut HashMap<Uuid, V>, sender: &Uuid, now: Instant, last: impl Fn(&V) -> Instant) {
    if map.contains_key(sender) {
        return;
    }
    map.retain(|_, v| now.saturating_duration_since(last(v)) < SPEAKER_IDLE);
    while map.len() >= MAX_SPEAKERS {
        let Some(oldest) = map.iter().min_by_key(|(_, v)| last(v)).map(|(k, _)| *k) else { break };
        map.remove(&oldest);
    }
}

fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    (frame.iter().map(|s| s * s).sum::<f32>() / frame.len() as f32).sqrt()
}

type Queue = Arc<Mutex<VecDeque<f32>>>;

fn push_capped(queue: &Queue, samples: impl Iterator<Item = f32>, cap: usize) {
    let mut q = queue.lock().unwrap_or_else(|e| e.into_inner());
    q.extend(samples);
    let excess = q.len().saturating_sub(cap);
    q.drain(..excess);
}

fn build_input(device: &cpal::Device, queue: Queue) -> Result<(cpal::Stream, u32), String> {
    let supported = device.default_input_config().map_err(|e| format!("микрофон: {e}"))?;
    let rate = supported.sample_rate();
    let channels = usize::from(supported.channels().max(1));
    let cap = rate as usize * QUEUE_LIMIT_MS / 1000;
    let config = supported.config();
    let fail = |e: cpal::Error| eprintln!("[voice] microphone stream error: {e}");
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream::<f32, _, _>(
            config,
            move |data, _| push_capped(&queue, data.chunks(channels).map(|c| c.iter().sum::<f32>() / channels as f32), cap),
            fail,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream::<i16, _, _>(
            config,
            move |data, _| {
                let mono = data.chunks(channels).map(|c| c.iter().map(|s| f32::from(*s) / 32768.0).sum::<f32>() / channels as f32);
                push_capped(&queue, mono, cap)
            },
            fail,
            None,
        ),
        other => return Err(format!("микрофон отдаёт неподдерживаемый формат {other:?}")),
    }
    .map_err(|e| format!("микрофон: {e}"))?;
    stream.play().map_err(|e| format!("микрофон: {e}"))?;
    Ok((stream, rate))
}

fn build_output(device: &cpal::Device, queue: Queue) -> Result<(cpal::Stream, u32), String> {
    let supported = device.default_output_config().map_err(|e| format!("динамики: {e}"))?;
    let rate = supported.sample_rate();
    let channels = usize::from(supported.channels().max(1));
    let config = supported.config();
    let fail = |e: cpal::Error| eprintln!("[voice] playback stream error: {e}");
    let stream = match supported.sample_format() {
        cpal::SampleFormat::F32 => device.build_output_stream::<f32, _, _>(
            config,
            move |data: &mut [f32], _| {
                let mut q = queue.lock().unwrap_or_else(|e| e.into_inner());
                for frame in data.chunks_mut(channels) {
                    let s = q.pop_front().unwrap_or(0.0);
                    frame.fill(s);
                }
            },
            fail,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_output_stream::<i16, _, _>(
            config,
            move |data: &mut [i16], _| {
                let mut q = queue.lock().unwrap_or_else(|e| e.into_inner());
                for frame in data.chunks_mut(channels) {
                    let s = q.pop_front().unwrap_or(0.0).clamp(-1.0, 1.0);
                    frame.fill((s * 32767.0) as i16);
                }
            },
            fail,
            None,
        ),
        other => return Err(format!("динамики принимают неподдерживаемый формат {other:?}")),
    }
    .map_err(|e| format!("динамики: {e}"))?;
    stream.play().map_err(|e| format!("динамики: {e}"))?;
    Ok((stream, rate))
}

struct Devices {
    mtu: usize,
    input: Option<String>,
    output: Option<String>,
}

/// The device the settings name, or the default with the reason it was not used.
fn pick_device(host: &cpal::Host, wanted: Option<&str>, input: bool) -> (Option<cpal::Device>, Option<String>) {
    let default = || if input { host.default_input_device() } else { host.default_output_device() };
    let Some(label) = wanted.filter(|l| !l.trim().is_empty()) else { return (default(), None) };
    let listed = if input { host.input_devices().map(|d| d.collect::<Vec<_>>()) } else { host.output_devices().map(|d| d.collect::<Vec<_>>()) };
    let devices = match listed {
        Ok(devices) => devices,
        Err(e) => return (default(), Some(format!("список устройств недоступен ({e})"))),
    };
    let names: Vec<String> = devices
        .iter()
        .map(|d| d.description().map(|desc| desc.name().to_string()).unwrap_or_default())
        .collect();
    match match_device(label, &names) {
        Some(i) => (devices.into_iter().nth(i), None),
        None => {
            let what = if input { "Микрофон" } else { "Устройство вывода" };
            (default(), Some(format!("{what} «{label}» из настроек звука не найден, взят системный по умолчанию")))
        }
    }
}

fn audio_thread(
    control: Arc<Control>,
    speakers: Speakers,
    events: Arc<dyn Events>,
    cmds: Sender<Cmd>,
    devices: Devices,
    ready: mpsc::SyncSender<Result<(), String>>,
) {
    let host = cpal::default_host();
    let mtu = devices.mtu;
    let playback: Queue = Arc::new(Mutex::new(VecDeque::new()));
    let (out_device, out_note) = pick_device(&host, devices.output.as_deref(), false);
    if let Some(note) = out_note {
        events.device_fallback(note);
    }
    let output = out_device
        .ok_or_else(|| "Не найдено устройство вывода звука".to_string())
        .and_then(|d| build_output(&d, playback.clone()));
    let (_output_stream, out_rate) = match output {
        Ok(v) => v,
        Err(reason) => {
            let _sent = ready.send(Err(reason));
            return;
        }
    };
    let encoder = match Encoder::new(mtu) {
        Ok(e) => e,
        Err(reason) => {
            let _sent = ready.send(Err(reason));
            return;
        }
    };
    let captured: Queue = Arc::new(Mutex::new(VecDeque::new()));
    let (in_device, in_note) = pick_device(&host, devices.input.as_deref(), true);
    if let Some(note) = in_note {
        events.device_fallback(note);
    }
    let input = in_device
        .ok_or_else(|| "Не найден микрофон".to_string())
        .and_then(|d| build_input(&d, captured.clone()));
    let (_input_stream, in_rate) = match input {
        Ok((s, r)) => (Some(s), r),
        Err(reason) => {
            events.mic_failed(reason);
            (None, SAMPLE_RATE)
        }
    };
    let _sent = ready.send(Ok(()));

    let mut mic = MicPipeline::new(in_rate, encoder);
    let mut mixer = Mixer::new(out_rate);
    let mut last_levels = Instant::now();
    while !control.stop.load(Ordering::SeqCst) {
        let chunk: Vec<f32> = captured.lock().unwrap_or_else(|e| e.into_inner()).drain(..).collect();
        let transmit = control.transmit.load(Ordering::SeqCst) && !control.deafened.load(Ordering::SeqCst);
        let processing = *control.processing.lock().unwrap_or_else(|e| e.into_inner());
        for opus in mic.push(&chunk, transmit, &processing) {
            if cmds.send(Cmd::Opus(opus)).is_err() {
                return;
            }
        }
        let lead = out_rate as usize * PLAYBACK_LEAD_MS / 1000;
        while playback.lock().unwrap_or_else(|e| e.into_inner()).len() < lead {
            let pcm = mixer.mix(&speakers, control.deafened.load(Ordering::SeqCst));
            push_capped(&playback, pcm.into_iter(), out_rate as usize * QUEUE_LIMIT_MS / 1000);
        }
        if last_levels.elapsed() >= LEVEL_EVERY {
            last_levels = Instant::now();
            events.levels(if transmit { mic.level } else { 0.0 }, &heard_levels(&speakers));
        }
        std::thread::sleep(AUDIO_TICK);
    }
}

fn heard_levels(speakers: &Speakers) -> Vec<(Uuid, f32)> {
    let map = speakers.lock().unwrap_or_else(|e| e.into_inner());
    map.iter()
        .filter(|(_, s)| s.heard.is_some_and(|t| t.elapsed() < SPEAKING_HOLD))
        .map(|(id, s)| (*id, s.level))
        .collect()
}

/// Microphone samples at the device rate in, Opus frames out. When the gate
/// closes one empty frame goes out: the relay forwards it and every listener's
/// jitter buffer ends the stream at once, as with the mod's MicCapture.
pub struct MicPipeline {
    resampler: Resampler,
    pending: Vec<f32>,
    encoder: Encoder,
    chain: MicChain,
    open: bool,
    pub level: f32,
}

impl MicPipeline {
    pub fn new(device_rate: u32, encoder: Encoder) -> Self {
        MicPipeline {
            resampler: Resampler::new(device_rate, SAMPLE_RATE),
            pending: Vec::new(),
            encoder,
            chain: MicChain::default(),
            open: false,
            level: 0.0,
        }
    }

    pub fn push(&mut self, samples: &[f32], transmit: bool, processing: &Processing) -> Vec<Vec<u8>> {
        self.resampler.push(samples, &mut self.pending);
        let mut out = Vec::new();
        while self.pending.len() >= FRAME_SAMPLES {
            let mut frame = [0f32; FRAME_SAMPLES];
            frame.copy_from_slice(&self.pending[..FRAME_SAMPLES]);
            self.pending.drain(..FRAME_SAMPLES);
            self.chain.process(&mut frame, processing);
            self.level = rms(&frame).min(1.0);
            if transmit {
                match self.encoder.encode(&frame) {
                    Ok(opus) if !opus.is_empty() => out.push(opus),
                    Ok(_) => {}
                    Err(e) => eprintln!("[voice] {e}"),
                }
                self.open = true;
            } else if self.open {
                self.open = false;
                out.push(Vec::new());
            }
        }
        out
    }
}

struct Mixer {
    resampler: Resampler,
}

impl Mixer {
    fn new(device_rate: u32) -> Self {
        Mixer { resampler: Resampler::new(SAMPLE_RATE, device_rate) }
    }

    fn mix(&mut self, speakers: &Speakers, deafened: bool) -> Vec<f32> {
        let mut sum = [0f32; FRAME_SAMPLES];
        {
            let mut map = speakers.lock().unwrap_or_else(|e| e.into_inner());
            map.retain(|_, s| s.last_packet.elapsed() < SPEAKER_IDLE || !s.jitter.is_empty());
            for speaker in map.values_mut() {
                let pcm = match speaker.jitter.poll() {
                    Frame::Audio(opus) => speaker.decoder.decode(Some(&opus)),
                    Frame::Lost => speaker.decoder.decode(None),
                    Frame::End | Frame::None => continue,
                };
                let level = rms(&pcm).min(1.0);
                speaker.level = level;
                if level >= SPEAKING_LEVEL {
                    speaker.heard = Some(Instant::now());
                }
                if !deafened {
                    for (acc, s) in sum.iter_mut().zip(pcm.iter()) {
                        *acc += *s;
                    }
                }
            }
        }
        for s in sum.iter_mut() {
            *s = s.clamp(-1.0, 1.0);
        }
        let mut out = Vec::with_capacity(FRAME_SAMPLES * 2);
        self.resampler.push(&sum, &mut out);
        out
    }
}
