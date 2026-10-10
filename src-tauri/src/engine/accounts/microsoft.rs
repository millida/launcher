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
    let xsts_token = match xsts["Token"].as_str() {
        Some(t) => t.to_string(),
        None => return Err(xsts_error_text(xsts["XErr"].as_u64())),
    };
    // the game passes XUID as ${auth_xuid}; 1.19+ clients treat a missing one
    // as an incomplete session
    let xuid = xsts["DisplayClaims"]["xui"][0]["xid"].as_str().unwrap_or("").to_string();

    let identity = serde_json::json!({"identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token)});
    let mut mc = Value::Null;
    let mut mc_status = 0u16;
    // 429 and 5xx from the Minecraft services are transient: one login attempt
    // shouldn't die on them
    for attempt in 0..3u64 {
        let r = client().post("https://api.minecraftservices.com/authentication/login_with_xbox")
            .json(&identity).send().await.map_err(|e| net_err(&e))?;
        mc_status = r.status().as_u16();
        mc = r.json().await.unwrap_or(Value::Null);
        if mc["access_token"].as_str().is_some() || !(mc_status == 429 || mc_status >= 500) { break; }
        tokio::time::sleep(std::time::Duration::from_millis(1500 * (attempt + 1))).await;
    }
    let mc_token = match mc["access_token"].as_str() {
        Some(t) => t.to_string(),
        None if mc_status == 429 => return Err("Minecraft временно ограничил запросы (HTTP 429) — подожди минуту и повтори".into()),
        None if mc_status >= 500 => return Err(format!("Серверы Minecraft сейчас недоступны (HTTP {}) — повтори позже", mc_status)),
        None => return Err(format!("Minecraft отказал во входе (HTTP {})", mc_status)),
    };
    // surfaced so callers can tell a live token from an expired one before
    // launching the game
    let expires_in = mc["expires_in"].as_i64().unwrap_or(86400);

    let mut prof = Value::Null;
    let mut prof_status = 0u16;
    for attempt in 0..3u64 {
        let r = client().get("https://api.minecraftservices.com/minecraft/profile")
            .bearer_auth(&mc_token).send().await.map_err(|e| net_err(&e))?;
        prof_status = r.status().as_u16();
        prof = r.json().await.unwrap_or(Value::Null);
        if prof["name"].as_str().is_some() || !(prof_status == 429 || prof_status >= 500) { break; }
        tokio::time::sleep(std::time::Duration::from_millis(1500 * (attempt + 1))).await;
    }
    let nick = match prof["name"].as_str() {
        Some(n) => n.to_string(),
        None if prof_status == 404 => return Err("Нет лицензии Minecraft Java Edition на этом аккаунте Microsoft. Если она есть (в том числе по Game Pass), войди тем же аккаунтом на minecraft.net и создай профиль игрока".into()),
        None if prof_status == 429 => return Err("Minecraft временно ограничил запросы (HTTP 429) — подожди минуту и повтори".into()),
        None if prof_status >= 500 => return Err(format!("Серверы Minecraft сейчас недоступны (HTTP {}) — повтори позже", prof_status)),
        None => return Err(format!("Профиль Minecraft не получен (HTTP {})", prof_status)),
    };
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

/// XSTS answers refusals with an XErr code; each has a different fix for the user.
fn xsts_error_text(code: Option<u64>) -> String {
    match code {
        Some(2148916233) => "У этого аккаунта Microsoft нет профиля Xbox. Зайди на minecraft.net этим аккаунтом, создай профиль и повтори".into(),
        Some(2148916235) => "Xbox недоступен в стране этого аккаунта".into(),
        Some(2148916236) | Some(2148916237) => "Аккаунту нужна проверка возраста на xbox.com, после неё повтори вход".into(),
        Some(2148916238) => "Детский аккаунт Microsoft: взрослый должен добавить его в семью на account.microsoft.com/family и разрешить онлайн-игру".into(),
        Some(c) => format!("XSTS отказал (код {})", c),
        None => "XSTS отказал (нет Xbox-профиля?)".into(),
    }
}
