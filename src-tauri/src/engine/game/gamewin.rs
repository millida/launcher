// Finds the window of a game we started, by the process id of its JVM, and raises it. Reads the
// list of windows of this desktop and asks the system to bring one forward; nothing is sent
// anywhere and nothing is written to disk. Used when Play is pressed for a build that is already
// running, and to time how long the game takes to show its window.

/// A visible, titled top-level window owned by the process. The helper windows a JVM creates
/// (GLFW message window, AWT toolkit) are hidden or have no title.
pub(crate) fn has_window(pid: u32) -> bool {
    os::has_window(pid)
}

/// Raises the game's window above the rest, restoring it first if it is minimised. False when
/// the process has no window yet or the system refused to switch.
pub(crate) fn bring_to_front(pid: u32) -> bool {
    os::bring_to_front(pid)
}

#[cfg(windows)]
mod os {
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        AllowSetForegroundWindow, BringWindowToTop, EnumWindows, GetForegroundWindow, GetWindowTextLengthW,
        GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    struct Search {
        pid: u32,
        found: HWND,
    }

    // Called by the system for every top-level window; stops (returns 0) at the first match.
    unsafe extern "system" fn each(hwnd: HWND, param: LPARAM) -> i32 {
        // SAFETY: `param` is the address of the `Search` on the stack of `find`, which outlives
        // the EnumWindows call that runs this callback on the same thread.
        let search = unsafe { &mut *(param as *mut Search) };
        let mut owner: u32 = 0;
        // SAFETY: plain query on a window handle the system just gave us.
        unsafe { GetWindowThreadProcessId(hwnd, &mut owner) };
        if owner != search.pid {
            return 1;
        }
        // SAFETY: same handle, read-only queries.
        let shown = unsafe { IsWindowVisible(hwnd) } != 0 && unsafe { GetWindowTextLengthW(hwnd) } > 0;
        if shown {
            search.found = hwnd;
            return 0;
        }
        1
    }

    fn find(pid: u32) -> Option<HWND> {
        let mut search = Search { pid, found: std::ptr::null_mut::<c_void>() };
        // SAFETY: the callback only touches `search`, which lives until this call returns.
        unsafe { EnumWindows(Some(each), &mut search as *mut Search as LPARAM) };
        (!search.found.is_null()).then_some(search.found)
    }

    pub(super) fn has_window(pid: u32) -> bool {
        find(pid).is_some()
    }

    pub(super) fn bring_to_front(pid: u32) -> bool {
        let Some(hwnd) = find(pid) else { return false };
        // SAFETY: calls on a window handle found a moment ago; the worst outcome of a stale
        // handle is that the system ignores the call.
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            // We hold the foreground right right after a click in our own window; the game
            // process is told it may take the foreground too, so the switch is not refused.
            AllowSetForegroundWindow(pid);
            BringWindowToTop(hwnd);
            if SetForegroundWindow(hwnd) != 0 {
                return true;
            }
            // The launcher is not in front (a tray menu, --launch, a millida:// link): the system
            // refuses the switch from a process that did not get the last input. Sharing the input
            // queue of the window that is in front lifts the refusal for the moment of the call.
            let front = GetForegroundWindow();
            let front_thread = if front.is_null() { 0 } else { GetWindowThreadProcessId(front, std::ptr::null_mut()) };
            let own_thread = GetCurrentThreadId();
            if front_thread == 0 || front_thread == own_thread {
                return false;
            }
            AttachThreadInput(own_thread, front_thread, 1);
            BringWindowToTop(hwnd);
            let raised = SetForegroundWindow(hwnd) != 0;
            AttachThreadInput(own_thread, front_thread, 0);
            raised
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

    // Listing the windows of another process on macOS needs the screen-recording or the
    // accessibility permission, and asking for it just to time a launch is not worth a prompt:
    // the timing there comes from the game's log (launch_perf.rs).
    pub(super) fn has_window(_pid: u32) -> bool {
        false
    }

    pub(super) fn bring_to_front(pid: u32) -> bool {
        let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid as libc::pid_t)
        else {
            return false;
        };
        app.activateWithOptions(NSApplicationActivationOptions::ActivateAllWindows)
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod os {
    pub(super) fn has_window(_pid: u32) -> bool {
        false
    }

    pub(super) fn bring_to_front(_pid: u32) -> bool {
        false
    }
}
