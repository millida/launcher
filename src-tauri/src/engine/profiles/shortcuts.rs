// Desktop shortcuts to a build, a world or a server: a millida://launch link with a key only this computer knows.
// The list of shortcuts lives in shortcuts.json in the launcher data folder; deleting a build deletes its shortcuts. No network.
use crate::engine::*;
use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;

#[derive(serde::Serialize, serde::Deserialize, Clone)]
struct ShortcutRecord {
    key: String,
    profile: String,
    #[serde(default)]
    world: Option<String>,
    #[serde(default)]
    server: Option<String>,
    path: PathBuf,
}

fn records_path() -> PathBuf {
    data_dir().join("shortcuts.json")
}

fn load_records() -> Vec<ShortcutRecord> {
    std::fs::read(records_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_records(all: &[ShortcutRecord]) {
    write_json_quiet(&records_path(), all);
}

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Any web page can open a millida:// link, so a link starts the game without
/// asking only when it carries a key that a shortcut made here holds. The key
/// mixes the process's random hash seeds with the clock: it has to be
/// unguessable from outside, not cryptographic.
fn new_key() -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for _ in 0..4 {
        let mut s = std::collections::hash_map::RandomState::new().build_hasher();
        s.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
        h.update(s.finish().to_le_bytes());
    }
    h.update(std::process::id().to_le_bytes());
    h.finalize().iter().take(16).map(|b| format!("{:02x}", b)).collect()
}

fn key_ok(key: &str) -> bool {
    key.len() == 32 && key.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Windows refuses these in a file name; the label stays readable without them.
fn file_label(text: &str) -> String {
    let clean: String = text
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let clean: String = clean.trim_matches('.').chars().take(80).collect();
    if clean.is_empty() { "Millida".into() } else { clean }
}

fn launch_url(profile: &str, quickplay: Option<&str>, key: &str) -> String {
    let mut url = url::Url::parse("millida://launch").expect("static url");
    {
        let mut q = url.query_pairs_mut();
        q.append_pair("profile", profile);
        if let Some(qp) = quickplay {
            q.append_pair("quickplay", qp);
        }
        q.append_pair("key", key);
    }
    url.to_string()
}

fn quickplay_of(world: Option<&str>, server: Option<&str>) -> Option<String> {
    match (world, server) {
        (Some(w), _) => Some(format!("world:{}", w)),
        (None, Some(s)) => Some(format!("server:{}", s)),
        _ => None,
    }
}

#[cfg(windows)]
fn shortcut_body(url: &str) -> (String, String) {
    let icon = std::env::current_exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    ("url".into(), format!("[InternetShortcut]\r\nURL={}\r\nIconFile={}\r\nIconIndex=0\r\n", url, icon))
}

#[cfg(target_os = "macos")]
fn shortcut_body(url: &str) -> (String, String) {
    let esc = url.replace('&', "&amp;").replace('<', "&lt;");
    (
        "webloc".into(),
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>URL</key><string>{}</string></dict></plist>\n",
            esc
        ),
    )
}

#[cfg(all(unix, not(target_os = "macos")))]
fn shortcut_body(url: &str) -> (String, String) {
    ("desktop".into(), format!("[Desktop Entry]\nType=Application\nName=Millida\nIcon=millida-launcher\nExec=xdg-open \"{}\"\nTerminal=false\n", url))
}

fn free_path(dir: &std::path::Path, label: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{}.{}", label, ext));
    if !first.exists() {
        return first;
    }
    (2..100).map(|n| dir.join(format!("{} ({}).{}", label, n, ext))).find(|p| !p.exists()).unwrap_or(first)
}

/// Puts a shortcut on the desktop that starts the build, or goes straight into
/// one of its worlds or servers. Returns the file it wrote.
pub fn create_build_shortcut(profile: &str, world: Option<String>, server: Option<String>) -> Result<String, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let world = world.map(|w| w.trim().to_string()).filter(|w| !w.is_empty());
    let server = server.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    if let Some(w) = &world {
        safe_file_name(w)?;
        if !profile_dir(profile).join("saves").join(w).is_dir() {
            return Err("Мир не найден".into());
        }
    }
    if server.as_deref().is_some_and(|s| !cmdline_text_ok(s, 255) || s.starts_with('-')) {
        return Err("Некорректный адрес сервера".into());
    }
    let desktop = dirs::desktop_dir().ok_or("Не нашли рабочий стол")?;
    let key = new_key();
    let quickplay = quickplay_of(world.as_deref(), server.as_deref());
    let (ext, body) = shortcut_body(&launch_url(profile, quickplay.as_deref(), &key));
    let target = world.as_deref().or(server.as_deref());
    let label = file_label(&match target {
        Some(x) => format!("{} — {}", profile, x),
        None => profile.to_string(),
    });
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = free_path(&desktop, &label, &ext);
    std::fs::write(&path, body).map_err(|e| format!("Ярлык не создался: {}", e))?;
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
    }
    let mut all = load_records();
    all.push(ShortcutRecord { key, profile: profile.to_string(), world, server, path: path.clone() });
    save_records(&all);
    Ok(path.to_string_lossy().to_string())
}

/// True when the link came from a shortcut made here for exactly this target.
pub fn shortcut_trusted(key: &str, profile: &str, quickplay: Option<&str>) -> bool {
    if !key_ok(key) {
        return false;
    }
    load_records()
        .iter()
        .any(|r| r.key == key && r.profile == profile && quickplay_of(r.world.as_deref(), r.server.as_deref()).as_deref() == quickplay)
}

/// A deleted build takes its shortcuts with it: a dead icon on the desktop
/// would only show an error.
pub(crate) fn forget_build_shortcuts(profile: &str) {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let all = load_records();
    let (gone, keep): (Vec<_>, Vec<_>) = all.into_iter().partition(|r| r.profile == profile);
    if gone.is_empty() {
        return;
    }
    for r in &gone {
        // Only a file this launcher wrote and recorded is removed, and only if
        // it still points at our link: the player may have reused the name.
        let ours = std::fs::read_to_string(&r.path).is_ok_and(|t| t.contains(&r.key));
        if ours {
            let _ = std::fs::remove_file(&r.path);
        }
    }
    save_records(&keep);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// label -> file name. A build name may hold anything the player typed.
    #[test]
    fn a_build_name_becomes_a_safe_file_name() {
        let table: [(&str, &str, &str); 4] = [
            ("Выживание", "Выживание", "plain names stay as they are"),
            ("a/b\\c:d*e?", "a b c d e", "path and reserved characters are dropped"),
            ("...", "Millida", "nothing left gives the default"),
            ("  two   spaces ", "two spaces", "runs of blanks collapse"),
        ];
        for (raw, want, why) in table {
            assert_eq!(file_label(raw), want, "{why}");
        }
    }

    /// The link carries the target and the key; a key from elsewhere is refused.
    #[test]
    fn the_link_names_its_target_and_key() {
        let url = launch_url("Моя сборка", Some("server:play.example.net"), "ab".repeat(16).as_str());
        let parsed = url::Url::parse(&url).expect("valid url");
        let q: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q.get("profile").map(String::as_str), Some("Моя сборка"), "the build name survives encoding");
        assert_eq!(q.get("quickplay").map(String::as_str), Some("server:play.example.net"));
        assert!(key_ok(&new_key()), "a fresh key has the form the check expects");
        assert!(!key_ok("../../x"), "anything else is not a key");
        assert_ne!(new_key(), new_key(), "two shortcuts must not share a key");
    }
}
