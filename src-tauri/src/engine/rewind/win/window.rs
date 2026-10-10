use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClientRect, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindow,
    IsWindowVisible, GW_OWNER,
};

const MIN_SIDE: i32 = 64;

/// A window handle that crosses threads as a plain number; every use goes
/// back through the Win32 calls that tolerate a closed window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Window(isize);

impl Window {
    pub fn hwnd(self) -> HWND {
        HWND(self.0 as *mut core::ffi::c_void)
    }

    pub fn alive(self) -> bool {
        unsafe { IsWindow(Some(self.hwnd())).as_bool() }
    }

    pub fn minimized(self) -> bool {
        unsafe { IsIconic(self.hwnd()).as_bool() }
    }

    pub fn client_size(self) -> (u32, u32) {
        let mut rect = RECT::default();
        if unsafe { GetClientRect(self.hwnd(), &mut rect) }.is_err() {
            return (0, 0);
        }
        ((rect.right - rect.left).max(0) as u32, (rect.bottom - rect.top).max(0) as u32)
    }
}

struct Search {
    pid: u32,
    best: Option<(HWND, i64)>,
}

unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
    let search = unsafe { &mut *(data.0 as *mut Search) };
    let mut owner_pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut owner_pid)) };
    if owner_pid != search.pid || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return BOOL(1);
    }
    if unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|owner| !owner.is_invalid()) {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if unsafe { GetClientRect(hwnd, &mut rect) }.is_err() {
        return BOOL(1);
    }
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    if w < MIN_SIDE || h < MIN_SIDE {
        return BOOL(1);
    }
    let area = w as i64 * h as i64;
    if search.best.is_none_or(|(_, best)| area > best) {
        search.best = Some((hwnd, area));
    }
    BOOL(1)
}

/// The game's main window: the largest visible top-level window of the process.
pub fn find(pid: u32) -> Option<Window> {
    let mut search = Search { pid, best: None };
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize)) };
    search.best.map(|(hwnd, _)| Window(hwnd.0 as isize))
}

pub fn foreground_pid() -> Option<u32> {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    (pid != 0).then_some(pid)
}
