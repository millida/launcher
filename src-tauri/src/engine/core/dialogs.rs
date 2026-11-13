// System dialogs to pick a file or a folder (rfd), attached to the launcher window. The UI gets a path only from them.
use rfd::AsyncFileDialog;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, WebviewWindow};

/// The app, not the window: the main window is destroyed when the launcher goes
/// to the tray or steps aside for the game, and built again from its config. A
/// window kept from startup was a dead handle after the first such round, and
/// every later dialog opened ownerless, behind the launcher («Выбрать PNG» did
/// nothing for a player who had once played a game).
static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn arm_dialogs(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// The launcher window alive right now, if there is one.
fn parent() -> Option<WebviewWindow> {
    APP.get().and_then(|app| app.get_webview_window("main"))
}

/// Every native dialog is owned by the launcher window. An ownerless dialog
/// raised from a worker thread loses the foreground race against the launcher
/// and ends up behind it: the caller stays blocked on a window the user cannot
/// see or dismiss.
pub fn dialog() -> AsyncFileDialog {
    let d = AsyncFileDialog::new();
    match parent() {
        Some(w) => d.set_parent(&w),
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

/// A question owned by the launcher window, for the same reason as `dialog`.
pub fn message_dialog() -> rfd::AsyncMessageDialog {
    let d = rfd::AsyncMessageDialog::new();
    match parent() {
        Some(w) => d.set_parent(&w),
        None => d,
    }
}
