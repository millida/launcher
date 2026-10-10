use windows::core::{Interface, Result};
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::Direct3D11::{ID3D11Texture2D, D3D11_BIND_RENDER_TARGET};
use windows::Win32::Media::MediaFoundation::*;

use super::super::mp4::parameter_sets;
use super::super::ring::{Packet, Ring, Ticks, VideoFormat, TICKS_PER_SECOND};
use super::d3d::{self, Converter, Gpu};
use super::mf::{self, pack, read_sample, variant_bool, variant_u32};

const PROFILE_HIGH: u32 = 100;
const PROFILE_MAIN: u32 = 77;
const ALLOCATOR_MIN: u32 = 3;
const ALLOCATOR_MAX: u32 = 8;
const KEY_OVERDUE: Ticks = 2 * TICKS_PER_SECOND;
const EVENT_NEED_INPUT: u32 = METransformNeedInput.0 as u32;
const EVENT_HAVE_OUTPUT: u32 = METransformHaveOutput.0 as u32;

pub struct Settings {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate: u32,
}

/// A hardware H.264 encoder fed with GPU textures. Hardware encoder MFTs are
/// asynchronous: they ask for input and announce output through events, which
/// the capture loop drains without blocking.
pub struct VideoEncoder {
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec: Option<ICodecAPI>,
    allocator: IMFVideoSampleAllocatorEx,
    _manager: IMFDXGIDeviceManager,
    settings: Settings,
    credits: u32,
    format: Option<VideoFormat>,
    last_key: Option<Ticks>,
    pub gpu: Gpu,
    pub converter: Converter,
}

fn adapter_of(activate: &IMFActivate) -> Option<LUID> {
    let mut raw = [0u8; 8];
    unsafe { activate.GetBlob(&MFT_ENUM_ADAPTER_LUID, &mut raw, None) }.ok()?;
    let low = u32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]);
    let high = i32::from_le_bytes([raw[4], raw[5], raw[6], raw[7]]);
    Some(LUID { LowPart: low, HighPart: high })
}

fn video_type(subtype: &windows::core::GUID, s: &Settings) -> Result<IMFMediaType> {
    let t = unsafe { MFCreateMediaType()? };
    unsafe {
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        t.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        t.SetUINT64(&MF_MT_FRAME_SIZE, pack(s.width, s.height))?;
        t.SetUINT64(&MF_MT_FRAME_RATE, pack(s.fps, 1))?;
        t.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, pack(1, 1))?;
        t.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
    }
    Ok(t)
}

/// Opens the first hardware encoder that accepts the settings, on a device
/// created on that encoder's own adapter.
pub fn open(settings: Settings) -> std::result::Result<VideoEncoder, String> {
    let found = mf::transforms(
        MFT_CATEGORY_VIDEO_ENCODER,
        MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
        (MFMediaType_Video, MFVideoFormat_NV12),
        (MFMediaType_Video, MFVideoFormat_H264),
    );
    if found.is_empty() {
        return Err("Видеокарта не умеет кодировать H.264 — клипы недоступны на этом компьютере".into());
    }
    let mut last = String::new();
    let mut settings = Some(settings);
    for activate in found {
        let Some(current) = settings.take() else { break };
        match try_open(&activate, current) {
            Ok(encoder) => return Ok(encoder),
            Err((e, back)) => {
                last = e.message();
                settings = Some(back);
                let _ = unsafe { activate.ShutdownObject() };
            }
        }
    }
    Err(format!("Кодировщик видеокарты не запустился: {}. Обнови драйвер видеокарты", last.trim()))
}

fn try_open(activate: &IMFActivate, settings: Settings) -> std::result::Result<VideoEncoder, (windows::core::Error, Settings)> {
    match build(activate, &settings) {
        Ok(parts) => Ok(parts.finish(settings)),
        Err(e) => Err((e, settings)),
    }
}

