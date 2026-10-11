use crate::engine;

#[tauri::command]
pub async fn store_games_state() -> Result<Vec<engine::StoreGameState>, String> {
    super::blocking(engine::store_games_state).await
}

#[tauri::command]
pub async fn store_game_open(slug: String, via: String) -> Result<(), String> {
    super::blocking(move || engine::store_game_open(&slug, &via)).await?
}

#[tauri::command]
pub async fn store_game_install(app: tauri::AppHandle, slug: String) -> Result<(), String> {
    engine::store_game_install(app, slug).await
}

#[tauri::command]
pub async fn bedrock_join(host: String, port: u16) -> Result<(), String> {
    super::blocking(move || engine::bedrock_join(&host, port)).await?
}
