use crate::engine::*;
use serde_json::Value;

pub const MILLIDA_API: &str = "https://api.millida.net/v2";

/// The API `message` field is either a string or a list of validator messages.
pub fn api_error_message(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    let msg = v.get("message")?;
    let out = match msg {
        Value::String(s) => s.clone(),
        Value::Array(list) => list
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join(", "),
        _ => return None,
    };
    let out = out.trim();
    if out.is_empty() || out.len() > 400 {
        return None;
    }
    Some(out.to_string())
}

/// A segment the server drops while normalising the path. Percent-encoded and
/// backslash spellings count too, so the verdict never depends on the URL
/// parser resolving them exactly the way the server does.
fn is_dot_segment(segment: &str) -> bool {
    let s = segment.to_ascii_lowercase().replace("%2e", ".");
    s == "." || s == ".."
}

/// Resolves a caller-supplied path against the API root and proves the result
/// still lives under `/v2`. Without this a path like `/../auth/x` normalises to
/// another prefix of the same host, which would hand the webview the user's
/// bearer token for endpoints outside the launcher API.
fn api_url(path: &str) -> Result<url::Url, String> {
    if !path.starts_with('/') || path.contains(['\r', '\n', '\0']) {
        return Err("bad path".into());
    }
    let segments = path.split(['?', '#']).next().unwrap_or_default();
    if segments.split(['/', '\\']).any(is_dot_segment) {
        return Err("bad path".into());
    }
    let base = url::Url::parse(&format!("{}/", MILLIDA_API)).map_err(|_| "bad path".to_string())?;
    let resolved = base.join(&path[1..]).map_err(|_| "bad path".to_string())?;
    let same_origin = resolved.scheme() == base.scheme()
        && resolved.host() == base.host()
        && resolved.port_or_known_default() == base.port_or_known_default();
    if !same_origin || !resolved.path().starts_with("/v2/") {
        return Err("bad path".into());
    }
    Ok(resolved)
}

/// Пути, которые webview не может вызвать через команду millida_api, даже с
/// валидным форматом: вход и выпуск токенов живут только в ядре (аудит
/// 24.09.2026, R2). Вызов из ядра (millida_api_auth напрямую) не ограничен.
pub fn webview_path_allowed(path: &str) -> bool {
    let route = path.split(['?', '#']).next().unwrap_or_default();
    let low = route.to_ascii_lowercase();
    // Закодированный разделитель внутри сегмента сервер может раскрыть уже
    // после нашей проверки префикса.
    if low.contains("%2f") || low.contains("%5c") || low.contains('\\') {
        return false;
    }
    let clean = low.trim_end_matches('/');
    if clean == "/auth" || clean.starts_with("/auth/") {
        // Webview начинает вход по коду сам; всё остальное в /auth — дело ядра.
        return clean == "/auth/launcher/init";
    }
    if clean == "/launcher/game-session" || clean == "/launcher/mod-session" {
        return false;
    }
    !clean.ends_with("/launch-token")
}

/// A GET answer the server tagged with an ETag. The next poll of the same
/// address asks "changed?" and gets an empty 304 instead of the same body: the
/// cosmetics catalog alone is 1.4 MB, and every open launcher re-read it every
/// couple of minutes.
#[derive(Clone)]
struct Tagged {
    etag: String,
    body: String,
}

const ETAG_CACHE_BUDGET: usize = 24 * 1024 * 1024;

static ETAG_CACHE: std::sync::Mutex<std::collections::BTreeMap<String, Tagged>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

/// The account is part of the key: a personal answer cached for one session
/// must never be replayed to the next one signed in on the same launcher.
fn etag_key(token: Option<&String>, url: &str) -> String {
    let account = token.map(|t| sha256_hex(t.as_bytes())).unwrap_or_default();
    format!("{}\n{}", account, url)
}

fn remembered(key: &str) -> Option<Tagged> {
    ETAG_CACHE.lock().unwrap_or_else(|e| e.into_inner()).get(key).cloned()
}

