//! Recovery after the display configuration changes.
//!
//! Turning a monitor off and on, or changing its resolution or refresh rate,
//! resets the display device under a running window. Windows then replays scale
//! and size changes at the window, and WebView2 keeps its own child window and
//! its input region on the geometry it had before the reset. The launcher looks
//! alive — the compositor keeps drawing the animations — while every click lands
//! outside the webview's hit-testing area, so nothing can be pressed until the
//! app is restarted.
//!
//! Windows announces the reset with WM_DISPLAYCHANGE and WM_DPICHANGED. Neither
//! reaches the app through Tauri's window events, so the main window is
//! subclassed for them; once the desktop settles, the window is pulled back onto
//! a real monitor and the webview is told where its parent now is.

#[cfg(not(target_os = "windows"))]
pub fn watch(_app: &tauri::AppHandle) {}

#[cfg(target_os = "windows")]
pub use win::watch;

#[cfg(target_os = "windows")]
mod win {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use std::time::Duration;
    use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, SetWindowPos, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SWP_NOZORDER,
    };

    // Plain message numbers: they are part of the Windows ABI and do not depend
    // on which windows-sys features happen to be enabled.
    const WM_DISPLAYCHANGE: u32 = 0x007E;
    const WM_DPICHANGED: u32 = 0x02E0;
    const WM_SIZE: u32 = 0x0005;
    const SIZE_MINIMIZED: WPARAM = 1;

    const SUBCLASS_ID: usize = 0x4D4C_4443;

    /// The desktop keeps moving windows around while a monitor comes back, and a
    /// resolution change arrives as a burst of messages. Recovering on the first
    /// one would fix geometry that is about to change again.
    const SETTLE: Duration = Duration::from_millis(600);

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static PENDING: AtomicBool = AtomicBool::new(false);
    /// A minimized window has no usable geometry and its webview no usable
    /// bounds, so a display change that arrives while it is away is repaired
    /// when it comes back instead of being applied to nothing.
    static MINIMIZED: AtomicBool = AtomicBool::new(false);
    static DEFERRED: AtomicBool = AtomicBool::new(false);

    pub fn watch(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else { return };
        let Ok(hwnd) = window.hwnd() else { return };
        if APP.set(app.clone()).is_err() {
            return;
        }
        unsafe {
            SetWindowSubclass(hwnd.0 as HWND, Some(proc), SUBCLASS_ID, 0);
        }
    }

    unsafe extern "system" fn proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        // Tauri's own handling runs first: the recovery corrects what is left
        // after the window has been repositioned and rescaled.
        let res = unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) };
        if msg == WM_DISPLAYCHANGE || msg == WM_DPICHANGED {
            if MINIMIZED.load(Ordering::Relaxed) {
                DEFERRED.store(true, Ordering::SeqCst);
            } else {
                schedule();
            }
        }
        if msg == WM_SIZE {
            let away = wparam == SIZE_MINIMIZED;
            MINIMIZED.store(away, Ordering::Relaxed);
            set_webview_visible(!away);
            if !away && DEFERRED.swap(false, Ordering::SeqCst) {
                schedule();
            }
        }
        res
    }

    /// Minimizing the host window does not take the webview's own composition
    /// surface with it: the HTML disappears, and the frame WebView2 drew last —
    /// the wallpaper behind the interface — stays painted on the desktop, so the
    /// button reads as broken. WebView2 expects the host to say when it is off
    /// screen; nothing in Tauri does it, so the message loop does. It is also
    /// what stops the wallpaper from being rendered while nobody looks at it.
    fn set_webview_visible(visible: bool) {
        let Some(app) = APP.get().cloned() else { return };
        let _ = app.clone().run_on_main_thread(move || {
            let Some(window) = app.get_webview_window("main") else { return };
            let _ = window.with_webview(move |webview| unsafe {
                let _ = webview.controller().SetIsVisible(visible);
            });
        });
    }

    fn schedule() {
        if PENDING.swap(true, Ordering::SeqCst) {
            return;
        }
        let Some(app) = APP.get().cloned() else {
            PENDING.store(false, Ordering::SeqCst);
            return;
        };
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SETTLE).await;
            PENDING.store(false, Ordering::SeqCst);
            let _ = app.clone().run_on_main_thread(move || recover(&app));
        });
    }

    fn recover(app: &AppHandle) {
        if MINIMIZED.load(Ordering::Relaxed) {
            DEFERRED.store(true, Ordering::SeqCst);
            return;
        }
        let Some(window) = app.get_webview_window("main") else { return };
        fit_to_monitor(&window);
        let _ = window.with_webview(|webview| unsafe {
            let controller = webview.controller();
            let mut parent = windows::Win32::Foundation::HWND::default();
            if controller.ParentWindow(&mut parent).is_err() {
                return;
            }
            let parent = parent.0 as HWND;
            let mut client: RECT = std::mem::zeroed();
            if GetClientRect(parent, &mut client) != 0 {
                let _ = controller.SetBounds(windows::Win32::Foundation::RECT {
                    left: client.left,
                    top: client.top,
                    right: client.right,
                    bottom: client.bottom,
                });
            }
            // Without this the webview keeps hit-testing against the position
            // the window had before the display was reset.
            let _ = controller.NotifyParentWindowPositionChanged();
            let _ = controller.SetIsVisible(true);
            SetWindowPos(
                parent,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
        });
    }

    /// A scale change replayed over a window can leave it larger than every
    /// monitor, or entirely outside the desktop — in both cases the controls the
    /// user needs are somewhere off screen.
    fn fit_to_monitor(window: &tauri::WebviewWindow) {
        if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
            return;
        }
        let (Ok(size), Ok(pos)) = (window.outer_size(), window.outer_position()) else { return };
        let monitor = match window.current_monitor() {
            Ok(Some(m)) => m,
            _ => match window.primary_monitor() {
                Ok(Some(m)) => m,
                _ => return,
            },
        };
        let area = *monitor.size();
        let width = size.width.min(area.width);
        let height = size.height.min(area.height);
        if width != size.width || height != size.height {
            let _ = window.set_size(PhysicalSize::new(width, height));
        }
        let origin = *monitor.position();
        let visible = pos.x < origin.x + area.width as i32
            && pos.y < origin.y + area.height as i32
            && pos.x + width as i32 > origin.x
            && pos.y + height as i32 > origin.y;
        if !visible {
            let _ = window.set_position(PhysicalPosition::new(origin.x, origin.y));
        }
    }
}
