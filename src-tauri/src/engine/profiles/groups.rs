use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;

pub(crate) fn groups_path() -> PathBuf { data_dir().join("profile-groups.json") }

pub fn set_profile_group(name: &str, group: &str) {
    let mut map: serde_json::Map<String, Value> = std::fs::read(groups_path()).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if group.trim().is_empty() { map.remove(name); } else { map.insert(name.to_string(), Value::String(group.trim().to_string())); }
    write_json_quiet(&groups_path(), &map);
}

pub fn get_profile_groups() -> Value {
    std::fs::read(groups_path()).ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()))
}

pub fn rename_profile_group(old: &str, new: &str) {
    let mut map: serde_json::Map<String, Value> = std::fs::read(groups_path()).ok()
        .and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if let Some(v) = map.remove(old) { map.insert(new.to_string(), v); }
    write_json_quiet(&groups_path(), &map);
}
