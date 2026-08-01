use crate::engine::*;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Vault keys are derived from the account id the frontend already knows, so no
/// token value has to travel through the webview to address a session.
fn mc_token_key(account_id: &str) -> String {
    format!("acc:{}", account_id)
}

fn ms_refresh_key(account_id: &str) -> String {
    format!("msr:{}", account_id)
}

fn account_id(raw: &str) -> Result<&str, String> {
    let id = raw.trim();
    if id.is_empty() || id.contains(['\r', '\n', '\0']) {
        return Err("не указан аккаунт".into());
    }
    Ok(id)
}

pub fn mc_token(account_id: &str) -> Option<String> {
    crate::secrets::get(&mc_token_key(account_id)).filter(|t| !t.is_empty())
}

pub fn ms_forget(account_id: &str) -> Result<(), String> {
    let id = self::account_id(account_id)?;
    crate::secrets::delete(&mc_token_key(id))?;
    crate::secrets::delete(&ms_refresh_key(id))
}

/// What the frontend is allowed to know about stored secrets: whether they exist.
pub fn session_presence(account_ids: &[String]) -> (bool, HashMap<String, bool>) {
    let mut keys: Vec<String> = vec![SEC_MILLIDA.into(), SEC_MILLIDA_LEGACY.into()];
    keys.extend(account_ids.iter().map(|id| mc_token_key(id)));
    let present = crate::secrets::present(&keys);
    let has = |k: &str| present.get(k).copied().unwrap_or(false);
    let millida = has(SEC_MILLIDA) || has(SEC_MILLIDA_LEGACY);
    let accounts = account_ids
        .iter()
        .map(|id| (id.clone(), has(&mc_token_key(id))))
        .collect();
    (millida, accounts)
}

struct PendingLogin {
    token: String,
    refresh: String,
    at: Instant,
}

/// A finished Microsoft login waits here until the frontend has created the
/// account row and can name the id its tokens belong to.
fn pending() -> &'static Mutex<HashMap<String, PendingLogin>> {
    static P: OnceLock<Mutex<HashMap<String, PendingLogin>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

const PENDING_TTL: Duration = Duration::from_secs(20 * 60);

fn stash(device_code: String, token: String, refresh: String) {
    let mut map = pending().lock().unwrap_or_else(|e| e.into_inner());
    map.retain(|_, p| p.at.elapsed() < PENDING_TTL);
    map.insert(device_code, PendingLogin { token, refresh, at: Instant::now() });
}

fn take(device_code: &str) -> Option<PendingLogin> {
    let mut map = pending().lock().unwrap_or_else(|e| e.into_inner());
    map.remove(device_code)
}

/// One polling step of the Microsoft device flow, with the tokens stripped from
/// the answer and kept in the core.
pub async fn ms_login_poll(device_code: String) -> Result<Value, String> {
    let mut j = ms_device_poll(device_code.clone()).await?;
    if j["status"].as_str() != Some("ok") {
        return Ok(j);
    }
    let token = j["token"].as_str().unwrap_or_default().to_string();
    let refresh = j["refresh_token"].as_str().unwrap_or_default().to_string();
    if let Some(obj) = j.as_object_mut() {
        obj.remove("token");
        obj.remove("refresh_token");
    }
    stash(device_code, token, refresh);
    Ok(j)
}

pub fn ms_login_commit(device_code: &str, account_id: &str) -> Result<(), String> {
    let id = self::account_id(account_id)?;
    let p = take(device_code).ok_or("вход Microsoft не найден — начни заново")?;
    let mut pairs = vec![(mc_token_key(id), p.token)];
    if !p.refresh.is_empty() {
        pairs.push((ms_refresh_key(id), p.refresh));
    }
    crate::secrets::set_many(pairs)
}

/// Only a revoked or expired refresh token warrants wiping the session; a
/// network failure must never be treated as one.
fn needs_relogin(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("invalid_grant") || e.contains("истекла") || e.contains("aadsts700") || e.contains("aadsts50")
}

/// One lock per account: Microsoft rotates the refresh token on every use and
/// answers a second use of a spent one by revoking the whole family, so
/// renewals of the same account must not overlap. A single global lock would
/// instead queue every account behind the slowest one.
fn refresh_lock(account_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut map = locks.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(account_id.to_string()).or_default().clone()
}

/// Silent renewal. Answers with the account facts only: `ok`, `relogin` when the
/// user has to sign in again, `none` when nothing is stored, `unavailable` when
/// Microsoft could not be reached.
pub async fn ms_session_refresh(account_id: &str) -> Result<Value, String> {
    let id = self::account_id(account_id)?;
    let lock = refresh_lock(id);
    let _guard = lock.lock().await;
    // read the token under the lock: a caller that waited here would otherwise
    // send the one the winning caller has already spent
    let Some(rt) = crate::secrets::get(&ms_refresh_key(id)).filter(|t| !t.is_empty()) else {
        return Ok(serde_json::json!({ "status": "none" }));
    };
    match ms_refresh(rt.clone()).await {
        Ok(j) => {
            let token = j["token"].as_str().unwrap_or_default().to_string();
            if token.is_empty() {
                return Ok(serde_json::json!({ "status": "unavailable" }));
            }
            let next = j["refresh_token"].as_str().filter(|s| !s.is_empty()).unwrap_or(&rt).to_string();
            crate::secrets::set_many(vec![(mc_token_key(id), token), (ms_refresh_key(id), next)])?;
            Ok(serde_json::json!({
                "status": "ok",
                "nick": j["nick"].as_str().unwrap_or_default(),
                "uuid": j["uuid"].as_str().unwrap_or_default(),
                "xuid": j["xuid"].as_str().unwrap_or_default(),
                "expires_in": j["expires_in"].as_i64().unwrap_or(86400),
            }))
        }
        Err(e) if needs_relogin(&e) => {
            ms_forget(id)?;
            Ok(serde_json::json!({ "status": "relogin" }))
        }
        Err(e) => Err(e),
    }
}

