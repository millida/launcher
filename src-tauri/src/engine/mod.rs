use serde::Serialize;
use tauri::{AppHandle, Emitter};

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
pub mod themes;
pub mod theme_catalog;

pub use core::*;
pub use game::*;
pub use profiles::*;
pub use content::*;
pub use accounts::*;
pub use skins::*;
pub use media::*;
pub use themes::*;
pub use theme_catalog::*;
