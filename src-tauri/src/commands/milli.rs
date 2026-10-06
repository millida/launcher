use crate::engine;

use super::blocking;

#[tauri::command]
pub async fn milli_files_list(profile: String) -> Result<Vec<engine::LocalFileMeta>, String> {
    blocking(move || engine::milli_files_list(&engine::profile_dir(&profile))).await
}

#[tauri::command]
pub async fn milli_files_read(profile: String, paths: Vec<String>) -> Result<Vec<engine::LocalFileText>, String> {
    blocking(move || engine::milli_files_read(&engine::profile_dir(&profile), &paths)).await?
}

#[tauri::command]
pub async fn milli_files_write(profile: String, edits: Vec<engine::LocalFileEdit>) -> Result<Vec<engine::LocalFileText>, String> {
    blocking(move || engine::milli_files_write(&engine::profile_dir(&profile), &edits)).await?
}

#[tauri::command]
pub async fn milli_note_read(profile: String, name: String) -> Result<Option<String>, String> {
    blocking(move || engine::milli_note_read(&engine::profile_dir(&profile), &name)).await?
}

#[tauri::command]
pub async fn milli_note_write(profile: String, name: String, text: String) -> Result<(), String> {
    blocking(move || engine::milli_note_write(&engine::profile_dir(&profile), &name, &text)).await?
}

#[tauri::command]
pub async fn milli_snapshot(profile: String, label: String, auto: bool) -> Result<engine::MilliSnap, String> {
    blocking(move || engine::milli_snapshot(&engine::profile_dir(&profile), &label, auto)).await?
}

#[tauri::command]
pub async fn milli_snapshots(profile: String) -> Result<Vec<engine::MilliSnap>, String> {
    blocking(move || engine::milli_snapshots(&engine::profile_dir(&profile))).await
}

#[tauri::command]
pub async fn milli_snapshot_restore(profile: String, id: String) -> Result<engine::MilliSnap, String> {
    blocking(move || engine::milli_snapshot_restore(&engine::profile_dir(&profile), &id)).await?
}

#[tauri::command]
pub async fn milli_snapshot_delete(profile: String, id: String) -> Result<(), String> {
    blocking(move || engine::milli_snapshot_delete(&engine::profile_dir(&profile), &id)).await?
}

#[tauri::command]
pub async fn milli_world_backups(profile: String) -> Result<Vec<engine::WorldBackup>, String> {
    blocking(move || engine::milli_world_backups(&engine::profile_dir(&profile))).await
}

#[tauri::command]
pub async fn apply_milli_options(
    profile: String,
    options: std::collections::BTreeMap<String, String>,
    shader: Option<engine::MilliShader>,
) -> Result<engine::MilliOptionsReport, String> {
    blocking(move || engine::apply_milli_options(&engine::profile_dir(&profile), &options, shader.as_ref())).await?
}
