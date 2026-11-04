// Requests to the Millida API (api.millida.net/v2) and the Millida account session: login, token refresh, file upload.
// The Millida token goes into the Authorization header only for api.millida.net. Microsoft and Ely.by tokens never get here.
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
// The request path is checked: it must stay inside /v2/ on the same server, no .. and no swapped host.
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
// API paths the UI is not allowed to call: issuing tokens and game sessions stays in the core only.
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
/// The market is part of it too: the same rating address answers with another
/// catalogue for another market.
fn etag_key(token: Option<&String>, url: &str, market: Option<&str>, lang: Option<&str>) -> String {
    let mut key = token.map(|t| sha256_hex(t.as_bytes())).unwrap_or_default();
    if let Some(m) = market {
        key = format!("{}\n{}", key, m);
    }
    if let Some(l) = lang {
        key = format!("{}\nlang={}", key, l);
    }
    format!("{}\n{}", key, url)
}

/// The API splits the server rating by market and reads it from this header; a
/// request without it is answered from the Russian catalogue.
const MARKET_HEADER: &str = "X-Market";

/// The webview names a market, never a header: only the known values pass.
pub fn market_header(raw: Option<&str>) -> Result<Option<&'static str>, String> {
    match raw.map(str::trim).unwrap_or_default() {
        "" | "RU" => Ok(None),
        "EN" => Ok(Some("EN")),
        _ => Err("bad market".into()),
    }
}

/// The server prices by the interface language (Russian in rubles, any other in dollars),
/// and texts follow it too, so every request carries it. Only the launcher's own codes pass.
const LANGS: [&str; 21] = ["en", "zh", "hi", "es", "ar", "fr", "bn", "pt-BR", "id", "ur", "ru", "de", "ja", "vi", "te", "tr", "ko", "pl", "uk", "sr", "sk"];

const LANG_HEADER: &str = "X-Lang";

pub fn lang_header(raw: Option<&str>) -> Result<Option<&'static str>, String> {
    match raw.map(str::trim).unwrap_or_default() {
        "" => Ok(None),
        code => LANGS.iter().copied().find(|l| *l == code).map(Some).ok_or_else(|| "bad lang".to_string()),
    }
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
pub(crate) async fn hedged<F1, F2, Fut1, Fut2>(first: F1, second: F2) -> Result<reqwest::Response, reqwest::Error>
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

/// POST addresses that only read: asking twice changes nothing on the server,
/// so a hung socket is answered by the spare pool the same way as for GET.
const READ_ONLY_POSTS: [&str; 1] = ["/cosmetics/equipped"];

/// POST addresses that write, yet may be asked twice: the second answer is a
/// spare game session nobody uses and the server expires. Without the repeat a
/// hung socket holds the request past the launch budget and the game starts
/// offline while a fresh connection is answered in milliseconds.
const SPARE_ANSWER_POSTS: [&str; 1] = ["/launcher/game-session"];

/// POST addresses that write under an idempotency key carried in the body: the
/// server answers a repeat with the stored result (the ledger's
/// `idempotencyKey`), never with a second purchase. Without the repeat a hung
/// socket froze an opening case on «Жми!» until the read timeout — a minute
/// (13.10.2026: timeouts on 22 installs in six hours for chests alone).
const IDEMPOTENT_POSTS: [&str; 1] = ["/rubies/cases/open"];

/// A daily or reward chest is opened by its id. Since 13.10.2026 the server
/// answers a repeat with the rewards stored on the chest instead of «already
/// opened» (millida-services #123), so the repeat is as safe as for a case.
fn idempotent_post(route: &str) -> bool {
    IDEMPOTENT_POSTS.contains(&route) || (route.starts_with("/rubies/chests/") && route.ends_with("/open"))
}

fn repeatable(method: &str, path: &str) -> bool {
    let route = path.split('?').next().unwrap_or(path);
    method == "GET"
        || (method == "POST"
            && (READ_ONLY_POSTS.contains(&route) || SPARE_ANSWER_POSTS.contains(&route) || idempotent_post(route)))
}

