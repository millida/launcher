use std::collections::HashMap;

use windows::core::{Interface, Result};
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, LUID, RECT};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_RATIONAL, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIAdapter, IDXGIDevice, IDXGIFactory4};
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

use super::window::Window;

const POOL_BUFFERS: i32 = 2;
const OUTPUT_COLOR_SPACE_BT709_STUDIO: u32 = (1 << 2) | (1 << 4);

pub struct Gpu {
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
}

/// A device on the adapter the encoder lives on, protected for the encoder's
/// own threads, which reach the same immediate context through MF.
pub fn device(adapter: Option<LUID>) -> Result<Gpu> {
    let adapter: Option<IDXGIAdapter> = match adapter {
        Some(luid) => {
            let factory: IDXGIFactory4 = unsafe { CreateDXGIFactory1()? };
            Some(unsafe { factory.EnumAdapterByLuid(luid)? })
        }
        None => None,
    };
    let driver = if adapter.is_some() { D3D_DRIVER_TYPE_UNKNOWN } else { D3D_DRIVER_TYPE_HARDWARE };
    let mut device = None;
    let mut context = None;
    unsafe {
        D3D11CreateDevice(
            adapter.as_ref(),
            driver,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
    }
    let device: ID3D11Device = device.ok_or_else(windows::core::Error::empty)?;
    let context: ID3D11DeviceContext = context.ok_or_else(windows::core::Error::empty)?;
    let _ = unsafe { device.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true) };
    Ok(Gpu { device, context })
}

pub struct Capture {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    winrt_device: IDirect3DDevice,
    size: SizeInt32,
}

