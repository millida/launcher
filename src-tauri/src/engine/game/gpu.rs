// Graphics card choice for the game. On Windows it writes one value to HKCU\Software\Microsoft\DirectX\UserGpuPreferences
// (the same one as in Windows "Graphics settings") for our Java. On Linux it sets environment variables for the launch.
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

/// Names of the hardware video cards of this machine. The webview reports only
/// the card it draws on itself, which on a laptop with two is the weak one,
/// while the game is sent to the strong one.
#[cfg(windows)]
pub fn adapter_names() -> Vec<String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};

    let mut names = Vec::new();
    // Windows system call: ask for the list of graphics cards.
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return names;
    };
    for index in 0..16 {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        let len = desc.Description.iter().position(|&unit| unit == 0).unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..len]).trim().to_string();
        if !name.is_empty() && !names.contains(&name) {
            names.push(name);
        }
    }
    names
}

#[cfg(not(windows))]
pub fn adapter_names() -> Vec<String> {
    Vec::new()
}

/// A video card and its driver as Windows reports them: PCI vendor id and the
/// user-mode driver version, the four numbers Device Manager shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdapterDriver {
    pub name: String,
    pub vendor: u32,
    pub version: [u16; 4],
}

const VENDOR_NVIDIA: u32 = 0x10DE;
const VENDOR_INTEL: u32 = 0x8086;

#[cfg(windows)]
pub fn adapter_drivers() -> Vec<AdapterDriver> {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIDevice, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};

    let mut out = Vec::new();
    // Windows system call: ask for the list of graphics cards.
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else {
        return out;
    };
    for index in 0..16 {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(index) }) else {
            break;
        };
        let Ok(desc) = (unsafe { adapter.GetDesc1() }) else {
            continue;
        };
        if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
            continue;
        }
        // Windows system call: the user-mode driver version of the card (read-only).
        let Ok(umd) = (unsafe { adapter.CheckInterfaceSupport(&IDXGIDevice::IID) }) else {
            continue;
        };
        let len = desc.Description.iter().position(|&unit| unit == 0).unwrap_or(desc.Description.len());
        let name = String::from_utf16_lossy(&desc.Description[..len]).trim().to_string();
        out.push(AdapterDriver { name, vendor: desc.VendorId, version: split_driver_version(umd) });
    }
    out
}

#[cfg(not(windows))]
pub fn adapter_drivers() -> Vec<AdapterDriver> {
    Vec::new()
}

/// DXGI packs the version as four 16-bit numbers, highest first.
pub fn split_driver_version(raw: i64) -> [u16; 4] {
    let u = raw as u64;
    [(u >> 48) as u16, (u >> 32) as u16, (u >> 16) as u16, u as u16]
}

/// NVIDIA's own number from the Windows one: 31.0.15.3623 is 536.23.
fn nvidia_release(v: [u16; 4]) -> u32 {
    u32::from(v[2] % 10) * 10000 + u32::from(v[3])
}

/// Intel Gen7 (Ivy Bridge, Haswell): Sodium crashes on start before driver 10.18.10.5161.
fn intel_gen7(name: &str) -> bool {
    let n = name.to_ascii_lowercase().replace("(r)", "").replace("(tm)", "");
    let n = n.split_whitespace().collect::<Vec<_>>().join(" ");
    ["hd graphics 2500", "hd graphics 4000", "hd graphics 4200", "hd graphics 4400", "hd graphics 4600", "hd graphics 5000", "iris graphics 5100", "iris pro graphics 5200"]
        .iter()
        .any(|m| n.contains(m))
}

/// A driver Sodium is known not to start on (Sodium wiki, Driver Compatibility):
/// the launcher then leaves Sodium out and offers the vendor's driver page.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverIssue {
    pub card: String,
    pub version: String,
    /// The vendor's own download page: Windows Update and Device Manager hand out stale drivers.
    pub url: &'static str,
}

pub fn driver_issue_among(drivers: &[AdapterDriver]) -> Option<DriverIssue> {
    let issue = |d: &AdapterDriver, url: &'static str| DriverIssue {
        card: d.name.clone(),
        version: d.version.iter().map(|n| n.to_string()).collect::<Vec<_>>().join("."),
        url,
    };
    if let Some(d) = drivers.iter().find(|d| d.vendor == VENDOR_NVIDIA && nvidia_release(d.version) < 53623) {
        return Some(issue(d, "https://www.nvidia.com/Download/index.aspx"));
    }
    // The game runs on a discrete card when there is one: an old Intel driver next to it does not matter.
    let only_intel = drivers.iter().all(|d| d.vendor == VENDOR_INTEL);
    drivers
        .iter()
        .find(|d| only_intel && intel_gen7(&d.name) && d.version < [10, 18, 10, 5161])
        .map(|d| issue(d, "https://www.intel.com/content/www/us/en/support/detect.html"))
}

