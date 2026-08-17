//! Cloud profile: the launcher on another machine, with the same builds and the
//! same settings.
//!
//! What travels is a description, not the files: every build is the same
//! catalogue manifest sharing uses, plus interface preferences, groups and the
//! list of themes. A hundred builds fit in a few hundred kilobytes, and the
//! restoring launcher fetches each mod from Modrinth or CurseForge and verifies
//! its digest — so a compromised snapshot cannot hand anybody a jar.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::engine::*;

const SYNC_PATH: &str = "/launcher/sync";
const SNAPSHOT_FORMAT: u32 = 1;
/// The API refuses more; the launcher says so before spending the upload.
const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024;
const MAX_PROFILES: usize = 100;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudProfile {
    pub name: String,
    #[serde(default)]
    pub group: String,
    pub manifest: PackManifest,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub format_version: u32,
    pub device: String,
    pub profiles: Vec<CloudProfile>,
    #[serde(default)]
    pub prefs: Value,
    #[serde(default)]
    pub themes: Vec<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub signed_in: bool,
    pub has_remote: bool,
    pub updated_at: String,
    pub device: String,
    pub remote_profiles: u32,
    pub local_profiles: u32,
    pub size_bytes: u64,
    /// Builds the cloud has and this machine does not.
    pub missing_here: Vec<String>,
    /// Builds on this machine the cloud has never seen.
    pub missing_there: Vec<String>,
}

fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| std::env::consts::OS.to_string())
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect()
}

fn group_of(groups: &Value, name: &str) -> String {
    groups.get(name).and_then(Value::as_str).unwrap_or_default().to_string()
}

pub fn build_snapshot() -> Result<Snapshot, String> {
    let groups = get_profile_groups();
    let mut profiles = vec![];
    for p in load_profiles().into_iter().take(MAX_PROFILES) {
        // A build whose manifest cannot be built (folder gone, no catalogue
        // files) is skipped rather than failing the whole sync.
        let Ok((manifest, _)) = build_manifest(&p.name) else { continue };
        profiles.push(CloudProfile { group: group_of(&groups, &p.name), name: p.name, manifest });
    }
    let prefs = serde_json::to_value(ui_prefs()).unwrap_or(Value::Null);
    let themes: Vec<String> = list_themes().into_iter().map(|t| t.manifest.id).collect();
    Ok(Snapshot { format_version: SNAPSHOT_FORMAT, device: device_name(), profiles, prefs, themes })
}

pub async fn cloud_status() -> Result<CloudStatus, String> {
    let local: Vec<String> = load_profiles().into_iter().map(|p| p.name).collect();
    if millida_token().is_none() {
        return Ok(CloudStatus { local_profiles: local.len() as u32, ..Default::default() });
    }
    let res = match millida_api_auth(SYNC_PATH.to_string(), "GET".into(), None).await {
        Ok(v) => v,
        // Nothing uploaded yet is a normal state, not a failure.
        Err(e) if e.contains("404") => Value::Null,
        Err(e) => return Err(e),
    };
    let mut status = CloudStatus {
        signed_in: true,
        local_profiles: local.len() as u32,
        ..Default::default()
    };
    let Some(snapshot) = res.get("snapshot").filter(|v| !v.is_null()) else { return Ok(status) };
    let snapshot: Snapshot =
        serde_json::from_value(snapshot.clone()).map_err(|_| "Облачная копия записана в неизвестном формате".to_string())?;
    status.has_remote = true;
    status.updated_at = res["updatedAt"].as_str().unwrap_or("").to_string();
    status.device = snapshot.device.clone();
    status.size_bytes = res["sizeBytes"].as_u64().unwrap_or(0);
    status.remote_profiles = snapshot.profiles.len() as u32;
    status.missing_here = snapshot
        .profiles
        .iter()
        .map(|p| p.name.clone())
        .filter(|n| !local.contains(n))
        .collect();
    status.missing_there = local
        .into_iter()
        .filter(|n| !snapshot.profiles.iter().any(|p| &p.name == n))
        .collect();
    Ok(status)
}

