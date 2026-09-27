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

/// Adds a slice `[ts - secs, ts]` to the wall-clock total, counting only the part
/// no earlier slice already covered. Every running game writes its own slices,
/// so three builds open side by side used to add three minutes per real minute
/// to the lobby total; each build's own seconds stay exact either way.
///
/// A file written before this total existed starts from the sum of the builds:
/// past overlap can no longer be told apart, so history is kept as it was.
fn bump_wall(doc: &mut Value, secs: u64, ts: u64) {
    let base = doc["wallSeconds"].as_u64().unwrap_or_else(|| {
        doc["builds"]
            .as_object()
            .map(|m| m.values().map(|e| e["seconds"].as_u64().unwrap_or(0)).sum())
            .unwrap_or(0)
    });
    let until = doc["wallUntil"].as_u64().unwrap_or(0);
    let start = ts.saturating_sub(secs).max(until);
    let fresh = ts.saturating_sub(start);
    doc["wallSeconds"] = json!(base + fresh);
    doc["wallUntil"] = json!(until.max(ts));
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
    bump_wall(&mut doc, secs, ts);
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
        total_seconds: doc["wallSeconds"].as_u64().unwrap_or_else(|| builds.iter().map(|b| b.seconds).sum()),
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

    /// Slices from builds running at once -> wall total -> why it is pinned.
    #[test]
    fn parallel_games_count_real_time_once() {
        let cases: [(&str, &[(u64, u64)], u64, &str); 4] = [
            ("one game, back to back slices", &[(60, 100), (60, 160)], 120, "a single game still counts every second"),
            ("three games in the same minute", &[(60, 100), (60, 100), (60, 100)], 60, "three windows open for a minute are one minute of the player's time"),
            ("second game joins halfway", &[(60, 100), (60, 130)], 90, "only the half not already covered is new time"),
            ("a gap between sessions", &[(60, 100), (60, 1000)], 120, "time between two sessions is not played time"),
        ];
        for (name, slices, want, why) in cases {
            let mut doc = json!({ "builds": {}, "wallSeconds": 0 });
            for &(secs, ts) in slices {
                bump_wall(&mut doc, secs, ts);
            }
            assert_eq!(doc["wallSeconds"].as_u64(), Some(want), "{}: {}", name, why);
        }
    }

    #[test]
    fn wall_total_starts_from_existing_history() {
        let mut doc = json!({ "builds": { "a": { "seconds": 3000 }, "b": { "seconds": 600 } } });
        bump_wall(&mut doc, 60, 5000);
        assert_eq!(
            doc["wallSeconds"].as_u64(),
            Some(3660),
            "an old file without the wall total must keep the hours it already shows"
        );
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