fn remember(key: String, etag: String, body: String) {
    let mut cache = ETAG_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    remember_in(&mut cache, key, etag, body);
}

fn remember_in(cache: &mut std::collections::BTreeMap<String, Tagged>, key: String, etag: String, body: String) {
    if body.len() > ETAG_CACHE_BUDGET / 4 {
        return;
    }
    cache.insert(key.clone(), Tagged { etag, body });
    while cache.values().map(|t| t.body.len()).sum::<usize>() > ETAG_CACHE_BUDGET {
        let Some(victim) = cache.keys().find(|k| **k != key).cloned() else { break };
        cache.remove(&victim);
    }
}

/// Сколько ждать ответа (заголовков) до дубля: каталог отвечает за 0,3–0,6 с,
/// холодный запрос сервера — до нескольких секунд; дубль — только хвосту.
const HEDGE_AFTER: std::time::Duration = std::time::Duration::from_millis(2500);

/// Hedged request: первый ответ из двух; ошибка одного — ждём другой.
async fn hedged<F1, F2, Fut1, Fut2>(first: F1, second: F2) -> Result<reqwest::Response, reqwest::Error>
where
    F1: FnOnce() -> Fut1,
    F2: FnOnce() -> Fut2,
    Fut1: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
    Fut2: std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
{
    let a = first();
    tokio::pin!(a);
    tokio::select! {
        r = &mut a => return r,
        _ = tokio::time::sleep(HEDGE_AFTER) => {}
    }
    let b = second();
    tokio::pin!(b);
    tokio::select! {
        r = &mut a => match r {
            Ok(res) => Ok(res),
            Err(e) => b.await.or(Err(e)),
        },
        r = &mut b => match r {
            Ok(res) => Ok(res),
            Err(e) => a.await.or(Err(e)),
        },
    }
}

pub async fn millida_api(
    path: String,
    method: String,
    body: Option<Value>,
    token: Option<String>,
) -> Result<Value, String> {
    let resolved = api_url(&path)?;
    let url = resolved.as_str();
    let m = method.to_uppercase();
    if !matches!(m.as_str(), "GET" | "POST" | "PATCH" | "PUT" | "DELETE") {
        return Err("bad method".into());
    }
    let token = token.filter(|t| !t.is_empty());
    let conditional = (m == "GET").then(|| etag_key(token.as_ref(), url));
    let known = conditional.as_deref().and_then(remembered);
    let build_on = |c: reqwest::Client| {
        let mut req = match m.as_str() {
            "GET" => c.get(url),
            "POST" => c.post(url),
            "PATCH" => c.patch(url),
            "PUT" => c.put(url),
            _ => c.delete(url),
        };
        if let Some(t) = token.as_ref() {
            req = req.header("Authorization", format!("Bearer {}", t));
        }
        if let Some(b) = body.as_ref() {
            req = req.json(b);
        }
        if let Some(k) = known.as_ref() {
            req = req.header(reqwest::header::IF_NONE_MATCH, k.etag.as_str());
        }
        req
    };
    let build = || build_on(client());
    // GET без ответа за HEDGE_AFTER дублируется вторым пулом соединений: зависший
    // сокет или медленный узел больше не держат каталог десятки секунд. Запись
    // (POST/PUT…) не дублируем — она не идемпотентна.
    let sent = if m == "GET" { hedged(|| build().send(), || build_on(spare_client()).send()).await } else { build().send().await };
    // a connect/timeout error means the request never reached the server, so
    // retrying is safe for any method
    let res = match sent {
        Ok(r) => r,
        Err(e) if e.is_connect() || e.is_timeout() => {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            build_on(spare_client()).send().await.map_err(|e| net_err(&e))?
        }
        Err(e) => return Err(net_err(&e)),
    };
    let status = res.status();
    if status == reqwest::StatusCode::NOT_MODIFIED {
        if let Some(k) = known {
            return parse_api_body(&k.body);
        }
    }
    let etag = res
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let text = match read_capped(res, JSON_MAX_BYTES).await {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) if status.is_success() => return Err(e),
        Err(_) => String::new(),
    };
    if status.is_success() {
        if let (Some(key), Some(tag)) = (conditional, etag) {
            remember(key, tag, text.clone());
        }
    }
    if !status.is_success() {
        // 401 is returned as a code so callers know to refresh the session;
        // other failures carry the server's own explanation
        if status.as_u16() == 401 {
            return Err("http 401".into());
        }
        // A message held by the marketplace guard must not offer a retry, so
        // the verdict travels with the text and the webview explains why.
        if let Some(reason) = off_platform_reason(&text) {
            return Err(format!("{}{}", OFF_PLATFORM_PREFIX, reason));
        }
        return Err(api_error_message(&text).unwrap_or_else(|| format!("http {}", status.as_u16())));
    }
    parse_api_body(&text)
}