/// The driver problem of this PC, asked once per launcher run: drivers do not change under a running launcher often enough to ask DXGI on every screen.
pub fn driver_issue() -> Option<DriverIssue> {
    static ISSUE: std::sync::OnceLock<Option<DriverIssue>> = std::sync::OnceLock::new();
    ISSUE.get_or_init(|| driver_issue_among(&adapter_drivers())).clone()
}

/// True where the choice actually changes anything. macOS switches cards on its
/// own and exposes no per-process control, so the UI says so instead of
/// pretending the setting works.
pub fn gpu_switch_supported() -> bool {
    cfg!(windows) || cfg!(target_os = "linux")
}

pub fn apply_gpu_pref(cmd: &mut Command, java: &Path, pref: GpuPref) {
    #[cfg(windows)]
    win_registry(java, windows_pref(pref));
    if pref == GpuPref::Auto {
        let _ = (cmd, java);
        return;
    }
    #[cfg(target_os = "linux")]
    linux_env(cmd, pref);
    let _ = (cmd, java);
}

/// На Windows «Авто» — это «производительная видеокарта». Игра идёт как
/// копия MillidaMinecraft.exe, а не javaw.exe: профили драйвера NVIDIA/AMD
/// под Java её не узнают, и «Пусть Windows решает» на ноутбуке с двумя
/// видеокартами отдаёт OpenGL встроенной — FPS вдвое ниже (25.09.2026).
/// На машине с одной видеокартой запись ничего не меняет.
fn windows_pref(pref: GpuPref) -> GpuPref {
    if pref == GpuPref::Auto { GpuPref::Discrete } else { pref }
}

pub fn auto_runs_on_discrete(pref: GpuPref) -> bool {
    cfg!(windows) && windows_pref(pref) != pref
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
        // Writes to the registry of the current user (HKCU, no admin rights needed): the graphics card setting for the launcher's java.exe only.
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

    /// (card, driver) -> a known bad driver. NVIDIA below 536.23 does not start
    /// Sodium; Intel Gen7 below 10.18.10.5161 crashes on start (Sodium wiki).
    #[test]
    fn known_bad_drivers_are_caught_and_good_ones_left_alone() {
        let d = |name: &str, vendor: u32, version: [u16; 4]| AdapterDriver { name: name.into(), vendor, version };
        let nv_old = d("NVIDIA GeForce GTX 1050", VENDOR_NVIDIA, [27, 21, 14, 5671]);
        let nv_new = d("NVIDIA GeForce RTX 3060", VENDOR_NVIDIA, [32, 0, 15, 6094]);
        let nv_edge = d("NVIDIA GeForce RTX 3060", VENDOR_NVIDIA, [31, 0, 15, 3623]);
        let hd4600_old = d("Intel(R) HD Graphics 4600", VENDOR_INTEL, [10, 18, 10, 4358]);
        let hd4600_new = d("Intel(R) HD Graphics 4600", VENDOR_INTEL, [20, 19, 15, 5107]);
        let uhd = d("Intel(R) UHD Graphics 620", VENDOR_INTEL, [31, 0, 101, 2125]);
        let cases: Vec<(Vec<AdapterDriver>, bool, &str)> = vec![
            (vec![nv_old.clone()], true, "NVIDIA 456.71 is below 536.23"),
            (vec![nv_new.clone()], false, "NVIDIA 560.94"),
            (vec![nv_edge], false, "exactly 536.23 is supported"),
            (vec![hd4600_old.clone()], true, "Haswell on an old driver"),
            (vec![hd4600_new], false, "Haswell on the last Intel driver"),
            (vec![uhd.clone()], false, "newer Intel is not on the list"),
            (vec![hd4600_old, nv_new], false, "the game runs on the NVIDIA card"),
            (vec![uhd, nv_old], true, "an old NVIDIA driver next to Intel"),
            (vec![], false, "no cards known (macOS, Linux)"),
        ];
        for (drivers, want, why) in cases {
            assert_eq!(driver_issue_among(&drivers).is_some(), want, "{why}");
        }
        assert_eq!(split_driver_version(0x001F_0000_000F_0E27), [31, 0, 15, 3623], "DXGI packs four 16-bit numbers");
        assert_eq!(nvidia_release([31, 0, 15, 3623]), 53623);
    }

    #[test]
    fn auto_on_windows_asks_for_the_fast_card_and_explicit_choices_stay() {
        assert_eq!(windows_pref(GpuPref::Auto), GpuPref::Discrete);
        assert_eq!(windows_pref(GpuPref::Discrete), GpuPref::Discrete);
        assert_eq!(windows_pref(GpuPref::Integrated), GpuPref::Integrated);
    }

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
