//! Microphone processing before Opus, following the launcher's sound settings:
//! gain, RNNoise (nnnoiseless) and automatic gain ported from the mod's
//! `audio/AutoGain.java`. Samples are in the i16 scale RNNoise expects.

use nnnoiseless::DenoiseState;

use crate::codec::FRAME_SAMPLES;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Noise {
    Off,
    Standard,
    /// RNNoise plus a gate on its voice probability: keyboard and fan never get through.
    Strong,
}

impl Noise {
    pub fn parse(raw: &str) -> Option<Noise> {
        match raw {
            "off" => Some(Noise::Off),
            "standard" => Some(Noise::Standard),
            "strong" => Some(Noise::Strong),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Processing {
    pub noise: Noise,
    pub agc: bool,
    /// Linear microphone gain, 0..=3, as the settings slider's 0..300 %.
    pub gain: f32,
}

impl Default for Processing {
    fn default() -> Self {
        Processing { noise: Noise::Standard, agc: false, gain: 1.0 }
    }
}

const SCALE: f32 = 32768.0;
const SPEECH_PROBABILITY: f32 = 0.5;
const GATE_HANGOVER_FRAMES: u32 = 10;
const SPEECH_DB_WITHOUT_VAD: f64 = -50.0;

pub struct MicChain {
    denoise: Box<DenoiseState<'static>>,
    agc: AutoGain,
    hangover: u32,
    scratch: [f32; FRAME_SAMPLES],
}

impl Default for MicChain {
    fn default() -> Self {
        MicChain { denoise: DenoiseState::new(), agc: AutoGain::default(), hangover: 0, scratch: [0.0; FRAME_SAMPLES] }
    }
}

impl MicChain {
    /// Processes one 20 ms frame of samples in -1..1 in place.
    pub fn process(&mut self, frame: &mut [f32; FRAME_SAMPLES], p: &Processing) {
        let gain = p.gain.clamp(0.0, 3.0) * SCALE;
        for s in frame.iter_mut() {
            *s = (*s * gain).clamp(-SCALE, SCALE - 1.0);
        }
        let speech = if p.noise == Noise::Off {
            AutoGain::rms_db(frame) > SPEECH_DB_WITHOUT_VAD
        } else {
            let half = DenoiseState::FRAME_SIZE;
            let mut vad: f32 = 0.0;
            for (input, output) in frame.chunks(half).zip(self.scratch.chunks_mut(half)) {
                vad = vad.max(self.denoise.process_frame(output, input));
            }
            frame.copy_from_slice(&self.scratch);
            vad >= SPEECH_PROBABILITY
        };
        if p.noise == Noise::Strong {
            if speech {
                self.hangover = GATE_HANGOVER_FRAMES;
            } else if self.hangover > 0 {
                self.hangover -= 1;
            } else {
                frame.fill(0.0);
            }
        }
        if p.agc {
            self.agc.process(frame, speech);
        }
        for s in frame.iter_mut() {
            *s = (*s / SCALE).clamp(-1.0, 1.0);
        }
    }
}

pub struct AutoGain {
    gain_db: f64,
    applied: f32,
    limiter: f32,
}

impl Default for AutoGain {
    fn default() -> Self {
        AutoGain { gain_db: 0.0, applied: 1.0, limiter: 1.0 }
    }
}

impl AutoGain {
    pub const TARGET_DB: f64 = -20.0;
    pub const MAX_GAIN_DB: f64 = 18.0;
    pub const MIN_GAIN_DB: f64 = -12.0;
    pub const LIMIT: f32 = 29200.0;
    const ATTACK_DB_PER_FRAME: f64 = 6.0;
    const RELEASE_DB_PER_FRAME: f64 = 0.15;
    const LIMITER_RELEASE: f32 = 0.0005;
    const SILENT_DB: f64 = -90.0;

    pub fn process(&mut self, frame: &mut [f32], speech: bool) {
        if frame.is_empty() {
            return;
        }
        if speech {
            let level = Self::rms_db(frame);
            if level > Self::SILENT_DB {
                let wanted = (Self::TARGET_DB - level).clamp(Self::MIN_GAIN_DB, Self::MAX_GAIN_DB);
                self.gain_db = if wanted < self.gain_db {
                    wanted.max(self.gain_db - Self::ATTACK_DB_PER_FRAME)
                } else {
                    wanted.min(self.gain_db + Self::RELEASE_DB_PER_FRAME)
                };
            }
        }
        let from = self.applied;
        let to = 10f64.powf(self.gain_db / 20.0) as f32;
        let step = (to - from) / frame.len() as f32;
        for (i, s) in frame.iter_mut().enumerate() {
            let gained = *s * (from + step * (i + 1) as f32);
            let magnitude = gained.abs();
            if magnitude * self.limiter > Self::LIMIT {
                self.limiter = Self::LIMIT / magnitude;
            } else {
                self.limiter += (1.0 - self.limiter) * Self::LIMITER_RELEASE;
            }
            *s = (gained * self.limiter).round().clamp(-Self::LIMIT, Self::LIMIT);
        }
        self.applied = to;
    }

    pub fn gain_db(&self) -> f64 {
        self.gain_db
    }

    pub fn rms_db(frame: &[f32]) -> f64 {
        if frame.is_empty() {
            return -127.0;
        }
        let sum: f64 = frame.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
        let rms = (sum / frame.len() as f64).sqrt();
        if rms <= 0.0 {
            -127.0
        } else {
            20.0 * (rms / 32768.0).log10()
        }
    }
}

/// Webview device labels and cpal names differ by decoration (Chromium adds a
/// USB "(vid:pid)" suffix, case may differ): exact match first, then containment.
pub fn match_device(label: &str, names: &[String]) -> Option<usize> {
    let want = normalize(label);
    if want.is_empty() {
        return None;
    }
    let names: Vec<String> = names.iter().map(|n| normalize(n)).collect();
    names
        .iter()
        .position(|n| *n == want)
        .or_else(|| names.iter().position(|n| !n.is_empty() && (n.contains(&want) || want.contains(n.as_str()))))
}

fn normalize(raw: &str) -> String {
    raw.trim().to_lowercase()
}