fn parse_api_body(text: &str) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(text).map_err(|e| e.to_string())
}

/// Marker the webview matches on to show the reason instead of «send failed».
pub const OFF_PLATFORM_PREFIX: &str = "off-platform: ";

fn off_platform_reason(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    if v.get("code")?.as_str()? != "OFF_PLATFORM_BLOCKED" {
        return None;
    }
    api_error_message(text)
}

pub const SEC_MILLIDA: &str = "millida";
pub const SEC_MILLIDA_REFRESH: &str = "millida-refresh";
/// Sessions issued before the refresh flow existed were stored under this name.
pub const SEC_MILLIDA_LEGACY: &str = "mc";
/// Tells the frontend that a failed refresh means the session is over.
pub const UNAUTHORIZED: &str = "unauthorized";

pub fn millida_token() -> Option<String> {
    crate::secrets::get(SEC_MILLIDA).or_else(|| crate::secrets::get(SEC_MILLIDA_LEGACY))
}

/// Узкий токен для нашего мода в игре: только косметика, живёт 12 часов
/// (POST /launcher/mod-session). Полный токен аккаунта в окружение игры не
/// уходит: его прочитал бы любой мод сборки (аудит 24.09.2026). Ручка не
/// ответила — мод работает без входа (каталог и косметика на игроках видны и так).
pub async fn mod_session_token() -> Option<String> {
    millida_token()?;
    let call = millida_api_auth("/launcher/mod-session".into(), "POST".into(), None);
    let v = tokio::time::timeout(std::time::Duration::from_secs(6), call).await.ok()?.ok()?;
    v.get("token")?.as_str().map(str::trim).filter(|t| !t.is_empty()).map(str::to_string)
}

static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
/// Set when a refresh fails for a reason that is not the session's fault (5xx,
/// 429, a dropped connection). Without it every background poll retries the
/// same refresh seconds apart for as long as the launcher stays open.
static REFRESH_BLOCKED_UNTIL: std::sync::Mutex<Option<std::time::Instant>> =
    std::sync::Mutex::new(None);
const REFRESH_COOLDOWN: std::time::Duration = std::time::Duration::from_secs(30);

fn refresh_on_cooldown() -> bool {
    let guard = REFRESH_BLOCKED_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    guard.is_some_and(|until| std::time::Instant::now() < until)
}

fn set_refresh_cooldown(on: bool) {
    let mut guard = REFRESH_BLOCKED_UNTIL.lock().unwrap_or_else(|e| e.into_inner());
    *guard = on.then(|| std::time::Instant::now() + REFRESH_COOLDOWN);
}

/// What a failed refresh says about the stored token pair. Only the server's
/// own 401 condemns it: a 403 is what the edge shield answers to a suspicious
/// IP, and 5xx/429/network errors say nothing about the session at all.
#[derive(Debug, PartialEq, Eq)]
enum RefreshVerdict {
    SessionOver,
    TryLater,
}

fn verdict_for(err: &str) -> RefreshVerdict {
    if err == "http 401" { RefreshVerdict::SessionOver } else { RefreshVerdict::TryLater }
}

enum Refreshed {
    Token(String),
    Dead,
    Unavailable,
}

