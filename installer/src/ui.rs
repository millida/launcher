use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, OnceLock};

use windows_sys::core::PCWSTR;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    CreateFontW, CLEARTYPE_QUALITY, COLOR_BTNFACE, DEFAULT_CHARSET, DEFAULT_PITCH, FF_DONTCARE,
    FW_NORMAL, HBRUSH,
};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::Controls::{PBM_SETPOS, PBM_SETRANGE32};
use windows_sys::Win32::UI::HiDpi::GetDpiForSystem;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    AdjustWindowRect, CreateWindowExW, DefWindowProcW, DispatchMessageW, FindWindowW,
    GetMessageW, GetSystemMetrics, LoadCursorW, LoadIconW, MessageBoxW, PostMessageW,
    PostQuitMessage, RegisterClassW, SendMessageW, SetForegroundWindow, SetTimer, SetWindowTextW,
    ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, IDC_ARROW,
    IDI_APPLICATION, MB_ICONERROR, MB_OK, MSG, SW_SHOW, WM_APP, WM_CLOSE, WM_DESTROY, WM_TIMER,
    WM_SETFONT, WNDCLASSW, WS_CAPTION, WS_CHILD, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU,
    WS_VISIBLE,
};

const CLASS_NAME: &str = "MillidaSetupWindow";
const WINDOW_TITLE: &str = "Установка Millida Launcher";
const WM_APP_UPDATE: u32 = WM_APP + 1;
const PROGRESS_CLASS: &str = "msctls_progress32";
const PROGRESS_STEPS: i32 = 1000;
const DRAIN_TIMER: usize = 1;
const DRAIN_INTERVAL_MS: u32 = 200;

pub enum Msg {
    Status(String),
    Progress(u32),
    Done(Result<(), String>),
}

static INBOX: OnceLock<Mutex<Receiver<Msg>>> = OnceLock::new();
static OUTCOME: OnceLock<Mutex<Option<Result<(), String>>>> = OnceLock::new();
static STATUS_LABEL: AtomicUsize = AtomicUsize::new(0);
static PROGRESS_BAR: AtomicUsize = AtomicUsize::new(0);

#[derive(Clone)]
pub struct Reporter {
    tx: Sender<Msg>,
    hwnd: usize,
}

impl Reporter {
    pub fn status(&self, text: impl Into<String>) {
        self.post(Msg::Status(text.into()));
    }

    /// Thousandths rather than percent: on a fast connection a percent-wide step
    /// makes the bar jump in visible chunks.
    pub fn progress(&self, done: u64, total: Option<u64>) {
        let Some(total) = total.filter(|t| *t > 0) else { return };
        let value = (done.min(total) * PROGRESS_STEPS as u64 / total) as u32;
        self.post(Msg::Progress(value));
    }

    fn post(&self, msg: Msg) {
        if self.tx.send(msg).is_ok() {
            unsafe { PostMessageW(self.hwnd as HWND, WM_APP_UPDATE, 0, 0) };
        }
    }
}

pub fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn scaled(value: i32) -> i32 {
    let dpi = unsafe { GetDpiForSystem() } as i32;
    value * dpi.max(96) / 96
}

/// A second copy would fight the first one for the same temporary files, so the
/// running window is raised instead.
pub fn raise_existing() -> bool {
    let class = wide(CLASS_NAME);
    let hwnd = unsafe { FindWindowW(class.as_ptr(), std::ptr::null()) };
    if hwnd.is_null() {
        return false;
    }
    unsafe { SetForegroundWindow(hwnd) };
    true
}

pub fn fail(text: &str) {
    let body = wide(text);
    let title = wide(WINDOW_TITLE);
    unsafe { MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR) };
}

/// `None` means the user closed the window before the work finished — a
/// cancellation is not a success and must not be reported as one.
pub fn run(work: impl FnOnce(&Reporter) -> Result<(), String> + Send + 'static) -> Option<Result<(), String>> {
    let hwnd = match create_window() {
        Ok(hwnd) => hwnd,
        Err(e) => return Some(Err(e)),
    };
    let (tx, rx) = channel();
    let _ = INBOX.set(Mutex::new(rx));
    let _ = OUTCOME.set(Mutex::new(None));

    let reporter = Reporter { tx, hwnd: hwnd as usize };
    std::thread::spawn(move || {
        let outcome = work(&reporter);
        reporter.post(Msg::Done(outcome));
    });

    pump();

    OUTCOME.get().and_then(|cell| cell.lock().ok()?.take())
}

