use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WindowEvent};

const EXTS: [&str; 2] = ["mrpack", "zip"];

#[derive(Clone, Serialize)]
pub struct DroppedPack {
    pub id: u64,
    pub name: String,
}

fn registry() -> &'static Mutex<HashMap<u64, PathBuf>> {
    static REG: OnceLock<Mutex<HashMap<u64, PathBuf>>> = OnceLock::new();
    REG.get_or_init(|| Mutex::new(HashMap::new()))
}

fn next_id() -> u64 {
    static N: OnceLock<Mutex<u64>> = OnceLock::new();
    let mut n = N.get_or_init(|| Mutex::new(0)).lock().unwrap_or_else(|e| e.into_inner());
    *n += 1;
    *n
}

fn accepted(p: &Path) -> bool {
    if p.is_dir() {
        return true;
    }
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn shown_name(p: &Path) -> String {
    p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| p.to_string_lossy().to_string())
}

/// The webview never gets the path, only a token the core minted for a path the
/// OS itself handed to the window — a dropped file is as trusted as a picked one,
/// a path invented by the page is not.
fn remember(paths: &[PathBuf]) -> Vec<DroppedPack> {
    let mut reg = registry().lock().unwrap_or_else(|e| e.into_inner());
    reg.clear();
    paths
        .iter()
        .filter(|p| accepted(p))
        .map(|p| {
            let id = next_id();
            reg.insert(id, p.clone());
            DroppedPack { id, name: shown_name(p) }
        })
        .collect()
}

pub fn take(id: u64) -> Option<PathBuf> {
    registry().lock().unwrap_or_else(|e| e.into_inner()).remove(&id)
}

pub fn watch(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let handle = win.clone();
    win.on_window_event(move |event| {
        let WindowEvent::DragDrop(drag) = event else { return };
        match drag {
            DragDropEvent::Enter { paths, .. } => {
                let any = paths.iter().any(|p| accepted(p));
                let _ = handle.emit("pack-drag", any);
            }
            DragDropEvent::Leave => {
                let _ = handle.emit("pack-drag", false);
            }
            DragDropEvent::Drop { paths, .. } => {
                let _ = handle.emit("pack-drag", false);
                // Брошенные в окно файлы можно добавить в сборку (моды, паки):
                // их путь дала система, а не страница.
                crate::engine::grant_user_files(paths);
                let found = remember(paths);
                let _ = handle.emit("pack-drop", found);
            }
            _ => {}
        }
    });
}
