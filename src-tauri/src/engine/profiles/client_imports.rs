// Lunar Client and Feather keep the player's own Fabric mods outside the game folder, one folder per
// game version; their game folder is the shared .minecraft. Such a folder is imported as a Fabric build
// of that version: the jars go to mods/, the shared settings and server list come along.
use super::imports::{home, version_is_plausible, FoundInstance};
use crate::engine::*;
use std::path::{Path, PathBuf};

const LUNAR: &str = "Lunar Client";
const FEATHER: &str = "Feather";

fn app_data() -> PathBuf {
    let h = home();
    if cfg!(target_os = "macos") {
        h.join("Library/Application Support")
    } else if cfg!(target_os = "windows") {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or(h.join("AppData/Roaming"))
    } else {
        h.join(".local/share")
    }
}

fn lunar_root() -> PathBuf {
    home().join(".lunarclient").join("profiles")
}

fn feather_roots() -> Vec<PathBuf> {
    let mut roots = vec![app_data().join(".feather").join("user-mods"), home().join(".feather").join("user-mods")];
    roots.dedup();
    roots
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .map(|e| e.path())
        .collect()
}

fn jar_count(dir: &Path) -> usize {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    rd.flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(".jar"))
        .count()
}

/// `fabric-1.20.1` (Lunar) and `1.20.1-fabric` (Feather) name the game version of their mods.
pub(crate) fn client_mods_version(folder: &str) -> Option<String> {
    let low = folder.to_ascii_lowercase();
    let v = low.strip_prefix("fabric-").or_else(|| low.strip_suffix("-fabric"))?;
    (v != "latest" && version_is_plausible(v)).then(|| v.to_string())
}

fn found(source: &str, dir: PathBuf) -> Option<FoundInstance> {
    let folder = dir.file_name()?.to_string_lossy().into_owned();
    let version = client_mods_version(&folder)?;
    if jar_count(&dir) == 0 {
        return None;
    }
    Some(FoundInstance {
        name: format!("{} {}", source, version),
        version,
        loader: "fabric".into(),
        path: dir.to_string_lossy().into_owned(),
        source: source.into(),
        movable: false,
    })
}

pub(crate) fn client_mod_instances() -> Vec<FoundInstance> {
    let mut out = vec![];
    for profile in subdirs(&lunar_root()) {
        for major in subdirs(&profile) {
            for dir in subdirs(&major.join("mods")) {
                out.extend(found(LUNAR, dir));
            }
        }
    }
    for root in feather_roots() {
        for dir in subdirs(&root) {
            out.extend(found(FEATHER, dir));
        }
    }
    out
}

pub(crate) fn is_client_mods_dir(path: &Path) -> bool {
    let inside = |root: &Path| path.starts_with(root) && path != root;
    let named = path.file_name().is_some_and(|n| client_mods_version(&n.to_string_lossy()).is_some());
    named && (inside(&lunar_root()) || feather_roots().iter().any(|r| inside(r)))
}

fn shared_minecraft() -> PathBuf {
    if cfg!(target_os = "macos") {
        app_data().join("minecraft")
    } else if cfg!(target_os = "windows") {
        app_data().join(".minecraft")
    } else {
        home().join(".minecraft")
    }
}

/// Settings and servers are shared with the vanilla game; worlds stay where they are.
const SHARED_FILES: [&str; 3] = ["options.txt", "servers.dat", "optionsof.txt"];

/// Copies the mod jars and the shared settings into an empty build folder. Links are skipped:
/// a jar pointing elsewhere would copy whatever it targets.
pub(crate) fn copy_client_mods(src: &Path, dst: &Path) -> Result<usize, String> {
    let mods = dst.join("mods");
    std::fs::create_dir_all(&mods).map_err(|e| format!("Не удалось создать папку модов: {}", e))?;
    let rd = std::fs::read_dir(src).map_err(|e| format!("Не удалось прочитать папку модов: {}", e))?;
    let mut copied = 0;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.to_ascii_lowercase().ends_with(".jar") {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else { continue };
        if !meta.is_file() {
            continue;
        }
        let to = safe_join(&mods, &name)?;
        std::fs::copy(entry.path(), &to).map_err(|e| format!("Не удалось скопировать {}: {}", name, e))?;
        copied += 1;
    }
    let shared = shared_minecraft();
    for file in SHARED_FILES {
        let from = shared.join(file);
        if std::fs::symlink_metadata(&from).is_ok_and(|m| m.is_file()) {
            let _ = std::fs::copy(&from, dst.join(file));
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::client_mods_version;

    #[test]
    fn version_comes_from_the_folder_name() {
        let cases: [(&str, Option<&str>, &str); 5] = [
            ("fabric-1.20.1", Some("1.20.1"), "Lunar names folders loader first"),
            ("1.21.4-fabric", Some("1.21.4"), "Feather names folders version first"),
            ("FABRIC-1.8.9", Some("1.8.9"), "case does not matter"),
            ("forge-1.20.1", None, "only Fabric mods are user-installable in these clients"),
            ("fabric-latest", None, "a folder without a real version is not a build"),
        ];
        for (input, want, why) in cases {
            assert_eq!(client_mods_version(input).as_deref(), want, "{why}");
        }
    }
}