fn pump() {
    let mut msg: MSG = unsafe { std::mem::zeroed() };
    loop {
        let got = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
        if got <= 0 {
            return;
        }
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn create_window() -> Result<HWND, String> {
    let instance = unsafe { GetModuleHandleW(std::ptr::null()) };
    let class = wide(CLASS_NAME);
    let title = wide(WINDOW_TITLE);

    let mut icon = unsafe { LoadIconW(instance, 1 as PCWSTR) };
    if icon.is_null() {
        icon = unsafe { LoadIconW(std::ptr::null_mut(), IDI_APPLICATION) };
    }

    let wnd_class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(window_proc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: instance,
        hIcon: icon,
        hCursor: unsafe { LoadCursorW(std::ptr::null_mut(), IDC_ARROW) },
        hbrBackground: (COLOR_BTNFACE as isize + 1) as HBRUSH,
        lpszMenuName: std::ptr::null(),
        lpszClassName: class.as_ptr(),
    };
    if unsafe { RegisterClassW(&wnd_class) } == 0 {
        return Err("не создать окно установщика".into());
    }

    let style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
    let mut rect = windows_sys::Win32::Foundation::RECT {
        left: 0,
        top: 0,
        right: scaled(440),
        bottom: scaled(140),
    };
    unsafe { AdjustWindowRect(&mut rect, style, 0) };
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let x = (unsafe { GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CXSCREEN) } - width) / 2;
    let y = (unsafe { GetSystemMetrics(windows_sys::Win32::UI::WindowsAndMessaging::SM_CYSCREEN) } - height) / 2;

    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            title.as_ptr(),
            style,
            x.max(0),
            y.max(0),
            width,
            height,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        )
    };
    if hwnd.is_null() {
        return Err("не создать окно установщика".into());
    }

    let font = create_font();
    let label = create_child("STATIC", "Готовим установку…", 0, 20, 24, 400, 40, hwnd, instance)?;
    let bar = create_child(PROGRESS_CLASS, "", 0, 20, 78, 400, 18, hwnd, instance)?;
    unsafe {
        SendMessageW(label, WM_SETFONT, font as WPARAM, 1);
        SendMessageW(bar, PBM_SETRANGE32, 0, PROGRESS_STEPS as LPARAM);
        ShowWindow(hwnd, SW_SHOW);
        SetForegroundWindow(hwnd);
        // Backs up PostMessage: a lost completion message would otherwise leave
        // the window hanging forever.
        SetTimer(hwnd, DRAIN_TIMER, DRAIN_INTERVAL_MS, None);
    }
    STATUS_LABEL.store(label as usize, Ordering::Relaxed);
    PROGRESS_BAR.store(bar as usize, Ordering::Relaxed);
    Ok(hwnd)
}

fn create_font() -> windows_sys::Win32::Graphics::Gdi::HFONT {
    let face = wide("Segoe UI");
    unsafe {
        CreateFontW(
            -scaled(12),
            0,
            0,
            0,
            FW_NORMAL as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET.into(),
            0,
            0,
            CLEARTYPE_QUALITY.into(),
            (DEFAULT_PITCH | FF_DONTCARE) as u32,
            face.as_ptr(),
        )
    }
}

#[allow(clippy::too_many_arguments)]
fn create_child(
    class: &str,
    text: &str,
    style: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: HWND,
    instance: windows_sys::Win32::Foundation::HMODULE,
) -> Result<HWND, String> {
    let class = wide(class);
    let text = wide(text);
    let hwnd = unsafe {
        CreateWindowExW(
            0,
            class.as_ptr(),
            text.as_ptr(),
            WS_CHILD | WS_VISIBLE | style,
            scaled(x),
            scaled(y),
            scaled(width),
            scaled(height),
            parent,
            std::ptr::null_mut(),
            instance,
            std::ptr::null(),
        )
    };
    if hwnd.is_null() {
        return Err("не создать окно установщика".into());
    }
    Ok(hwnd)
}

unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_APP_UPDATE | WM_TIMER => {
            drain(hwnd);
            0
        }
        WM_CLOSE => {
            PostQuitMessage(0);
            0
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn drain(hwnd: HWND) {
    let Some(inbox) = INBOX.get() else { return };
    let Ok(rx) = inbox.lock() else { return };
    while let Ok(msg) = rx.try_recv() {
        match msg {
            Msg::Status(text) => {
                let label = STATUS_LABEL.load(Ordering::Relaxed) as HWND;
                let text = wide(&text);
                unsafe { SetWindowTextW(label, text.as_ptr()) };
            }
            Msg::Progress(value) => {
                let bar = PROGRESS_BAR.load(Ordering::Relaxed) as HWND;
                unsafe { SendMessageW(bar, PBM_SETPOS, value as WPARAM, 0) };
            }
            Msg::Done(outcome) => {
                if let Some(cell) = OUTCOME.get() {
                    if let Ok(mut slot) = cell.lock() {
                        *slot = Some(outcome);
                    }
                }
                unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) };
            }
        }
    }
}
