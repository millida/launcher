use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use windows::core::{implement, Interface, Ref, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::*;
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{CoCreateInstance, IAgileObject, IAgileObject_Impl, BLOB, CLSCTX_ALL};
use windows::Win32::System::Threading::{CreateEventW, WaitForMultipleObjects};
use windows::Win32::System::Variant::VT_BLOB;

use super::super::mp4::{AUDIO_CHANNELS, AUDIO_RATE};
use super::super::ring::{Packet, Ring, Ticks, TICKS_PER_SECOND};
use super::super::settings::AUDIO_BITRATE;
use super::clock;
use super::mf::{self, read_sample};

const BUFFER: i64 = 2_000_000;
const CHUNK: usize = 480;
const LATENCY: Ticks = 600_000;
const MAX_BACKLOG: usize = AUDIO_RATE as usize / 5;
const KEEP_BACKLOG: usize = AUDIO_RATE as usize / 20;
const WAIT_MS: u32 = 10;
const ACTIVATE_TIMEOUT: Duration = Duration::from_secs(5);
const CHANNELS: usize = AUDIO_CHANNELS as usize;

fn format() -> WAVEFORMATEX {
    let block = AUDIO_CHANNELS * 2;
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: AUDIO_CHANNELS,
        nSamplesPerSec: AUDIO_RATE,
        nAvgBytesPerSec: AUDIO_RATE * block as u32,
        nBlockAlign: block,
        wBitsPerSample: 16,
        cbSize: 0,
    }
}

struct Event(HANDLE);

impl Drop for Event {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.0) };
    }
}

struct Source {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    event: Event,
    fifo: VecDeque<i16>,
}

impl Source {
    fn open(client: IAudioClient, loopback: bool) -> Result<Source> {
        let mut flags = AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
        if loopback {
            flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
        }
        let wave = format();
        unsafe { client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, BUFFER, 0, &wave, None)? };
        let event = Event(unsafe { CreateEventW(None, false, false, None)? });
        unsafe { client.SetEventHandle(event.0)? };
        let capture: IAudioCaptureClient = unsafe { client.GetService()? };
        unsafe { client.Start()? };
        Ok(Source { client, capture, event, fifo: VecDeque::new() })
    }

    fn drain(&mut self) -> Result<()> {
        loop {
            let frames = unsafe { self.capture.GetNextPacketSize()? };
            if frames == 0 {
                break;
            }
            let mut data = std::ptr::null_mut();
            let mut count = 0u32;
            let mut flags = 0u32;
            unsafe { self.capture.GetBuffer(&mut data, &mut count, &mut flags, None, None)? };
            let samples = count as usize * CHANNELS;
            if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                self.fifo.extend(std::iter::repeat_n(0i16, samples));
            } else {
                let pcm = unsafe { std::slice::from_raw_parts(data as *const i16, samples) };
                self.fifo.extend(pcm.iter().copied());
            }
            unsafe { self.capture.ReleaseBuffer(count)? };
        }
        if self.fifo.len() > MAX_BACKLOG * CHANNELS {
            let excess = self.fifo.len() - KEEP_BACKLOG * CHANNELS;
            self.fifo.drain(..excess);
        }
        Ok(())
    }
}

impl Drop for Source {
    fn drop(&mut self) {
        let _ = unsafe { self.client.Stop() };
    }
}

#[implement(IActivateAudioInterfaceCompletionHandler, IAgileObject)]
struct Activated(Mutex<Option<mpsc::Sender<()>>>);

impl IActivateAudioInterfaceCompletionHandler_Impl for Activated_Impl {
    fn ActivateCompleted(&self, _operation: Ref<'_, IActivateAudioInterfaceAsyncOperation>) -> Result<()> {
        if let Some(done) = self.0.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = done.send(());
        }
        Ok(())
    }
}

impl IAgileObject_Impl for Activated_Impl {}