struct Parts {
    transform: IMFTransform,
    events: IMFMediaEventGenerator,
    codec: Option<ICodecAPI>,
    allocator: IMFVideoSampleAllocatorEx,
    manager: IMFDXGIDeviceManager,
    gpu: Gpu,
    converter: Converter,
}

impl Parts {
    fn finish(self, settings: Settings) -> VideoEncoder {
        VideoEncoder {
            transform: self.transform,
            events: self.events,
            codec: self.codec,
            allocator: self.allocator,
            _manager: self.manager,
            settings,
            credits: 0,
            format: None,
            last_key: None,
            gpu: self.gpu,
            converter: self.converter,
        }
    }
}

fn build(activate: &IMFActivate, s: &Settings) -> Result<Parts> {
    let gpu = match adapter_of(activate) {
        Some(luid) => d3d::device(Some(luid)).or_else(|_| d3d::device(None))?,
        None => d3d::device(None)?,
    };
    let transform: IMFTransform = unsafe { activate.ActivateObject()? };
    let attributes = unsafe { transform.GetAttributes()? };
    unsafe { attributes.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)? };
    let mut token = 0u32;
    let mut manager = None;
    unsafe { MFCreateDXGIDeviceManager(&mut token, &mut manager)? };
    let manager = manager.ok_or_else(windows::core::Error::empty)?;
    unsafe {
        manager.ResetDevice(&gpu.device, token)?;
        transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)?;
    }
    let codec = transform.cast::<ICodecAPI>().ok();
    if let Some(codec) = &codec {
        let set = |api: &windows::core::GUID, value: windows::Win32::System::Variant::VARIANT| {
            let _ = unsafe { codec.SetValue(api, &value) };
        };
        set(&CODECAPI_AVEncCommonRateControlMode, variant_u32(eAVEncCommonRateControlMode_CBR.0 as u32));
        set(&CODECAPI_AVEncCommonMeanBitRate, variant_u32(s.bitrate));
        set(&CODECAPI_AVEncMPVGOPSize, variant_u32(s.fps));
        set(&CODECAPI_AVEncMPVDefaultBPictureCount, variant_u32(0));
        set(&CODECAPI_AVLowLatencyMode, variant_bool(true));
    }
    let mut output = video_type(&MFVideoFormat_H264, s)?;
    unsafe {
        output.SetUINT32(&MF_MT_AVG_BITRATE, s.bitrate)?;
        output.SetUINT32(&MF_MT_MPEG2_PROFILE, PROFILE_HIGH)?;
    }
    if unsafe { transform.SetOutputType(0, &output, 0) }.is_err() {
        output = video_type(&MFVideoFormat_H264, s)?;
        unsafe {
            output.SetUINT32(&MF_MT_AVG_BITRATE, s.bitrate)?;
            output.SetUINT32(&MF_MT_MPEG2_PROFILE, PROFILE_MAIN)?;
            transform.SetOutputType(0, &output, 0)?;
        }
    }
    let input = video_type(&MFVideoFormat_NV12, s)?;
    unsafe { transform.SetInputType(0, &input, 0)? };
    let events: IMFMediaEventGenerator = transform.cast()?;
    let allocator: IMFVideoSampleAllocatorEx = unsafe {
        let mut raw = std::ptr::null_mut();
        MFCreateVideoSampleAllocatorEx(&IMFVideoSampleAllocatorEx::IID, &mut raw)?;
        IMFVideoSampleAllocatorEx::from_raw(raw)
    };
    let mut pool_attributes = None;
    unsafe {
        MFCreateAttributes(&mut pool_attributes, 2)?;
    }
    let pool_attributes = pool_attributes.ok_or_else(windows::core::Error::empty)?;
    unsafe {
        pool_attributes.SetUINT32(&MF_SA_D3D11_BINDFLAGS, D3D11_BIND_RENDER_TARGET.0 as u32)?;
        allocator.SetDirectXManager(&manager)?;
        allocator.InitializeSampleAllocatorEx(ALLOCATOR_MIN, ALLOCATOR_MAX, &pool_attributes, &input)?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
    }
    let converter = Converter::new(&gpu, s.width, s.height, s.fps)?;
    Ok(Parts { transform, events, codec, allocator, manager, gpu, converter })
}