/// Serialized behind a mutex: concurrent callers hitting 401 at once would
/// reuse the same refresh token, which the server treats as compromise and
/// answers by invalidating the whole token family.
async fn refresh_session(used: Option<String>) -> Refreshed {
    let _guard = REFRESH_LOCK.lock().await;
    let current = crate::secrets::get(SEC_MILLIDA);
    if current.is_some() && current != used {
        return Refreshed::Token(current.unwrap_or_default());
    }
    let Some(rt) = crate::secrets::get(SEC_MILLIDA_REFRESH) else { return Refreshed::Dead };
    if refresh_on_cooldown() {
        return Refreshed::Unavailable;
    }
    match millida_refresh(&rt).await {
        Ok((access, next)) => {
            let _ = crate::secrets::set(SEC_MILLIDA, &access);
            let _ = crate::secrets::set(SEC_MILLIDA_REFRESH, &next);
            set_refresh_cooldown(false);
            Refreshed::Token(access)
        }
        // Without dropping the condemned pair every later call retries the same
        // dead token seconds apart, and the account stays half-signed-in until
        // the launcher restarts.
        Err(e) => match verdict_for(&e) {
            RefreshVerdict::SessionOver => {
                if let Err(e) = millida_forget_session() {
                    eprintln!("[auth] не удалось очистить мёртвую сессию Millida: {e}");
                }
                set_refresh_cooldown(false);
                Refreshed::Dead
            }
            RefreshVerdict::TryLater => {
                set_refresh_cooldown(true);
                Refreshed::Unavailable
            }
        },
    }
}

/// The only way the launcher talks to the Millida API as the signed-in user:
/// the token is read from the vault here and never leaves the core.
pub async fn millida_api_auth(path: String, method: String, body: Option<Value>) -> Result<Value, String> {
    let token = millida_token();
    let first = millida_api(path.clone(), method.clone(), body.clone(), token.clone()).await;
    let Err(e) = first else { return first };
    if e != "http 401" {
        return Err(e);
    }
    match refresh_session(token).await {
        Refreshed::Token(fresh) => millida_api(path, method, body, Some(fresh)).await,
        Refreshed::Dead => Err(UNAUTHORIZED.into()),
        Refreshed::Unavailable => Err(e),
    }
}

