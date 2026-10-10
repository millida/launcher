use windows::core::{Interface, Result, GUID};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_BOOL, VT_UI4};

use super::super::ring::Ticks;

/// MFStartup is reference counted; each recorder holds one count for its life.
pub struct Startup;

impl Startup {
    pub fn new() -> Result<Startup> {
        unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL)? };
        Ok(Startup)
    }
}

impl Drop for Startup {
    fn drop(&mut self) {
        let _ = unsafe { MFShutdown() };
    }
}

pub fn transforms(category: GUID, flags: MFT_ENUM_FLAG, input: (GUID, GUID), output: (GUID, GUID)) -> Vec<IMFActivate> {
    let input = MFT_REGISTER_TYPE_INFO { guidMajorType: input.0, guidSubtype: input.1 };
    let output = MFT_REGISTER_TYPE_INFO { guidMajorType: output.0, guidSubtype: output.1 };
    let mut list: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count = 0u32;
    if unsafe { MFTEnumEx(category, flags, Some(&input), Some(&output), &mut list, &mut count) }.is_err() || list.is_null() {
        return Vec::new();
    }
    let found = (0..count as usize).filter_map(|i| unsafe { (*list.add(i)).take() }).collect();
    unsafe { CoTaskMemFree(Some(list as *const core::ffi::c_void)) };
    found
}

fn variant(vt: windows::Win32::System::Variant::VARENUM, value: VARIANT_0_0_0) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: core::mem::ManuallyDrop::new(VARIANT_0_0 { vt, wReserved1: 0, wReserved2: 0, wReserved3: 0, Anonymous: value }),
        },
    }
}

pub fn variant_u32(value: u32) -> VARIANT {
    variant(VT_UI4, VARIANT_0_0_0 { ulVal: value })
}

pub fn variant_bool(value: bool) -> VARIANT {
    variant(VT_BOOL, VARIANT_0_0_0 { boolVal: windows::Win32::Foundation::VARIANT_BOOL(if value { -1 } else { 0 }) })
}

pub fn pack(high: u32, low: u32) -> u64 {
    (high as u64) << 32 | low as u64
}

pub struct Output {
    pub data: Vec<u8>,
    pub time: Ticks,
    pub key: bool,
}

pub fn read_sample(sample: &IMFSample) -> Result<Output> {
    let buffer = unsafe { sample.ConvertToContiguousBuffer()? };
    let mut ptr = std::ptr::null_mut();
    let mut length = 0u32;
    unsafe { buffer.Lock(&mut ptr, None, Some(&mut length))? };
    let data = if ptr.is_null() { Vec::new() } else { unsafe { std::slice::from_raw_parts(ptr, length as usize) }.to_vec() };
    let _ = unsafe { buffer.Unlock() };
    let time = unsafe { sample.GetSampleTime() }.unwrap_or(0);
    let key = unsafe { sample.GetUINT32(&MFSampleExtension_CleanPoint) }.unwrap_or(0) != 0;
    Ok(Output { data, time, key })
}

/// Pulls finished samples from a transform. The sample buffer is ours unless
/// the transform says it brings its own.
pub fn process_output(transform: &IMFTransform) -> Result<Option<IMFSample>> {
    let info = unsafe { transform.GetOutputStreamInfo(0)? };
    let provides = info.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES.0 as u32) != 0;
    let mine = if provides {
        None
    } else {
        let sample = unsafe { MFCreateSample()? };
        let buffer = unsafe { MFCreateMemoryBuffer(info.cbSize.max(1 << 16))? };
        unsafe { sample.AddBuffer(&buffer)? };
        Some(sample)
    };
    let mut buffers = [MFT_OUTPUT_DATA_BUFFER {
        dwStreamID: 0,
        pSample: core::mem::ManuallyDrop::new(mine),
        dwStatus: 0,
        pEvents: core::mem::ManuallyDrop::new(None),
    }];
    let mut status = 0u32;
    let result = unsafe { transform.ProcessOutput(0, &mut buffers, &mut status) };
    let [buffer] = buffers;
    let sample = core::mem::ManuallyDrop::into_inner(buffer.pSample);
    drop(core::mem::ManuallyDrop::into_inner(buffer.pEvents));
    match result {
        Ok(()) => Ok(sample),
        Err(e) if e.code() == MF_E_TRANSFORM_STREAM_CHANGE => {
            let fresh = unsafe { transform.GetOutputAvailableType(0, 0)? };
            unsafe { transform.SetOutputType(0, &fresh, 0)? };
            Ok(None)
        }
        Err(e) => Err(e),
    }
}

pub fn shutdown(transform: &IMFTransform) {
    if let Ok(shut) = transform.cast::<IMFShutdown>() {
        let _ = unsafe { shut.Shutdown() };
    }
}
