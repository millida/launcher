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

fn bump(section: &mut Value, key: &str, secs: u64, ts: u64) {
    let cur = section[key].clone();
    section[key] = json!({
        "seconds": cur["seconds"].as_u64().unwrap_or(0) + secs,
        "sessions": cur["sessions"].as_u64().unwrap_or(0) + 1,
        "last": ts,
        "name": cur["name"].as_str().unwrap_or(""),
    });
}

pub(crate) fn record_playtime(profile: &str, secs: u64, server: Option<&str>) {
    if secs == 0 { return }
    let ts = now_secs();
    let mut doc = read_doc();
    bump(&mut doc["builds"], profile, secs, ts);
    doc["lastBuild"] = json!(profile);
    doc["lastAt"] = json!(ts);
    if let Some(addr) = server.map(str::trim).filter(|s| !s.is_empty()) {
        bump(&mut doc["servers"], addr, secs, ts);
        doc["lastServer"] = json!(addr);
    }
    write_doc(&doc);
}

/// The engine stores only addresses; display names are supplied by the UI.
pub fn label_server(addr: &str, name: &str) {
    let addr = addr.trim();
    let name = name.trim();
    if addr.is_empty() || name.is_empty() { return }
    let mut doc = read_doc();
    let cur = doc["servers"][addr].clone();
    doc["servers"][addr] = json!({
        "seconds": cur["seconds"].as_u64().unwrap_or(0),
        "sessions": cur["sessions"].as_u64().unwrap_or(0),
        "last": cur["last"].as_u64().unwrap_or(0),
        "name": name,
    });
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
        .find(|s| s.key == last_server)
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
