//! One speaker's Opus frames reordered by sequence, one per 20 ms tick: a port
//! of the mod's `audio/JitterBuffer.java`, constants and edge cases included,
//! so the lobby and the game sound the same on a bad network.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    None,
    Audio(Vec<u8>),
    Lost,
    End,
}

pub const PREBUFFER: usize = 3;
pub const MAX_CONCEALED: u32 = 3;
pub const MAX_GAP: i64 = 10;
pub const MAX_FRAMES: usize = 25;
pub const RESTART_DISTANCE: i64 = 100;

#[derive(Default)]
pub struct JitterBuffer {
    frames: BTreeMap<i64, Vec<u8>>,
    next: Option<i64>,
    playing: bool,
    ending: bool,
    concealed: u32,
}

impl JitterBuffer {
    pub fn offer(&mut self, sequence: i64, opus: Vec<u8>) {
        if opus.is_empty() {
            self.ending = true;
            return;
        }
        if let Some(next) = self.next {
            if sequence < next {
                if next - sequence < RESTART_DISTANCE {
                    return;
                }
                self.reset();
            }
        }
        self.ending = false;
        self.frames.insert(sequence, opus);
        while self.frames.len() > MAX_FRAMES {
            self.frames.pop_first();
            if self.playing {
                self.next = self.frames.keys().next().copied();
            }
        }
    }

    pub fn poll(&mut self) -> Frame {
        if !self.playing {
            if self.frames.is_empty() {
                if self.ending {
                    self.ending = false;
                    return if self.next.is_some() { self.end_stream() } else { Frame::None };
                }
                return Frame::None;
            }
            if self.frames.len() < PREBUFFER && !self.ending {
                return Frame::None;
            }
            self.playing = true;
            self.next = self.frames.keys().next().copied();
        }
        let Some(next) = self.next else { return self.end_stream() };
        if let Some(exact) = self.frames.remove(&next) {
            self.next = Some(next + 1);
            self.concealed = 0;
            return Frame::Audio(exact);
        }
        let Some((&first, _)) = self.frames.first_key_value() else {
            if self.ending || self.concealed >= MAX_CONCEALED {
                return self.end_stream();
            }
            self.concealed += 1;
            self.next = Some(next + 1);
            return Frame::Lost;
        };
        if self.ending || first - next > MAX_GAP {
            let opus = self.frames.remove(&first).unwrap_or_default();
            self.next = Some(first + 1);
            self.concealed = 0;
            return Frame::Audio(opus);
        }
        self.next = Some(next + 1);
        Frame::Lost
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    pub fn reset(&mut self) {
        *self = JitterBuffer::default();
    }

    fn end_stream(&mut self) -> Frame {
        let was_playing = self.playing || self.next.is_some();
        self.reset();
        if was_playing {
            Frame::End
        } else {
            Frame::None
        }
    }
}
