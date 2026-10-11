mod audio;
mod clock;
mod d3d;
mod encoder;
mod mf;
mod window;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use super::ring::{Ring, Ticks, TICKS_PER_SECOND};
use super::settings::RewindSettings;

pub use clock::now;
pub use window::foreground_pid;

const WINDOW_POLL: Duration = Duration::from_millis(500);
const WINDOW_WAIT: Duration = Duration::from_secs(600);
const RESIZE_SETTLE: Duration = Duration::from_millis(700);

/// What the recorder reports to the session: a reason it is not recording,
/// or the absence of one.
pub type Report = Arc<dyn Fn(Option<String>) + Send + Sync>;

pub struct Recorder {
    stop: Arc<AtomicBool>,
    threads: Vec<JoinHandle<()>>,
}

impl Drop for Recorder {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
    }
}

struct Com;

impl Com {
    fn init() -> Option<Com> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok().then_some(Com)
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn start(pid: u32, settings: RewindSettings, ring: Arc<Mutex<Ring>>, video_report: Report, audio_report: Report) -> Recorder {
    let stop = Arc::new(AtomicBool::new(false));
    let mut threads = Vec::new();
    {
        let (stop, ring, settings) = (stop.clone(), ring.clone(), settings.clone());
        threads.push(std::thread::spawn(move || {
            let _com = Com::init();
            let Ok(_mf) = mf::Startup::new() else {
                video_report(Some("В системе нет Media Foundation (Windows N без Media Feature Pack)".into()));
                return;
            };
            if let Err(why) = video(pid, &settings, &ring, &stop, &video_report) {
                video_report(Some(why));
            }
        }));
    }
    if settings.game_audio || settings.mic {
        let stop = stop.clone();
        threads.push(std::thread::spawn(move || {
            let _com = Com::init();
            let Ok(_mf) = mf::Startup::new() else { return };
            let options = audio::Options { pid, game: settings.game_audio, mic: settings.mic };
            audio::run(options, ring, stop, |problem| audio_report(problem));
        }));
    }
    Recorder { stop, threads }
}

fn wait_window(pid: u32, stop: &AtomicBool) -> Option<window::Window> {
    let since = Instant::now();
    while !stop.load(Ordering::Relaxed) && since.elapsed() < WINDOW_WAIT {
        if let Some(found) = window::find(pid) {
            return Some(found);
        }
        std::thread::sleep(WINDOW_POLL);
    }
    None
}

fn video(pid: u32, settings: &RewindSettings, ring: &Mutex<Ring>, stop: &AtomicBool, report: &Report) -> Result<(), String> {
    while !stop.load(Ordering::Relaxed) {
        let Some(window) = wait_window(pid, stop) else { return Ok(()) };
        record(window, settings, ring, stop, report)?;
    }
    Ok(())
}

/// Records one game window until it closes. A game that recreates its window
/// (some versions do on a fullscreen switch) gets a fresh encoder for the new one.
fn record(window: window::Window, settings: &RewindSettings, ring: &Mutex<Ring>, stop: &AtomicBool, report: &Report) -> Result<(), String> {
    let (client_w, client_h) = window.client_size();
    let (width, height) = settings.output_size(client_w, client_h);
    let bitrate = settings.bitrate(width, height);
    let mut encoder = encoder::open(encoder::Settings { width, height, fps: settings.fps, bitrate })?;
    let interval: Ticks = TICKS_PER_SECOND / settings.fps.max(1) as Ticks;
    let mut capture = d3d::Capture::start(&encoder.gpu, window, interval)
        .map_err(|e| format!("Windows не дал записать окно игры: {}", e.message().trim()))?;
    report(None);
    let fail = |e: windows::core::Error| format!("Запись остановилась: {}", e.message().trim());
    let mut due = clock::now();
    let mut last_time: Ticks = 0;
    let mut resized: Option<((u32, u32), Instant)> = None;
    while !stop.load(Ordering::Relaxed) && window.alive() {
        // Minecraft opens at 854x480 and grows a moment later; an encoder kept at
        // the first size shrinks every later frame down to it. A size that holds
        // for a while gets its own encoder; the ring drops the old picture size.
        if !window.minimized() {
            let (cw, ch) = window.client_size();
            let wanted = settings.output_size(cw, ch);
            if wanted == (width, height) {
                resized = None;
            } else if resized.is_some_and(|(size, since)| size == wanted && since.elapsed() >= RESIZE_SETTLE) {
                return Ok(());
            } else if resized.map(|(size, _)| size) != Some(wanted) {
                resized = Some((wanted, Instant::now()));
            }
        }
        let wait = due - clock::now();
        if wait > 0 {
            std::thread::sleep(Duration::from_nanos(wait as u64 * 100));
        }
        due = (due + interval).max(clock::now() - interval);
        encoder.pump(ring).map_err(fail)?;
        let Some(frame) = capture.latest() else { continue };
        if window.minimized() || !encoder.wants_input() {
            let _ = frame.Close();
            continue;
        }
        let content = frame.ContentSize().map_err(fail)?;
        if content.Width <= 0 || content.Height <= 0 || capture.follow_size(content).map_err(fail)? {
            let _ = frame.Close();
            continue;
        }
        let time = frame.SystemRelativeTime().map(|t| t.Duration).unwrap_or_else(|_| clock::now());
        if time <= last_time {
            let _ = frame.Close();
            continue;
        }
        let texture = d3d::frame_texture(&frame).map_err(fail)?;
        let pushed = encoder.push(&texture, content.Width as u32, content.Height as u32, time).map_err(fail);
        let _ = frame.Close();
        if pushed? {
            last_time = time;
        }
        encoder.pump(ring).map_err(fail)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::clips;
    use super::super::settings::{Quality, AUDIO_BITRATE};
    use super::*;

    #[test]
    #[ignore = "records a real window on this machine; run by hand: MILLIDA_REWIND_PID=<pid> MILLIDA_REWIND_OUT=<dir>"]
    fn records_a_real_window_into_a_clip() {
        let pid = std::env::var("MILLIDA_REWIND_PID").ok().and_then(|v| v.parse().ok()).or_else(foreground_pid).expect("a window to record");
        let out = std::env::var("MILLIDA_REWIND_OUT").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        let settings = RewindSettings { enabled: true, seconds: 15, quality: Quality::P720, fps: 30, game_audio: std::env::var("MILLIDA_REWIND_AUDIO").as_deref() != Ok("0"), mic: false, ..Default::default() };
        let ring = Arc::new(Mutex::new(Ring::new(15, 64 << 20)));
        let problems = Arc::new(Mutex::new(Vec::<String>::new()));
        let report = |problems: Arc<Mutex<Vec<String>>>| -> Report {
            Arc::new(move |p: Option<String>| problems.lock().unwrap().extend(p))
        };
        let recorder = start(pid, settings, ring.clone(), report(problems.clone()), report(problems.clone()));
        std::thread::sleep(Duration::from_secs(5));
        let clip = ring.lock().unwrap().clip(now());
        drop(recorder);
        println!("problems: {:?}", problems.lock().unwrap());
        let clip = clip.expect("the window must leave at least one keyframe in the ring");
        println!("video packets {}, audio packets {}", clip.video.len(), clip.audio.len());
        let path = clips::save(&out, "rewind test", "probe", &clip, AUDIO_BITRATE).unwrap();
        println!("saved {}", path.display());
    }
}
