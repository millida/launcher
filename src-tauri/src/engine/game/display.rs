use std::process::Command;

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum EnvChange {
    Set(&'static str, &'static str),
    Remove(&'static str),
}

const SDL_DRIVER_VARS: [&str; 2] = ["SDL_VIDEO_DRIVER", "SDL_VIDEODRIVER"];

fn present(lookup: &dyn Fn(&str) -> Option<String>, name: &str) -> bool {
    lookup(name).is_some_and(|v| !v.trim().is_empty())
}

/// SDL3 (lwjgl3ify on 1.7.10) and GLFW 3.4 open a native Wayland surface when
/// WAYLAND_DISPLAY is set, and EGL on that surface dies with EGL_BAD_ALLOC on
/// the NVIDIA driver before the first frame. XWayland runs the same builds
/// fine, so the game is moved there whenever an X server is reachable. A user
/// who exported an SDL driver of their own keeps it.
pub(crate) fn x11_fallback(lookup: &dyn Fn(&str) -> Option<String>) -> Vec<EnvChange> {
    let on_wayland = present(lookup, "WAYLAND_DISPLAY");
    let has_x = present(lookup, "DISPLAY");
    let user_chose = SDL_DRIVER_VARS.iter().any(|name| present(lookup, name));
    if !on_wayland || !has_x || user_chose {
        return Vec::new();
    }
    vec![
        EnvChange::Remove("WAYLAND_DISPLAY"),
        EnvChange::Set("XDG_SESSION_TYPE", "x11"),
        EnvChange::Set("SDL_VIDEO_DRIVER", "x11"),
        EnvChange::Set("SDL_VIDEODRIVER", "x11"),
        EnvChange::Set("GDK_BACKEND", "x11"),
    ]
}

pub fn apply_display_backend(cmd: &mut Command) {
    if !cfg!(target_os = "linux") {
        return;
    }
    for change in x11_fallback(&|name| std::env::var(name).ok()) {
        match change {
            EnvChange::Set(name, value) => {
                cmd.env(name, value);
            }
            EnvChange::Remove(name) => {
                cmd.env_remove(name);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    type Vars<'a> = &'a [(&'a str, &'a str)];

    fn changes(vars: Vars) -> Vec<EnvChange> {
        let map: HashMap<String, String> = vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
        x11_fallback(&|name| map.get(name).cloned())
    }

    #[test]
    fn wayland_sessions_move_the_game_to_xwayland_only_when_it_is_safe() {
        // (environment → game goes to X11, why the case is pinned)
        let cases: &[(Vars, bool, &str)] = &[
            (&[("WAYLAND_DISPLAY", "wayland-1"), ("DISPLAY", ":0")], true, "Hyprland/GNOME/KDE with XWayland: the crash from the partner report"),
            (&[("DISPLAY", ":0")], false, "plain X11 session already works and must stay untouched"),
            (&[("WAYLAND_DISPLAY", "wayland-1")], false, "no XWayland: forcing X11 would leave the game without any display"),
            (&[("WAYLAND_DISPLAY", "wayland-1"), ("DISPLAY", "")], false, "an empty DISPLAY is no X server either"),
            (&[("WAYLAND_DISPLAY", ""), ("DISPLAY", ":0")], false, "an empty WAYLAND_DISPLAY is not a Wayland session"),
            (&[("WAYLAND_DISPLAY", "wayland-1"), ("DISPLAY", ":0"), ("SDL_VIDEO_DRIVER", "wayland")], false, "a player who asked SDL for Wayland keeps that choice"),
            (&[("WAYLAND_DISPLAY", "wayland-1"), ("DISPLAY", ":0"), ("SDL_VIDEODRIVER", "wayland")], false, "the SDL2 spelling of the same choice is honoured too"),
        ];
        for (vars, want_x11, why) in cases {
            let got = changes(vars);
            assert_eq!(!got.is_empty(), *want_x11, "{why}: got {got:?}");
        }
    }

    #[test]
    fn the_fallback_hides_wayland_from_every_toolkit_the_game_may_use() {
        let got = changes(&[("WAYLAND_DISPLAY", "wayland-1"), ("DISPLAY", ":0")]);
        for want in [
            EnvChange::Remove("WAYLAND_DISPLAY"),
            EnvChange::Set("SDL_VIDEO_DRIVER", "x11"),
            EnvChange::Set("SDL_VIDEODRIVER", "x11"),
            EnvChange::Set("XDG_SESSION_TYPE", "x11"),
        ] {
            assert!(got.contains(&want), "{want:?} missing: GLFW looks at WAYLAND_DISPLAY, SDL3/SDL2 at their driver vars; without it the game reopens on Wayland and crashes");
        }
    }
}
