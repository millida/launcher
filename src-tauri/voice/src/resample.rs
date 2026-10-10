/// Linear-interpolation rate converter for one mono stream. Devices run at 44.1
/// or 48 kHz (sometimes 16 kHz headsets), Opus wants 48 kHz; for speech the
/// interpolation error is far below what the codec throws away anyway.
pub struct Resampler {
    step: f64,
    pos: f64,
    last: f32,
}

impl Resampler {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        Resampler { step: f64::from(from_rate) / f64::from(to_rate.max(1)), pos: 0.0, last: 0.0 }
    }

    pub fn identity(&self) -> bool {
        (self.step - 1.0).abs() < f64::EPSILON
    }

    pub fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.identity() {
            out.extend_from_slice(input);
            return;
        }
        while self.pos < input.len() as f64 {
            let i = self.pos.floor();
            let frac = (self.pos - i) as f32;
            let idx = i as usize;
            let before = if idx == 0 { self.last } else { input[idx - 1] };
            let after = input[idx];
            out.push(before + (after - before) * frac);
            self.pos += self.step;
        }
        self.pos -= input.len() as f64;
        if let Some(&tail) = input.last() {
            self.last = tail;
        }
    }
}
