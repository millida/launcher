use rfd::AsyncFileDialog;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, WebviewWindow};

static PARENT: OnceLock<WebviewWindow> = OnceLock::new();

pub fn arm_dialogs(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = PARENT.set(w);
    }
}

/// Every native dialog is owned by the launcher window. An ownerless dialog
/// raised from a worker thread loses the foreground race against the launcher
/// and ends up behind it: the caller stays blocked on a window the user cannot
/// see or dismiss.
pub fn dialog() -> AsyncFileDialog {
    let d = AsyncFileDialog::new();
    match PARENT.get() {
        Some(w) => d.set_parent(w),
        None => d,
    }
}

pub async fn pick_file(d: AsyncFileDialog) -> Option<PathBuf> {
    d.pick_file().await.map(|f| f.path().to_path_buf())
}

pub async fn pick_files(d: AsyncFileDialog) -> Option<Vec<PathBuf>> {
    d.pick_files().await.map(|v| v.iter().map(|f| f.path().to_path_buf()).collect())
}

pub async fn pick_folder(d: AsyncFileDialog) -> Option<PathBuf> {
    d.pick_folder().await.map(|f| f.path().to_path_buf())
}

pub async fn save_file(d: AsyncFileDialog) -> Option<PathBuf> {
    d.save_file().await.map(|f| f.path().to_path_buf())
}
