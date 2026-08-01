use crate::engine::*;
use serde_json::Value;

/// Azure application client_id, baked in at compile time. Own builds should set
/// MILLIDA_MS_CLIENT_ID to their own registration.
const MS_CLIENT_ID_FALLBACK: &str = "499c8d36-be2a-4231-9ebd-ef291b7bb64c";

pub(crate) fn ms_client_id() -> &'static str {
    match option_env!("MILLIDA_MS_CLIENT_ID") {
        Some(v) if !v.trim().is_empty() => v.trim(),
        _ => MS_CLIENT_ID_FALLBACK,
    }
}

pub async fn ms_device_start() -> Result<Value, String> {
    let client_id = ms_client_id();
    let r = client()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
        .form(&[("client_id", client_id), ("scope", "XboxLive.signin offline_access")])
        .send().await.map_err(|e| net_err(&e))?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = j["error"].as_str() {
        return Err(j["error_description"].as_str().unwrap_or(err).to_string());
    }
    if j["user_code"].as_str().unwrap_or("").is_empty() || j["device_code"].as_str().unwrap_or("").is_empty() {
        return Err("Microsoft не выдал код устройства".into());
    }
    Ok(j)
}

/// One polling step: {status:"pending"} or {status:"ok",nick,uuid,token}.
pub async fn ms_device_poll(device_code: String) -> Result<Value, String> {
    let client_id = ms_client_id();
    let r = client()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", &device_code),
        ])
        .send().await.map_err(|e| net_err(&e))?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = j["error"].as_str() {
        if err == "authorization_pending" || err == "slow_down" {
            return Ok(serde_json::json!({"status":"pending"}));
        }
        return Err(j["error_description"].as_str().unwrap_or(err).to_string());
    }
    let ms_token = j["access_token"].as_str().ok_or("нет токена Microsoft")?.to_string();
    // refresh_token comes from the offline_access scope and is what allows the
    // ~24h Minecraft token to be renewed without user interaction
    let refresh = j["refresh_token"].as_str().unwrap_or("").to_string();
    let mut out = xbox_chain(&ms_token).await?;
    out["refresh_token"] = Value::String(refresh);
    Ok(out)
}

/// Xbox Live -> XSTS -> Minecraft services -> profile, as required by the
/// Microsoft login protocol. Shared by first login and silent refresh.
pub(crate) async fn xbox_chain(ms_token: &str) -> Result<Value, String> {
    let xbl: Value = client().post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&serde_json::json!({
            "Properties": {"AuthMethod":"RPS","SiteName":"user.auth.xboxlive.com","RpsTicket": format!("d={}", ms_token)},
            "RelyingParty":"http://auth.xboxlive.com","TokenType":"JWT"}))
        .send().await.map_err(|e| net_err(&e))?.json().await.map_err(|e| e.to_string())?;
    let xbl_token = xbl["Token"].as_str().ok_or("Xbox Live отказал")?.to_string();
    let uhs = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().ok_or("нет uhs")?.to_string();

    let xsts: Value = client().post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&serde_json::json!({
            "Properties": {"SandboxId":"RETAIL","UserTokens":[xbl_token]},
            "RelyingParty":"rp://api.minecraftservices.com/","TokenType":"JWT"}))
        .send().await.map_err(|e| net_err(&e))?.json().await.map_err(|e| e.to_string())?;
    let xsts_token = xsts["Token"].as_str().ok_or("XSTS отказал (нет Xbox-профиля?)")?.to_string();
    // the game passes XUID as ${auth_xuid}; 1.19+ clients treat a missing one
    // as an incomplete session
    let xuid = xsts["DisplayClaims"]["xui"][0]["xid"].as_str().unwrap_or("").to_string();

    let mc: Value = client().post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&serde_json::json!({"identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)}))
        .send().await.map_err(|e| net_err(&e))?.json().await.map_err(|e| e.to_string())?;
    let mc_token = mc["access_token"].as_str().ok_or("Minecraft отказал")?.to_string();
    // surfaced so callers can tell a live token from an expired one before
    // launching the game
    let expires_in = mc["expires_in"].as_i64().unwrap_or(86400);

    let prof: Value = client().get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_token).send().await.map_err(|e| net_err(&e))?
        .json().await.map_err(|e| e.to_string())?;
    let nick = prof["name"].as_str().ok_or("Нет лицензии Minecraft на этом аккаунте")?.to_string();
    Ok(serde_json::json!({
        "status":"ok", "nick": nick,
        "uuid": prof["id"].as_str().unwrap_or(""),
        "xuid": xuid,
        "expires_in": expires_in,
        "token": mc_token
    }))
}

/// The profile endpoint answers 200 only for a valid token, which is the only
/// way to check accounts stored before expiry tracking existed.
pub async fn ms_validate(token: String) -> Result<Value, String> {
    let r = client()
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    let status = r.status();
    let j: Value = r.json().await.unwrap_or(Value::Null);
    Ok(serde_json::json!({
        "ok": status.is_success() && !j["name"].as_str().unwrap_or("").is_empty(),
        "expired": status.as_u16() == 401,
        "nick": j["name"].as_str().unwrap_or(""),
        "uuid": j["id"].as_str().unwrap_or(""),
    }))
}

/// Silent renewal via the stored refresh_token; returns a fresh Minecraft token
/// and the rotated refresh_token when Microsoft issues one.
pub async fn ms_refresh(refresh_token: String) -> Result<Value, String> {
    let client_id = ms_client_id();
    let r = client()
        .post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
        .form(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", &refresh_token),
            ("scope", "XboxLive.signin offline_access"),
        ])
        .send().await.map_err(|e| net_err(&e))?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    let ms_token = j["access_token"].as_str().ok_or("Сессия Microsoft истекла — войди заново")?.to_string();
    let new_refresh = j["refresh_token"].as_str().unwrap_or(&refresh_token).to_string();
    let mut out = xbox_chain(&ms_token).await?;
    out["refresh_token"] = Value::String(new_refresh);
    Ok(out)
}
