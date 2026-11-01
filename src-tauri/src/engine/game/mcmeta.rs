// Rules from the Mojang version.json (which libraries and arguments for which system) and md5 for old assets. Only computes, no network.
use md5::{Digest, Md5};
use serde_json::Value;
use std::path::PathBuf;

/// The system a launch is planned for: Mojang's names for it (`osx`, `windows`, `linux`; `arm64`,
/// `x86_64`) and the separator of a Java path list. The running system in the launcher; any
/// system in tests, so a plan made on a Mac can be checked against the Windows one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Platform {
    pub os: &'static str,
    pub arch: &'static str,
    /// `${arch}` in the name of a natives jar: "64" or "32".
    pub bits: &'static str,
}

impl Platform {
    pub(crate) fn host() -> Platform {
        Platform {
            os: if cfg!(target_os = "macos") {
                "osx"
            } else if cfg!(target_os = "windows") {
                "windows"
            } else {
                "linux"
            },
            arch: if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" },
            bits: if cfg!(target_pointer_width = "64") { "64" } else { "32" },
        }
    }

    /// Separator of the classpath and of `-p`.
    pub(crate) fn path_sep(&self) -> &'static str {
        if self.os == "windows" { ";" } else { ":" }
    }
}

/// Evaluates version json `rules` (os.name/os.arch, features) the way the
/// official launcher does: the last matching rule wins.
pub(crate) fn rules_allow(rules: &Value) -> bool {
    rules_allow_on(rules, &Platform::host())
}

/// `rules_allow` for the given system.
pub(crate) fn rules_allow_on(rules: &Value, platform: &Platform) -> bool {
    let Some(arr) = rules.as_array() else { return true };
    let os_name = platform.os;
    let arch = platform.arch;
    let mut allowed = false;
    for r in arr {
        let action_allow = r["action"].as_str() == Some("allow");
        if r.get("features").is_some() {
            // Feature-gated arguments (demo, resolution, quickplay) are unused.
            if action_allow { continue } else { return false }
        }
        let mut matches = true;
        if let Some(os) = r.get("os") {
            if let Some(n) = os["name"].as_str() {
                if n != os_name { matches = false }
            }
            if let Some(a) = os["arch"].as_str() {
                let want = if a == "x86" { "x86" } else { a };
                if want != arch && !(a == "x86" && arch == "x86_64") { matches = false }
            }
        }
        if matches { allowed = action_allow }
    }
    allowed
}

/// Maps "group/path/artifact/version/file.jar" to a version-less key so loader
/// libraries replace the vanilla ones instead of both landing on the classpath.
pub(crate) fn artifact_key(rel: &str) -> String {
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() < 3 { return rel.to_string(); }
    let base = parts[..parts.len() - 2].join("/");
    // The classifier belongs in the key: lwjgl.jar and lwjgl-natives-macos.jar
    // are distinct artifacts.
    let artifact = parts[parts.len() - 3];
    let version = parts[parts.len() - 2];
    let file = parts[parts.len() - 1];
    let prefix = format!("{}-{}", artifact, version);
    let classifier = file
        .strip_suffix(".jar").unwrap_or(file)
        .strip_prefix(&prefix).unwrap_or("");
    format!("{}{}", base, classifier)
}

pub(crate) fn cp_put(cp: &mut Vec<(String, PathBuf)>, rel: &str, path: PathBuf) {
    let key = artifact_key(rel);
    if let Some(slot) = cp.iter_mut().find(|(k, _)| *k == key) { slot.1 = path; } else { cp.push((key, path)); }
}

pub(crate) fn maven_path(coord: &str) -> String {
    // group:artifact:version[:classifier][@ext] -> group/artifact/version/artifact-version[-classifier].ext
    // `coord` comes from remote JSON, so malformed names must not panic.
    let (coord, ext) = coord.split_once('@').unwrap_or((coord, "jar"));
    let parts: Vec<&str> = coord.split(':').collect();
    let g = parts.first().map(|s| s.replace('.', "/")).unwrap_or_default();
    let a = parts.get(1).copied().unwrap_or("");
    let v = parts.get(2).copied().unwrap_or("");
    let cls = parts.get(3).map(|c| format!("-{}", c)).unwrap_or_default();
    format!("{}/{}/{}/{}-{}{}.{}", g, a, v, a, v, cls, ext)
}

/// Vanilla offline player UUID: version 3 UUID of md5("OfflinePlayer:" + name).
pub(crate) fn offline_uuid(nick: &str) -> String {
    let mut h = Md5::new();
    h.update(format!("OfflinePlayer:{}", nick).as_bytes());
    let mut b = h.finalize();
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    let hex: String = b.iter().map(|x| format!("{:02x}", x)).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}
