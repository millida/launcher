//! Survival of the webview's render process.
//!
//! When Windows runs out of memory — a modded game holding a large heap next to
//! the launcher is the usual way there — WebView2 kills the render process and
//! paints its own error page ("Код ошибки: Out of Memory") over the whole
//! window. Nothing in the app is running at that point: the launcher looks
//! frozen and dead until it is restarted by hand.
//!
//! Two things happen here. The failure is caught and the page reloaded, so the
//! launcher comes back on its own, and the reason is kept for the fresh page to
//! report — without it there is no way to tell a memory leak in the UI from a
//! machine that simply ran dry.
//!
//! macOS and Linux keep their own recovery: WKWebView and WebKitGTK reload the
//! page themselves after a web process dies.

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebviewFailure {
    pub kind: String,
    pub reason: String,
    /// Memory the machine had left when the process died, in MB.
    pub free_mb: u64,
    pub total_mb: u64,
    pub reloaded: bool,
}

static LAST: Mutex<Option<WebviewFailure>> = Mutex::new(None);
#[cfg(target_os = "windows")]
static RELOADS: AtomicU32 = AtomicU32::new(0);

/// A page that dies again the moment it loads would otherwise reload forever and
/// keep the machine under the very pressure that killed it. After this many
/// tries the error page stays up and the player restarts the launcher.
#[cfg(any(target_os = "windows", test))]
const MAX_RELOADS: u32 = 3;

#[cfg(any(target_os = "windows", test))]
fn should_reload(already: u32) -> bool {
    already < MAX_RELOADS
}

#[cfg(any(target_os = "windows", test))]
fn record(failure: WebviewFailure) {
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(failure);
}

/// Reported once: the page that reads it is the one that survived the crash.
#[tauri::command]
pub fn take_webview_failure() -> Option<WebviewFailure> {
    LAST.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(target_os = "windows")]
fn free_and_total_mb() -> (u64, u64) {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    (sys.available_memory() / 1024 / 1024, sys.total_memory() / 1024 / 1024)
}

#[cfg(not(target_os = "windows"))]
pub fn watch(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "windows"))]
pub fn set_low_memory(_window: &tauri::WebviewWindow, _on: bool) {}

#[cfg(target_os = "windows")]
fn kind_name(kind: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_KIND) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match kind {
        COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED => "browser",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED => "render",
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE => "render_hung",
        COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED => "frame_render",
        COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED => "gpu",
        COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED => "utility",
        _ => "other",
    }
}

#[cfg(target_os = "windows")]
fn reason_name(reason: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PROCESS_FAILED_REASON) -> &'static str {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    match reason {
        COREWEBVIEW2_PROCESS_FAILED_REASON_OUT_OF_MEMORY => "out_of_memory",
        COREWEBVIEW2_PROCESS_FAILED_REASON_CRASHED => "crashed",
        COREWEBVIEW2_PROCESS_FAILED_REASON_TERMINATED => "terminated",
        COREWEBVIEW2_PROCESS_FAILED_REASON_LAUNCH_FAILED => "launch_failed",
        COREWEBVIEW2_PROCESS_FAILED_REASON_UNRESPONSIVE => "unresponsive",
        COREWEBVIEW2_PROCESS_FAILED_REASON_PROFILE_DELETED => "profile_deleted",
        _ => "unexpected",
    }
}

#[cfg(target_os = "windows")]
pub fn watch(window: &tauri::WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ProcessFailedEventArgs2, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };
    use webview2_com::ProcessFailedEventHandler;
    use windows::core::Interface;

    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let mut token = Default::default();
        let handler = ProcessFailedEventHandler::create(Box::new(move |sender, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = Default::default();
            args.ProcessFailedKind(&mut kind)?;
            let mut reason = Default::default();
            if let Ok(args2) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
                args2.Reason(&mut reason)?;
            }
            // The browser process taking the whole webview with it cannot be
            // reloaded from inside it, and a hung renderer often comes back on
            // its own — reloading it would throw away a page that is still there.
            let recoverable = kind != COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED
                && kind != COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE;
            let already = RELOADS.load(Ordering::Relaxed);
            let reload = recoverable && should_reload(already);
            let (free_mb, total_mb) = free_and_total_mb();
            record(WebviewFailure {
                kind: kind_name(kind).to_string(),
                reason: reason_name(reason).to_string(),
                free_mb,
                total_mb,
                reloaded: reload,
            });
            if reload {
                RELOADS.store(already + 1, Ordering::Relaxed);
                if let Some(core) = sender.as_ref() {
                    let _ = core.Reload();
                }
            }
            Ok(())
        }));
        let _ = core.add_ProcessFailed(&handler, &mut token);
    });
}

/// Lets WebView2 trade speed for memory while the launcher is out of sight — the
/// game is what needs the machine then, and the caches the webview keeps for a
/// window nobody is looking at are what it gives up.
#[cfg(target_os = "windows")]
pub fn set_low_memory(window: &tauri::WebviewWindow, on: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;

    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let Ok(core) = core.cast::<ICoreWebView2_19>() else { return };
        let level = if on {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        let _ = core.SetMemoryUsageTargetLevel(level);
    });
}

#[tauri::command]
pub fn set_webview_low_memory(app: tauri::AppHandle, on: bool) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        set_low_memory(&w, on);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Recovery has to stop somewhere: a page that dies on every load would
    /// otherwise reload in a loop and hold the machine down instead of letting
    /// the player see what happened.
    #[test]
    fn reloads_are_capped() {
        for already in 0..MAX_RELOADS {
            assert!(
                should_reload(already),
                "{already}-я перезагрузка должна пройти: лаунчер обязан подняться сам, \
                 пока попытки не исчерпаны",
            );
        }
        assert!(
            !should_reload(MAX_RELOADS),
            "после {MAX_RELOADS} перезагрузок подряд страница падает снова и снова — \
             дальше цикл только держит машину под той же нехваткой памяти",
        );
    }

    #[test]
    fn failure_is_reported_once() {
        record(WebviewFailure {
            kind: "render".into(),
            reason: "out_of_memory".into(),
            free_mb: 120,
            total_mb: 8192,
            reloaded: true,
        });
        assert!(
            take_webview_failure().is_some(),
            "первая страница после падения должна получить причину — иначе о падении \
             никто не узнает",
        );
        assert!(
            take_webview_failure().is_none(),
            "причина отдаётся один раз: иначе каждая перезагрузка UI слала бы один и тот же \
             отчёт заново",
        );
    }
}
