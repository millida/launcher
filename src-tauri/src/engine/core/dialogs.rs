// System dialogs to pick a file or a folder (rfd), attached to the launcher window. The UI gets a path only from them.
use rfd::AsyncFileDialog;
use std::path::{Path, PathBuf};
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

/// The picked path is remembered for "Show in folder": the player chose it, so
/// revealing it later hands the webview nothing it did not already have.
pub async fn save_file(d: AsyncFileDialog) -> Option<PathBuf> {
    let picked = d.save_file().await.map(|f| f.path().to_path_buf());
    if let Some(p) = &picked {
        remember_saved_file(&p.to_string_lossy());
    }
    picked
}

/// A question owned by the launcher window, for the same reason as `dialog`.
pub fn message_dialog() -> rfd::AsyncMessageDialog {
    let d = rfd::AsyncMessageDialog::new();
    match parent() {
        Some(w) => d.set_parent(&w),
        None => d,
    }
}

/// Files the core wrote on the player's request (exports, backups, "Save as"),
/// newest last. "Show in folder" on a toast opens only these: the webview gets
/// back a path it was handed, never a way to reveal an arbitrary one.
const SAVED_FILES_MAX: usize = 16;

fn saved_files() -> &'static std::sync::Mutex<std::collections::VecDeque<PathBuf>> {
    static SAVED: OnceLock<std::sync::Mutex<std::collections::VecDeque<PathBuf>>> = OnceLock::new();
    SAVED.get_or_init(Default::default)
}

pub fn remember_saved_file(path: &str) {
    let mut list = saved_files().lock().unwrap_or_else(|e| e.into_inner());
    let path = PathBuf::from(path);
    list.retain(|p| p != &path);
    list.push_back(path);
    while list.len() > SAVED_FILES_MAX {
        list.pop_front();
    }
}

fn saved_file(path: &str) -> Option<PathBuf> {
    let wanted = Path::new(path);
    saved_files().lock().unwrap_or_else(|e| e.into_inner()).iter().find(|p| p.as_path() == wanted).cloned()
}

pub fn reveal_saved_file(path: &str) -> Result<(), String> {
    let Some(file) = saved_file(path) else {
        return Err("Лаунчер уже не помнит этот файл — открой папку вручную".into());
    };
    if !file.is_file() {
        return Err("Файл удалён или перемещён".into());
    }
    tauri_plugin_opener::reveal_item_in_dir(&file).map_err(|e| format!("Не удалось открыть папку: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Only paths the core handed out may be revealed, and the list stays short: a path the
    /// webview made up, or one pushed out by newer saves, is refused.
    #[test]
    fn only_files_the_core_saved_can_be_revealed() {
        let base = std::env::temp_dir().join("millida-saved-files-test");
        let first = base.join("first.mrpack").to_string_lossy().to_string();
        remember_saved_file(&first);
        assert!(saved_file(&first).is_some(), "a file the core just saved must be revealable");
        assert!(saved_file(&base.join("other.zip").to_string_lossy()).is_none(), "a path the core never issued must be refused");
        assert!(saved_file("C:/Windows/System32").is_none(), "an arbitrary system path must be refused");
        for i in 0..SAVED_FILES_MAX {
            remember_saved_file(&base.join(format!("later-{i}.zip")).to_string_lossy());
        }
        assert!(saved_file(&first).is_none(), "the oldest entry must fall out once the list is full");
        assert!(reveal_saved_file(&first).is_err(), "revealing a forgotten file must fail, not open anything");
    }
}
