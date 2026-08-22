use crate::engine::*;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(serde::Serialize)]
pub struct WorldEntry { pub name: String, pub folder: String, pub last_played: u64 }

pub fn list_worlds(profile: &str) -> Vec<WorldEntry> {
    let saves = profile_dir(profile).join("saves");
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&saves) {
        for e in rd.flatten() {
            if !e.path().is_dir() { continue }
            let folder = e.file_name().to_string_lossy().to_string();
            let lp = e.path().join("level.dat").metadata().ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()).unwrap_or(0);
            out.push(WorldEntry { name: folder.clone(), folder, last_played: lp });
        }
    }
    out.sort_by_key(|w| std::cmp::Reverse(w.last_played));
    out
}

/// The folder name comes over IPC, so the path is built via safe_child only.
pub fn delete_world(profile: &str, folder: &str) -> Result<(), String> {
    let name = safe_file_name(folder)?;
    let dir = safe_child(&profile_dir(profile).join("saves"), &name)?;
    if !dir.is_dir() { return Err("Мир не найден".into()); }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("Мир занят другой программой: {}", e))?;
    manifest_remove(profile, "world", &name);
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct ServerEntry { pub name: String, pub ip: String }

pub(crate) fn servers_file(profile: &str) -> PathBuf { profile_dir(profile).join("millida-servers.json") }

pub fn list_servers(profile: &str) -> Vec<ServerEntry> {
    std::fs::read(servers_file(profile)).ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

/// Dedup by name as well as by address: a hosting server keeps its name while
/// its address follows the entry it is routed through (PL, MSK, direct), and
/// matching on the address alone left one duplicate per route in the list.
pub fn add_server(profile: &str, name: String, ip: String) -> Vec<ServerEntry> {
    let mut all = list_servers(profile);
    let same_name = !name.trim().is_empty();
    all.retain(|s| s.ip != ip && !(same_name && s.name == name));
    all.insert(0, ServerEntry { name, ip });
    write_json_quiet(&servers_file(profile), &all);
    all
}

pub fn remove_server(profile: &str, ip: &str) -> Vec<ServerEntry> {
    let mut all = list_servers(profile);
    all.retain(|s| s.ip != ip);
    write_json_quiet(&servers_file(profile), &all);
    all
}

/// Pins a server to the first slot of the in-game servers.dat list, keeping the
/// player's other entries and creating the file when missing.
pub fn pin_server_dat(profile: &str, name: &str, ip: &str) -> Result<(), String> {
    if ip.trim().is_empty() { return Ok(()); }
    let path = profile_dir(profile).join("servers.dat");
    let raw = std::fs::read(&path).unwrap_or_default();
    let mut list = read_servers(&raw);
    // A non-empty file that yields no servers is a format we failed to read,
    // not an empty list. Writing our single entry over it would erase every
    // server the player added by hand; not getting pinned is the lesser harm.
    if list.is_empty() && !raw.is_empty() {
        return Ok(());
    }
    // Same reason as in add_server: the address changes with the entry the
    // server is routed through, the name does not.
    let prev = list
        .iter()
        .position(|s| s.ip == ip || (!name.is_empty() && s.name == name))
        .map(|idx| list.remove(idx));
    list.retain(|s| s.ip != ip && !(!name.is_empty() && s.name == name));
    let pinned = prev
        .map(|prev| ServerRecord { name: name.to_string(), ip: ip.to_string(), ..prev })
        .unwrap_or_else(|| ServerRecord::new(name, ip));
    list.insert(0, pinned);
    if let Some(par) = path.parent() { std::fs::create_dir_all(par).ok(); }
    write_bytes_atomic(&path, &write_servers(&list))
}

/// Quick Play (MC 1.20+): launch straight into a world or server.
pub async fn quick_play(
    app: AppHandle,
    profile: String,
    nick: String,
    ram_mb: u32,
    world: Option<String>,
    server: Option<String>,
    auth: Auth,
) -> Result<String, String> {
    let p = load_profiles().into_iter().find(|x| x.name == profile)
        .ok_or("Сборка не найдена")?;
    QUICK.lock().unwrap().replace((world, server));
    let r = install_and_launch_in(app, p.version.clone(), nick, p.fabric, ram_mb, profile, auth).await;
    QUICK.lock().unwrap().take();
    r
}

/// Set from the UI, checked between install steps and right before the JVM starts.
pub static CANCEL: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn cancel_launch() {
    CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
}

pub(crate) fn cancelled() -> bool {
    CANCEL.load(std::sync::atomic::Ordering::SeqCst)
}

pub(crate) fn check_cancel() -> Result<(), String> {
    if cancelled() { Err("Запуск отменён".into()) } else { Ok(()) }
}

pub static QUICK: std::sync::Mutex<Option<(Option<String>, Option<String>)>> = std::sync::Mutex::new(None);
