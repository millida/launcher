use std::collections::VecDeque;
use std::sync::Arc;

/// Media time in 100 ns units, the clock both Windows Graphics Capture and
/// WASAPI stamp their data with.
pub type Ticks = i64;
pub const TICKS_PER_SECOND: Ticks = 10_000_000;
const GOP_SLACK: Ticks = 2 * TICKS_PER_SECOND;

#[derive(Clone, Debug)]
pub struct Packet {
    pub time: Ticks,
    pub data: Arc<[u8]>,
    pub key: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VideoFormat {
    pub width: u32,
    pub height: u32,
    pub sps: Vec<u8>,
    pub pps: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct Clip {
    pub format: VideoFormat,
    pub video: Vec<Packet>,
    pub audio: Vec<Packet>,
    pub end: Ticks,
}

/// The last few seconds of encoded video and audio. Video is dropped a whole
/// group of pictures at a time, so whatever is left always starts on a
/// keyframe and decodes on its own.
pub struct Ring {
    span: Ticks,
    cap: usize,
    bytes: usize,
    format: Option<VideoFormat>,
    video: VecDeque<Packet>,
    audio: VecDeque<Packet>,
}

impl Ring {
    pub fn new(seconds: u32, cap: usize) -> Ring {
        Ring {
            span: seconds as Ticks * TICKS_PER_SECOND,
            cap,
            bytes: 0,
            format: None,
            video: VecDeque::new(),
            audio: VecDeque::new(),
        }
    }

    pub fn set_format(&mut self, format: VideoFormat) {
        if self.format.as_ref() != Some(&format) {
            self.video.clear();
            self.audio.clear();
            self.bytes = 0;
            self.format = Some(format);
        }
    }

    #[cfg(test)]
    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn push_video(&mut self, packet: Packet) {
        if self.video.is_empty() && !packet.key {
            return;
        }
        if self.video.back().is_some_and(|last| packet.time <= last.time) {
            return;
        }
        self.bytes += packet.data.len();
        self.video.push_back(packet);
        self.trim();
    }

    pub fn push_audio(&mut self, packet: Packet) {
        if self.audio.back().is_some_and(|last| packet.time <= last.time) {
            return;
        }
        self.bytes += packet.data.len();
        self.audio.push_back(packet);
        self.trim();
    }

    fn second_key(&self) -> Option<usize> {
        self.video.iter().skip(1).position(|p| p.key).map(|i| i + 1)
    }

    fn trim(&mut self) {
        let newest = self.video.back().map(|p| p.time);
        while let (Some(newest), Some(next)) = (newest, self.second_key()) {
            let covered = newest - self.video[next].time >= self.span;
            if !covered && self.bytes <= self.cap {
                break;
            }
            for packet in self.video.drain(..next) {
                self.bytes -= packet.data.len();
            }
        }
        let Some(newest_any) = self.audio.back().map(|p| p.time).max(newest) else { return };
        let mut floor = newest_any - self.span - GOP_SLACK;
        if let Some(first) = self.video.front() {
            floor = floor.max(first.time);
        }
        while self.audio.front().is_some_and(|p| p.time < floor) || (self.bytes > self.cap && self.audio.len() > 1) {
            if let Some(packet) = self.audio.pop_front() {
                self.bytes -= packet.data.len();
            }
        }
    }

    /// The window ending at `now`, reaching back to the keyframe at or before
    /// its start. None when no picture fell inside it.
    pub fn clip(&self, now: Ticks) -> Option<Clip> {
        let format = self.format.clone()?;
        let start = now - self.span;
        let first_inside = self.video.iter().position(|p| p.time >= start && p.time <= now)?;
        let key = self.video.iter().take(first_inside + 1).rposition(|p| p.key)?;
        let video: Vec<Packet> = self.video.iter().skip(key).take_while(|p| p.time <= now).cloned().collect();
        let begin = video.first()?.time;
        let audio = self.audio.iter().filter(|p| p.time >= begin && p.time <= now).cloned().collect();
        Some(Clip { format, video, audio, end: now })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(seconds: f64, key: bool, size: usize) -> Packet {
        Packet { time: (seconds * TICKS_PER_SECOND as f64) as Ticks, data: vec![0u8; size].into(), key }
    }

    fn format() -> VideoFormat {
        VideoFormat { width: 2, height: 2, sps: vec![0x67, 0x64, 0, 0x1f], pps: vec![0x68] }
    }

    fn filled(seconds: u32, until: u32) -> Ring {
        let mut ring = Ring::new(seconds, usize::MAX);
        ring.set_format(format());
        for tenth in 0..until * 10 {
            ring.push_video(packet(tenth as f64 / 10.0, tenth % 10 == 0, 100));
        }
        ring
    }

    #[test]
    fn ring_keeps_the_window_and_starts_on_a_keyframe() {
        let ring = filled(5, 20);
        let first = ring.video.front().unwrap();
        assert!(first.key, "a ring that starts mid-GOP cannot be decoded");
        let newest = ring.video.back().unwrap().time;
        assert!(newest - first.time >= 5 * TICKS_PER_SECOND, "the ring must still cover the whole window");
        assert!(newest - first.time < 7 * TICKS_PER_SECOND, "older GOPs must go, or memory grows with play time");
    }

    #[test]
    fn byte_cap_wins_over_the_window() {
        let mut ring = Ring::new(60, 3_000);
        ring.set_format(format());
        for tenth in 0..200 {
            ring.push_video(packet(tenth as f64 / 10.0, tenth % 10 == 0, 100));
        }
        assert!(ring.bytes() <= 3_000 + 1_000, "the memory ceiling must hold even when the window is longer: {}", ring.bytes());
        assert!(ring.video.front().unwrap().key);
    }

    #[test]
    fn clip_verdicts() {
        let ring = filled(5, 20);
        let now = (19.9 * TICKS_PER_SECOND as f64) as Ticks;
        let clip = ring.clip(now).unwrap();
        assert!(clip.video[0].key, "a clip starts on a keyframe");
        assert_eq!(clip.video[0].time, 14 * TICKS_PER_SECOND, "the keyframe at or before now - 5 s");
        assert_eq!(clip.video.last().unwrap().time, now);
        let empty = Ring::new(5, usize::MAX);
        assert!(empty.clip(now).is_none(), "nothing recorded is not a clip");
        let stale = ring.clip(now + 60 * TICKS_PER_SECOND);
        assert!(stale.is_none(), "a minimized window leaves nothing inside the window, and an old picture must not pass for a new one");
    }

    #[test]
    fn video_never_starts_without_a_keyframe() {
        let mut ring = Ring::new(5, usize::MAX);
        ring.set_format(format());
        ring.push_video(packet(0.0, false, 10));
        assert_eq!(ring.bytes(), 0, "a delta frame before the first keyframe is useless");
    }

    #[test]
    fn audio_follows_the_video_window() {
        let mut ring = filled(5, 20);
        for tenth in 0..200 {
            ring.push_audio(packet(tenth as f64 / 10.0, true, 10));
        }
        let first_video = ring.video.front().unwrap().time;
        assert!(ring.audio.front().unwrap().time >= first_video - TICKS_PER_SECOND, "audio older than the video is dead weight");
        let clip = ring.clip(ring.video.back().unwrap().time).unwrap();
        assert!(clip.audio.iter().all(|p| p.time >= clip.video[0].time), "audio in a clip starts with its picture");
    }

    #[test]
    fn audio_alone_is_still_bounded() {
        let mut ring = Ring::new(5, usize::MAX);
        for tenth in 0..2_000 {
            ring.push_audio(packet(tenth as f64 / 10.0, true, 10));
        }
        assert!(ring.audio.len() <= 72, "audio keeps flowing while the window is minimized and must not pile up: {}", ring.audio.len());
    }

    #[test]
    fn a_new_format_starts_over() {
        let mut ring = filled(5, 3);
        let mut other = format();
        other.width = 4;
        ring.set_format(other);
        assert_eq!(ring.bytes(), 0, "packets of another encoder session cannot share one file");
    }
}