/// Loopback of one process tree only, so the clip has the game and not the
/// player's browser or call. Needs Windows 10 build 20348 or later.
fn game_client(pid: u32) -> Result<IAudioClient> {
    let params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };
    // PROPVARIANT clears itself on drop, and clearing a blob frees its data: this
    // one points at `params` on the stack.
    let mut blob = core::mem::ManuallyDrop::new(PROPVARIANT::default());
    unsafe {
        let inner = &mut *blob.Anonymous.Anonymous;
        inner.vt = VT_BLOB;
        inner.Anonymous.blob = BLOB {
            cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: &params as *const AUDIOCLIENT_ACTIVATION_PARAMS as *mut u8,
        };
    }
    let (done, wait) = mpsc::channel();
    let handler: IActivateAudioInterfaceCompletionHandler = Activated(Mutex::new(Some(done))).into();
    let operation = unsafe { ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*blob), &handler)? };
    wait.recv_timeout(ACTIVATE_TIMEOUT).map_err(|_| windows::core::Error::empty())?;
    let mut result = windows::core::HRESULT(0);
    let mut activated = None;
    unsafe { operation.GetActivateResult(&mut result, &mut activated)? };
    result.ok()?;
    activated.ok_or_else(windows::core::Error::empty)?.cast()
}

fn mic_client() -> Result<IAudioClient> {
    let devices: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device = unsafe { devices.GetDefaultAudioEndpoint(eCapture, eConsole)? };
    unsafe { device.Activate(CLSCTX_ALL, None) }
}

fn audio_type(subtype: &windows::core::GUID, bytes_per_second: u32) -> Result<IMFMediaType> {
    let t = unsafe { MFCreateMediaType()? };
    unsafe {
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16)?;
        t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_RATE)?;
        t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS as u32)?;
        t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, bytes_per_second)?;
    }
    Ok(t)
}

fn aac_encoder() -> Result<IMFTransform> {
    let found = mf::transforms(
        MFT_CATEGORY_AUDIO_ENCODER,
        MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
        (MFMediaType_Audio, MFAudioFormat_PCM),
        (MFMediaType_Audio, MFAudioFormat_AAC),
    );
    let activate = found.into_iter().next().ok_or_else(windows::core::Error::empty)?;
    let transform: IMFTransform = unsafe { activate.ActivateObject()? };
    let input = audio_type(&MFAudioFormat_PCM, AUDIO_RATE * AUDIO_CHANNELS as u32 * 2)?;
    unsafe { input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, AUDIO_CHANNELS as u32 * 2)? };
    let output = audio_type(&MFAudioFormat_AAC, AUDIO_BITRATE / 8)?;
    unsafe { output.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0)? };
    let input_first = unsafe { transform.SetInputType(0, &input, 0).and_then(|_| transform.SetOutputType(0, &output, 0)) };
    if input_first.is_err() {
        unsafe {
            transform.SetOutputType(0, &output, 0)?;
            transform.SetInputType(0, &input, 0)?;
        }
    }
    unsafe {
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
    }
    Ok(transform)
}

struct Encoder {
    transform: IMFTransform,
}

impl Encoder {
    fn encode(&self, pcm: &[i16], time: Ticks, ring: &Mutex<Ring>) -> Result<()> {
        let bytes = pcm.len() * 2;
        let buffer = unsafe { MFCreateMemoryBuffer(bytes as u32)? };
        let mut ptr = std::ptr::null_mut();
        unsafe { buffer.Lock(&mut ptr, None, None)? };
        unsafe { std::ptr::copy_nonoverlapping(pcm.as_ptr() as *const u8, ptr, bytes) };
        unsafe {
            buffer.Unlock()?;
            buffer.SetCurrentLength(bytes as u32)?;
        }
        let sample = unsafe { MFCreateSample()? };
        unsafe {
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration((pcm.len() / CHANNELS) as Ticks * TICKS_PER_SECOND / AUDIO_RATE as Ticks)?;
            self.transform.ProcessInput(0, &sample, 0)?;
        }
        loop {
            match mf::process_output(&self.transform) {
                Ok(Some(out)) => {
                    let out = read_sample(&out)?;
                    if !out.data.is_empty() {
                        ring.lock().unwrap_or_else(|e| e.into_inner()).push_audio(Packet { time: out.time, data: out.data.into(), key: true });
                    }
                }
                Ok(None) => {}
                Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => return Ok(()),
                Err(e) => return Err(e),
            }
        }
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        mf::shutdown(&self.transform);
    }
}