impl VideoEncoder {
    /// Handles whatever the encoder has announced so far, without waiting.
    pub fn pump(&mut self, ring: &std::sync::Mutex<Ring>) -> Result<()> {
        loop {
            let event = match unsafe { self.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) } {
                Ok(event) => event,
                Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => return Ok(()),
                Err(e) => return Err(e),
            };
            match unsafe { event.GetType()? } {
                EVENT_NEED_INPUT => self.credits += 1,
                EVENT_HAVE_OUTPUT => {
                    if let Some(sample) = mf::process_output(&self.transform)? {
                        self.store(&sample, ring)?;
                    }
                }
                _ => {}
            }
        }
    }

    fn store(&mut self, sample: &IMFSample, ring: &std::sync::Mutex<Ring>) -> Result<()> {
        let out = read_sample(sample)?;
        if out.data.is_empty() {
            return Ok(());
        }
        let key = out.key || parameter_sets(&out.data).is_some();
        let mut ring = ring.lock().unwrap_or_else(|e| e.into_inner());
        if key {
            self.last_key = Some(out.time);
            let sets = parameter_sets(&out.data).or_else(|| self.sequence_header());
            if let Some((sps, pps)) = sets {
                let format = VideoFormat { width: self.settings.width, height: self.settings.height, sps, pps };
                if self.format.as_ref() != Some(&format) {
                    ring.set_format(format.clone());
                    self.format = Some(format);
                }
            }
        }
        if self.format.is_some() {
            ring.push_video(Packet { time: out.time, data: out.data.into(), key });
        }
        Ok(())
    }

    fn sequence_header(&self) -> Option<(Vec<u8>, Vec<u8>)> {
        let current = unsafe { self.transform.GetOutputCurrentType(0) }.ok()?;
        let size = unsafe { current.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER) }.ok()? as usize;
        let mut blob = vec![0u8; size];
        unsafe { current.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut blob, None) }.ok()?;
        parameter_sets(&blob)
    }

    pub fn wants_input(&self) -> bool {
        self.credits > 0
    }

    /// Converts the frame into a pooled NV12 surface and hands it over. False
    /// when the frame was dropped because every surface is still in flight.
    pub fn push(&mut self, frame: &ID3D11Texture2D, width: u32, height: u32, time: Ticks) -> Result<bool> {
        if self.credits == 0 {
            return Ok(false);
        }
        let sample = match unsafe { self.allocator.AllocateSample() } {
            Ok(sample) => sample,
            Err(e) if e.code() == MF_E_SAMPLEALLOCATOR_EMPTY => return Ok(false),
            Err(e) => return Err(e),
        };
        let buffer = unsafe { sample.GetBufferByIndex(0)? };
        let dxgi: IMFDXGIBuffer = buffer.cast()?;
        let target: ID3D11Texture2D = unsafe {
            let mut raw = std::ptr::null_mut();
            dxgi.GetResource(&ID3D11Texture2D::IID, &mut raw)?;
            ID3D11Texture2D::from_raw(raw)
        };
        let subresource = unsafe { dxgi.GetSubresourceIndex()? };
        self.converter.convert(frame, width, height, &target, subresource)?;
        unsafe {
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(TICKS_PER_SECOND / self.settings.fps.max(1) as Ticks)?;
        }
        if self.last_key.is_some_and(|key| time - key > KEY_OVERDUE) {
            if let Some(codec) = &self.codec {
                let _ = unsafe { codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &variant_u32(1)) };
            }
            self.last_key = Some(time);
        }
        unsafe { self.transform.ProcessInput(0, &sample, 0)? };
        self.credits -= 1;
        Ok(true)
    }
}

impl Drop for VideoEncoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            let _ = self.allocator.UninitializeSampleAllocator();
        }
        mf::shutdown(&self.transform);
    }
}
