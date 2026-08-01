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

pub fn add_server(profile: &str, name: String, ip: String) -> Vec<ServerEntry> {
    let mut all = list_servers(profile);
    all.retain(|s| s.ip != ip);
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
    let mut list = std::fs::read(&path).ok().map(|b| read_servers(&b)).unwrap_or_default();
    list.retain(|(_, i)| i != ip);
    list.insert(0, (name.to_string(), ip.to_string()));
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