/// Multipart upload to the same API, with the same path validation: the payload
/// is built in the core and the webview never names a URL or a file on disk.
pub async fn millida_upload(
    path: String,
    filename: String,
    mime: &str,
    bytes: Vec<u8>,
    fields: Vec<(String, String)>,
    token: Option<String>,
) -> Result<Value, String> {
    let resolved = api_url(&path)?;
    let mut form = reqwest::multipart::Form::new();
    for (key, value) in fields {
        form = form.text(key, value);
    }
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(filename)
        .mime_str(mime)
        .map_err(|e| e.to_string())?;
    form = form.part("file", part);

    let mut req = client().post(resolved.as_str()).multipart(form);
    if let Some(t) = token.as_ref().filter(|t| !t.is_empty()) {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    // No retry: a multipart body is consumed by the send, and a repeated upload
    // would publish the same version twice.
    let res = req.send().await.map_err(|e| net_err(&e))?;
    let status = res.status();
    let text = match read_capped(res, JSON_MAX_BYTES).await {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(e) if status.is_success() => return Err(e),
        Err(_) => String::new(),
    };
    if !status.is_success() {
        if status.as_u16() == 401 {
            return Err("http 401".into());
        }
        return Err(api_error_message(&text).unwrap_or_else(|| format!("http {}", status.as_u16())));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub async fn millida_upload_auth(
    path: String,
    filename: String,
    mime: &str,
    bytes: Vec<u8>,
    fields: Vec<(String, String)>,
) -> Result<Value, String> {
    let token = millida_token();
    let first = millida_upload(
        path.clone(),
        filename.clone(),
        mime,
        bytes.clone(),
        fields.clone(),
        token.clone(),
    )
    .await;
    let Err(e) = first else { return first };
    if e != "http 401" {
        return Err(e);
    }
    match refresh_session(token).await {
        Refreshed::Token(fresh) => millida_upload(path, filename, mime, bytes, fields, Some(fresh)).await,
        Refreshed::Dead => Err(UNAUTHORIZED.into()),
        Refreshed::Unavailable => Err(e),
    }
}

pub fn millida_forget_session() -> Result<(), String> {
    for key in [SEC_MILLIDA, SEC_MILLIDA_REFRESH, SEC_MILLIDA_LEGACY] {
        crate::secrets::delete(key)?;
    }
    Ok(())
}

const REFRESH_COOKIE: &str = "rt2";

fn cookie_value(header: &str, name: &str) -> Option<String> {
    let first = header.split(';').next()?.trim();
    let (k, v) = first.split_once('=')?;
    if k.trim() == name && !v.is_empty() { Some(v.to_string()) } else { None }
}

/// Returns (access, next refresh). The rotated refresh token arrives only in a
/// Set-Cookie header; missing it trips server-side reuse detection, which
/// invalidates the whole token family.
pub async fn millida_refresh(refresh_token: &str) -> Result<(String, String), String> {
    let res = client()
        .post(format!("{}/auth/refresh", MILLIDA_API))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| net_err(&e))?;
    if !res.status().is_success() {
        return Err(format!("http {}", res.status().as_u16()));
    }
    let next = res
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|c| cookie_value(c, REFRESH_COOKIE))
        .unwrap_or_else(|| refresh_token.to_string());
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let access = body["accessToken"].as_str().unwrap_or_default().to_string();
    if access.is_empty() {
        return Err("в ответе нет accessToken".into());
    }
    Ok((access, next))
}

/// The socket channel that announces the approval. Only a well-formed name is
/// passed on: the webview subscribes to it anonymously.
fn login_channel(value: Option<&Value>) -> Option<String> {
    let name = value?.as_str()?;
    let hash = name.strip_prefix("login:")?;
    let ok = hash.len() == 32 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
    ok.then(|| name.to_string())
}

fn login_poll_answer(status: &str, channel: Option<&Value>) -> Value {
    match login_channel(channel) {
        Some(channel) if status == "pending" => serde_json::json!({ "status": status, "channel": channel }),
        _ => serde_json::json!({ "status": status }),
    }
}

/// Device-code login. The issued pair goes straight into the vault, so the
/// webview only ever learns who signed in.
pub async fn millida_login_poll(device_code: String) -> Result<Value, String> {
    let body = serde_json::json!({ "deviceCode": device_code });
    let r = millida_api("/auth/launcher/poll".into(), "POST".into(), Some(body), None).await?;
    let status = r["status"].as_str().unwrap_or_default().to_string();
    if status != "ok" {
        return Ok(login_poll_answer(&status, r.get("channel")));
    }
    let access = r["accessToken"].as_str().unwrap_or_default();
    if access.is_empty() {
        return Err("в ответе нет accessToken".into());
    }
    let mut pairs = vec![(SEC_MILLIDA.to_string(), access.to_string())];
    if let Some(rt) = r["refreshToken"].as_str().filter(|s| !s.is_empty()) {
        pairs.push((SEC_MILLIDA_REFRESH.to_string(), rt.to_string()));
    }
    crate::secrets::store_login(pairs)?;
    Ok(serde_json::json!({ "status": "ok", "user": r["user"].clone() }))
}

#[cfg(test)]
mod tests {
    use super::{
        api_url, etag_key, login_poll_answer, refresh_on_cooldown, remember_in, webview_path_allowed, set_refresh_cooldown, verdict_for,
        RefreshVerdict, Tagged, ETAG_CACHE_BUDGET, MILLIDA_API,
    };
    use std::collections::BTreeMap;

    #[test]
    fn a_remembered_answer_is_replayed_only_to_its_own_account_and_address() {
        let url = "https://api.millida.net/v2/cosmetics/catalog";
        let alice = "token-alice".to_string();
        let bob = "token-bob".to_string();
        let mut cache: BTreeMap<String, Tagged> = BTreeMap::new();
        remember_in(&mut cache, etag_key(Some(&alice), url), "\"v1\"".into(), "{\"items\":[]}".into());
        // (account, address, expected etag, why this case is pinned)
        let cases: [(Option<&String>, &str, Option<&str>, &str); 4] = [
            (Some(&alice), url, Some("\"v1\""), "the same session asks again and gets a 304 instead of 1.4 MB"),
            (Some(&bob), url, None, "another account must never see a personal answer cached for the first one"),
            (None, url, None, "a signed-out call is a different audience from a signed-in one"),
            (Some(&alice), "https://api.millida.net/v2/cosmetics/owned", None, "one address never answers for another"),
        ];
        for (account, address, expected, why) in cases {
            let got = cache.get(&etag_key(account, address)).map(|t| t.etag.as_str());
            assert_eq!(got, expected, "{}", why);
        }
    }

    #[test]
    fn the_etag_cache_stays_within_its_budget() {
        let mut cache: BTreeMap<String, Tagged> = BTreeMap::new();
        let quarter = "x".repeat(ETAG_CACHE_BUDGET / 4);
        for i in 0..8 {
            remember_in(&mut cache, format!("budget-{i}"), format!("\"{i}\""), quarter.clone());
        }
        let held: usize = cache.values().map(|t| t.body.len()).sum();
        assert!(held <= ETAG_CACHE_BUDGET, "the cache holds {held} bytes over its {ETAG_CACHE_BUDGET} budget");
        assert!(
            cache.contains_key("budget-7"),
            "the newest answer must survive eviction, or the next poll downloads it again"
        );
        remember_in(&mut cache, "budget-huge".into(), "\"huge\"".into(), "x".repeat(ETAG_CACHE_BUDGET / 4 + 1));
        assert!(
            !cache.contains_key("budget-huge"),
            "an answer larger than a quarter of the budget would evict everything else and is not kept"
        );
    }

    #[test]
    fn login_poll_passes_only_a_well_formed_channel() {
        let hash = "0123456789abcdef0123456789abcdef";
        let good = format!("login:{hash}");
        // (status, channel from the server, channel the webview gets, why this case is pinned)
        let cases: Vec<(&str, serde_json::Value, Option<&str>, &str)> = vec![
            ("pending", serde_json::json!(good), Some(good.as_str()), "a pending answer names the channel to wait on"),
            ("pending", serde_json::Value::Null, None, "an older server sends no channel and the launcher keeps polling"),
            ("denied", serde_json::json!(good), None, "a finished login has nothing left to wait for"),
            ("pending", serde_json::json!(format!("personal:#{hash}")), None, "only login channels may be joined anonymously"),
            ("pending", serde_json::json!(format!("login:{}", hash.to_uppercase())), None, "the hash is lower-case hex"),
            ("pending", serde_json::json!("login:abc"), None, "a short hash is not ours"),
            ("pending", serde_json::json!(42), None, "a number is not a channel"),
        ];
        for (status, channel, want, why) in cases {
            let answer = login_poll_answer(status, Some(&channel));
            assert_eq!(answer["status"], status, "the status must pass through unchanged");
            assert_eq!(answer["channel"].as_str(), want, "channel {channel} with status {status}: {why}");
        }
    }

    #[test]
    fn refresh_failure_verdicts() {
        // (server answer, verdict, why this case is pinned)
        let cases: &[(&str, RefreshVerdict, &str)] = &[
            (
                "http 401",
                RefreshVerdict::SessionOver,
                "the token itself is dead — keeping it retries forever (6087 rejected refreshes from one client in 12h)",
            ),
            (
                "http 403",
                RefreshVerdict::TryLater,
                "the edge shield answers 403 to a suspicious IP; signing the user out over it loses a live session",
            ),
            ("http 429", RefreshVerdict::TryLater, "rate limits pass"),
            ("http 502", RefreshVerdict::TryLater, "a deploy restart is not a logout"),
            ("нет сети", RefreshVerdict::TryLater, "network errors say nothing about the session"),
        ];
        for (answer, expected, why) in cases {
            assert_eq!(
                &verdict_for(answer),
                expected,
                "refresh answer {answer:?} judged wrong. Reason this case is pinned: {why}",
            );
        }
    }

    #[test]
    fn cooldown_gates_retries() {
        set_refresh_cooldown(true);
        assert!(
            refresh_on_cooldown(),
            "after a failure that is not the session's fault the next poll must wait,              otherwise background polls retry the refresh every few seconds",
        );
        set_refresh_cooldown(false);
        assert!(!refresh_on_cooldown(), "a successful refresh must clear the block");
    }

    #[test]
    fn api_path_verdicts() {
        // (input, should be accepted, why this case exists)
        let cases: &[(&str, bool, &str)] = &[
            ("/auth/launcher/poll", true, "the device-flow endpoint must keep working"),
            ("/core/user/me", true, "ordinary nested endpoints must keep working"),
            ("/launcher/game-session", true, "the launch session endpoint must keep working"),
            ("/core/list?page=1&limit=20", true, "query strings must survive intact"),
            ("/core/search?q=a%20b", true, "percent-encoded query values must be preserved"),
            ("/", true, "the API root itself is inside /v2 and harmless"),
            ("/../auth/token", false, "dot segments normalise the path out of the /v2 prefix"),
            ("/v2/../auth/token", false, "the same escape spelled with a leading /v2"),
            ("/core/../../auth/token", false, "dot segments deeper in the path escape just as well"),
            ("/%2e%2e/auth/token", false, "percent-encoded dots are decoded before normalisation"),
            ("/%2E%2E/auth/token", false, "percent-encoding is case-insensitive"),
            ("/.%2e/auth/token", false, "mixed plain and encoded dots form the same segment"),
            ("/..\\auth/token", false, "backslashes count as separators for special schemes"),
            ("/./core/user", false, "single-dot segments are normalised away by the server too"),
            ("//evil.example/auth", false, "a protocol-relative path would switch the host"),
            ("https://evil.example/auth", false, "an absolute URL must never replace the API root"),
            ("auth/launcher/poll", false, "paths must be rooted so the prefix check is meaningful"),
            ("", false, "empty input is not a path"),
            ("/auth\r\nX-Evil: 1", false, "CR/LF enable request splitting"),
            ("/auth\0", false, "NUL truncates the URL in C-string based APIs"),
        ];

        for (input, expected_ok, why) in cases {
            let verdict = api_url(input);
            assert_eq!(
                verdict.is_ok(),
                *expected_ok,
                "api_url({input:?}) returned {verdict:?}, expected {}. \
                 Reason this case is pinned: {why}",
                if *expected_ok { "Ok" } else { "Err" },
            );
        }
    }

    #[test]
    fn webview_path_verdicts() {
        let cases: &[(&str, bool)] = &[
            ("/auth/launcher/init", true),
            ("/users/me", true),
            ("/friends/chat/upload", true),
            ("/core/list?page=1&next=/auth/x", true),
            ("/auth/refresh", false),
            ("/auth/launcher/poll", false),
            ("/AUTH/launcher/poll", false),
            ("/auth", false),
            ("/launcher/game-session", false),
            ("/launcher/game-session/", false),
            ("/launcher/mod-session", false),
            ("/catalog/packs/arcania/launch-token", false),
            ("/core/a%2f..%2fauth/refresh", false),
            ("/core/a%5Cb", false),
        ];
        for (input, ok) in cases {
            assert_eq!(webview_path_allowed(input), *ok, "{input}");
        }
    }

    #[test]
    fn accepted_path_is_appended_to_the_api_root() {
        let url = api_url("/core/list?page=1&limit=20").expect("a normal endpoint must be accepted");
        assert_eq!(
            url.as_str(),
            format!("{}/core/list?page=1&limit=20", MILLIDA_API),
            "the resolved URL must match what plain concatenation produced before, \
             otherwise existing callers would start hitting different endpoints",
        );
    }

}
