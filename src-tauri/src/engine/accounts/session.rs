// Stores and hands out login tokens. The UI only gets the answer "logged in or not". The tokens themselves are in secrets.rs.
// The token is put in at game launch (resolve_launch_auth) and nowhere else.
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

/// Strips the tokens from a finished device-flow answer and keeps them in the core.
// Cuts the tokens out of the answer before it reaches the UI. They stay in core memory until confirmed.
fn keep_tokens(device_code: String, mut j: Value) -> Value {
    if j["status"].as_str() != Some("ok") {
        return j;
    }
    let token = j["token"].as_str().unwrap_or_default().to_string();
    let refresh = j["refresh_token"].as_str().unwrap_or_default().to_string();
    if let Some(obj) = j.as_object_mut() {
        obj.remove("token");
        obj.remove("refresh_token");
    }
    stash(device_code, token, refresh);
    j
}

/// One polling step of the Microsoft device flow.
pub async fn ms_login_poll(device_code: String) -> Result<Value, String> {
    let j = ms_device_poll(device_code.clone()).await?;
    Ok(keep_tokens(device_code, j))
}

pub fn ms_login_commit(device_code: &str, account_id: &str) -> Result<(), String> {
    commit_login(device_code, account_id, "вход Microsoft не найден — начни заново")
}

fn commit_login(device_code: &str, account_id: &str, missing: &str) -> Result<(), String> {
    let id = self::account_id(account_id)?;
    let p = take(device_code).ok_or(missing)?;
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

// Builds the login data for a game launch. The Microsoft or Ely.by token goes to the game itself, like in any launcher.
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

pub fn millida_yggdrasil() -> String {
    format!("{}/yggdrasil", MILLIDA_API)
}

/// Longest a launch waits for the game session before starting offline, as it
/// already does when the API refuses. A dead connection used to spend three
/// full connect timeouts here before the window opened.
const SESSION_BUDGET: Duration = Duration::from_secs(12);

/// Our own Yggdrasil session, issued per launch and handed to authlib-injector.
/// The request runs as its own task: dropping it on the budget could cut a token
/// refresh after the server had already rotated the pair, and the reused
/// refresh token then signs the player out.
async fn millida_launch_auth(app: &AppHandle) -> ResolvedAuth {
    let issued = tauri::async_runtime::spawn(issue_game_session());
    let last = match tokio::time::timeout(SESSION_BUDGET, issued).await {
        Ok(Ok(Ok(auth))) => return auth,
        Ok(Ok(Err(e))) => e,
        Ok(Err(e)) => e.to_string(),
        Err(_) => format!("сервер не ответил за {} с", SESSION_BUDGET.as_secs()),
    };
    crate::engine::warn(
        app,
        &format!("Вход Millida не выдан, играем офлайн (Multiplayer и Realms будут недоступны): {}", last),
    );
    known_identity_offline()
}

/// Vault slot with the game profile of the last session issued to this Millida
/// login. The server often creates the session yet answers after the launch
/// budget, and a game started with the nick-derived uuid is a different player
/// to every world: FTB quests, advancements and LAN inventories reset, then come
/// back on the next normal launch.
pub const SEC_MILLIDA_GAME_PROFILE: &str = "millida-game-profile";

/// Who the account's game profile is, as remembered from its last session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnownIdentity {
    pub uuid: String,
    pub name: String,
}

