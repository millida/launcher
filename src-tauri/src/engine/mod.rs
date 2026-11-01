// Engine root: wires up the modules (accounts, core, content, game launch) and holds the shared launch types.
// The Mojang addresses below are the official ones the launcher takes the version list and game assets from.
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// Official Minecraft version list from Mojang.
pub(crate) const MANIFEST: &str = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
pub(crate) const RESOURCES: &str = "https://resources.download.minecraft.net";

#[derive(Clone, Serialize)]
pub struct Progress {
    pub stage: String,
    pub pct: f32,
    pub msg: String,
}

/// Credentials for an online launch; empty means offline mode. A non-empty
/// `yggdrasil` URL enables authlib-injector against that auth server.
#[derive(Clone, Default)]
pub struct Auth { pub token: String, pub uuid: String, pub xuid: String, pub yggdrasil: String }

/// What the webview may say about a launch: which account to play as, never the
/// credentials themselves.
#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthArgs {
    pub kind: Option<String>,
    pub account_id: Option<String>,
    pub uuid: Option<String>,
    pub xuid: Option<String>,
}

fn emit(app: &AppHandle, stage: &str, pct: f32, msg: &str) {
    // Work inside a step of the launch graph reports its share of the launch's one bar
    // (game/pipeline/progress.rs), not its own numbers over the others'.
    if game::lane_emit(stage, pct, msg) {
        return;
    }
    emit_progress(app, stage, pct, msg);
}

/// Straight to the window: the progress of a launch as a whole.
pub(crate) fn emit_progress(app: &AppHandle, stage: &str, pct: f32, msg: &str) {
    let _ = app.emit(
        "launch-progress",
        Progress { stage: stage.into(), pct, msg: msg.into() },
    );
}

/// The launch continues, but not exactly as requested.
fn warn(app: &AppHandle, msg: &str) {
    let _ = app.emit("launch-warning", msg.to_string());
}

pub mod core;
pub mod game;
pub mod profiles;
pub mod content;
pub mod accounts;
pub mod skins;
pub mod media;
pub mod cloud;
pub mod party_voice;
pub mod rewind;
pub mod uninstall_report;

pub use core::*;
pub use game::*;
pub use profiles::*;
pub use content::*;
pub use accounts::*;
pub use skins::*;
pub use media::*;
pub use cloud::*;
pub use uninstall_report::*;