pub fn mix(sources: &mut [VecDeque<i16>], out: &mut Vec<i16>, frames: usize) {
    out.clear();
    out.resize(frames * CHANNELS, 0);
    let mut sum = vec![0i32; frames * CHANNELS];
    for fifo in sources.iter_mut() {
        let take = fifo.len().min(frames * CHANNELS);
        for (slot, sample) in sum.iter_mut().zip(fifo.drain(..take)) {
            *slot += sample as i32;
        }
    }
    for (o, s) in out.iter_mut().zip(sum) {
        *o = s.clamp(i16::MIN as i32, i16::MAX as i32) as i16;
    }
}

pub struct Options {
    pub pid: u32,
    pub game: bool,
    pub mic: bool,
}

/// Records until `stop`; returns why audio could not start, if it could not.
pub fn run(options: Options, ring: Arc<Mutex<Ring>>, stop: Arc<AtomicBool>, started: impl FnOnce(Option<String>)) {
    let mut sources = Vec::new();
    let mut problems = Vec::new();
    if options.game {
        match game_client(options.pid).and_then(|c| Source::open(c, true)) {
            Ok(source) => sources.push(source),
            Err(_) => problems.push("звук игры недоступен: нужен Windows 10 21H2 или новее"),
        }
    }
    if options.mic {
        match mic_client().and_then(|c| Source::open(c, false)) {
            Ok(source) => sources.push(source),
            Err(_) => problems.push("микрофон недоступен"),
        }
    }
    let encoder = if sources.is_empty() {
        None
    } else {
        match aac_encoder() {
            Ok(transform) => Some(Encoder { transform }),
            Err(_) => {
                problems.push("нет кодировщика AAC в системе");
                None
            }
        }
    };
    started((!problems.is_empty()).then(|| problems.join(", ")));
    let Some(encoder) = encoder else { return };
    let events: Vec<HANDLE> = sources.iter().map(|s| s.event.0).collect();
    let origin = clock::now();
    let mut produced: i64 = 0;
    let mut pcm = Vec::with_capacity(CHUNK * CHANNELS);
    while !stop.load(Ordering::Relaxed) {
        let _ = unsafe { WaitForMultipleObjects(&events, false, WAIT_MS) };
        for source in sources.iter_mut() {
            if source.drain().is_err() {
                source.fifo.clear();
            }
        }
        let elapsed = clock::now() - origin - LATENCY;
        let mut due = elapsed.max(0) * AUDIO_RATE as i64 / TICKS_PER_SECOND - produced;
        if due > AUDIO_RATE as i64 {
            produced += due - CHUNK as i64;
            due = CHUNK as i64;
        }
        while due >= CHUNK as i64 {
            let mut fifos: Vec<VecDeque<i16>> = sources.iter_mut().map(|s| std::mem::take(&mut s.fifo)).collect();
            mix(&mut fifos, &mut pcm, CHUNK);
            for (source, fifo) in sources.iter_mut().zip(fifos) {
                source.fifo = fifo;
            }
            let time = origin + produced * TICKS_PER_SECOND / AUDIO_RATE as i64;
            if encoder.encode(&pcm, time, &ring).is_err() {
                return;
            }
            produced += CHUNK as i64;
            due -= CHUNK as i64;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mix_verdicts() {
        let mut out = Vec::new();
        let mut sources = vec![VecDeque::from(vec![1000i16, -1000, 30000, 30000]), VecDeque::from(vec![500i16, 500])];
        mix(&mut sources, &mut out, 2);
        assert_eq!(out, vec![1500, -500, 30000, 30000], "sources add up, a short source is padded with silence");
        let mut loud = vec![VecDeque::from(vec![30000i16, 30000]), VecDeque::from(vec![30000i16, -30000])];
        mix(&mut loud, &mut out, 1);
        assert_eq!(out, vec![i16::MAX, 0], "the sum clips instead of wrapping around into a crack");
        assert!(sources.iter().all(|s| s.is_empty()), "mixed samples leave their queues");
    }
}