/// Checks the stored Minecraft token against Mojang, which is the only way to
/// judge accounts signed in before expiry was tracked.
pub async fn ms_session_validate(account_id: &str) -> Result<Value, String> {
    let id = self::account_id(account_id)?;
    let Some(token) = mc_token(id) else {
        return Ok(serde_json::json!({ "status": "none" }));
    };
    let j = ms_validate(token).await?;
    if j["ok"].as_bool().unwrap_or(false) {
        return Ok(serde_json::json!({
            "status": "ok",
            "nick": j["nick"].as_str().unwrap_or_default(),
            "uuid": j["uuid"].as_str().unwrap_or_default(),
        }));
    }
    if j["expired"].as_bool().unwrap_or(false) {
        crate::secrets::delete(&mc_token_key(id))?;
        return Ok(serde_json::json!({ "status": "expired" }));
    }
    Ok(serde_json::json!({ "status": "unavailable" }))
}

/// Credentials for one launch. The frontend names the account; the token is
/// looked up or issued here.
pub struct ResolvedAuth {
    pub auth: Auth,
    pub nick: Option<String>,
}

const SESSION_ATTEMPTS: u32 = 3;

pub async fn resolve_launch_auth(app: &AppHandle, args: Option<AuthArgs>) -> ResolvedAuth {
    let args = args.unwrap_or_default();
    let offline = ResolvedAuth { auth: Auth::default(), nick: None };
    match args.kind.unwrap_or_default().as_str() {
        "microsoft" => {
            let Some(token) = args.account_id.as_deref().and_then(mc_token) else { return offline };
            ResolvedAuth {
                auth: Auth {
                    token,
                    uuid: args.uuid.unwrap_or_default(),
                    xuid: args.xuid.unwrap_or_default(),
                    yggdrasil: String::new(),
                },
                nick: None,
            }
        }
        "millida" => millida_launch_auth(app).await,
        _ => offline,
    }
}

/// Our own Yggdrasil session, issued per launch and handed to authlib-injector.
async fn millida_launch_auth(app: &AppHandle) -> ResolvedAuth {
    let mut last = String::new();
    for attempt in 0..SESSION_ATTEMPTS {
        let body = Some(serde_json::json!({}));
        match millida_api_auth("/launcher/game-session".into(), "POST".into(), body).await {
            Ok(v) => {
                let token = v["accessToken"].as_str().unwrap_or_default().to_string();
                if !token.is_empty() {
                    return ResolvedAuth {
                        auth: Auth {
                            token,
                            uuid: v["uuid"].as_str().unwrap_or_default().to_string(),
                            xuid: String::new(),
                            yggdrasil: format!("{}/yggdrasil", MILLIDA_API),
                        },
                        nick: v["name"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string()),
                    };
                }
                last = "в ответе нет accessToken".into();
            }
            Err(e) if e == UNAUTHORIZED => {
                last = e;
                break;
            }
            Err(e) => last = e,
        }
        if attempt + 1 < SESSION_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(700 * (attempt as u64 + 1))).await;
        }
    }
    crate::engine::warn(
        app,
        &format!("Вход Millida не выдан, играем офлайн (Multiplayer и Realms будут недоступны): {}", last),
    );
    ResolvedAuth { auth: Auth::default(), nick: None }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relogin_only_on_revoked_grant() {
        assert!(needs_relogin("invalid_grant"));
        assert!(needs_relogin("Сессия Microsoft истекла — войди заново"));
        assert!(needs_relogin("AADSTS70000: expired"));
        assert!(!needs_relogin("нет соединения с сервером"));
    }

    #[test]
    fn account_id_is_validated() {
        assert!(account_id("  ").is_err());
        assert!(account_id("ac\nc1").is_err());
        assert_eq!(account_id(" acc1 ").unwrap(), "acc1");
    }

    #[test]
    fn refresh_lock_is_shared_per_account() {
        let a = refresh_lock("acc-a");
        let a_again = refresh_lock("acc-a");
        let b = refresh_lock("acc-b");
        assert!(
            Arc::ptr_eq(&a, &a_again),
            "both renewals of one account must contend for the same lock, otherwise they \
             send the same refresh token twice and Microsoft revokes the token family",
        );
        assert!(!Arc::ptr_eq(&a, &b), "different accounts must get different locks");

        let held = a.try_lock().expect("a fresh lock must be free");
        assert!(
            a_again.try_lock().is_err(),
            "a second renewal of the same account has to wait for the first one to finish",
        );
        assert!(
            b.try_lock().is_ok(),
            "another account must not queue behind an unrelated renewal",
        );
        drop(held);
    }

    #[test]
    fn pending_login_is_taken_once() {
        stash("dc-test".into(), "t".into(), "r".into());
        assert!(take("dc-test").is_some());
        assert!(take("dc-test").is_none());
    }
}
