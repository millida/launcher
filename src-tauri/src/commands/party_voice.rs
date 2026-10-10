use crate::engine::party_voice::{self, AudioPrefs};
use tauri::AppHandle;

#[tauri::command]
pub async fn party_voice_join(
    app: AppHandle,
    party_id: String,
    members: Vec<String>,
    audio: AudioPrefs,
) -> Result<(), String> {
    party_voice::join(app, party_id, members, audio).await
}

#[tauri::command]
pub fn party_voice_audio(audio: AudioPrefs) -> Result<(), String> {
    party_voice::set_audio(audio)
}

#[tauri::command]
pub async fn party_voice_leave() -> Result<(), String> {
    super::blocking(party_voice::leave).await
}

#[tauri::command]
pub fn party_voice_transmit(open: bool) -> Result<(), String> {
    party_voice::set_transmit(open)
}

#[tauri::command]
pub fn party_voice_deafen(on: bool) -> Result<(), String> {
    party_voice::set_deafened(on)
}

#[tauri::command]
pub fn party_voice_members(members: Vec<String>) -> Result<(), String> {
    party_voice::set_members(members)
}

#[tauri::command]
pub fn party_voice_bind(party_id: Option<String>) -> Result<(), String> {
    party_voice::bind_party(party_id)
}
