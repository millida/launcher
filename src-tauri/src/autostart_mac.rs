// macOS login item: the app registers itself with SMAppService.mainApp (macOS 13+).
//
// Why not the LaunchAgent that tauri-plugin-autostart writes: its plist points at
// `Contents/MacOS/millida-launcher`, so Background Task Management lists a bare
// binary named after the cargo package and shows «App Background Activity:
// "millida-launcher" can run in the background» again whenever that binary changes
// (every update). mainApp is tied to the bundle: the name is «Millida Launcher»,
// the notice comes once, when the player flips the switch.
//
// A login item gets no arguments, so «started by the system» is read from the
// launch Apple event (`keyAEPropData == keyAELaunchedAsLogInItem`).

use objc2::runtime::AnyClass;
use objc2_foundation::NSAppleEventManager;
use objc2_service_management::{SMAppService, SMAppServiceStatus};
use std::path::PathBuf;

const KEY_AE_PROP_DATA: u32 = u32::from_be_bytes(*b"prdt");
const KEY_AE_LAUNCHED_AS_LOGIN_ITEM: u32 = u32::from_be_bytes(*b"lgit");

/// SMAppService exists from macOS 13; on older systems the class is missing.
pub fn available() -> bool {
    AnyClass::get(c"SMAppService").is_some()
}

pub fn is_enabled() -> bool {
    available() && unsafe { SMAppService::mainAppService().status() } == SMAppServiceStatus::Enabled
}

pub fn set_enabled(on: bool) -> Result<(), String> {
    if !available() {
        return Err("SMAppService is not available".into());
    }
    let svc = unsafe { SMAppService::mainAppService() };
    let status = unsafe { svc.status() };
    if on && status != SMAppServiceStatus::Enabled {
        unsafe { svc.registerAndReturnError() }.map_err(|e| e.localizedDescription().to_string())?;
    } else if !on && status != SMAppServiceStatus::NotRegistered {
        unsafe { svc.unregisterAndReturnError() }
            .map_err(|e| e.localizedDescription().to_string())?;
    }
    Ok(())
}

/// The plist the old plugin wrote: `~/Library/LaunchAgents/<cargo package name>.plist`.
fn legacy_plist(package: &str) -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/LaunchAgents").join(format!("{package}.plist")))
}

/// One-time move from the old LaunchAgent to the login item, silent. The old plist
/// is deleted only after the new registration took, and its presence is the marker:
/// once it is gone, nothing runs again. Returns true when a move happened.
pub fn migrate_legacy(package: &str) -> bool {
    // Dev builds never touch the player's login items.
    if cfg!(debug_assertions) {
        return false;
    }
    let Some(plist) = legacy_plist(package) else { return false };
    if !plist.exists() || !available() {
        return false;
    }
    if set_enabled(true).is_err() || !is_enabled() {
        return false;
    }
    std::fs::remove_file(&plist).is_ok()
}

/// True when the system opened the app at login. Must be asked while the launch
/// event is still current (during setup); the answer is kept for later calls.
pub fn launched_as_login_item() -> bool {
    use std::sync::OnceLock;
    static ANSWER: OnceLock<bool> = OnceLock::new();
    *ANSWER.get_or_init(|| {
        let Some(event) = NSAppleEventManager::sharedAppleEventManager().currentAppleEvent() else {
            return false;
        };
        event
            .paramDescriptorForKeyword(KEY_AE_PROP_DATA)
            .is_some_and(|d| d.enumCodeValue() == KEY_AE_LAUNCHED_AS_LOGIN_ITEM)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apple_event_codes_are_the_documented_four_char_codes() {
        assert_eq!(KEY_AE_PROP_DATA, 0x7072_6474);
        assert_eq!(KEY_AE_LAUNCHED_AS_LOGIN_ITEM, 0x6C67_6974);
    }

    #[test]
    fn legacy_plist_is_named_after_the_package() {
        let p = legacy_plist("millida-launcher").unwrap();
        assert!(p.ends_with("Library/LaunchAgents/millida-launcher.plist"));
    }
}
