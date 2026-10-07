use crate::engine::*;
use serde_json::Value;

/// Public OAuth client registered on account.ely.by as a desktop application:
/// it carries no secret, so the id alone is safe to ship in the binary.
const ELY_CLIENT_ID: &str = "millida-launcher";
const ELY_OAUTH: &str = "https://account.ely.by/api/oauth2/v1";
const ELY_ACCOUNT_INFO: &str = "https://account.ely.by/api/account/v1/info";
/// Ely.by answers with an http:// verification page; the launcher opens the https one.
const ELY_VERIFY_URL: &str = "https://account.ely.by/code";
/// `minecraft_server_session` makes the issued token valid as the game's
/// accessToken, so no separate authserver login is needed.
const ELY_SCOPE: &str = "account_info minecraft_server_session";

pub const ELY_YGGDRASIL: &str = "https://authserver.ely.by/api/authlib-injector";

fn ely_error(j: &Value, fallback: &str) -> String {
    match j["error"].as_str() {
        Some("access_denied") => "Вход отклонён на странице Ely.by".into(),
        Some("expired_token") => "Код Ely.by истёк — начни вход заново".into(),
        _ => j["message"].as_str().or(j["error"].as_str()).unwrap_or(fallback).to_string(),
    }
}

pub async fn ely_device_start() -> Result<Value, String> {
    let r = client()
        .post(format!("{}/devicecode", ELY_OAUTH))
        .form(&[("client_id", ELY_CLIENT_ID), ("scope", ELY_SCOPE)])
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    if j.get("error").is_some() {
        return Err(ely_error(&j, "Ely.by не выдал код устройства"));
    }
    let device_code = j["device_code"].as_str().unwrap_or_default();
    let user_code = j["user_code"].as_str().unwrap_or_default();
    if device_code.is_empty() || user_code.is_empty() {
        return Err("Ely.by не выдал код устройства".into());
    }
    Ok(serde_json::json!({
        "device_code": device_code,
        "user_code": user_code,
        "verification_uri": ELY_VERIFY_URL,
        "interval": j["interval"].as_i64().unwrap_or(5),
        "expires_in": j["expires_in"].as_i64().unwrap_or(600),
    }))
}

/// One polling step: {status:"pending"} or {status:"ok",nick,uuid,token}.
pub async fn ely_device_poll(device_code: &str) -> Result<Value, String> {
    let r = client()
        .post(format!("{}/token", ELY_OAUTH))
        .form(&[
            ("client_id", ELY_CLIENT_ID),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code),
        ])
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = j["error"].as_str() {
        if err == "authorization_pending" || err == "slow_down" {
            return Ok(serde_json::json!({ "status": "pending" }));
        }
        return Err(ely_error(&j, err));
    }
    let token = j["access_token"].as_str().filter(|t| !t.is_empty()).ok_or("Ely.by не выдал токен")?.to_string();
    let info: Value = client()
        .get(ELY_ACCOUNT_INFO)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| net_err(&e))?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let nick = info["username"].as_str().filter(|s| !s.is_empty()).ok_or("Ely.by не вернул ник аккаунта")?;
    let uuid = info["uuid"].as_str().map(game_uuid).filter(|s| !s.is_empty()).ok_or("Ely.by не вернул UUID аккаунта")?;
    Ok(serde_json::json!({ "status": "ok", "nick": nick, "uuid": uuid, "token": token }))
}

/// The game takes the profile id in Mojang's undashed form.
fn game_uuid(raw: &str) -> String {
    let flat: String = raw.chars().filter(|c| *c != '-').collect();
    if flat.len() == 32 && flat.chars().all(|c| c.is_ascii_hexdigit()) {
        flat.to_lowercase()
    } else {
        String::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_uuid_accepts_only_a_profile_id() {
        let cases = [
            ("ffc8fdc9-5824-509e-8a57-c99b940fb996", "ffc8fdc95824509e8a57c99b940fb996", "Ely.by sends the dashed form"),
            ("FFC8FDC95824509E8A57C99B940FB996", "ffc8fdc95824509e8a57c99b940fb996", "case must not split one profile into two"),
            ("ffc8fdc9-5824", "", "a cut id would start the game as a stranger"),
            ("zzc8fdc95824509e8a57c99b940fb996", "", "non-hex text is not an id"),
            ("", "", "nothing in, nothing out"),
        ];
        for (input, want, why) in cases {
            assert_eq!(game_uuid(input), want, "{input:?}: {why}");
        }
    }

    #[test]
    fn ely_errors_read_as_next_steps() {
        let denied = serde_json::json!({ "error": "access_denied", "message": "The resource owner denied the request." });
        assert_eq!(ely_error(&denied, ""), "Вход отклонён на странице Ely.by", "a refused login must say where it was refused");
        let expired = serde_json::json!({ "error": "expired_token" });
        assert!(ely_error(&expired, "").contains("заново"), "an expired code must tell the player to start over");
        let other = serde_json::json!({ "error": "invalid_client", "message": "Client authentication failed" });
        assert_eq!(ely_error(&other, ""), "Client authentication failed", "unknown errors keep Ely.by's own text for diagnosis");
    }
}
