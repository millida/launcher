//! Development only: the narrow mod token the launcher hands the game
//! (POST /launcher/mod-session), for a mod started with `gradle runClient`.
//! It never refreshes the launcher session: refresh tokens rotate, and a
//! refresh from a second process would leave the launcher holding a spent one.

use millida_launcher_lib::engine::{millida_api, millida_token};
use std::io::Write;
use std::path::Path;

fn fail(message: &str) -> ! {
    eprintln!("{}", message);
    std::process::exit(1);
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
    let Some(session) = millida_token() else {
        fail("no Millida session in the launcher vault: sign in to Millida in the launcher first");
    };
    let reply = tauri::async_runtime::block_on(millida_api(
        "/launcher/mod-session".into(),
        "POST".into(),
        None,
        Some(session),
    ));
    let token = match reply {
        Ok(v) => v.get("token").and_then(|t| t.as_str()).map(str::trim).unwrap_or_default().to_string(),
        Err(e) if e == "http 401" => fail(
            "the launcher session has expired: open the launcher once so it refreshes the session, then run this again",
        ),
        Err(e) => fail(&format!("mod-session request failed: {}", e)),
    };
    if token.is_empty() {
        fail("the service answered without a token");
    }
    let Some(home) = dirs::home_dir() else { fail("no home directory") };
    let path = home.join(".millida-mod-token");
    if let Err(e) = write_private(&path, &token) {
        fail(&format!("cannot write {}: {}", path.display(), e));
    }
    println!("mod token written to {} (valid about 12 hours)", path.display());
}
