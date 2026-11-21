// Scheduled world backups of a build and cloud world backups (PLUS). Thin wrappers over the engine.
use super::blocking;
use crate::engine;

#[tauri::command]
pub async fn world_autobackup(profile: String) -> Result<engine::WorldAutoBackup, String> {
    blocking(move || engine::world_autobackup(&profile)).await
}

#[tauri::command]
pub async fn set_world_autobackup(profile: String, settings: engine::WorldAutoBackup) -> Result<engine::WorldAutoBackup, String> {
    blocking(move || engine::set_world_autobackup(&profile, settings)).await?
}

#[tauri::command]
pub async fn cloud_backups_status() -> Result<engine::CloudBackupsStatus, String> {
    engine::cloud_backups_status().await
}

/// `backup` names a zip from `list_backups`; without it the world is zipped first.
#[tauri::command]
pub async fn cloud_backup_upload(
    app: tauri::AppHandle,
    profile: String,
    folder: String,
    backup: Option<String>,
) -> Result<engine::CloudBackupItem, String> {
    engine::cloud_backup_upload(app, profile, folder, backup).await
}

#[tauri::command]
pub async fn cloud_backup_restore(app: tauri::AppHandle, profile: String, id: String) -> Result<engine::WorldInfo, String> {
    engine::cloud_backup_restore(app, profile, id).await
}

#[tauri::command]
pub async fn cloud_backup_delete(id: String) -> Result<(), String> {
    engine::cloud_backup_delete(id).await
}

#[tauri::command]
pub fn cloud_backup_cancel(key: String) -> bool {
    engine::cloud_backup_cancel(&key)
}
