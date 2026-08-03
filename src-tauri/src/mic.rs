//! Microphone consent for the launcher's own window.
//!
//! Voice messages are recorded by the webview, and the webview asks the host
//! for the microphone every time. WebView2 answers that with its own dialog,
//! which in a frameless app looks like a stray browser popup and reappears in
//! development on every reload. The user already agreed by pressing record, so
//! the request is answered here; nothing else about the window changes.
//!
//! macOS and Linux are not touched: WKWebView routes the request through the
//! system permission sheet (see Info.plist), which is remembered by the OS.

use tauri::WebviewWindow;

#[cfg(not(target_os = "windows"))]
pub fn allow_microphone(_window: &WebviewWindow) {}

#[cfg(target_os = "windows")]
pub fn allow_microphone(window: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        ICoreWebView2PermissionRequestedEventArgs,
    };
    use webview2_com::PermissionRequestedEventHandler;
    use windows::core::Interface;

    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let mut token = Default::default();
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let args: ICoreWebView2PermissionRequestedEventArgs = args.cast()?;
            let mut kind = Default::default();
            args.PermissionKind(&mut kind)?;
            // Only the microphone: camera, geolocation and the rest keep their
            // dialog, so a compromised page cannot help itself to a webcam.
            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}
