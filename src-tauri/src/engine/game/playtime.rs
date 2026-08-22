use crate::engine::*;
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;

pub(crate) fn playtime_path() -> PathBuf { data_dir().join("playtime.json") }

#[derive(Serialize, Clone)]
pub struct PlayEntry {
    pub key: String,
    pub label: String,
    pub seconds: u64,
    pub last: u64,
    pub sessions: u64,
}

#[derive(Serialize, Default)]
pub struct PlayStats {
    pub total_seconds: u64,
    pub sessions: u64,
    pub builds: Vec<PlayEntry>,
    pub servers: Vec<PlayEntry>,
    pub last_build: String,
    pub last_server: String,
    pub last_server_name: String,
    pub last_at: u64,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The v1 file was a flat profile -> {seconds,last} map; it is migrated into the
/// `builds` section so existing playtime is not lost.
fn read_doc() -> Value {
    let raw: Value = std::fs::read(playtime_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| json!({}));
    let mut doc = if raw["builds"].is_object() {
        raw
    } else {
        let mut builds = serde_json::Map::new();
        if let Some(obj) = raw.as_object() {
            for (k, v) in obj {
                let seconds = v["seconds"].as_u64().unwrap_or(0);
                if seconds == 0 { continue }
                builds.insert(
                    k.clone(),
                    json!({ "seconds": seconds, "last": v["last"].as_u64().unwrap_or(0), "sessions": 0 }),
                );
            }
        }
        json!({ "builds": Value::Object(builds) })
    };
    if !doc["builds"].is_object() { doc["builds"] = json!({}) }
    if !doc["servers"].is_object() { doc["servers"] = json!({}) }
    doc
}

fn write_doc(doc: &Value) {
    write_json_quiet(&playtime_path(), doc);
}

fn bump(section: &mut Value, key: &str, secs: u64, ts: u64, new_session: bool) {
    let cur = section[key].clone();
    section[key] = json!({
        "seconds": cur["seconds"].as_u64().unwrap_or(0) + secs,
        "sessions": cur["sessions"].as_u64().unwrap_or(0) + u64::from(new_session),
        "last": ts,
        "name": cur["name"].as_str().unwrap_or(""),
    });
}

/// Existing entries were written before addresses were canonicalized, and the
/// UI still passes whatever the player typed: without this, one server splits
/// into `Play.Example.RU` and `play.example.ru`.
fn server_key(section: &Value, addr: &str) -> String {
    let canon = canon_addr(addr);
    section
        .as_object()
        .and_then(|m| m.keys().find(|k| canon_addr(k) == canon).cloned())
        .unwrap_or(canon)
}

/// A session is written in slices while the game runs, so killing the launcher
/// (tray exit, crash, reboot) loses at most one flush interval instead of the
/// whole session. Only the first slice counts towards the session counter.
///
/// `server_session` is separate from `new_session`: hopping to another server
/// mid-launch starts a session for that server without inventing a second
/// launch of the build.
pub(crate) fn record_playtime(
    profile: &str,
    secs: u64,
    server: Option<&str>,
    new_session: bool,
    server_session: bool,
) {
    if secs == 0 && !new_session && !server_session { return }
    let ts = now_secs();
    let mut doc = read_doc();
    bump(&mut doc["builds"], profile, secs, ts, new_session);
    doc["lastBuild"] = json!(profile);
    doc["lastAt"] = json!(ts);
    if let Some(addr) = server.map(str::trim).filter(|s| !s.is_empty()) {
        let key = server_key(&doc["servers"], addr);
        bump(&mut doc["servers"], &key, secs, ts, server_session);
        doc["lastServer"] = json!(key);
    }
    write_doc(&doc);
}

/// The engine stores only addresses; display names are supplied by the UI.
pub fn label_server(addr: &str, name: &str) {
    let addr = addr.trim();
    let name = name.trim();
    if addr.is_empty() || name.is_empty() { return }
    let mut doc = read_doc();
    let key = server_key(&doc["servers"], addr);
    let addr = key.as_str();
    let cur = doc["servers"][addr].clone();
    doc["servers"][addr] = json!({
        "seconds": cur["seconds"].as_u64().unwrap_or(0),
        "sessions": cur["sessions"].as_u64().unwrap_or(0),
        "last": cur["last"].as_u64().unwrap_or(0),
        "name": name,
    });
    write_doc(&doc);
}

/// Called when a build is deleted: otherwise a new build with the same name
/// inherits the hours played by the old one.
pub(crate) fn forget_playtime(profile: &str) {
    let mut doc = read_doc();
    if let Some(builds) = doc["builds"].as_object_mut() {
        if builds.remove(profile).is_none() { return }
    } else {
        return;
    }
    if doc["lastBuild"].as_str() == Some(profile) {
        doc["lastBuild"] = json!("");
    }
    write_doc(&doc);
}

pub fn get_playtime(profile: &str) -> u64 {
    read_doc()["builds"][profile]["seconds"].as_u64().unwrap_or(0)
}

pub fn get_play_stats() -> PlayStats {
    let doc = read_doc();
    let entries = |section: &Value| -> Vec<PlayEntry> {
        let mut out: Vec<PlayEntry> = section
            .as_object()
            .map(|m| {
                m.iter()
                    .map(|(k, e)| PlayEntry {
                        key: k.clone(),
                        label: e["name"].as_str().unwrap_or("").to_string(),
                        seconds: e["seconds"].as_u64().unwrap_or(0),
                        last: e["last"].as_u64().unwrap_or(0),
                        sessions: e["sessions"].as_u64().unwrap_or(0),
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.sort_by(|a, b| b.seconds.cmp(&a.seconds).then(b.last.cmp(&a.last)));
        out
    };
    let builds = entries(&doc["builds"]);
    let servers = entries(&doc["servers"]);
    let last_server = doc["lastServer"].as_str().unwrap_or("").to_string();
    let last_server_name = servers
        .iter()
        .find(|s| canon_addr(&s.key) == canon_addr(&last_server))
        .map(|s| s.label.clone())
        .unwrap_or_default();
    PlayStats {
        total_seconds: builds.iter().map(|b| b.seconds).sum(),
        sessions: builds.iter().map(|b| b.sessions).sum(),
        last_build: doc["lastBuild"].as_str().unwrap_or("").to_string(),
        last_at: doc["lastAt"].as_u64().unwrap_or(0),
        last_server,
        last_server_name,
        builds,
        servers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Slices of one session must add up in seconds but count as a single
    /// session: the periodic flush in `launch.rs` calls `bump` many times.
    #[test]
    fn flush_slices_accumulate_seconds_but_not_sessions() {
        let mut section = json!({});
        bump(&mut section, "build", 60, 100, true);
        bump(&mut section, "build", 60, 160, false);
        bump(&mut section, "build", 25, 185, false);
        assert_eq!(
            section["build"]["seconds"].as_u64(),
            Some(145),
            "flushed slices must sum into total seconds"
        );
        assert_eq!(
            section["build"]["sessions"].as_u64(),
            Some(1),
            "one launch must stay one session no matter how many flushes it took"
        );
        assert_eq!(section["build"]["last"].as_u64(), Some(185), "last must track the newest flush");
    }

    #[test]
    fn separate_launches_count_separately() {
        let mut section = json!({ "build": { "seconds": 10, "sessions": 1, "name": "Survival" } });
        bump(&mut section, "build", 5, 200, true);
        assert_eq!(section["build"]["sessions"].as_u64(), Some(2));
        assert_eq!(section["build"]["seconds"].as_u64(), Some(15));
        assert_eq!(
            section["build"]["name"].as_str(),
            Some("Survival"),
            "the UI-supplied label must survive a bump"
        );
    }
}