impl Capture {
    pub fn start(gpu: &Gpu, window: Window, min_interval: i64) -> Result<Capture> {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(window.hwnd())? };
        let dxgi: IDXGIDevice = gpu.device.cast()?;
        let winrt_device: IDirect3DDevice = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let size = item.Size()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, POOL_BUFFERS, size)?;
        let session = pool.CreateCaptureSession(&item)?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        let _ = session.SetIsBorderRequired(false);
        let _ = session.SetMinUpdateInterval(windows::Foundation::TimeSpan { Duration: min_interval });
        session.StartCapture()?;
        Ok(Capture { pool, session, winrt_device, size })
    }

    /// The newest frame waiting in the pool; older ones are released unseen.
    pub fn latest(&self) -> Option<Direct3D11CaptureFrame> {
        let mut newest: Option<Direct3D11CaptureFrame> = None;
        while let Ok(frame) = self.pool.TryGetNextFrame() {
            if let Some(old) = newest.replace(frame) {
                let _ = old.Close();
            }
        }
        newest
    }

    /// True when the pool was rebuilt for a new window size; the frame in hand
    /// still belongs to the old buffers and is skipped.
    pub fn follow_size(&mut self, content: SizeInt32) -> Result<bool> {
        if content.Width == self.size.Width && content.Height == self.size.Height {
            return Ok(false);
        }
        self.pool.Recreate(&self.winrt_device, DirectXPixelFormat::B8G8R8A8UIntNormalized, POOL_BUFFERS, content)?;
        self.size = content;
        Ok(true)
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

pub fn frame_texture(frame: &Direct3D11CaptureFrame) -> Result<ID3D11Texture2D> {
    let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
    unsafe { access.GetInterface() }
}

struct Input {
    width: u32,
    height: u32,
    texture: ID3D11Texture2D,
    view: ID3D11VideoProcessorInputView,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
}

/// Scales and converts a BGRA frame to NV12 on the GPU, letterboxed into the
/// fixed size the encoder was opened with.
pub struct Converter {
    video_device: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    context: ID3D11DeviceContext,
    device: ID3D11Device,
    width: u32,
    height: u32,
    fps: u32,
    input: Option<Input>,
    outputs: HashMap<usize, ID3D11VideoProcessorOutputView>,
}

pub fn fit(src_w: u32, src_h: u32, dst_w: u32, dst_h: u32) -> RECT {
    let (src_w, src_h) = (src_w.max(1) as u64, src_h.max(1) as u64);
    let (dst_w64, dst_h64) = (dst_w as u64, dst_h as u64);
    let (w, h) = if src_w * dst_h64 > src_h * dst_w64 {
        (dst_w64, (src_h * dst_w64 / src_w).max(2))
    } else {
        ((src_w * dst_h64 / src_h).max(2), dst_h64)
    };
    let (w, h) = (w & !1, h & !1);
    let left = ((dst_w64 - w) / 2) & !1;
    let top = ((dst_h64 - h) / 2) & !1;
    RECT { left: left as i32, top: top as i32, right: (left + w) as i32, bottom: (top + h) as i32 }
}

impl Converter {
    pub fn new(gpu: &Gpu, width: u32, height: u32, fps: u32) -> Result<Converter> {
        Ok(Converter {
            video_device: gpu.device.cast()?,
            video_context: gpu.context.cast()?,
            context: gpu.context.clone(),
            device: gpu.device.clone(),
            width,
            height,
            fps,
            input: None,
            outputs: HashMap::new(),
        })
    }

    fn input(&mut self, width: u32, height: u32) -> Result<&Input> {
        if self.input.as_ref().is_none_or(|i| i.width != width || i.height != height) {
            self.input = None;
            self.outputs.clear();
            let rate = DXGI_RATIONAL { Numerator: self.fps, Denominator: 1 };
            let content = D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                InputFrameRate: rate,
                InputWidth: width,
                InputHeight: height,
                OutputFrameRate: rate,
                OutputWidth: self.width,
                OutputHeight: self.height,
                Usage: D3D11_VIDEO_USAGE_OPTIMAL_SPEED,
            };
            let enumerator = unsafe { self.video_device.CreateVideoProcessorEnumerator(&content)? };
            let processor = unsafe { self.video_device.CreateVideoProcessor(&enumerator, 0)? };
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32,
                CPUAccessFlags: 0,
                MiscFlags: 0,
            };
            let mut texture = None;
            unsafe { self.device.CreateTexture2D(&desc, None, Some(&mut texture))? };
            let texture = texture.ok_or_else(windows::core::Error::empty)?;
            let view_desc = D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                FourCC: 0,
                ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPIV { MipSlice: 0, ArraySlice: 0 } },
            };
            let mut view = None;
            unsafe { self.video_device.CreateVideoProcessorInputView(&texture, &enumerator, &view_desc, Some(&mut view))? };
            let view = view.ok_or_else(windows::core::Error::empty)?;
            let source = RECT { left: 0, top: 0, right: width as i32, bottom: height as i32 };
            let dest = fit(width, height, self.width, self.height);
            let target = RECT { left: 0, top: 0, right: self.width as i32, bottom: self.height as i32 };
            let rgb_full = D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: 0 };
            let studio = D3D11_VIDEO_PROCESSOR_COLOR_SPACE { _bitfield: OUTPUT_COLOR_SPACE_BT709_STUDIO };
            unsafe {
                self.video_context.VideoProcessorSetStreamFrameFormat(&processor, 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
                self.video_context.VideoProcessorSetStreamSourceRect(&processor, 0, true, Some(&source));
                self.video_context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&dest));
                self.video_context.VideoProcessorSetOutputTargetRect(&processor, true, Some(&target));
                self.video_context.VideoProcessorSetStreamColorSpace(&processor, 0, &rgb_full);
                self.video_context.VideoProcessorSetOutputColorSpace(&processor, &studio);
                self.video_context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);
            }
            self.input = Some(Input { width, height, texture, view, enumerator, processor });
        }
        self.input.as_ref().ok_or_else(windows::core::Error::empty)
    }

    /// Copies the visible part of `frame` and draws it into `target`, an NV12
    /// texture of the encoder's size.
    pub fn convert(&mut self, frame: &ID3D11Texture2D, width: u32, height: u32, target: &ID3D11Texture2D, subresource: u32) -> Result<()> {
        let context = self.context.clone();
        let video_device = self.video_device.clone();
        let video_context = self.video_context.clone();
        let input = self.input(width, height)?;
        let region = D3D11_BOX { left: 0, top: 0, front: 0, right: width, bottom: height, back: 1 };
        unsafe { context.CopySubresourceRegion(&input.texture, 0, 0, 0, 0, frame, 0, Some(&region)) };
        let (view_in, processor, enumerator) = (input.view.clone(), input.processor.clone(), input.enumerator.clone());
        let key = target.as_raw() as usize ^ subresource as usize;
        let output = match self.outputs.get(&key) {
            Some(view) => view.clone(),
            None => {
                let desc = D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                    ViewDimension: if subresource == 0 { D3D11_VPOV_DIMENSION_TEXTURE2D } else { D3D11_VPOV_DIMENSION_TEXTURE2DARRAY },
                    Anonymous: if subresource == 0 {
                        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_VPOV { MipSlice: 0 } }
                    } else {
                        D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 {
                            Texture2DArray: D3D11_TEX2D_ARRAY_VPOV { MipSlice: 0, FirstArraySlice: subresource, ArraySize: 1 },
                        }
                    },
                };
                let mut view = None;
                unsafe { video_device.CreateVideoProcessorOutputView(target, &enumerator, &desc, Some(&mut view))? };
                let view = view.ok_or_else(windows::core::Error::empty)?;
                if self.outputs.len() > 32 {
                    self.outputs.clear();
                }
                self.outputs.insert(key, view.clone());
                view
            }
        };
        let stream = D3D11_VIDEO_PROCESSOR_STREAM {
            Enable: true.into(),
            pInputSurface: core::mem::ManuallyDrop::new(Some(view_in)),
            ..Default::default()
        };
        let streams = [stream];
        let result = unsafe { video_context.VideoProcessorBlt(&processor, &output, 0, &streams) };
        let [mut stream] = streams;
        unsafe { core::mem::ManuallyDrop::drop(&mut stream.pInputSurface) };
        result
    }
}

#[cfg(test)]
mod tests {
    use super::fit;

    #[test]
    fn letterbox_verdicts() {
        let cases = [
            ((1920, 1080), (1280, 720), (0, 0, 1280, 720), "same aspect fills the frame"),
            ((1920, 1200), (1280, 720), (64, 0, 1216, 720), "taller source gets side bars"),
            ((2560, 1080), (1280, 720), (0, 90, 1280, 630), "wider source gets top and bottom bars"),
        ];
        for ((sw, sh), (dw, dh), (l, t, r, b), why) in cases {
            let rect = fit(sw, sh, dw, dh);
            assert_eq!((rect.left, rect.top, rect.right, rect.bottom), (l, t, r, b), "{}", why);
        }
    }
}