/// The `sub` claim of our own access token, read without verifying the
/// signature: it only tells apart which login a remembered profile belongs to.
fn token_subject(jwt: &str) -> Option<String> {
    use base64::Engine as _;
    let payload = jwt.split('.').nth(1)?;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&raw).ok()?;
    claims["sub"].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn valid_profile_uuid(uuid: &str) -> bool {
    let hex: String = uuid.chars().filter(|c| *c != '-').collect();
    let dashes_ok = uuid.len() == 32 || (uuid.len() == 36 && [8, 13, 18, 23].iter().all(|&i| uuid.as_bytes()[i] == b'-'));
    dashes_ok && hex.len() == 32 && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_game_name(name: &str) -> bool {
    (1..=16).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn remembered_profile_record(subject: &str, uuid: &str, name: &str) -> Option<String> {
    (valid_profile_uuid(uuid) && valid_game_name(name) && !subject.is_empty())
        .then(|| serde_json::json!({ "sub": subject, "uuid": uuid, "name": name }).to_string())
}

/// The remembered profile, only for the login it was issued to and only when it
/// still looks like a game profile: the record may come from an older build.
fn identity_for(record: Option<&str>, subject: Option<&str>) -> Option<KnownIdentity> {
    let subject = subject?;
    let v: Value = serde_json::from_str(record?).ok()?;
    let uuid = v["uuid"].as_str()?;
    let name = v["name"].as_str()?;
    (v["sub"].as_str() == Some(subject) && valid_profile_uuid(uuid) && valid_game_name(name))
        .then(|| KnownIdentity { uuid: uuid.to_string(), name: name.to_string() })
}

fn remember_game_profile(uuid: &str, name: &str) {
    let Some(subject) = millida_token().as_deref().and_then(token_subject) else { return };
    let Some(record) = remembered_profile_record(&subject, uuid, name) else { return };
    if let Err(e) = crate::secrets::set_many(vec![(SEC_MILLIDA_GAME_PROFILE.to_string(), record)]) {
        eprintln!("[auth] игровой профиль Millida не запомнен, при сбое входа игра стартует с UUID по нику: {e}");
    }
}

pub fn known_millida_identity() -> Option<KnownIdentity> {
    let record = crate::secrets::get(SEC_MILLIDA_GAME_PROFILE);
    let subject = millida_token().as_deref().and_then(token_subject);
    identity_for(record.as_deref(), subject.as_deref())
}

/// Offline start that keeps the account's own uuid and name, and keeps our
/// Yggdrasil so a world opened to LAN still verifies guests against it.
fn known_identity_offline() -> ResolvedAuth {
    match known_millida_identity() {
        Some(id) => ResolvedAuth {
            auth: Auth { token: String::new(), uuid: id.uuid, xuid: String::new(), yggdrasil: millida_yggdrasil() },
            nick: Some(id.name),
        },
        None => ResolvedAuth { auth: Auth::default(), nick: None },
    }
}

// For a Millida account we ask api.millida.net for a one-time game session and give it to authlib-injector.
async fn issue_game_session() -> Result<ResolvedAuth, String> {
    let mut last = String::new();
    for attempt in 0..SESSION_ATTEMPTS {
        let body = Some(serde_json::json!({}));
        match millida_api_auth("/launcher/game-session".into(), "POST".into(), body).await {
            Ok(v) => {
                let token = v["accessToken"].as_str().unwrap_or_default().to_string();
                if !token.is_empty() {
                    let uuid = v["uuid"].as_str().unwrap_or_default().to_string();
                    let nick = v["name"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
                    if let Some(name) = nick.as_deref() {
                        remember_game_profile(&uuid, name);
                    }
                    return Ok(ResolvedAuth {
                        auth: Auth { token, uuid, xuid: String::new(), yggdrasil: millida_yggdrasil() },
                        nick,
                    });
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
    Err(last)
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

    fn jwt(claims: &str) -> String {
        use base64::Engine as _;
        let b = |s: &str| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s);
        format!("{}.{}.sig", b(r#"{"alg":"HS256"}"#), b(claims))
    }

    #[test]
    fn token_subject_names_the_login() {
        let cases: Vec<(String, Option<&str>, &str)> = vec![
            (jwt(r#"{"sub":"glmypb7nm5r0xxlt8rnpxfc7","typ":"access"}"#), Some("glmypb7nm5r0xxlt8rnpxfc7"), "an access token names its user"),
            (jwt(r#"{"typ":"access"}"#), None, "no subject means no login to bind the profile to"),
            (jwt(r#"{"sub":"  "}"#), None, "a blank subject would match every other blank one"),
            ("opaque-token".into(), None, "a token that is not a JWT binds nothing"),
            ("a.!!!.c".into(), None, "a broken payload is not read"),
        ];
        for (token, want, why) in cases {
            assert_eq!(token_subject(&token).as_deref(), want, "{why}");
        }
    }

    #[test]
    fn remembered_identity_belongs_to_its_login_only() {
        let rec = remembered_profile_record("u1", "c6d9db59f6fc4b81a447cd6b60936a6f", "BrainMcpe55");
        let id = Some(KnownIdentity { uuid: "c6d9db59f6fc4b81a447cd6b60936a6f".into(), name: "BrainMcpe55".into() });
        type Case<'a> = (Option<String>, Option<&'a str>, Option<KnownIdentity>, &'a str);
        let cases: Vec<Case> = vec![
            (rec.clone(), Some("u1"), id.clone(), "the same login gets its own uuid back, so a failed session keeps the player"),
            (rec.clone(), Some("u2"), None, "another login on this launcher must never play as the previous player"),
            (rec.clone(), None, None, "without a readable login nothing proves whose profile it is"),
            (None, Some("u1"), None, "nothing remembered yet: the old offline start"),
            (Some(r#"{"sub":"u1","uuid":"../../x","name":"BrainMcpe55"}"#.into()), Some("u1"), None, "a record from an older build is checked again before use"),
            (Some(r#"{"sub":"u1","uuid":"c6d9db59f6fc4b81a447cd6b60936a6f","name":"no spaces allowed"}"#.into()), Some("u1"), None, "a nick the game would refuse is not used"),
            (Some("not json".into()), Some("u1"), None, "a damaged record is ignored"),
        ];
        for (record, subject, want, why) in cases {
            assert_eq!(identity_for(record.as_deref(), subject), want, "{why}");
        }
    }

    #[test]
    fn only_a_game_profile_is_remembered() {
        let cases: Vec<(&str, &str, &str, bool, &str)> = vec![
            ("u1", "c6d9db59f6fc4b81a447cd6b60936a6f", "BrainMcpe55", true, "undashed uuid as the server sends it"),
            ("u1", "c6d9db59-f6fc-4b81-a447-cd6b60936a6f", "icon", true, "dashed uuid"),
            ("u1", "", "BrainMcpe55", false, "a session without uuid gives nothing to keep"),
            ("u1", "c6d9db59f6fc4b81a447cd6b60936a6", "BrainMcpe55", false, "31 hex digits is not a uuid"),
            ("u1", "c6d9db59f6fc4b81a447cd6b60936a6f", "", false, "an empty nick"),
            ("u1", "c6d9db59f6fc4b81a447cd6b60936a6f", "SeventeenLetters1", false, "longer than the game allows"),
            ("", "c6d9db59f6fc4b81a447cd6b60936a6f", "BrainMcpe55", false, "no login to bind it to"),
        ];
        for (sub, uuid, name, kept, why) in cases {
            assert_eq!(remembered_profile_record(sub, uuid, name).is_some(), kept, "{why}");
        }
    }

    #[test]
    fn pending_login_is_taken_once() {
        stash("dc-test".into(), "t".into(), "r".into());
        assert!(take("dc-test").is_some());
        assert!(take("dc-test").is_none());
    }
}
