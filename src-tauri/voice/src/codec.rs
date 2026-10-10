//! Opus 48 kHz mono, 20 ms frames, VOIP mode: what the mod's `OpusCodec.java`
//! sends and expects.

use opus_rs::{Application, OpusDecoder, OpusEncoder};

pub const SAMPLE_RATE: u32 = 48_000;
pub const FRAME_SAMPLES: usize = 960;
pub const MAX_PAYLOAD: usize = 1275;

pub struct Encoder {
    inner: OpusEncoder,
    out: Vec<u8>,
    max_bytes: usize,
}

impl Encoder {
    /// `max_bytes` is the MTU from the ticket, clamped the way the mod clamps it.
    pub fn new(max_bytes: usize) -> Result<Self, String> {
        let inner = OpusEncoder::new(SAMPLE_RATE as i32, 1, Application::Voip)
            .map_err(|e| format!("кодек Opus не запустился: {e}"))?;
        Ok(Encoder { inner, out: vec![0; MAX_PAYLOAD], max_bytes: max_bytes.clamp(16, MAX_PAYLOAD) })
    }

    pub fn encode(&mut self, pcm: &[f32; FRAME_SAMPLES]) -> Result<Vec<u8>, String> {
        let n = self
            .inner
            .encode(pcm, FRAME_SAMPLES, &mut self.out[..self.max_bytes])
            .map_err(|e| format!("Opus encode: {e}"))?;
        Ok(self.out[..n].to_vec())
    }
}

pub struct Decoder {
    inner: OpusDecoder,
}

impl Decoder {
    pub fn new() -> Result<Self, String> {
        let inner = OpusDecoder::new(SAMPLE_RATE as i32, 1).map_err(|e| format!("кодек Opus не запустился: {e}"))?;
        Ok(Decoder { inner })
    }

    /// `None` conceals one lost frame. A packet the decoder rejects (another
    /// channel count, garbage) becomes silence, as in the mod.
    pub fn decode(&mut self, packet: Option<&[u8]>) -> [f32; FRAME_SAMPLES] {
        let mut pcm = [0f32; FRAME_SAMPLES];
        match self.inner.decode(packet.unwrap_or(&[]), FRAME_SAMPLES, &mut pcm) {
            Ok(_) => pcm,
            Err(_) => [0f32; FRAME_SAMPLES],
        }
    }
}