pub async fn cloud_push() -> Result<CloudStatus, String> {
    let snapshot = tauri::async_runtime::spawn_blocking(build_snapshot)
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
    let body = serde_json::to_value(&snapshot).map_err(|e| e.to_string())?;
    let size = serde_json::to_vec(&body).map(|v| v.len()).unwrap_or(0);
    if size > MAX_SNAPSHOT_BYTES {
        return Err(format!(
            "Слепок сборок весит {} КБ — это больше предела в {} КБ. Убери часть сборок из синхронизации.",
            size / 1024,
            MAX_SNAPSHOT_BYTES / 1024
        ));
    }
    millida_api_auth(SYNC_PATH.to_string(), "PUT".into(), Some(serde_json::json!({ "snapshot": body }))).await?;
    cloud_status().await
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullReport {
    pub installed: Vec<String>,
    pub updated: Vec<String>,
    pub failed: Vec<String>,
    pub prefs_applied: u32,
    pub themes_missing: Vec<String>,
}

/// Restores builds from the cloud. Existing builds are left alone unless named
/// explicitly: pulling must never quietly overwrite a build somebody has been
/// playing on this machine.
pub async fn cloud_pull(app: AppHandle, only: Option<Vec<String>>, apply_prefs: bool) -> Result<PullReport, String> {
    let res = millida_api_auth(SYNC_PATH.to_string(), "GET".into(), None).await?;
    let raw = res.get("snapshot").filter(|v| !v.is_null()).ok_or("В облаке ещё ничего нет")?;
    let snapshot: Snapshot =
        serde_json::from_value(raw.clone()).map_err(|_| "Облачная копия записана в неизвестном формате".to_string())?;
    if snapshot.format_version > SNAPSHOT_FORMAT {
        return Err("Копию сделали в более новой версии лаунчера — обнови лаунчер".into());
    }
    let local: Vec<String> = load_profiles().into_iter().map(|p| p.name).collect();
    let mut report = PullReport::default();

    for entry in snapshot.profiles.iter().take(MAX_PROFILES) {
        let wanted = only.as_ref().map(|list| list.contains(&entry.name)).unwrap_or(true);
        if !wanted {
            continue;
        }
        let exists = local.contains(&entry.name);
        if exists && only.is_none() {
            continue;
        }
        let manifest = match parse_manifest(&serde_json::to_value(&entry.manifest).unwrap_or(Value::Null)) {
            Ok(m) => m,
            Err(e) => {
                report.failed.push(format!("{}: {}", entry.name, e));
                continue;
            }
        };
        match install_manifest(&app, &manifest, Some(entry.name.clone())).await {
            Ok(_) => {
                if !entry.group.is_empty() {
                    set_profile_group(&entry.name, &entry.group);
                }
                if exists {
                    report.updated.push(entry.name.clone());
                } else {
                    report.installed.push(entry.name.clone());
                }
            }
            Err(e) => report.failed.push(format!("{}: {}", entry.name, e)),
        }
    }

    if apply_prefs {
        if let Some(map) = snapshot.prefs.as_object() {
            for (k, v) in map {
                let Some(value) = v.as_str() else { continue };
                if set_ui_pref(k.clone(), value.to_string()).is_ok() {
                    report.prefs_applied += 1;
                }
            }
        }
    }
    let installed_themes: Vec<String> = list_themes().into_iter().map(|t| t.manifest.id).collect();
    report.themes_missing = snapshot.themes.into_iter().filter(|t| !installed_themes.contains(t)).collect();
    Ok(report)
}

pub async fn cloud_forget() -> Result<(), String> {
    millida_api_auth(SYNC_PATH.to_string(), "DELETE".into(), None).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The snapshot is a description, never a payload: anything that would make
    /// it grow with the size of the game must stay out of it.
    #[test]
    fn snapshot_carries_no_file_bytes() {
        let snapshot = Snapshot {
            format_version: SNAPSHOT_FORMAT,
            device: "PC".into(),
            profiles: vec![CloudProfile {
                name: "Моя сборка".into(),
                group: "Выживание".into(),
                manifest: PackManifest {
                    format_version: 1,
                    name: "Моя сборка".into(),
                    game: "1.21.4".into(),
                    loader: "fabric".into(),
                    files: (0..200)
                        .map(|i| PackFile {
                            path: format!("mods/mod{}.jar", i),
                            kind: "mod".into(),
                            sha1: "a".repeat(40),
                            size: 4_000_000,
                            url: "https://cdn.modrinth.com/data/AAA/versions/1/mod.jar".into(),
                            ..Default::default()
                        })
                        .collect(),
                    ..Default::default()
                },
            }],
            prefs: serde_json::json!({"m-density": "compact"}),
            themes: vec!["noir".into()],
        };
        let bytes = serde_json::to_vec(&snapshot).unwrap().len();
        assert!(
            bytes < 64 * 1024,
            "сборка на 200 модов и 800 МБ файлов заняла в слепке {bytes} байт — в облако должны \
             уезжать ссылки и хеши, иначе синхронизация превращается в бэкап гигабайтов",
        );
    }

    /// A device name ends up shown to the player on another machine.
    #[test]
    fn device_name_is_plain_text() {
        let name = device_name();
        assert!(name.chars().all(|c| !c.is_control()), "получили {name:?}");
        assert!(name.chars().count() <= 40);
    }
}
