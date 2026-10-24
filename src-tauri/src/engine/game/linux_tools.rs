// Linux game helpers per build: Feral GameMode (gamemoderun) and Valve Gamescope. Each is a switch the player turns on;
// the launch puts the tool in front of the game command only when the tool is installed. No network.
use crate::engine::*;
use std::path::PathBuf;

const GAMEMODE_KEY: &str = "linuxGamemode";
const GAMESCOPE_KEY: &str = "linuxGamescope";
const GAMEMODE_BIN: &str = "gamemoderun";
const GAMESCOPE_BIN: &str = "gamescope";

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxTools {
    pub supported: bool,
    pub gamemode_installed: bool,
    pub gamescope_installed: bool,
    pub gamemode: bool,
    pub gamescope: bool,
}

fn on_path(bin: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(bin)).find(|p| p.is_file())
}

pub fn linux_tools_state(profile: &str) -> LinuxTools {
    if !cfg!(target_os = "linux") {
        return LinuxTools::default();
    }
    let s = profile_settings(profile);
    LinuxTools {
        supported: true,
        gamemode_installed: on_path(GAMEMODE_BIN).is_some(),
        gamescope_installed: on_path(GAMESCOPE_BIN).is_some(),
        gamemode: s[GAMEMODE_KEY].as_bool() == Some(true),
        gamescope: s[GAMESCOPE_KEY].as_bool() == Some(true),
    }
}

pub fn set_linux_tools(profile: &str, gamemode: bool, gamescope: bool) -> Result<LinuxTools, String> {
    if !cfg!(target_os = "linux") {
        return Err("GameMode и Gamescope работают только в Linux".into());
    }
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена — открой список сборок заново".into());
    }
    let mut patch = serde_json::Map::new();
    patch.insert(GAMEMODE_KEY.into(), serde_json::json!(gamemode));
    patch.insert(GAMESCOPE_KEY.into(), serde_json::json!(gamescope));
    merge_settings(profile, patch);
    Ok(linux_tools_state(profile))
}

/// What goes in front of the player's own wrapper. Gamescope is outermost, so
/// GameMode and the player's wrapper run inside its session.
pub(crate) fn wrapper_prefix(state: &LinuxTools) -> Vec<&'static str> {
    let mut out = vec![];
    if state.gamescope && state.gamescope_installed {
        out.extend([GAMESCOPE_BIN, "-f", "--"]);
    }
    if state.gamemode && state.gamemode_installed {
        out.push(GAMEMODE_BIN);
    }
    out
}

/// The build's launch hooks with the switched-on Linux helpers prepended to the wrapper.
pub(crate) fn with_linux_tools(profile: &str, mut hooks: LaunchHooks) -> LaunchHooks {
    let prefix = wrapper_prefix(&linux_tools_state(profile));
    if prefix.is_empty() {
        return hooks;
    }
    let own = hooks.wrapper.trim().to_string();
    hooks.wrapper = if own.is_empty() { prefix.join(" ") } else { format!("{} {}", prefix.join(" "), own) };
    hooks
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (switches, installed) -> what runs before java.
    #[test]
    fn only_installed_tools_wrap_the_game() {
        let st = |gm: bool, gs: bool, gmi: bool, gsi: bool| LinuxTools {
            supported: true,
            gamemode_installed: gmi,
            gamescope_installed: gsi,
            gamemode: gm,
            gamescope: gs,
        };
        let cases: [(LinuxTools, &[&str], &str); 4] = [
            (st(true, true, true, true), &["gamescope", "-f", "--", "gamemoderun"], "gamescope holds the session, gamemode runs inside it"),
            (st(true, false, true, true), &["gamemoderun"], "only what the player switched on"),
            (st(true, true, false, false), &[], "a missing tool is skipped rather than failing the launch"),
            (st(false, false, true, true), &[], "installed but off does nothing"),
        ];
        for (state, want, why) in cases {
            assert_eq!(wrapper_prefix(&state), want.to_vec(), "{}", why);
        }
    }
}
