use std::path::Path;
use std::process::Command;

/// Which video card the game should run on. A wrapper command would let the
/// webview put arbitrary text on a command line, so the choice is an
/// identifier the core translates into known-safe switches itself.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GpuPref {
    Auto,
    Discrete,
    Integrated,
}

impl GpuPref {
    pub fn parse(raw: &str) -> GpuPref {
        match raw {
            "discrete" => GpuPref::Discrete,
            "integrated" => GpuPref::Integrated,
            _ => GpuPref::Auto,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            GpuPref::Discrete => "discrete",
            GpuPref::Integrated => "integrated",
            GpuPref::Auto => "auto",
        }
    }
}

/// True where the choice actually changes anything. macOS switches cards on its
/// own and exposes no per-process control, so the UI says so instead of
/// pretending the setting works.
pub fn gpu_switch_supported() -> bool {
    cfg!(windows) || cfg!(target_os = "linux")
}

pub fn apply_gpu_pref(cmd: &mut Command, java: &Path, pref: GpuPref) {
    if pref == GpuPref::Auto {
        return;
    }
    #[cfg(target_os = "linux")]
    linux_env(cmd, pref);
    #[cfg(windows)]
    win_registry(java, pref);
    let _ = (cmd, java);
}

/// PRIME offload is per-process and env-driven on every current driver stack:
/// Mesa reads DRI_PRIME, the NVIDIA blob reads the __NV/__GLX pair, and Vulkan
/// picks the same card through __VK_LAYER_NV_optimus.
#[cfg(target_os = "linux")]
fn linux_env(cmd: &mut Command, pref: GpuPref) {
    match pref {
        GpuPref::Discrete => {
            cmd.env("DRI_PRIME", "1");
            cmd.env("__NV_PRIME_RENDER_OFFLOAD", "1");
            cmd.env("__GLX_VENDOR_LIBRARY_NAME", "nvidia");
            cmd.env("__VK_LAYER_NV_optimus", "NVIDIA_only");
        }
        GpuPref::Integrated => {
            cmd.env("DRI_PRIME", "0");
        }
        GpuPref::Auto => {}
    }
}

/// Windows has no environment switch: the per-application choice lives in the
/// same registry list the Graphics settings page writes, keyed by the exe that
/// is actually spawned.
#[cfg(windows)]
fn win_registry(java: &Path, pref: GpuPref) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Registry::{
        RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ,
    };

    const KEY: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";

    let wide = |s: &str| -> Vec<u16> { OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect() };
    let Some(exe) = java.to_str() else { return };
    let value = match pref {
        GpuPref::Discrete => "GpuPreference=2;",
        GpuPref::Integrated => "GpuPreference=1;",
        GpuPref::Auto => "GpuPreference=0;",
    };
    let key = wide(KEY);
    let name = wide(exe);
    let data = wide(value);
    unsafe {
        RegSetKeyValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            REG_SZ,
            data.as_ptr() as *const std::ffi::c_void,
            (data.len() * 2) as u32,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pref_round_trips_and_unknown_falls_back_to_auto() {
        // (stored value → parsed choice, why the case is pinned)
        let cases: &[(&str, GpuPref, &str)] = &[
            ("discrete", GpuPref::Discrete, "the whole point of the setting"),
            ("integrated", GpuPref::Integrated, "saving battery is the opposite ask"),
            ("auto", GpuPref::Auto, "the default must survive a round trip"),
            ("", GpuPref::Auto, "a settings file without the key must not switch cards"),
            ("GpuPreference=2;", GpuPref::Auto, "raw registry text is not an identifier we accept"),
            ("DISCRETE", GpuPref::Auto, "the identifier set is exact, not case-folded"),
        ];
        for (raw, want, why) in cases {
            assert_eq!(
                GpuPref::parse(raw),
                *want,
                "GpuPref::parse({raw:?}) must yield {want:?}. Reason this case is pinned: {why}",
            );
        }
        for p in [GpuPref::Auto, GpuPref::Discrete, GpuPref::Integrated] {
            assert_eq!(GpuPref::parse(p.as_str()), p, "as_str/parse must round trip so saved settings survive a restart");
        }
    }
}
