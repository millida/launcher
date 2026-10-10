//! Development only: the launcher's now-playing socket without the launcher,
//! so a mod started with `gradle runClient` shows the music island.
//! The port and key go to ~/.millida-dev-media.json, which the mod's Fabric
//! run configs read; the file is removed on Ctrl+C.

use millida_launcher_lib::engine::MediaLink;
use std::io::Write;
use std::path::{Path, PathBuf};

fn file_path() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".millida-dev-media.json"))
        .ok_or_else(|| "no home directory to write .millida-dev-media.json into".to_string())
}

fn write_private(path: &Path, text: &str) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)?.write_all(text.as_bytes())
}

fn main() {
    let Some(link) = MediaLink::start() else {
        eprintln!("now playing is not available on this OS (Windows SMTC and Linux MPRIS only)");
        std::process::exit(1);
    };
    let path = match file_path() {
        Ok(path) => path,
        Err(e) => {
            eprintln!("{}", e);
            std::process::exit(1);
        }
    };
    let text = serde_json::json!({ "port": link.port(), "key": link.key() }).to_string();
    if let Err(e) = write_private(&path, &text) {
        eprintln!("cannot write {}: {}", path.display(), e);
        std::process::exit(1);
    }
    println!(
        "now playing on 127.0.0.1:{}, port and key in {}; start gradle runClient now, Ctrl+C to stop",
        link.port(),
        path.display()
    );
    tauri::async_runtime::block_on(async {
        let _ = tokio::signal::ctrl_c().await;
    });
    drop(link);
    if let Err(e) = std::fs::remove_file(&path) {
        eprintln!("left {} behind: {}", path.display(), e);
    }
}
