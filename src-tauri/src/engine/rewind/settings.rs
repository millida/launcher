use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::engine::core::{data_dir, write_json_atomic};

pub const DEFAULT_HOTKEY: &str = "Alt+F10";
pub const SECONDS: [u32; 4] = [15, 30, 60, 120];
pub const FPS: [u32; 2] = [30, 60];
const MAX_HOTKEY: usize = 40;
const MIN_BITRATE: u32 = 4_000_000;
const MAX_BITRATE: u32 = 24_000_000;
const MAX_NATIVE_HEIGHT: u32 = 1440;
pub const AUDIO_BITRATE: u32 = 192_000;
const HARD_CAP_BYTES: usize = 512 * 1024 * 1024;

static LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Quality {
    #[serde(rename = "720p")]
    P720,
    #[serde(rename = "1080p")]
    P1080,
    #[serde(rename = "native")]
    Native,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RewindSettings {
    pub enabled: bool,
    pub seconds: u32,
    pub quality: Quality,
    pub fps: u32,
    pub game_audio: bool,
    pub mic: bool,
    pub hotkey: String,
}

impl Default for RewindSettings {
    fn default() -> Self {
        RewindSettings {
            enabled: false,
            seconds: 30,
            quality: Quality::P1080,
            fps: 60,
            game_audio: true,
            mic: false,
            hotkey: DEFAULT_HOTKEY.into(),
        }
    }
}

fn nearest(choices: &[u32], value: u32) -> u32 {
    choices.iter().copied().min_by_key(|c| c.abs_diff(value)).unwrap_or(value)
}

fn hotkey_ok(hotkey: &str) -> bool {
    !hotkey.is_empty()
        && hotkey.len() <= MAX_HOTKEY
        && hotkey.split('+').all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_alphanumeric()))
        && hotkey.contains('+')
}

impl RewindSettings {
    /// Values arrive from the webview and from a file an older version wrote.
    pub fn sanitized(mut self) -> Self {
        self.seconds = nearest(&SECONDS, self.seconds);
        self.fps = nearest(&FPS, self.fps);
        self.hotkey = self.hotkey.trim().to_string();
        if !hotkey_ok(&self.hotkey) {
            self.hotkey = DEFAULT_HOTKEY.into();
        }
        self
    }

    /// The encoded picture for a window whose client area is `width` x `height`:
    /// never upscaled, even on both sides, as H.264 needs.
    pub fn output_size(&self, width: u32, height: u32) -> (u32, u32) {
        let (width, height) = (width.max(2), height.max(2));
        let target = match self.quality {
            Quality::P720 => 720,
            Quality::P1080 => 1080,
            Quality::Native => MAX_NATIVE_HEIGHT,
        }
        .min(height);
        let scaled = (width as u64 * target as u64 / height as u64) as u32;
        (even(scaled), even(target))
    }

    pub fn bitrate(&self, width: u32, height: u32) -> u32 {
        let bits_per_pixel = if self.fps >= 60 { 0.09 } else { 0.13 };
        let raw = width as f64 * height as f64 * self.fps as f64 * bits_per_pixel;
        (raw as u32).clamp(MIN_BITRATE, MAX_BITRATE)
    }

    /// What the ring may hold: the encoder overshoots its rate on busy scenes and
    /// a clip starts at the keyframe before the window, so there is headroom,
    /// but the total never runs past a fixed ceiling whatever the settings say.
    pub fn memory_cap(&self, video_bitrate: u32) -> usize {
        let per_second = (video_bitrate as usize + AUDIO_BITRATE as usize) / 8;
        (per_second * (self.seconds as usize + 4) * 3 / 2).min(HARD_CAP_BYTES)
    }
}

fn even(value: u32) -> u32 {
    (value & !1).max(2)
}

fn file() -> std::path::PathBuf {
    data_dir().join("rewind.json")
}

pub fn load() -> RewindSettings {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    std::fs::read_to_string(file())
        .ok()
        .and_then(|text| serde_json::from_str::<RewindSettings>(&text).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn store(settings: RewindSettings) -> Result<RewindSettings, String> {
    let clean = settings.sanitized();
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    write_json_atomic(&file(), &clean).map_err(|e| format!("Не удалось сохранить настройки клипов: {}", e))?;
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_from_outside_snap_to_the_offered_choices() {
        let cases = [
            (RewindSettings { seconds: 0, ..Default::default() }, 15, "zero seconds would record nothing"),
            (RewindSettings { seconds: 100_000, ..Default::default() }, 120, "a huge window must not grow the ring without bound"),
            (RewindSettings { seconds: 50, ..Default::default() }, 60, "an unlisted value goes to the nearest choice"),
        ];
        for (input, want, why) in cases {
            assert_eq!(input.sanitized().seconds, want, "{}", why);
        }
        assert_eq!(RewindSettings { fps: 240, ..Default::default() }.sanitized().fps, 60, "fps above 60 costs the game frames");
    }

    #[test]
    fn hotkey_verdicts() {
        let cases = [
            ("Alt+F10", "Alt+F10", "the default is valid"),
            ("Ctrl+Shift+R", "Ctrl+Shift+R", "a chord with modifiers is kept"),
            ("F10", DEFAULT_HOTKEY, "a bare key would fire while typing in chat"),
            ("", DEFAULT_HOTKEY, "empty falls back"),
            ("Alt+;rm -rf", DEFAULT_HOTKEY, "only letters and digits between the pluses"),
            ("Alt++", DEFAULT_HOTKEY, "an empty part is not a key"),
        ];
        for (input, want, why) in cases {
            let s = RewindSettings { hotkey: input.into(), ..Default::default() }.sanitized();
            assert_eq!(s.hotkey, want, "{}", why);
        }
    }

    #[test]
    fn output_size_verdicts() {
        let at = |quality| RewindSettings { quality, ..Default::default() };
        let cases = [
            (at(Quality::P1080), (2560, 1440), (1920, 1080), "16:9 window scaled down to 1080p"),
            (at(Quality::P720), (1920, 1080), (1280, 720), "720p preset"),
            (at(Quality::P1080), (854, 480), (854, 480), "never upscaled"),
            (at(Quality::P720), (1001, 777), (926, 720), "odd sizes become even for the encoder"),
            (at(Quality::Native), (3840, 2160), (2560, 1440), "native is capped so the hardware encoder keeps up"),
            (at(Quality::P1080), (0, 0), (2, 2), "a zero window never divides by zero"),
        ];
        for (settings, (w, h), want, why) in cases {
            assert_eq!(settings.output_size(w, h), want, "{}", why);
        }
    }

    #[test]
    fn memory_stays_bounded() {
        let s = RewindSettings { seconds: 120, ..Default::default() };
        let cap = s.memory_cap(s.bitrate(2560, 1440));
        assert!(cap <= HARD_CAP_BYTES, "the ring must never exceed the hard ceiling, got {}", cap);
        let small = RewindSettings { seconds: 15, ..Default::default() };
        assert!(small.memory_cap(small.bitrate(1280, 720)) < 64 * 1024 * 1024, "a short 720p ring is small");
    }

    #[test]
    fn older_file_without_new_fields_still_loads() {
        let parsed: RewindSettings = serde_json::from_str(r#"{"enabled":true,"quality":"720p"}"#).unwrap();
        assert!(parsed.enabled);
        assert_eq!(parsed.quality, Quality::P720);
        assert_eq!(parsed.hotkey, DEFAULT_HOTKEY, "missing fields take defaults");
    }
}