pub async fn millida_api(
    path: String,
    method: String,
    body: Option<Value>,
    token: Option<String>,
) -> Result<Value, String> {
    millida_api_in(path, method, body, token, None, None).await
}

pub async fn millida_api_in(
    path: String,
    method: String,
    body: Option<Value>,
    token: Option<String>,
    market: Option<&'static str>,
    lang: Option<&'static str>,
) -> Result<Value, String> {
    let resolved = api_url(&path)?;
    let url = resolved.as_str();
    let m = method.to_uppercase();
    if !matches!(m.as_str(), "GET" | "POST" | "PATCH" | "PUT" | "DELETE") {
        return Err("bad method".into());
    }
    let token = token.filter(|t| !t.is_empty());
    let conditional = (m == "GET").then(|| etag_key(token.as_ref(), url, market, lang));
    let known = conditional.as_deref().and_then(remembered);
    let build_on = |c: reqwest::Client| {
        let mut req = match m.as_str() {
            "GET" => c.get(url),
            "POST" => c.post(url),
            "PATCH" => c.patch(url),
            "PUT" => c.put(url),
            _ => c.delete(url),
        };
        // The Millida account token is added to the header. The address above is always api.millida.net.
        if let Some(t) = token.as_ref() {
            req = req.header("Authorization", format!("Bearer {}", t));
        }
        if let Some(mk) = market {
            req = req.header(MARKET_HEADER, mk);
        }
        if let Some(l) = lang {
            req = req.header(reqwest::header::ACCEPT_LANGUAGE, l).header(LANG_HEADER, l);
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
    let sent = if repeatable(&m, &path) { hedged(|| build().send(), || build_on(spare_client()).send()).await } else { build().send().await };
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
        // The top-up is sized by the server; the bare message would leave the webview guessing the sum.
        if let Some(detail) = insufficient_funds_detail(&text) {
            return Err(format!("{}{}", INSUFFICIENT_FUNDS_PREFIX, detail));
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

pub const INSUFFICIENT_FUNDS_PREFIX: &str = "insufficient-funds: ";

fn insufficient_funds_detail(text: &str) -> Option<String> {
    let v: Value = serde_json::from_str(text).ok()?;
    if v.get("code")?.as_str()? != "INSUFFICIENT_FUNDS" {
        return None;
    }
    let options: Vec<Value> = v
        .get("topupCurrencyOptions")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|o| {
                    let currency = o.get("currency")?.as_str()?;
                    let amount = o.get("amountMinor")?.as_u64()?;
                    Some(serde_json::json!({ "currency": currency, "amountMinor": amount }))
                })
                .collect()
        })
        .unwrap_or_default();
    let detail = serde_json::json!({
        "code": "INSUFFICIENT_FUNDS",
        "displayCurrency": v.get("displayCurrency").and_then(Value::as_str),
        "missingMinor": v.get("missingMinor").and_then(Value::as_u64),
        "missingKopecks": v.get("missingKopecks").and_then(Value::as_u64),
        "topupCurrencyOptions": options,
    });
    Some(detail.to_string())
}

pub const SEC_MILLIDA: &str = "millida";
pub const SEC_MILLIDA_REFRESH: &str = "millida-refresh";
/// Sessions issued before the refresh flow existed were stored under this name.
pub const SEC_MILLIDA_LEGACY: &str = "mc";
/// Tells the frontend that a failed refresh means the session is over.
pub const UNAUTHORIZED: &str = "unauthorized";

pub fn millida_token() -> Option<String> {
    if let Some((access, _)) = unsaved_pair() {
        return Some(access);
    }
    crate::secrets::get(SEC_MILLIDA).or_else(|| crate::secrets::get(SEC_MILLIDA_LEGACY))
}

/// The pair the server has just issued when the vault refused to take it. The
/// refresh token on disk is already spent by then: reading it back would send
/// it a second time, which the server answers by ending the session. The pair
/// lives here until a write succeeds.
static UNSAVED_PAIR: std::sync::Mutex<Option<(String, String)>> = std::sync::Mutex::new(None);

fn unsaved_pair() -> Option<(String, String)> {
    UNSAVED_PAIR.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

fn set_unsaved_pair(pair: Option<(String, String)>) {
    *UNSAVED_PAIR.lock().unwrap_or_else(|e| e.into_inner()) = pair;
}

/// Both tokens in one write: an access token saved next to a spent refresh
/// token is a session that dies at its next refresh.
fn save_pair(access: &str, refresh: &str) -> Result<(), String> {
    crate::secrets::set_many(vec![
        (SEC_MILLIDA.to_string(), access.to_string()),
        (SEC_MILLIDA_REFRESH.to_string(), refresh.to_string()),
    ])
}

fn keep_pair(access: &str, refresh: &str) {
    match save_pair(access, refresh) {
        Ok(()) => set_unsaved_pair(None),
        Err(e) => {
            eprintln!("[auth] новая сессия Millida не записана на диск, держим её в памяти до следующей попытки: {e}");
            set_unsaved_pair(Some((access.to_string(), refresh.to_string())));
        }
    }
}

/// Узкий токен для нашего мода в игре: только косметика, живёт 12 часов
/// (POST /launcher/mod-session). Полный токен аккаунта в окружение игры не
/// уходит: его прочитал бы любой мод сборки (аудит 24.09.2026). Ручка не
/// ответила — мод работает без входа (каталог и косметика на игроках видны и так).
// A separate narrow token for the Millida mod in the game (cosmetics only, 12 hours). The full account token is not passed to the game.
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

#[derive(Debug, PartialEq, Eq)]
enum Refreshed {
    Token(String),
    Dead,
    SignedOut,
    Unavailable,
}

/// With no refresh token left, an access token alone is a session that has ended, while no
/// tokens at all is a player who never signed in (offline nick or licence only). Only the first
/// is reported as `unauthorized`: the webview reads that as "session expired" and sends the
/// player to the sign-in screen, which would otherwise happen on every sign-in-only request.
fn without_refresh_token(has_access: bool) -> Refreshed {
    if has_access { Refreshed::Dead } else { Refreshed::SignedOut }
}

/// Serialized behind a mutex: concurrent callers hitting 401 at once would
/// reuse the same refresh token, which the server treats as compromise and
/// answers by invalidating the whole token family.
async fn refresh_session(used: Option<String>) -> Refreshed {
    let _guard = REFRESH_LOCK.lock().await;
    if let Some((access, refresh)) = unsaved_pair() {
        keep_pair(&access, &refresh);
    }
    let (current, stored_refresh) = match unsaved_pair() {
        Some((access, refresh)) => (Some(access), Some(refresh)),
        None => (crate::secrets::get(SEC_MILLIDA), crate::secrets::get(SEC_MILLIDA_REFRESH)),
    };
    if current.is_some() && current != used {
        return Refreshed::Token(current.unwrap_or_default());
    }
    let Some(rt) = stored_refresh else { return without_refresh_token(current.is_some()) };
    if refresh_on_cooldown() {
        return Refreshed::Unavailable;
    }
    match millida_refresh(&rt).await {
        Ok((access, next)) => {
            keep_pair(&access, &next);
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

/// When an access token ends: its `exp` claim, read without checking the signature (the server
/// checks it; this only decides whether to renew early).
pub(crate) fn token_expiry(jwt: &str) -> Option<u64> {
    use base64::Engine as _;
    let payload = jwt.split('.').nth(1)?;
    let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: Value = serde_json::from_slice(&raw).ok()?;
    claims["exp"].as_u64()
}

/// Renews the account's token ahead of Play when it ends within `window`. Otherwise the first
/// request of the launch is refused, renews on the way and asks again: two more round trips
/// while the player waits. One renewal per token lifetime; a renewal on cooldown is not forced.
pub(crate) async fn refresh_millida_if_expiring(window: std::time::Duration) {
    let Some(token) = millida_token() else { return };
    let Some(exp) = token_expiry(&token) else { return };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    if exp > now + window.as_secs() || refresh_on_cooldown() {
        return;
    }
    let _ = refresh_session(Some(token)).await;
}

/// The only way the launcher talks to the Millida API as the signed-in user:
/// the token is read from the vault here and never leaves the core.
pub async fn millida_api_auth(path: String, method: String, body: Option<Value>) -> Result<Value, String> {
    millida_api_auth_in(path, method, body, None, None).await
}

pub async fn millida_api_auth_in(
    path: String,
    method: String,
    body: Option<Value>,
    market: Option<&'static str>,
    lang: Option<&'static str>,
) -> Result<Value, String> {
    let token = millida_token();
    let first = millida_api_in(path.clone(), method.clone(), body.clone(), token.clone(), market, lang).await;
    let Err(e) = first else { return first };
    if e != "http 401" {
        return Err(e);
    }
    match refresh_session(token).await {
        Refreshed::Token(fresh) => millida_api_in(path, method, body, Some(fresh), market, lang).await,
        Refreshed::Dead => Err(UNAUTHORIZED.into()),
        Refreshed::SignedOut | Refreshed::Unavailable => Err(e),
    }
}

/// Uploads the website hosting screens may make: the file-manager chunk (POST, raw bytes, `offset` in the
/// query) and the resource pack (PUT, raw bytes). Nothing else gets a raw body through the core.
pub fn upload_route_allowed(path: &str, method: &str) -> bool {
    let route = path.split(['?', '#']).next().unwrap_or_default();
    let parts: Vec<&str> = route.split('/').collect();
    // "", "hosting", "servers", <id>, <tail...>
    if parts.len() < 5 || !parts[0].is_empty() || parts[1] != "hosting" || parts[2] != "servers" {
        return false;
    }
    let id_ok = !parts[3].is_empty() && parts[3].chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !id_ok || !webview_path_allowed(path) {
        return false;
    }
    matches!(
        (method, &parts[4..]),
        ("POST", ["files", "upload"]) | ("PUT", ["resource-pack"])
    )
}

/// One raw-body request to the API: the body is cut into 64 KB pieces as it goes out (no second full copy
/// in the HTTP layer) and `progress` hears how many bytes have left.
pub async fn millida_upload_raw_in(
    path: &str,
    method: &str,
    body: std::sync::Arc<Vec<u8>>,
    token: Option<String>,
    progress: std::sync::Arc<dyn Fn(u64) + Send + Sync>,
) -> Result<Value, String> {
    let resolved = api_url(path)?;
    let total = body.len();
    let stream = futures::stream::unfold((body, 0usize), move |(data, pos)| {
        let progress = progress.clone();
        async move {
            if pos >= data.len() {
                return None;
            }
            let end = (pos + 64 * 1024).min(data.len());
            let piece = data[pos..end].to_vec();
            progress(end as u64);
            Some((Ok::<Vec<u8>, std::io::Error>(piece), (data, end)))
        }
    });
    let mut req = match method {
        "PUT" => client().put(resolved.as_str()),
        _ => client().post(resolved.as_str()),
    };
    req = req
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .header(reqwest::header::CONTENT_LENGTH, total.to_string())
        .body(reqwest::Body::wrap_stream(stream));
    if let Some(t) = token.as_ref().filter(|t| !t.is_empty()) {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
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
        let msg = api_error_message(&text).unwrap_or_default();
        return Err(format!("http {}{}{}", status.as_u16(), if msg.is_empty() { "" } else { ": " }, msg));
    }
    parse_api_body(&text)
}

/// Same session handling as `millida_api_auth_in`: a 401 refreshes the token once and sends the body again.
pub async fn millida_upload_raw_auth(
    path: String,
    method: String,
    body: std::sync::Arc<Vec<u8>>,
    progress: std::sync::Arc<dyn Fn(u64) + Send + Sync>,
) -> Result<Value, String> {
    if !upload_route_allowed(&path, &method) {
        return Err("bad path".into());
    }
    let token = millida_token();
    let first = millida_upload_raw_in(&path, &method, body.clone(), token.clone(), progress.clone()).await;
    let Err(e) = first else { return first };
    if e != "http 401" {
        return Err(e);
    }
    match refresh_session(token).await {
        Refreshed::Token(fresh) => millida_upload_raw_in(&path, &method, body, Some(fresh), progress).await,
        Refreshed::Dead => Err(UNAUTHORIZED.into()),
        Refreshed::SignedOut | Refreshed::Unavailable => Err(e),
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

/// One raw chunk of a file to the same API (`application/octet-stream`): the
/// bytes are read from disk in the core, the webview never names a file.
pub async fn millida_post_bytes(path: String, bytes: Vec<u8>, token: Option<String>) -> Result<Value, String> {
    let resolved = api_url(&path)?;
    let mut req = client()
        .post(resolved.as_str())
        .header("Content-Type", "application/octet-stream")
        .body(bytes);
    if let Some(t) = token.as_ref().filter(|t| !t.is_empty()) {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
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

pub async fn millida_post_bytes_auth(path: String, bytes: Vec<u8>) -> Result<Value, String> {
    let token = millida_token();
    let first = millida_post_bytes(path.clone(), bytes.clone(), token.clone()).await;
    let Err(e) = first else { return first };
    if e != "http 401" {
        return Err(e);
    }
    match refresh_session(token).await {
        Refreshed::Token(fresh) => millida_post_bytes(path, bytes, Some(fresh)).await,
        Refreshed::Dead => Err(UNAUTHORIZED.into()),
        Refreshed::SignedOut | Refreshed::Unavailable => Err(e),
    }
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
        Refreshed::SignedOut | Refreshed::Unavailable => Err(e),
    }
}

pub fn millida_forget_session() -> Result<(), String> {
    set_unsaved_pair(None);
    for key in [SEC_MILLIDA, SEC_MILLIDA_REFRESH, SEC_MILLIDA_LEGACY, SEC_MILLIDA_GAME_PROFILE] {
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
// Session refresh: the refresh token goes to api.millida.net, the new one comes back in the rt2 cookie.
pub async fn millida_refresh(refresh_token: &str) -> Result<(String, String), String> {
    refresh_at(MILLIDA_API, refresh_token, [client(), spare_client()], REFRESH_ATTEMPT).await
}

/// The server answers a spent refresh token with a fresh pair only for 60 s
/// after it rotated it (REFRESH_ROTATION_GRACE_MS in trade-api); later it is
/// treated as stolen and the session is revoked. When the rotated pair is lost
/// on the way back, the client's 60 s read timeout plus the 30 s cooldown put
/// the resend at about 90 s, past that window. Two attempts of this length fit
/// inside it.
const REFRESH_ATTEMPT: std::time::Duration = std::time::Duration::from_secs(20);

enum RefreshFailure {
    /// The server gave its verdict: sending the same token again changes nothing.
    Answered(String),
    /// No verdict reached us, yet the server may already have rotated the pair.
    Unanswered(String),
}

async fn refresh_at(
    base: &str,
    refresh_token: &str,
    [first, spare]: [reqwest::Client; 2],
    attempt: std::time::Duration,
) -> Result<(String, String), String> {
    match refresh_once(&first, base, refresh_token, attempt).await {
        Ok(pair) => Ok(pair),
        Err(RefreshFailure::Answered(e)) => Err(e),
        Err(RefreshFailure::Unanswered(_)) => match refresh_once(&spare, base, refresh_token, attempt).await {
            Ok(pair) => Ok(pair),
            Err(RefreshFailure::Answered(e) | RefreshFailure::Unanswered(e)) => Err(e),
        },
    }
}

async fn refresh_once(
    c: &reqwest::Client,
    base: &str,
    refresh_token: &str,
    attempt: std::time::Duration,
) -> Result<(String, String), RefreshFailure> {
    let res = c
        .post(format!("{}/auth/refresh", base))
        .timeout(attempt)
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|e| RefreshFailure::Unanswered(net_err(&e)))?;
    if !res.status().is_success() {
        return Err(RefreshFailure::Answered(format!("http {}", res.status().as_u16())));
    }
    let next = res
        .headers()
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(|c| cookie_value(c, REFRESH_COOKIE))
        .unwrap_or_else(|| refresh_token.to_string());
    let body: Value = res.json().await.map_err(|e| RefreshFailure::Unanswered(e.to_string()))?;
    let access = body["accessToken"].as_str().unwrap_or_default().to_string();
    if access.is_empty() {
        return Err(RefreshFailure::Answered("в ответе нет accessToken".into()));
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
    set_unsaved_pair(None);
    Ok(serde_json::json!({ "status": "ok", "user": r["user"].clone() }))
}

#[cfg(test)]
mod tests {
    #[test]
    fn raw_upload_only_reaches_the_hosting_upload_routes() {
        assert!(upload_route_allowed("/hosting/servers/abc-1/files/upload?path=%2Fworld.zip&offset=0", "POST"));
        assert!(upload_route_allowed("/hosting/servers/abc-1/resource-pack?name=a.zip", "PUT"));
        assert!(!upload_route_allowed("/hosting/servers/abc-1/files/upload", "PUT"));
        assert!(!upload_route_allowed("/hosting/servers/abc-1/resource-pack", "POST"));
        assert!(!upload_route_allowed("/hosting/servers/abc-1/files/delete", "POST"));
        assert!(!upload_route_allowed("/hosting/servers/../files/upload", "POST"));
        assert!(!upload_route_allowed("/hosting/servers/a%2Fb/files/upload", "POST"));
        assert!(!upload_route_allowed("/me/avatar", "POST"));
        assert!(!upload_route_allowed("/hosting/servers//files/upload", "POST"));
    }

    use super::{
        api_url, etag_key, insufficient_funds_detail, lang_header, login_poll_answer, market_header, refresh_on_cooldown, remember_in, repeatable, webview_path_allowed, set_refresh_cooldown,
        upload_route_allowed, verdict_for, without_refresh_token, RefreshVerdict, Refreshed, Tagged, ETAG_CACHE_BUDGET, MILLIDA_API,
    };
    use std::collections::BTreeMap;

    #[test]
    fn only_reads_are_asked_twice() {
        // (method, path, repeatable, why this case is pinned)
        let cases: [(&str, &str, bool, &str); 8] = [
            ("POST", "/rubies/cases/open", true, "the body carries an idempotency key: the server answers a repeat with the stored result"),
            ("POST", "/rubies/chests/abc/open", true, "the server answers a repeat with the rewards stored on the chest"),
            ("POST", "/rubies/chests/abc/reroll", false, "only the opening of a chest is answered twice the same way"),
            ("GET", "/launcher/wardrobe", true, "a read can be asked twice: the spare pool answers for a hung socket"),
            ("POST", "/cosmetics/equipped", true, "what the player wears is read by POST: without a repeat the lobby figure waits on a hung socket"),
            ("POST", "/cosmetics/equipped?fresh=1", true, "a query string does not turn the read into a write"),
            ("POST", "/cosmetics/wardrobe", false, "a repeated write would apply the outfit twice"),
            ("DELETE", "/cosmetics/equipped", false, "only the reading method of the address is repeatable"),
        ];
        for (method, path, expected, why) in cases {
            assert_eq!(repeatable(method, path), expected, "{}", why);
        }
    }

    #[test]
    fn a_game_session_is_the_only_write_asked_twice() {
        // (method, path, repeatable, why this case is pinned)
        let cases: [(&str, &str, bool, &str); 4] = [
            ("POST", "/launcher/game-session", true, "a hung socket otherwise outlasts the launch budget and the player starts offline; the spare session is a token nobody uses"),
            ("POST", "/launcher/game-texture", false, "a repeated upload would write the skin twice"),
            ("POST", "/auth/refresh", false, "a refresh token spent twice makes the server revoke the whole session"),
            ("PUT", "/launcher/game-session", false, "only the issuing method of the address is repeatable"),
        ];
        for (method, path, expected, why) in cases {
            assert_eq!(repeatable(method, path), expected, "{}", why);
        }
    }

    #[test]
    fn a_remembered_answer_is_replayed_only_to_its_own_account_and_address() {
        let url = "https://api.millida.net/v2/cosmetics/catalog";
        let alice = "token-alice".to_string();
        let bob = "token-bob".to_string();
        let mut cache: BTreeMap<String, Tagged> = BTreeMap::new();
        remember_in(&mut cache, etag_key(Some(&alice), url, None, None), "\"v1\"".into(), "{\"items\":[]}".into());
        // (account, address, expected etag, why this case is pinned)
        let cases: [(Option<&String>, &str, Option<&str>, &str); 4] = [
            (Some(&alice), url, Some("\"v1\""), "the same session asks again and gets a 304 instead of 1.4 MB"),
            (Some(&bob), url, None, "another account must never see a personal answer cached for the first one"),
            (None, url, None, "a signed-out call is a different audience from a signed-in one"),
            (Some(&alice), "https://api.millida.net/v2/cosmetics/owned", None, "one address never answers for another"),
        ];
        for (account, address, expected, why) in cases {
            let got = cache.get(&etag_key(account, address, None, None)).map(|t| t.etag.as_str());
            assert_eq!(got, expected, "{}", why);
        }
        assert!(
            !cache.contains_key(&etag_key(Some(&alice), url, Some("EN"), None)),
            "a rating cached for the Russian market must never answer for the English one",
        );
        assert!(
            !cache.contains_key(&etag_key(Some(&alice), url, None, Some("en"))),
            "names cached in one interface language must never be replayed after switching to another",
        );
    }

    type MarketCase<'a> = (Option<&'a str>, Result<Option<&'a str>, ()>, &'a str);

    #[test]
    fn only_known_markets_reach_the_header() {
        let cases: [MarketCase; 5] = [
            (None, Ok(None), "no market keeps the request exactly as before"),
            (Some("RU"), Ok(None), "Russian is the API default and needs no header"),
            (Some("EN"), Ok(Some("EN")), "the English catalogue is asked for by its header"),
            (Some("en\r\nX-Evil: 1"), Err(()), "a webview value must never become a header of its own"),
            (Some("DE"), Err(()), "an unknown market is refused rather than silently served Russian"),
        ];
        for (input, want, why) in cases {
            assert_eq!(market_header(input).map_err(|_| ()), want, "{:?}: {}", input, why);
        }
    }

    #[test]
    fn only_launcher_languages_reach_the_header() {
        // (from the webview, header sent, why this case is pinned)
        type Case<'a> = (Option<&'a str>, Result<Option<&'a str>, ()>, &'a str);
        let cases: [Case; 5] = [
            (None, Ok(None), "a request without a language stays exactly as before"),
            (Some("ru"), Ok(Some("ru")), "Russian is priced in rubles"),
            (Some("pt-BR"), Ok(Some("pt-BR")), "a regional code passes as the launcher spells it"),
            (Some("ru\r\nX-Evil: 1"), Err(()), "a webview value must never become a header of its own"),
            (Some("xx"), Err(()), "a language the launcher does not have is refused"),
        ];
        for (input, want, why) in cases {
            assert_eq!(lang_header(input).map_err(|_| ()), want, "{:?}: {}", input, why);
        }
    }

    #[test]
    fn a_shortfall_reaches_the_webview_with_its_top_up() {
        let body = r#"{"status":"insufficient_funds","code":"INSUFFICIENT_FUNDS","displayCurrency":"USD","missingMinor":250,"missingKopecks":22500,"topupCurrencyOptions":[{"currency":"USD","amountMinor":250,"methods":["paypal"]},{"currency":"RUB","amountMinor":22500}],"message":"short"}"#;
        let detail = insufficient_funds_detail(body).unwrap_or_default();
        let got: serde_json::Value = serde_json::from_str(&detail).unwrap_or_default();
        // (field, expected, why this case is pinned)
        let cases: [(&str, serde_json::Value, &str); 4] = [
            ("displayCurrency", serde_json::json!("USD"), "the sum is shown in the currency the buyer saw"),
            ("missingMinor", serde_json::json!(250), "the shortfall in that currency names the sum to top up"),
            ("missingKopecks", serde_json::json!(22500), "the ruble figure stays beside it"),
            (
                "topupCurrencyOptions",
                serde_json::json!([{ "currency": "USD", "amountMinor": 250 }, { "currency": "RUB", "amountMinor": 22500 }]),
                "only currency and sum cross the bridge, and the first option leads",
            ),
        ];
        for (field, want, why) in cases {
            assert_eq!(got.get(field), Some(&want), "{}: {}", field, why);
        }
        assert!(insufficient_funds_detail(r#"{"message":"Not found"}"#).is_none(), "any other refusal keeps its plain message");
        assert!(insufficient_funds_detail("not json").is_none(), "a body that is not JSON is never read as a shortfall");
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
    fn missing_refresh_token_verdicts() {
        // (access token stored, outcome, why this case is pinned)
        let cases: &[(bool, Refreshed, &str)] = &[
            (true, Refreshed::Dead, "an access token whose refresh token is gone cannot be renewed: the session is over"),
            (
                false,
                Refreshed::SignedOut,
                "an offline-only player has no session to expire; reporting it as expired logged them out on every start",
            ),
        ];
        for (has_access, expected, why) in cases {
            assert_eq!(&without_refresh_token(*has_access), expected, "access token stored: {has_access}. {why}");
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

    #[derive(Clone, Copy, Debug)]
    enum Reply {
        Lost,
        Status(u16),
        Rotated,
    }

    async fn refresh_server(script: Vec<Reply>) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let base = format!("http://{}", listener.local_addr().expect("addr"));
        let seen = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = seen.clone();
        tokio::spawn(async move {
            for reply in script {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                while !String::from_utf8_lossy(&buf).contains("spent-token") {
                    match sock.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                    }
                }
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let answer = match reply {
                    Reply::Lost => {
                        tokio::spawn(async move {
                            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                            drop(sock);
                        });
                        continue;
                    }
                    Reply::Status(code) => {
                        format!("HTTP/1.1 {code} Nope\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}")
                    }
                    Reply::Rotated => {
                        let body = r#"{"accessToken":"fresh-access"}"#;
                        format!(
                            "HTTP/1.1 200 OK\r\nSet-Cookie: rt2=fresh-refresh; Path=/\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        )
                    }
                };
                let _ = sock.write_all(answer.as_bytes()).await;
            }
        });
        (base, seen)
    }

    fn direct_client() -> reqwest::Client {
        reqwest::Client::builder().no_proxy().build().expect("client")
    }

    #[tokio::test]
    async fn a_lost_rotation_is_asked_again_inside_the_server_grace() {
        let attempt = std::time::Duration::from_millis(400);
        let ok = Ok(("fresh-access".to_string(), "fresh-refresh".to_string()));
        // (server replies per connection, expected result, requests sent, why this case is pinned)
        type Case<'a> = (Vec<Reply>, Result<(String, String), String>, usize, &'a str);
        let cases: Vec<Case> = vec![
            (
                vec![Reply::Lost, Reply::Rotated],
                ok.clone(),
                2,
                "the server rotated the pair but the reply never came back: only a resend inside the \
                 60 s grace gets the new pair, a later one is judged reuse and signs the player out \
                 (prod 20.10.2026: 519 of 1503 desktop revocations in three days landed at 90-100 s)",
            ),
            (vec![Reply::Rotated], ok.clone(), 1, "an answered refresh is sent exactly once"),
            (
                vec![Reply::Status(401), Reply::Rotated],
                Err("http 401".to_string()),
                1,
                "the server's own verdict on the token is final: sending it again is a reuse",
            ),
            (
                vec![Reply::Status(503), Reply::Rotated],
                Err("http 503".to_string()),
                1,
                "an answered failure did not rotate anything, the cooldown handles the retry",
            ),
        ];
        for (script, expected, requests, why) in cases {
            let (base, seen) = refresh_server(script.clone()).await;
            let started = std::time::Instant::now();
            let got = super::refresh_at(&base, "spent-token", [direct_client(), direct_client()], attempt).await;
            assert_eq!(got, expected, "server script {script:?}. Reason this case is pinned: {why}");
            assert_eq!(
                seen.load(std::sync::atomic::Ordering::SeqCst),
                requests,
                "server script {script:?}: wrong number of refresh requests. Reason this case is pinned: {why}",
            );
            assert!(
                started.elapsed() < attempt * 3,
                "server script {script:?}: the refresh took {:?}, a resend this late falls outside the grace window",
                started.elapsed(),
            );
        }
        assert!(
            super::REFRESH_ATTEMPT * 2 < std::time::Duration::from_secs(60),
            "two refresh attempts must fit inside the server's 60 s rotation grace, otherwise the resend revokes the session",
        );
    }

}
