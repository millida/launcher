use crate::{discord, engine};

#[tauri::command]
pub fn discord_presence(
    details: String,
    state: String,
    playing: bool,
    large_image: Option<String>,
    large_text: Option<String>,
) {
    discord::set_activity(
        &details,
        &state,
        playing,
        &large_image.unwrap_or_default(),
        &large_text.unwrap_or_default(),
    );
}

#[tauri::command]
pub fn discord_status() -> discord::DiscordStatus { discord::status() }

#[tauri::command]
pub fn discord_reconnect() -> discord::DiscordStatus { discord::reconnect() }

#[tauri::command]
pub fn discord_clear() { discord::clear(); }

#[tauri::command]
pub async fn ms_device_start() -> Result<serde_json::Value, String> { engine::ms_device_start().await }

#[tauri::command]
pub async fn ms_device_poll(device_code: String) -> Result<serde_json::Value, String> {
    engine::ms_login_poll(device_code).await
}

/// Binds the finished Microsoft login to the account row the frontend created.
#[tauri::command]
pub fn ms_session_commit(device_code: String, account_id: String) -> Result<(), String> {
    engine::ms_login_commit(&device_code, &account_id)
}

#[tauri::command]
pub async fn ms_session_refresh(account_id: String) -> Result<serde_json::Value, String> {
    engine::ms_session_refresh(&account_id).await
}

#[tauri::command]
pub async fn ms_session_validate(account_id: String) -> Result<serde_json::Value, String> {
    engine::ms_session_validate(&account_id).await
}

#[tauri::command]
pub fn ms_session_forget(account_id: String) -> Result<(), String> {
    engine::ms_forget(&account_id)
}

#[tauri::command]
pub async fn mc_textures(query: String) -> Result<serde_json::Value, String> { engine::mc_textures(query).await }

fn licensed_token(account_id: &str) -> Result<String, String> {
    engine::mc_token(account_id).ok_or_else(|| "вход по лицензии Microsoft устарел".to_string())
}

#[tauri::command]
pub async fn ms_profile(account_id: String) -> Result<serde_json::Value, String> {
    engine::ms_profile(licensed_token(&account_id)?).await
}

#[tauri::command]
pub async fn ms_set_cape(account_id: String, cape_id: String) -> Result<serde_json::Value, String> {
    engine::ms_set_cape(licensed_token(&account_id)?, cape_id).await
}

#[tauri::command]
pub async fn ms_upload_skin(account_id: String, png_base64: String, slim: bool) -> Result<serde_json::Value, String> {
    engine::ms_upload_skin_png(licensed_token(&account_id)?, png_base64, slim).await
}

#[tauri::command]
pub async fn ms_reset_skin(account_id: String) -> Result<serde_json::Value, String> {
    engine::ms_reset_skin(licensed_token(&account_id)?).await
}

#[derive(serde::Serialize)]
pub struct SessionStatus {
    pub millida: bool,
    pub accounts: std::collections::HashMap<String, bool>,
}

/// The only session fact the webview gets: which sessions are stored.
#[tauri::command]
pub fn session_status(account_ids: Vec<String>) -> SessionStatus {
    let (millida, accounts) = engine::session_presence(&account_ids);
    SessionStatus { millida, accounts }
}

#[tauri::command]
pub async fn millida_login_poll(device_code: String) -> Result<serde_json::Value, String> {
    engine::millida_login_poll(device_code).await
}

#[tauri::command]
pub fn millida_logout() -> Result<(), String> {
    engine::millida_forget_session()
}

#[tauri::command]
pub async fn millida_api(path: String, method: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    engine::millida_api_auth(path, method, body).await
}

#[tauri::command]
pub fn set_local_skin(skin: Option<String>, cape: Option<String>, slim: bool) -> Result<(), String> {
    engine::set_local_skin(skin, cape, slim)
}

#[tauri::command]
pub fn list_textures(kind: String) -> Result<Vec<engine::TextureEntry>, String> {
    engine::list_textures(&kind)
}

#[tauri::command]
pub fn save_texture(kind: String, name: String, data: String, slim: bool) -> Result<Vec<engine::TextureEntry>, String> {
    engine::save_texture(&kind, &name, &data, slim)
}

#[tauri::command]
pub async fn fetch_texture(url: String) -> Result<String, String> {
    engine::fetch_texture(url).await
}

#[tauri::command]
pub fn delete_texture(kind: String, file: String) -> Result<Vec<engine::TextureEntry>, String> {
    engine::delete_texture(&kind, &file)
}

#[tauri::command]
pub fn set_texture_slim(kind: String, file: String, slim: bool, manual: bool) -> Result<Vec<engine::TextureEntry>, String> {
    engine::set_texture_slim(&kind, &file, slim, manual)
}

#[tauri::command]
pub fn rename_texture(kind: String, file: String, name: String) -> Result<Vec<engine::TextureEntry>, String> {
    engine::rename_texture(&kind, &file, &name)
}

#[tauri::command]
pub async fn head_avatar(nick: String) -> Result<String, String> {
    engine::head_avatar(nick).await
}
