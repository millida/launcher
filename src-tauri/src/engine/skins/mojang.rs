use crate::engine::*;
use serde_json::Value;

pub(crate) fn b64_decode(input: &str) -> Option<Vec<u8>> {
    const TBL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    let mut out = Vec::new();
    for ch in input.bytes() {
        if !ch.is_ascii_alphanumeric() && ch != b'+' && ch != b'/' {
            continue;
        }
        let v = TBL.iter().position(|c| *c == ch)? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

pub(crate) fn to_https(url: Option<&str>) -> Value {
    match url {
        Some(u) => Value::String(u.replacen("http://", "https://", 1)),
        None => Value::Null,
    }
}

const MS_PROFILE: &str = "https://api.minecraftservices.com/minecraft/profile";

/// Mojang reports failures as {"errorMessage": "..."}.
fn ms_error(status: u16, text: &str) -> String {
    let msg = serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|v| {
            v.get("errorMessage")
                .or_else(|| v.get("error"))
                .and_then(|m| m.as_str())
                .map(String::from)
        })
        .filter(|m| !m.is_empty());
    match msg {
        Some(m) => m,
        None if status == 401 => "Сессия Microsoft истекла — перезайди в аккаунт".into(),
        None => format!("Mojang ответил {}", status),
    }
}

async fn ms_json(req: reqwest::RequestBuilder) -> Result<Value, String> {
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ms_error(status.as_u16(), &text));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

/// Full account profile: every owned cape with its ACTIVE/INACTIVE status. The
/// session profile (`mc_textures`) only reports the equipped one.
pub async fn ms_profile(token: String) -> Result<Value, String> {
    let prof = ms_json(client().get(MS_PROFILE).bearer_auth(&token)).await?;
    let capes: Vec<Value> = prof["capes"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c["id"].as_str().unwrap_or(""),
                "alias": c["alias"].as_str().unwrap_or(""),
                "url": to_https(c["url"].as_str()),
                "active": c["state"].as_str().unwrap_or("") == "ACTIVE",
            })
        })
        .collect();
    let skin = prof["skins"]
        .as_array()
        .and_then(|a| a.iter().find(|s| s["state"] == "ACTIVE").or_else(|| a.first()))
        .cloned()
        .unwrap_or(Value::Null);
    Ok(serde_json::json!({
        "uuid": prof["id"].as_str().unwrap_or(""),
        "nick": prof["name"].as_str().unwrap_or(""),
        "skin": to_https(skin["url"].as_str()),
        "slim": skin["variant"].as_str().unwrap_or("").eq_ignore_ascii_case("slim"),
        "capes": capes,
    }))
}

pub async fn ms_set_cape(token: String, cape_id: String) -> Result<Value, String> {
    let url = format!("{}/capes/active", MS_PROFILE);
    if cape_id.is_empty() {
        return ms_json(client().delete(&url).bearer_auth(&token)).await;
    }
    ms_json(
        client()
            .put(&url)
            .bearer_auth(&token)
            .json(&serde_json::json!({ "capeId": cape_id })),
    )
    .await
}

/// Mojang can fetch the skin PNG by URL, so the existing hosted URL is passed
/// through instead of re-uploading the bytes.
pub async fn ms_upload_skin(token: String, skin_url: String, slim: bool) -> Result<Value, String> {
    if !skin_url.starts_with("https://") {
        return Err("Mojang принимает только https-ссылку на скин".into());
    }
    ms_json(
        client()
            .post(format!("{}/skins", MS_PROFILE))
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "variant": if slim { "slim" } else { "classic" },
                "url": skin_url,
            })),
    )
    .await
}

pub async fn mc_textures(query: String) -> Result<Value, String> {
    let clean = query.replace('-', "");
    let uuid = if clean.len() == 32 && clean.chars().all(|c| c.is_ascii_hexdigit()) {
        clean
    } else {
        let j: Value = client()
            .get(format!("https://api.mojang.com/users/profiles/minecraft/{}", query))
            .send().await.map_err(|e| e.to_string())?
            .json().await.map_err(|_| "Профиль не найден".to_string())?;
        j["id"].as_str().ok_or("Профиль не найден")?.to_string()
    };
    let prof: Value = client()
        .get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{}", uuid))
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let raw = prof["properties"][0]["value"].as_str().ok_or("Нет текстур в профиле")?;
    let decoded = b64_decode(raw).ok_or("Битые текстуры профиля")?;
    let tex: Value = serde_json::from_slice(&decoded).map_err(|e| e.to_string())?;
    let skin = &tex["textures"]["SKIN"];
    Ok(serde_json::json!({
        "uuid": uuid,
        "nick": prof["name"].as_str().unwrap_or(""),
        "skin": to_https(skin["url"].as_str()),
        "cape": to_https(tex["textures"]["CAPE"]["url"].as_str()),
        "slim": skin["metadata"]["model"].as_str().unwrap_or("") == "slim"
    }))
}
