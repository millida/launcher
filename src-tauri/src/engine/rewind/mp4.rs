use std::io::{Read, Seek, SeekFrom, Write};

use super::ring::{Clip, Packet, Ticks, TICKS_PER_SECOND};

const MOVIE_SCALE: u32 = 1000;
const VIDEO_SCALE: u32 = 90_000;
pub const AUDIO_RATE: u32 = 48_000;
pub const AUDIO_CHANNELS: u16 = 2;
const AAC_FRAME: u32 = 1024;
const NAL_SPS: u8 = 7;
const NAL_PPS: u8 = 8;
const NAL_AUD: u8 = 9;
const MATRIX: [u32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

/// NAL units of an Annex B stream, start codes stripped.
pub fn nal_units(stream: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= stream.len() {
        if stream[i] == 0 && stream[i + 1] == 0 && stream[i + 2] == 1 {
            starts.push((i, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    let mut units = Vec::with_capacity(starts.len());
    for (n, &(_, body)) in starts.iter().enumerate() {
        let mut end = starts.get(n + 1).map(|&(code, _)| code).unwrap_or(stream.len());
        while end > body && stream[end - 1] == 0 {
            end -= 1;
        }
        if end > body {
            units.push(&stream[body..end]);
        }
    }
    units
}

fn nal_type(unit: &[u8]) -> u8 {
    unit.first().map(|b| b & 0x1F).unwrap_or(0)
}

/// SPS and PPS of a keyframe, which the MP4 keeps once in its sample description.
pub fn parameter_sets(stream: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let units = nal_units(stream);
    let sps = units.iter().find(|u| nal_type(u) == NAL_SPS && u.len() >= 4)?;
    let pps = units.iter().find(|u| nal_type(u) == NAL_PPS)?;
    Some((sps.to_vec(), pps.to_vec()))
}

/// One access unit in the length-prefixed form `avc1` expects, without the
/// parameter sets and delimiters that live in the sample description.
pub fn to_avcc(stream: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(stream.len());
    for unit in nal_units(stream) {
        if matches!(nal_type(unit), NAL_SPS | NAL_PPS | NAL_AUD) {
            continue;
        }
        out.extend_from_slice(&(unit.len() as u32).to_be_bytes());
        out.extend_from_slice(unit);
    }
    out
}

/// AudioSpecificConfig for AAC-LC at the rate and layout the mixer produces.
pub fn audio_specific_config() -> [u8; 2] {
    let object = 2u16;
    let rate_index = 3u16;
    let value = object << 11 | rate_index << 7 | (AUDIO_CHANNELS << 3);
    value.to_be_bytes()
}

struct Boxer(Vec<u8>);

impl Boxer {
    fn new() -> Boxer {
        Boxer(Vec::new())
    }
    fn u8(&mut self, v: u8) -> &mut Self {
        self.0.push(v);
        self
    }
    fn u16(&mut self, v: u16) -> &mut Self {
        self.0.extend_from_slice(&v.to_be_bytes());
        self
    }
    fn u32(&mut self, v: u32) -> &mut Self {
        self.0.extend_from_slice(&v.to_be_bytes());
        self
    }
    fn u64(&mut self, v: u64) -> &mut Self {
        self.0.extend_from_slice(&v.to_be_bytes());
        self
    }
    fn bytes(&mut self, v: &[u8]) -> &mut Self {
        self.0.extend_from_slice(v);
        self
    }
    fn zeros(&mut self, n: usize) -> &mut Self {
        self.0.resize(self.0.len() + n, 0);
        self
    }
    fn full(&mut self, version: u8, flags: u32) -> &mut Self {
        self.u32((version as u32) << 24 | (flags & 0x00FF_FFFF))
    }
    fn matrix(&mut self) -> &mut Self {
        for v in MATRIX {
            self.u32(v);
        }
        self
    }
    fn wrap(&self, kind: &[u8; 4]) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.0.len() + 8);
        out.extend_from_slice(&((self.0.len() + 8) as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(&self.0);
        out
    }
}

fn boxed(kind: &[u8; 4], parts: &[Vec<u8>]) -> Vec<u8> {
    let mut b = Boxer::new();
    for part in parts {
        b.bytes(part);
    }
    b.wrap(kind)
}

fn descriptor(tag: u8, body: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let len = body.len();
    out.extend_from_slice(&[0x80 | ((len >> 21) & 0x7F) as u8, 0x80 | ((len >> 14) & 0x7F) as u8, 0x80 | ((len >> 7) & 0x7F) as u8, (len & 0x7F) as u8]);
    out.extend_from_slice(body);
    out
}

struct Track {
    id: u32,
    scale: u32,
    durations: Vec<u32>,
    sizes: Vec<u32>,
    offsets: Vec<u64>,
    keys: Option<Vec<u32>>,
    delay: Ticks,
}

impl Track {
    fn duration(&self) -> u64 {
        self.durations.iter().map(|d| *d as u64).sum()
    }

    fn movie_duration(&self) -> u64 {
        self.duration() * MOVIE_SCALE as u64 / self.scale as u64
    }

    fn stbl(&self, stsd: Vec<u8>) -> Vec<u8> {
        let mut stts = Boxer::new();
        let mut runs: Vec<(u32, u32)> = Vec::new();
        for &d in &self.durations {
            match runs.last_mut() {
                Some((count, value)) if *value == d => *count += 1,
                _ => runs.push((1, d)),
            }
        }
        stts.full(0, 0).u32(runs.len() as u32);
        for (count, value) in runs {
            stts.u32(count).u32(value);
        }
        let mut stsz = Boxer::new();
        stsz.full(0, 0).u32(0).u32(self.sizes.len() as u32);
        for &s in &self.sizes {
            stsz.u32(s);
        }
        let mut stsc = Boxer::new();
        stsc.full(0, 0).u32(1).u32(1).u32(1).u32(1);
        let mut co64 = Boxer::new();
        co64.full(0, 0).u32(self.offsets.len() as u32);
        for &o in &self.offsets {
            co64.u64(o);
        }
        let mut parts = vec![stsd, stts.wrap(b"stts")];
        if let Some(keys) = &self.keys {
            let mut stss = Boxer::new();
            stss.full(0, 0).u32(keys.len() as u32);
            for &k in keys {
                stss.u32(k);
            }
            parts.push(stss.wrap(b"stss"));
        }
        parts.extend([stsz.wrap(b"stsz"), stsc.wrap(b"stsc"), co64.wrap(b"co64")]);
        boxed(b"stbl", &parts)
    }

    fn trak(&self, handler: &[u8; 4], name: &str, width: u32, height: u32, media_header: Vec<u8>, stsd: Vec<u8>) -> Vec<u8> {
        let audio = handler == b"soun";
        let delay = (self.delay.max(0) as u64) * MOVIE_SCALE as u64 / TICKS_PER_SECOND as u64;
        let mut tkhd = Boxer::new();
        tkhd.full(0, 3).u32(0).u32(0).u32(self.id).u32(0).u32((self.movie_duration() + delay) as u32).zeros(8);
        tkhd.u16(0).u16(0).u16(if audio { 0x0100 } else { 0 }).u16(0).matrix().u32(width << 16).u32(height << 16);
        let mut parts = vec![tkhd.wrap(b"tkhd")];
        if delay > 0 {
            let mut elst = Boxer::new();
            elst.full(0, 0).u32(2);
            elst.u32(delay as u32).u32(u32::MAX).u16(1).u16(0);
            elst.u32(self.movie_duration() as u32).u32(0).u16(1).u16(0);
            parts.push(boxed(b"edts", &[elst.wrap(b"elst")]));
        }
        let mut mdhd = Boxer::new();
        mdhd.full(0, 0).u32(0).u32(0).u32(self.scale).u32(self.duration() as u32).u16(0x55C4).u16(0);
        let mut hdlr = Boxer::new();
        hdlr.full(0, 0).u32(0).bytes(handler).zeros(12).bytes(name.as_bytes()).u8(0);
        let mut url = Boxer::new();
        url.full(0, 1);
        let mut dref = Boxer::new();
        dref.full(0, 0).u32(1).bytes(&url.wrap(b"url "));
        let dinf = boxed(b"dinf", &[dref.wrap(b"dref")]);
        let minf = boxed(b"minf", &[media_header, dinf, self.stbl(stsd)]);
        let mdia = boxed(b"mdia", &[mdhd.wrap(b"mdhd"), hdlr.wrap(b"hdlr"), minf]);
        parts.push(mdia);
        boxed(b"trak", &parts)
    }
}

fn avc1(format: &super::ring::VideoFormat) -> Vec<u8> {
    let sps = &format.sps;
    let mut avcc = Boxer::new();
    avcc.u8(1).u8(sps[1]).u8(sps[2]).u8(sps[3]).u8(0xFF).u8(0xE1);
    avcc.u16(sps.len() as u16).bytes(sps).u8(1).u16(format.pps.len() as u16).bytes(&format.pps);
    let mut entry = Boxer::new();
    entry.zeros(6).u16(1).zeros(16).u16(format.width as u16).u16(format.height as u16);
    entry.u32(0x0048_0000).u32(0x0048_0000).u32(0).u16(1).zeros(32).u16(0x0018).u16(0xFFFF);
    entry.bytes(&avcc.wrap(b"avcC"));
    let mut stsd = Boxer::new();
    stsd.full(0, 0).u32(1).bytes(&entry.wrap(b"avc1"));
    stsd.wrap(b"stsd")
}

fn mp4a(bitrate: u32) -> Vec<u8> {
    let config = descriptor(5, &audio_specific_config());
    let mut decoder = Boxer::new();
    decoder.u8(0x40).u8(0x15).u8(0).u16(0).u32(bitrate).u32(bitrate).bytes(&config);
    let decoder = descriptor(4, &decoder.0);
    let sl = descriptor(6, &[2]);
    let mut es = Boxer::new();
    es.u16(2).u8(0).bytes(&decoder).bytes(&sl);
    let mut esds = Boxer::new();
    esds.full(0, 0).bytes(&descriptor(3, &es.0));
    let mut entry = Boxer::new();
    entry.zeros(6).u16(1).zeros(8).u16(AUDIO_CHANNELS).u16(16).u16(0).u16(0).u32(AUDIO_RATE << 16);
    entry.bytes(&esds.wrap(b"esds"));
    let mut stsd = Boxer::new();
    stsd.full(0, 0).u32(1).bytes(&entry.wrap(b"mp4a"));
    stsd.wrap(b"stsd")
}

fn to_scale(ticks: Ticks, scale: u32) -> u64 {
    (ticks.max(0) as i128 * scale as i128 / TICKS_PER_SECOND as i128) as u64
}

fn video_durations(packets: &[Packet], end: Ticks) -> Vec<u32> {
    let Some(first) = packets.first().map(|p| p.time) else { return Vec::new() };
    let stamps: Vec<u64> = packets.iter().map(|p| to_scale(p.time - first, VIDEO_SCALE)).collect();
    let last_gap = stamps.windows(2).last().map(|w| w[1] - w[0]).unwrap_or(VIDEO_SCALE as u64 / 30);
    let tail = to_scale(end - first, VIDEO_SCALE).saturating_sub(*stamps.last().unwrap_or(&0));
    let mut durations: Vec<u32> = stamps.windows(2).map(|w| (w[1] - w[0]).max(1) as u32).collect();
    durations.push(tail.clamp(1, last_gap.max(1)) as u32);
    durations
}

/// Writes the clip as a progressive MP4: header, samples, then the index.
pub fn write<W: Write + Seek>(out: &mut W, clip: &Clip, audio_bitrate: u32) -> std::io::Result<()> {
    let Some(start) = clip.video.first().map(|p| p.time) else {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "no video"));
    };
    let mut ftyp = Boxer::new();
    ftyp.bytes(b"isom").u32(0x200).bytes(b"isomiso2avc1mp41");
    out.write_all(&ftyp.wrap(b"ftyp"))?;
    let mdat_at = out.stream_position()?;
    out.write_all(&1u32.to_be_bytes())?;
    out.write_all(b"mdat")?;
    out.write_all(&0u64.to_be_bytes())?;
    let mut video = Track {
        id: 1,
        scale: VIDEO_SCALE,
        durations: video_durations(&clip.video, clip.end),
        sizes: Vec::with_capacity(clip.video.len()),
        offsets: Vec::with_capacity(clip.video.len()),
        keys: Some(Vec::new()),
        delay: 0,
    };
    let mut audio = Track {
        id: 2,
        scale: AUDIO_RATE,
        durations: vec![AAC_FRAME; clip.audio.len()],
        sizes: Vec::with_capacity(clip.audio.len()),
        offsets: Vec::with_capacity(clip.audio.len()),
        keys: None,
        delay: clip.audio.first().map(|p| p.time - start).unwrap_or(0),
    };
    let (mut v, mut a) = (0usize, 0usize);
    while v < clip.video.len() || a < clip.audio.len() {
        let take_video = match (clip.video.get(v), clip.audio.get(a)) {
            (Some(pv), Some(pa)) => pv.time <= pa.time,
            (Some(_), None) => true,
            _ => false,
        };
        let at = out.stream_position()?;
        if take_video {
            let packet = &clip.video[v];
            let body = to_avcc(&packet.data);
            out.write_all(&body)?;
            video.offsets.push(at);
            video.sizes.push(body.len() as u32);
            if packet.key {
                if let Some(keys) = video.keys.as_mut() {
                    keys.push(v as u32 + 1);
                }
            }
            v += 1;
        } else {
            let packet = &clip.audio[a];
            out.write_all(&packet.data)?;
            audio.offsets.push(at);
            audio.sizes.push(packet.data.len() as u32);
            a += 1;
        }
    }
    let end = out.stream_position()?;
    out.seek(SeekFrom::Start(mdat_at + 8))?;
    out.write_all(&(end - mdat_at).to_be_bytes())?;
    out.seek(SeekFrom::Start(end))?;

    let format = &clip.format;
    let mut vmhd = Boxer::new();
    vmhd.full(0, 1).zeros(8);
    let mut traks = vec![video.trak(b"vide", "Millida Video", format.width, format.height, vmhd.wrap(b"vmhd"), avc1(format))];
    let mut duration = video.movie_duration();
    if !clip.audio.is_empty() {
        let mut smhd = Boxer::new();
        smhd.full(0, 0).zeros(4);
        traks.push(audio.trak(b"soun", "Millida Audio", 0, 0, smhd.wrap(b"smhd"), mp4a(audio_bitrate)));
        duration = duration.max(audio.movie_duration() + to_scale(audio.delay, MOVIE_SCALE));
    }
    let mut mvhd = Boxer::new();
    mvhd.full(0, 0).u32(0).u32(0).u32(MOVIE_SCALE).u32(duration as u32).u32(0x0001_0000).u16(0x0100).zeros(10);
    mvhd.matrix().zeros(24).u32(3);
    let mut parts = vec![mvhd.wrap(b"mvhd")];
    parts.append(&mut traks);
    out.write_all(&boxed(b"moov", &parts))?;
    out.flush()
}

/// Length of an MP4 in milliseconds, read from `mvhd` by walking box headers,
/// so listing clips never reads their media.
pub fn duration_ms<R: Read + Seek>(input: &mut R) -> Option<u64> {
    let total = input.seek(SeekFrom::End(0)).ok()?;
    let mut at = 0u64;
    let mut moov_end = None;
    while at + 8 <= total {
        input.seek(SeekFrom::Start(at)).ok()?;
        let mut head = [0u8; 8];
        input.read_exact(&mut head).ok()?;
        let mut size = u32::from_be_bytes([head[0], head[1], head[2], head[3]]) as u64;
        let mut header = 8;
        if size == 1 {
            let mut large = [0u8; 8];
            input.read_exact(&mut large).ok()?;
            size = u64::from_be_bytes(large);
            header = 16;
        }
        if size < header {
            return None;
        }
        match (&head[4..8], moov_end) {
            (b"moov", None) => {
                moov_end = Some(at + size);
                at += header;
                continue;
            }
            (b"mvhd", Some(_)) => {
                let mut body = [0u8; 32];
                input.read_exact(&mut body).ok()?;
                return if body[0] == 1 {
                    let scale = u32::from_be_bytes(body[20..24].try_into().ok()?) as u64;
                    let duration = u64::from_be_bytes(body[24..32].try_into().ok()?);
                    (scale > 0).then(|| duration * 1000 / scale)
                } else {
                    let scale = u32::from_be_bytes(body[12..16].try_into().ok()?) as u64;
                    let duration = u32::from_be_bytes(body[16..20].try_into().ok()?) as u64;
                    (scale > 0).then(|| duration * 1000 / scale)
                };
            }
            _ => {}
        }
        at += size;
        if moov_end.is_some_and(|end| at >= end) {
            return None;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::ring::VideoFormat;
    use super::*;
    use std::io::Cursor;

    const SPS: [u8; 6] = [0x67, 0x64, 0x00, 0x28, 0xAC, 0xD9];
    const PPS: [u8; 4] = [0x68, 0xEB, 0xE3, 0xCB];

    fn keyframe() -> Vec<u8> {
        let mut out = vec![0, 0, 0, 1, 0x09, 0xF0];
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(&SPS);
        out.extend_from_slice(&[0, 0, 1]);
        out.extend_from_slice(&PPS);
        out.extend_from_slice(&[0, 0, 0, 1, 0x65, 0x88, 0x84, 0x21]);
        out
    }

    fn clip(frames: usize, audio: usize) -> Clip {
        let video = (0..frames)
            .map(|i| Packet {
                time: 1_000_000 + i as Ticks * TICKS_PER_SECOND / 30,
                data: if i % 30 == 0 { keyframe().into() } else { vec![0, 0, 0, 1, 0x41, 0x9A, i as u8].into() },
                key: i % 30 == 0,
            })
            .collect();
        let audio = (0..audio)
            .map(|i| Packet { time: 1_500_000 + i as Ticks * 213_333, data: vec![0x21, 0x10, i as u8].into(), key: true })
            .collect();
        Clip {
            format: VideoFormat { width: 1280, height: 720, sps: SPS.to_vec(), pps: PPS.to_vec() },
            video,
            audio,
            end: 1_000_000 + frames as Ticks * TICKS_PER_SECOND / 30,
        }
    }

    fn find(data: &[u8], kind: &[u8; 4]) -> Option<usize> {
        data.windows(4).position(|w| w == kind)
    }

    #[test]
    fn annex_b_verdicts() {
        let frame = keyframe();
        let units = nal_units(&frame);
        assert_eq!(units.len(), 4, "3- and 4-byte start codes both split units");
        assert_eq!(parameter_sets(&frame), Some((SPS.to_vec(), PPS.to_vec())), "SPS and PPS come out whole");
        let avcc = to_avcc(&frame);
        assert_eq!(avcc, vec![0, 0, 0, 4, 0x65, 0x88, 0x84, 0x21], "only the slice remains, length-prefixed");
        assert_eq!(to_avcc(&[0, 0, 1, 0x41, 0x9A, 0, 0, 0, 0, 1, 0x41, 0x9B]), vec![0, 0, 0, 2, 0x41, 0x9A, 0, 0, 0, 2, 0x41, 0x9B], "the zero before a 4-byte start code is not part of the unit");
        assert!(parameter_sets(&[0, 0, 1, 0x41, 1]).is_none(), "a delta frame has no parameter sets");
    }

    #[test]
    fn audio_config_is_aac_lc_48k_stereo() {
        assert_eq!(audio_specific_config(), [0x11, 0x90], "players reject an AudioSpecificConfig that disagrees with the stream");
    }

    #[test]
    fn written_file_is_a_consistent_mp4() {
        let source = clip(90, 100);
        let mut out = Cursor::new(Vec::new());
        write(&mut out, &source, 192_000).unwrap();
        let data = out.into_inner();
        assert_eq!(&data[4..8], b"ftyp");
        let mdat = find(&data, b"mdat").unwrap() - 4;
        let mdat_size = u64::from_be_bytes(data[mdat + 8..mdat + 16].try_into().unwrap()) as usize;
        let moov = mdat + mdat_size;
        assert_eq!(&data[moov + 4..moov + 8], b"moov", "the mdat size must land exactly on moov");
        let moov_size = u32::from_be_bytes(data[moov..moov + 4].try_into().unwrap()) as usize;
        assert_eq!(moov + moov_size, data.len(), "moov is the last box and its size is right");
        let moov_data = &data[moov..];
        assert_eq!(moov_data.windows(4).filter(|w| w == b"trak").count(), 2, "video and audio tracks");
        let stss = find(moov_data, b"stss").unwrap();
        let keys = u32::from_be_bytes(moov_data[stss + 8..stss + 12].try_into().unwrap());
        assert_eq!(keys, 3, "every keyframe is a sync sample, or seeking breaks");
        let co64 = find(moov_data, b"co64").unwrap();
        let first = u64::from_be_bytes(moov_data[co64 + 12..co64 + 20].try_into().unwrap()) as usize;
        assert_eq!(&data[first..first + 5], &[0, 0, 0, 4, 0x65], "the first chunk offset points at the first video sample");
        assert!(find(moov_data, b"elst").is_some(), "audio starting after the picture is delayed by an edit list");
        let length = duration_ms(&mut Cursor::new(&data)).unwrap();
        assert!((2990..=3000).contains(&length), "90 frames at 30 fps last 3 s, got {} ms", length);
    }

    #[test]
    fn video_only_clip_has_one_track() {
        let mut out = Cursor::new(Vec::new());
        write(&mut out, &clip(30, 0), 192_000).unwrap();
        let data = out.into_inner();
        assert_eq!(data.windows(4).filter(|w| w == b"trak").count(), 1, "no audio means no empty audio track");
    }

    #[test]
    fn durations_follow_the_timestamps() {
        let packets: Vec<Packet> = [0, 333_334, 1_000_000]
            .iter()
            .map(|&t| Packet { time: t, data: vec![0].into(), key: true })
            .collect();
        let d = video_durations(&packets, 1_100_000);
        assert_eq!(d, vec![3000, 6000, 900], "a dropped frame stretches the previous one; the last ends at the save moment");
    }

    #[test]
    fn duration_of_garbage_is_none() {
        assert_eq!(duration_ms(&mut Cursor::new(vec![0u8; 3])), None);
        assert_eq!(duration_ms(&mut Cursor::new(vec![0, 0, 0, 4, b'm', b'o', b'o', b'v'])), None, "a box smaller than its header must not loop");
    }
}
