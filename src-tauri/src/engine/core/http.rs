// Shared network code: HTTP client, file downloads with checksum checks, resume, retries.
// Every request has the User-Agent "MillidaLauncher/version". No tokens, nickname or hardware are added here. They get into headers only where the calling modules put them.
use futures::StreamExt;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Duration;

use super::diskgate;
use super::jobs::{count_downloaded, Halt, CANCELLED};

/// Never leaves this layer: a paused stream ends with it, the caller waits at
/// `Halt::gate` and asks for the rest of the file.
pub(crate) const PAUSED: &str = "Загрузка на паузе";

// The only header we send to every server ourselves: launcher version and site.
const UA: &str = concat!("MillidaLauncher/", env!("CARGO_PKG_VERSION"), " (+https://millida.net)");
const JSON_TIMEOUT: Duration = Duration::from_secs(30);
const TRIES: u32 = 3;

/*
 * С какого размера оборванную закачку выгоднее продолжить, чем начать заново.
 * Мелочь (мод, ассет) перекачивается за секунды, и докачка для неё — лишний
 * риск: дописанный хвост поверх чужого начала не виден до сверки хеша. Сборка
 * весит гигабайты, и там верно обратное.
 */
const RESUME_MIN_BYTES: u64 = 64 * 1024 * 1024;

/// How long a launch waits for fresh metadata it already holds a copy of. Past
/// it the copy is used and a late answer still lands in the cache for the next
/// launch: a dead or filtered connection used to hold the game back for minutes
/// on data that was already on disk.
const REFRESH_BUDGET: Duration = Duration::from_secs(4);

const PROXY_RECHECK: Duration = Duration::from_secs(5);

/// A transfer that gets no bytes for this long is hung, not slow: the connection is dropped and
/// the file goes to the next mirror. The read timeout alone left a stuck socket holding the
/// whole stage for a minute ("stuck at 55-60%" on the assets).
const STALL: Duration = Duration::from_secs(10);

// A test shortens the limit for its own task only; tests run side by side.
#[cfg(test)]
tokio::task_local! {
    static STALL_TEST: Duration;
}

fn stall_limit() -> Duration {
    #[cfg(test)]
    if let Ok(short) = STALL_TEST.try_with(|d| *d) {
        return short;
    }
    STALL
}

/// The wait for the first answer (DNS up to 3 s plus DoH up to 4 s, the connection, TLS, the
/// headers) is longer than the pause allowed between chunks: a slow mobile network or a
/// mirror that opens a big file late is slow, not hung. 10 s covered all of that and cut
/// the 15 s connect timeout short.
const HEADER_WAIT_FACTOR: u32 = 3;

fn header_limit() -> Duration {
    stall_limit() * HEADER_WAIT_FACTOR
}

/// Not marked as `NO_LINK` on purpose: one hung file must not move the whole source behind our
/// mirror for the session (the mirror has its own rate limit). Only this file tries the next route.
/// "timed out" is what the page's error classifier (errorKind.ts) reads as a timeout.
fn stalled(url: &str) -> String {
    format!("{}: timed out — no data for {} s", url, stall_limit().as_secs().max(1))
}

pub(crate) fn is_stall(err: &str) -> bool {
    err.contains("timed out — no data for")
}

/// Which pool and which order a download tries. The default is the normal path; the duplicate of
/// a hedged download goes the other way round, over the spare pool of connections.
#[derive(Clone, Copy, Default)]
pub(crate) struct Via {
    pub spare: bool,
    pub swap: bool,
}

struct Shared {
    client: reqwest::Client,
    proxy: String,
    checked: std::time::Instant,
}

/// VPN clients in "system proxy" mode switch the proxy on and off while the
/// launcher sits in the tray, and a client built before the switch kept going
/// direct — straight into the resets the VPN was turned on to avoid.
static CLIENT: std::sync::Mutex<Option<Shared>> = std::sync::Mutex::new(None);

/// When off, a matching file size is accepted as intact; full rehashing is only
/// enabled during an explicit repair pass.
static DEEP_VERIFY: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// A counter, not a flag: a launch running next to a repair used to clear the
/// flag under it and the repair silently degraded to size-only checks.
pub(crate) struct DeepVerify;

impl DeepVerify {
    pub(crate) fn hold() -> DeepVerify {
        DEEP_VERIFY.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        DeepVerify
    }
}

impl Drop for DeepVerify {
    fn drop(&mut self) {
        DEEP_VERIFY.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

pub(crate) fn deep_verify() -> bool {
    DEEP_VERIFY.load(std::sync::atomic::Ordering::SeqCst) > 0
}

/// The bundled webpki roots alone are not enough: HTTPS-inspecting antivirus and
/// corporate proxies re-sign traffic with a CA that only exists in the OS store.
/// Редирект только на https: иначе разрешённый хост мог бы увести запрос на
/// http и на локальный адрес (аудит 24.09.2026, R5). В тестах — локальные
/// http-серверы, для них исключение.
fn redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 10 {
            attempt.error("слишком много перенаправлений")
        } else if attempt.url().scheme() != "https" && !cfg!(test) {
            attempt.error("перенаправление не на https")
        } else {
            attempt.follow()
        }
    })
}

/// Предел ответа API в JSON/тексте.
pub(crate) const JSON_MAX_BYTES: usize = 16 * 1024 * 1024;

fn too_big(max: usize) -> String {
    if max >= 1024 * 1024 {
        format!("ответ больше {} МБ", max / (1024 * 1024))
    } else {
        format!("ответ больше {} КБ", max / 1024)
    }
}

/// Тело ответа с пределом: сначала по Content-Length, потом по факту, кусками —
/// сервер без Content-Length не забьёт память гигабайтами.
pub(crate) async fn read_capped(mut resp: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if resp.content_length().is_some_and(|n| n > max as u64) {
        return Err(too_big(max));
    }
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| net_err(&e))? {
        if out.len() + chunk.len() > max {
            return Err(too_big(max));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// Соединение, которое молча умерло (VPN переключился, NAT забыл сокет), раньше
/// держало все запросы к API до read_timeout — минуту: HTTP/2 гонит их по одному
/// сокету, и каталог «не отвечал», хотя сервер отвечает за 0,3 с (10.10.2026).
/// PING раз в 15 с и TCP keepalive находят мёртвый сокет за секунды.
fn build_client(native_roots: bool) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .user_agent(UA)
        .redirect(redirect_policy())
        // System lookup first; public DNS over HTTPS only if it fails (doh.rs).
        .dns_resolver(super::doh::resolver())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(20))
        .http2_keep_alive_interval(Duration::from_secs(15))
        .http2_keep_alive_timeout(Duration::from_secs(6))
        .http2_keep_alive_while_idle(true)
        .tls_built_in_webpki_certs(true)
        .tls_built_in_native_certs(native_roots)
        .build()
}

#[cfg(windows)]
// Windows: reads the system proxy from the registry (read only), so requests take the same road as the browser.
fn system_proxy() -> String {
    let Ok(key) = windows_registry::CURRENT_USER.open(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
    else {
        return String::new();
    };
    if key.get_u32("ProxyEnable").unwrap_or(0) == 0 {
        return String::new();
    }
    format!(
        "{}\n{}",
        key.get_string("ProxyServer").unwrap_or_default(),
        key.get_string("ProxyOverride").unwrap_or_default()
    )
}

#[cfg(not(windows))]
fn system_proxy() -> String {
    String::new()
}

pub(crate) fn client() -> reqwest::Client {
    shared_client(&CLIENT)
}

/// Второй пул соединений — для дублирующего запроса (hedged request, «The Tail at
/// Scale»): повтор по тому же пулу ушёл бы в тот же зависший сокет HTTP/2.
static SPARE: std::sync::Mutex<Option<Shared>> = std::sync::Mutex::new(None);

pub(crate) fn spare_client() -> reqwest::Client {
    shared_client(&SPARE)
}

fn shared_client(cell: &std::sync::Mutex<Option<Shared>>) -> reqwest::Client {
    let mut slot = cell.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(shared) = slot.as_ref().filter(|s| s.checked.elapsed() < PROXY_RECHECK) {
        return shared.client.clone();
    }
    let proxy = system_proxy();
    if let Some(shared) = slot.as_mut().filter(|s| s.proxy == proxy) {
        shared.checked = std::time::Instant::now();
        return shared.client.clone();
    }
    let client = build_client(true)
        .or_else(|_| build_client(false))
        .unwrap_or_else(|_| reqwest::Client::new());
    *slot = Some(Shared { client: client.clone(), proxy, checked: std::time::Instant::now() });
    client
}

#[cfg(test)]
mod tls_roots_tests {
    #[test]
    fn client_builds_with_system_roots() {
        assert!(super::build_client(true).is_ok());
    }

    #[test]
    #[ignore]
    fn millida_api_reachable() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        let status = rt.block_on(async {
            super::client()
                .get("https://api.millida.net/v2/rating/servers?limit=1&offset=0&sort=rating")
                .send()
                .await
                .map(|r| r.status().as_u16())
                .map_err(|e| super::net_err(&e))
        });
        assert_eq!(status, Ok(200));
    }
}

/// reqwest's Display only yields "error sending request for url"; the actual
/// cause is the deepest source() in the chain.
pub(crate) fn net_err(e: &reqwest::Error) -> String {
    let mut cause: &(dyn std::error::Error + 'static) = e;
    while let Some(next) = cause.source() {
        cause = next;
    }
    let detail = cause.to_string();
    let low = detail.to_lowercase();
    let hint = if low.contains("certificate") || low.contains("tls") || low.contains("handshake") {
        "соединение подменяет антивирус или прокси: отключи проверку HTTPS/SSL или добавь лаунчер в исключения"
    } else if low.contains("dns") || low.contains("failed to lookup") || low.contains("resolve") {
        "адрес сервера не определился: проверь DNS, VPN и антивирус"
    } else if e.is_timeout() || low.contains("timed out") {
        "сервер не ответил вовремя: проверь интернет и VPN"
    } else if e.is_connect() {
        "соединение не установилось: проверь брандмауэр, VPN и антивирус"
    } else {
        return format!("нет связи ({})", detail);
    };
    format!("нет связи ({} — {})", detail, hint)
}

/// Digest kind announced by the source: Modrinth publishes sha1/sha512, Mojang
/// and Adoptium sha1/sha256.
#[derive(Clone, Copy)]
pub(crate) enum Sum<'a> {
    Sha1(&'a str),
    Sha256(&'a str),
    Sha512(&'a str),
}

enum Hasher {
    Sha1(sha1::Sha1),
    Sha256(sha2::Sha256),
    Sha512(sha2::Sha512),
}

impl Hasher {
    fn for_sum(sum: &Sum<'_>) -> Self {
        use sha1::Digest as _;
        match sum {
            Sum::Sha1(_) => Hasher::Sha1(sha1::Sha1::new()),
            Sum::Sha256(_) => Hasher::Sha256(sha2::Sha256::new()),
            Sum::Sha512(_) => Hasher::Sha512(sha2::Sha512::new()),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        use sha1::Digest as _;
        match self {
            Hasher::Sha1(h) => h.update(bytes),
            Hasher::Sha256(h) => h.update(bytes),
            Hasher::Sha512(h) => h.update(bytes),
        }
    }

    fn hex(self) -> String {
        use sha1::Digest as _;
        let bytes: Vec<u8> = match self {
            Hasher::Sha1(h) => h.finalize().to_vec(),
            Hasher::Sha256(h) => h.finalize().to_vec(),
            Hasher::Sha512(h) => h.finalize().to_vec(),
        };
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

impl Sum<'_> {
    fn expected(&self) -> &str {
        match self {
            Sum::Sha1(v) | Sum::Sha256(v) | Sum::Sha512(v) => v,
        }
    }

    fn matches(&self, got: &str) -> bool {
        got.eq_ignore_ascii_case(self.expected())
    }

    fn is_usable(&self) -> bool {
        !self.expected().trim().is_empty()
    }
}

fn retryable(status: reqwest::StatusCode) -> bool {
    status.is_server_error() || status == reqwest::StatusCode::TOO_MANY_REQUESTS
}

/// A failed attempt either deserves another try (connection reset, truncated
/// body, 5xx) or is the final answer (404, malformed request).
enum Attempt {
    Retry(String),
    Fatal(String),
}

async fn retrying<T, F, Fut>(mut once: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, Attempt>>,
{
    let mut last = String::new();
    for attempt in 1..=TRIES {
        match once().await {
            Ok(v) => return Ok(v),
            Err(Attempt::Fatal(e)) => return Err(e),
            Err(Attempt::Retry(e)) => last = e,
        }
        if attempt < TRIES {
            tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
        }
    }
    Err(last)
}

/// The body is read inside the attempt, not after it: a connection cut halfway
/// through a chunked response is the common failure on filtered networks, and
/// reqwest reports it as an opaque decode error long after the status said 200.
///
/// The cause goes first and the URL last on purpose. These strings are joined
/// into one line that a toast truncates, and an API URL with its query runs past
/// a hundred characters: with the URL in front the player only ever saw the
/// address and never the reason, while net_err already carries the advice that
/// resolves the failure ("antivirus is intercepting HTTPS", "check DNS").
async fn read_json(url: &str, resp: reqwest::Response) -> Result<Value, Attempt> {
    let status = resp.status();
    if !status.is_success() {
        return Err(status_attempt(url, status));
    }
    if resp.content_length().is_some_and(|n| n > JSON_MAX_BYTES as u64) {
        return Err(Attempt::Fatal(format!("ответ больше 16 МБ — {}", url)));
    }
    let body = read_capped(resp, JSON_MAX_BYTES)
        .await
        .map_err(|e| Attempt::Retry(format!("ответ оборвался: {} — {}", e, url)))?;
    serde_json::from_slice(&body)
        .map_err(|e| Attempt::Retry(format!("неожиданный ответ: {} — {}", e, url)))
}

fn status_message(url: &str, status: reqwest::StatusCode) -> String {
    format!("{} от {}", status, url)
}

fn status_attempt(url: &str, status: reqwest::StatusCode) -> Attempt {
    let msg = status_message(url, status);
    if retryable(status) {
        Attempt::Retry(msg)
    } else {
        Attempt::Fatal(msg)
    }
}

/// The server answered that the address names nothing. Unlike a request the
/// network cut short, asking again gets the same answer.
pub(crate) fn is_absent_answer(err: &str) -> bool {
    [reqwest::StatusCode::NOT_FOUND, reqwest::StatusCode::GONE]
        .into_iter()
        .any(|status| err.starts_with(&status_message("", status)))
}

/// Marker of a download whose bytes arrived whole but hash to something else.
pub(crate) const SUM_MISMATCH: &str = "контрольная сумма не сошлась";

/// Percent-encoding for path segments and query values; also used when a URL is
/// carried as a query parameter to the mirror.
pub(crate) fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// Plain GET with JSON, retries on failure. Addresses come from the calling modules, mirror.rs picks mirrors.
pub(crate) async fn get_json(url: &str) -> Result<Value, String> {
    let mut last = String::new();
    for target in super::mirror::routes(url).await {
        let attempt = retrying(|| {
            let target = target.clone();
            async move {
                match client().get(&target).timeout(JSON_TIMEOUT).send().await {
                    Ok(r) => read_json(&target, r).await,
                    Err(e) => Err(Attempt::Retry(format!("{} — {}", net_err(&e), target))),
                }
            }
        })
        .await;
        match attempt {
            Ok(v) => return Ok(v),
            Err(e) => last = e,
        }
    }
    Err(last)
}

pub(crate) async fn get_json_cached(url: &str, cache: &Path) -> Result<Value, String> {
    match get_json(url).await {
        Ok(v) => {
            super::paths::write_json_quiet(cache, &v);
            Ok(v)
        }
        Err(e) => {
            if let Ok(v) = read_json_file(cache) {
                return Ok(v);
            }
            Err(format!("{} (и нет офлайн-кэша)", e))
        }
    }
}

fn read_json_file(cache: &Path) -> Result<Value, ()> {
    let b = std::fs::read(cache).map_err(|_| ())?;
    serde_json::from_slice(&b).map_err(|_| ())
}

/// Mojang version descriptors and asset indexes are content-addressed, so a
/// cached copy can never go stale.
pub(crate) async fn get_json_immutable(url: &str, cache: &Path) -> Result<Value, String> {
    if let Ok(v) = read_json_file(cache) {
        return Ok(v);
    }
    get_json_cached(url, cache).await
}

fn copy_is_fresh(cache: &Path, ttl: Duration) -> bool {
    std::fs::metadata(cache)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().map(|age| age < ttl).unwrap_or(false))
        .unwrap_or(false)
}

pub(crate) async fn get_json_fresh(url: &str, cache: &Path, ttl: Duration) -> Result<Value, String> {
    if copy_is_fresh(cache, ttl) {
        if let Ok(v) = read_json_file(cache) {
            return Ok(v);
        }
    }
    get_json_revalidated(url, cache).await
}

/// What the source said about the copy on disk. `sum` ties them to the exact
/// bytes: other readers of the same URL rewrite the copy without validators,
/// and validators of a newer body sent for an older copy would earn a 304 that
/// pins the old copy until the source changes again.
#[derive(serde::Serialize, serde::Deserialize)]
struct Validators {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    etag: Option<String>,
    #[serde(default, rename = "lastModified", skip_serializing_if = "Option::is_none")]
    last_modified: Option<String>,
    sum: String,
}

fn validators_path(cache: &Path) -> PathBuf {
    let mut name = cache.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".validators");
    cache.with_file_name(name)
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut h = Hasher::for_sum(&Sum::Sha1(""));
    h.update(bytes);
    h.hex()
}

fn stored_validators(cache: &Path, copy: &[u8]) -> Option<Validators> {
    let v: Validators = serde_json::from_slice(&std::fs::read(validators_path(cache)).ok()?).ok()?;
    (v.sum == sha1_hex(copy) && (v.etag.is_some() || v.last_modified.is_some())).then_some(v)
}

enum Revalidated {
    Unchanged,
    Changed { body: Vec<u8>, value: Value, etag: Option<String>, last_modified: Option<String> },
}

async fn read_if_changed(url: &str, resp: reqwest::Response) -> Result<Revalidated, Attempt> {
    let status = resp.status();
    if status == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(Revalidated::Unchanged);
    }
    if !status.is_success() {
        return Err(status_attempt(url, status));
    }
    let header = |name: reqwest::header::HeaderName| {
        resp.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_owned)
    };
    let etag = header(reqwest::header::ETAG);
    let last_modified = header(reqwest::header::LAST_MODIFIED);
    let body = read_capped(resp, JSON_MAX_BYTES)
        .await
        .map_err(|e| Attempt::Retry(format!("ответ оборвался: {} — {}", e, url)))?;
    let value = serde_json::from_slice(&body)
        .map_err(|e| Attempt::Retry(format!("неожиданный ответ: {} — {}", e, url)))?;
    Ok(Revalidated::Changed { body, value, etag, last_modified })
}

async fn fetch_if_changed(url: &str, sent: Option<&Validators>) -> Result<Revalidated, String> {
    let mut last = String::new();
    for target in super::mirror::routes(url).await {
        let attempt = retrying(|| {
            let target = target.clone();
            async move {
                let mut req = client().get(&target).timeout(JSON_TIMEOUT);
                if let Some(etag) = sent.and_then(|v| v.etag.as_deref()) {
                    req = req.header(reqwest::header::IF_NONE_MATCH, etag);
                }
                if let Some(since) = sent.and_then(|v| v.last_modified.as_deref()) {
                    req = req.header(reqwest::header::IF_MODIFIED_SINCE, since);
                }
                match req.send().await {
                    Ok(r) => read_if_changed(&target, r).await,
                    Err(e) => Err(Attempt::Retry(format!("{} — {}", net_err(&e), target))),
                }
            }
        })
        .await;
        match attempt {
            Ok(v) => return Ok(v),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// A 304 only restarts the copy's age; a new body replaces the copy together
/// with its validators.
async fn refresh_if_changed(url: &str, cache: &Path) -> Result<Value, String> {
    let copy = std::fs::read(cache).ok();
    let sent = copy.as_deref().and_then(|b| stored_validators(cache, b));
    match fetch_if_changed(url, sent.as_ref()).await? {
        Revalidated::Unchanged => {
            match copy.as_deref().map(serde_json::from_slice::<Value>) {
                Some(Ok(v)) => {
                    // A failed touch only means the next call asks again.
                    if let Ok(f) = std::fs::File::options().write(true).open(cache) {
                        let _ = f.set_modified(std::time::SystemTime::now());
                    }
                    Ok(v)
                }
                _ => get_json_cached(url, cache).await,
            }
        }
        Revalidated::Changed { body, value, etag, last_modified } => {
            let marks = validators_path(cache);
            if super::paths::write_bytes_atomic(cache, &body).is_ok() {
                if etag.is_some() || last_modified.is_some() {
                    super::paths::write_json_quiet(&marks, &Validators { etag, last_modified, sum: sha1_hex(&body) });
                } else {
                    let _ = std::fs::remove_file(&marks);
                }
            }
            Ok(value)
        }
    }
}

/// For a large list that changes rarely but whose changes players wait for
/// (Mojang's version manifest): past `ttl` the source is asked with the copy's
/// ETag/Last-Modified, so an unchanged list costs a 304 instead of the whole
/// body. Same budget and offline fallback as `get_json_revalidated`.
pub(crate) async fn get_json_conditional(url: &str, cache: &Path, ttl: Duration) -> Result<Value, String> {
    conditional_within(url, cache, ttl, REFRESH_BUDGET).await
}

async fn conditional_within(url: &str, cache: &Path, ttl: Duration, budget: Duration) -> Result<Value, String> {
    if copy_is_fresh(cache, ttl) {
        if let Ok(v) = read_json_file(cache) {
            return Ok(v);
        }
    }
    let Ok(copy) = read_json_file(cache) else {
        return refresh_if_changed(url, cache).await.map_err(|e| format!("{} (и нет офлайн-кэша)", e));
    };
    let (url, cache) = (url.to_string(), cache.to_path_buf());
    let refresh = tauri::async_runtime::spawn(async move { refresh_if_changed(&url, &cache).await.ok() });
    match tokio::time::timeout(budget, refresh).await {
        Ok(Ok(Some(v))) => Ok(v),
        _ => Ok(copy),
    }
}

/// The network answer when it comes within `REFRESH_BUDGET`, the copy from an
/// earlier run otherwise. Without a copy there is nothing else to use, so the
/// request runs to its own end.
pub(crate) async fn get_json_revalidated(url: &str, cache: &Path) -> Result<Value, String> {
    revalidated_within(url, cache, REFRESH_BUDGET).await
}

/// Files being refreshed in the background right now, so a quick relaunch does not start a
/// second identical request.
static REFRESHING: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

/// Stale-while-revalidate for a small list the launch needs but does not have to be newest: the
/// copy on disk is returned at once, and when it is older than `ttl` the source is asked in the
/// background and the answer lands in the copy for the next launch. Without a copy the request
/// runs to its end, as before.
pub(crate) async fn get_json_swr(url: &str, cache: &Path, ttl: Duration) -> Result<Value, String> {
    let Ok(copy) = read_json_file(cache) else {
        return get_json_cached(url, cache).await;
    };
    if !copy_is_fresh(cache, ttl) {
        refresh_in_background(url, cache);
    }
    Ok(copy)
}

fn refresh_in_background(url: &str, cache: &Path) {
    {
        let mut busy = REFRESHING.lock().unwrap_or_else(|e| e.into_inner());
        if busy.iter().any(|p| p == cache) {
            return;
        }
        busy.push(cache.to_path_buf());
    }
    let (url, cache) = (url.to_string(), cache.to_path_buf());
    tauri::async_runtime::spawn(async move {
        if let Ok(v) = get_json(&url).await {
            super::paths::write_json_quiet(&cache, &v);
        } else if let Ok(f) = std::fs::File::options().write(true).open(&cache) {
            // A failed refresh still restarts the copy's age, so an unreachable source is asked
            // once per `ttl` and not on every launch.
            let _ = f.set_modified(std::time::SystemTime::now());
        }
        REFRESHING.lock().unwrap_or_else(|e| e.into_inner()).retain(|p| p != &cache);
    });
}

async fn revalidated_within(url: &str, cache: &Path, budget: Duration) -> Result<Value, String> {
    let Ok(copy) = read_json_file(cache) else {
        return get_json_cached(url, cache).await;
    };
    let (url, cache) = (url.to_string(), cache.to_path_buf());
    // Its own task, so running out of budget does not cancel the request.
    let refresh = tauri::async_runtime::spawn(async move {
        let v = get_json(&url).await.ok()?;
        super::paths::write_json_quiet(&cache, &v);
        Some(v)
    });
    match tokio::time::timeout(budget, refresh).await {
        Ok(Ok(Some(v))) => Ok(v),
        _ => Ok(copy),
    }
}

/// Modrinth bulk endpoints only accept a JSON body over POST.
// POST with JSON, needed for Modrinth batch requests. The body is set by the calling code.
pub(crate) async fn post_json(url: &str, body: &Value) -> Result<Value, String> {
    let mut last = String::new();
    for target in super::mirror::routes(url).await {
        let attempt = retrying(|| {
            let target = target.clone();
            async move {
                match client().post(&target).json(body).timeout(JSON_TIMEOUT).send().await {
                    Ok(r) => read_json(&target, r).await,
                    Err(e) => Err(Attempt::Retry(format!("{} — {}", net_err(&e), target))),
                }
            }
        })
        .await;
        match attempt {
            Ok(v) => return Ok(v),
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// Unique per call: two downloads of the same destination — a duplicated library
/// in one version json, two builds sharing the library store, a second launch
/// started next to the first — used to share one `.part`. One of them renamed or
/// removed it under the other, which surfaced as "file not found", "access
/// denied" or a jar with no end-of-central-directory.
fn part_path(dest: &Path) -> PathBuf {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(format!(".{}-{}.part", std::process::id(), n));
    dest.with_file_name(name)
}

fn file_matches(path: &Path, sum: Option<Sum<'_>>, size: Option<u64>) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    let hashed = sum.as_ref().is_some_and(|s| s.is_usable());
    if let Some(want) = size {
        // Размер из манифеста бывает неверным при верном хеше (см. fetch_once):
        // несовпадение тогда решает хеш, а не отказ.
        if meta.len() != want && !hashed {
            return false;
        }
        if meta.len() == want && !deep_verify() {
            return true;
        }
    }
    let Some(sum) = sum else { return true };
    if !sum.is_usable() {
        return true;
    }
    hash_matches(path, &sum)
}

fn hash_matches(path: &Path, sum: &Sum<'_>) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut h = Hasher::for_sum(sum);
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        match std::io::Read::read(&mut file, &mut buf) {
            Ok(0) => break,
            Ok(n) => h.update(&buf[..n]),
            Err(_) => return false,
        }
    }
    sum.matches(&h.hex())
}

fn is_stale_cdn_miss(err: &str) -> bool {
    err.contains("404 Not Found") || err.contains("403 Forbidden")
}

fn bypass_cdn_cache(url: &str) -> String {
    let salt = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{}{}nocache={}", url, sep, salt)
}

/// Removes the temporary file on every exit path, including cancellation.
struct PartGuard(PathBuf);

impl Drop for PartGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Moves the finished download into place. A rename can still lose to a parallel
/// download of the same file or to the game holding the jar open, so a
/// destination that already carries the wanted content counts as success instead
/// of failing the whole install.
fn publish(part: &Path, dest: &Path, sum: Option<Sum<'_>>, size: Option<u64>) -> Result<(), String> {
    match std::fs::rename(part, dest) {
        Ok(()) => Ok(()),
        Err(_) if file_matches(dest, sum, size) => Ok(()),
        Err(e) => Err(format!("{}: {}", dest.display(), e)),
    }
}

/// Streams into a private `.part` file and renames on success so an aborted
/// download can never be mistaken for a complete file.
async fn fetch(url: &str, dest: &Path, sum: Option<Sum<'_>>, size: Option<u64>) -> Result<(), String> {
    fetch_cancellable(url, dest, sum, size, None, None).await
}

/// Сколько байт уже легло и сколько ожидается. Зовётся на каждом куске тела.
pub(crate) type Progress<'a> = dyn Fn(u64, Option<u64>) + Send + Sync + 'a;

async fn fetch_cancellable(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&Halt>,
    on: Option<&Progress<'_>>,
) -> Result<(), String> {
    fetch_via(url, dest, sum, size, cancel, on, Via::default()).await
}

async fn fetch_via(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&Halt>,
    on: Option<&Progress<'_>>,
    via: Via,
) -> Result<(), String> {
    if url.trim().is_empty() {
        return Err("пустая ссылка на файл".into());
    }
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("{}: {}", p.display(), e))?;
    }
    let part = part_path(dest);
    let _cleanup = PartGuard(part.clone());
    let mut last = String::new();
    let mut resume_from: u64 = 0;
    let mut routes = super::mirror::routes(url).await;
    if via.swap && routes.len() > 1 {
        routes.rotate_left(1);
    }
    for (ri, route) in routes.iter().enumerate() {
        let has_next = ri + 1 < routes.len();
        let mut attempt = 1;
        while attempt <= TRIES {
            let target = if attempt > 1 && is_stale_cdn_miss(&last) {
                bypass_cdn_cache(route)
            } else {
                route.clone()
            };
            match fetch_once(&target, &part, sum, size, cancel, resume_from, on, via.spare).await {
                Ok(()) => return publish(&part, dest, sum, size),
                // A pause is not a failed attempt: everything that landed stays,
                // whatever its size, and the same attempt picks up from there.
                Err(e) if e == PAUSED => {
                    resume_from = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
                    if let Some(halt) = cancel {
                        halt.gate().await?;
                    }
                    continue;
                }
                Err(e) => {
                    /*
                     * Оборванную закачку большого файла оставляем на диске и
                     * продолжаем с того же места: сборка весит гигабайты, и
                     * обрыв на девяноста процентах не должен стоить полного
                     * повтора. Всё остальное — мелочь, для которой докачка
                     * дороже обычного перекачивания, и битый хвост в ней
                     * опаснее: файл дописался бы поверх чужого начала.
                     */
                    let have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
                    resume_from = resume_after(&e, have);
                    if resume_from == 0 {
                        let _ = std::fs::remove_file(&part);
                    }
                    // Throttling, a dropped line and a silent one all tell the batches running
                    // next to this download to slow down (pace.rs).
                    if is_throttled(&e) || e.contains(super::mirror::NO_LINK) || is_stall(&e) {
                        super::pace::pressure();
                    }
                    last = e;
                }
            }
            // A cancelled download must not be retried: three mirrors × three
            // attempts kept a slow connection busy long after the player asked
            // the install to stop.
            if cancelled(cancel) {
                return Err(CANCELLED.into());
            }
            // A hung connection does not get two more tries of ten silent seconds each while
            // another route is waiting.
            // This also covers a connection cut a few kilobytes into the body (a filter that
            // drops a host after ~16 KB): the next source, not the same one again.
            if has_next && (super::mirror::abandon_direct(route, &last) || is_stall(&last) || last.contains(super::mirror::NO_LINK)) {
                break;
            }
            if attempt < TRIES {
                tokio::time::sleep(retry_pause(attempt, &last)).await;
            }
            attempt += 1;
        }
    }
    Err(last)
}

/// Our mirror answers 429 when a parallel pack install outruns its per-address
/// limit; the window is a minute, so the short pause meant for a dropped
/// connection only burned the remaining attempts inside the same window.
fn retry_pause(attempt: u32, err: &str) -> Duration {
    if is_throttled(err) {
        throttle_pause(attempt, server_wait(err), jitter_unit())
    } else {
        Duration::from_millis(400 * attempt as u64)
    }
}

/// The server's own wait travels inside the failure text, so every retry loop
/// above the transfer can honour it without a second error type.
const RETRY_AFTER_MARK: &str = "; Retry-After: ";
const THROTTLE_BASE: Duration = Duration::from_secs(5);
const THROTTLE_CAP: Duration = Duration::from_secs(120);

fn status_failure(url: &str, resp: &reqwest::Response) -> String {
    let retry_after = resp.headers().get(reqwest::header::RETRY_AFTER).and_then(|v| v.to_str().ok());
    status_text(url, resp.status(), retry_after)
}

fn status_text(url: &str, status: reqwest::StatusCode, retry_after: Option<&str>) -> String {
    match retry_after.and_then(parse_retry_after) {
        Some(wait) => format!("{} → {}{}{}", url, status, RETRY_AFTER_MARK, wait.as_secs()),
        None => format!("{} → {}", url, status),
    }
}

/// Only the delta-seconds form: an HTTP-date would need a date parser the
/// launcher does not carry, and the doubling backoff covers that case.
fn parse_retry_after(raw: &str) -> Option<Duration> {
    raw.trim().parse::<u64>().ok().map(Duration::from_secs)
}

pub(crate) fn server_wait(err: &str) -> Option<Duration> {
    let (_, tail) = err.rsplit_once(RETRY_AFTER_MARK)?;
    let digits: String = tail.chars().take_while(char::is_ascii_digit).collect();
    parse_retry_after(&digits)
}

pub(crate) fn is_throttled(err: &str) -> bool {
    err.contains(&reqwest::StatusCode::TOO_MANY_REQUESTS.to_string()) || server_wait(err).is_some()
}

/// Worth another round later: a limit that lifts by itself or a dropped line.
/// A 404 or a wrong checksum stays the same however long one waits.
pub(crate) fn is_transient(err: &str) -> bool {
    is_throttled(err) || err.contains(super::mirror::NO_LINK)
}

/// Doubling from five seconds, never shorter than the server asked, capped so a
/// hostile header cannot park the download for an hour. The jitter spreads the
/// thousands of launchers that hit the limit in the same second after a release.
pub(crate) fn throttle_pause(attempt: u32, server: Option<Duration>, jitter: f64) -> Duration {
    let doubling = THROTTLE_BASE.saturating_mul(1u32 << attempt.saturating_sub(1).min(5));
    let floor = doubling.max(server.unwrap_or_default()).min(THROTTLE_CAP);
    floor + floor.mul_f64(jitter.clamp(0.0, 1.0) / 2.0)
}

pub(crate) fn jitter_unit() -> f64 {
    use std::hash::BuildHasher as _;
    let n = std::collections::hash_map::RandomState::new().hash_one(std::time::SystemTime::now());
    (n >> 11) as f64 / (1u64 << 53) as f64
}

fn cancelled(cancel: Option<&Halt>) -> bool {
    cancel.is_some_and(Halt::cancelled)
}

const CANCEL_POLL: Duration = Duration::from_millis(200);

/// A stalled connection delivers nothing until the read timeout, so a flag
/// checked only between chunks kept a cancelled download alive for a minute,
/// long enough for the next launch to start next to it.
///
/// A pause holds the work before it starts; work already under way finishes.
pub(crate) async fn or_cancel<F: std::future::Future>(fut: F, cancel: Option<&Halt>) -> Result<F::Output, String> {
    let Some(halt) = cancel else { return Ok(fut.await) };
    halt.gate().await?;
    watch(fut, halt, false).await
}

/// For reads of a download body: a pause ends the wait with `PAUSED` instead
/// of leaving the connection idle. A stream held open through a long pause is
/// cut by the server, and every such cut used to cost a retry.
pub(crate) async fn or_pause<F: std::future::Future>(fut: F, cancel: Option<&Halt>) -> Result<F::Output, String> {
    let Some(halt) = cancel else { return Ok(fut.await) };
    watch(fut, halt, true).await
}

async fn watch<F: std::future::Future>(fut: F, halt: &Halt, stop_on_pause: bool) -> Result<F::Output, String> {
    // Пауза, поставленная до первого опроса, ловится сразу: иначе локальный
    // сервер успевал отдать всё тело раньше первого тика, и загрузка «на паузе»
    // доезжала до конца (тест a_paused_download_... на раннерах GitHub).
    if stop_on_pause && !halt.cancelled() && halt.paused() {
        return Err(PAUSED.into());
    }
    tokio::pin!(fut);
    let mut tick = tokio::time::interval(CANCEL_POLL);
    loop {
        tokio::select! {
            out = &mut fut => return Ok(out),
            _ = tick.tick() => {
                if halt.cancelled() {
                    return Err(CANCELLED.into());
                }
                if stop_on_pause && halt.paused() {
                    return Err(PAUSED.into());
                }
            }
        }
    }
}

/// Сколько уже скачанного можно оставить после неудачной попытки.
///
/// Ноль — начать заново. Не ноль — продолжить с этого места.
///
/// Битую контрольную сумму и неверный размер продолжать нельзя: испорчен сам
/// скачанный кусок, и докачка поверх него даст файл, который не сойдётся уже
/// никогда. Всё остальное — обрыв связи, ответ щита пятисоткой, закрытое
/// соединение — портит только хвост, и его довозит следующая попытка.
fn resume_after(err: &str, have: u64) -> u64 {
    if have < RESUME_MIN_BYTES {
        return 0;
    }
    if err.contains("контрольная сумма") || err.contains("размер") {
        return 0;
    }
    have
}

// Downloads a file. The checksum is compared after the download, a wrong file is deleted (SUM_MISMATCH).
#[allow(clippy::too_many_arguments)]
async fn fetch_once(
    url: &str,
    part: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&Halt>,
    resume_from: u64,
    on: Option<&Progress<'_>>,
    spare: bool,
) -> Result<(), String> {
    if cancelled(cancel) {
        return Err(CANCELLED.into());
    }
    let mut req = if spare { spare_client() } else { client() }.get(url);
    if resume_from > 0 {
        req = req.header("Range", format!("bytes={}-", resume_from));
    }
    let resp = match or_pause(tokio::time::timeout(header_limit(), req.send()), cancel).await? {
        Ok(sent) => sent.map_err(|e| format!("{}: {}", url, net_err(&e)))?,
        Err(_) => return Err(stalled(url)),
    };
    if !resp.status().is_success() {
        return Err(status_failure(url, &resp));
    }
    let resp_len = resp.content_length();
    /*
     * Сервер вправе не поддержать докачку и ответить целым файлом: тогда
     * дописывать к уже скачанному нельзя — получится склейка двух начал,
     * которая сойдётся по размеру далеко не всегда, а по хешу не сойдётся
     * никогда, и разбираться в этом будет игрок.
     */
    let resumed = resume_from > 0 && resp.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut hasher = sum.filter(|s| s.is_usable()).map(|s| Hasher::for_sum(&s));
    let mut written: u64 = 0;
    let mut stream = resp.bytes_stream();
    // On a spinning disk only a few files are written at once, the connections stay as they were.
    // A small body is read first, so the wait for a place to write does not hold a connection
    // idle; a large one takes its place before the file is opened.
    let limited = diskgate::limited().await;
    let mut early = Vec::new();
    if diskgate::buffers_body(limited, resp_len, resumed) {
        loop {
            let next = match or_pause(tokio::time::timeout(stall_limit(), stream.next()), cancel).await? {
                Ok(next) => next,
                Err(_) => return Err(stalled(url)),
            };
            let Some(chunk) = next else { break };
            early.push(chunk.map_err(|e| format!("{}: обрыв загрузки ({})", url, net_err(&e)))?);
        }
    }
    let _writing = or_pause(diskgate::write_permit(), cancel).await?;
    let mut file = if resumed {
        // Хеш считается по ходу закачки, поэтому уже лежащий кусок нужно
        // прогнать через него заново — это чтение с диска против повторной
        // закачки двух гигабайт по сети.
        if let Some(h) = hasher.as_mut() {
            let mut fh = std::fs::File::open(part).map_err(|e| format!("{}: {}", part.display(), e))?;
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = std::io::Read::read(&mut fh, &mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                h.update(&buf[..n]);
            }
        }
        written = resume_from;
        std::fs::OpenOptions::new()
            .append(true)
            .open(part)
            .map_err(|e| format!("{}: {}", part.display(), e))?
    } else {
        std::fs::File::create(part).map_err(|e| format!("{}: {}", part.display(), e))?
    };
    let mut take = |chunk: &[u8]| -> Result<(), String> {
        if let Some(h) = hasher.as_mut() {
            h.update(chunk);
        }
        written += chunk.len() as u64;
        file.write_all(chunk).map_err(|e| e.to_string())?;
        count_downloaded(chunk.len());
        if let Some(report) = on {
            report(written, size);
        }
        Ok(())
    };
    for chunk in &early {
        take(chunk)?;
    }
    drop(early);
    loop {
        let next = match or_pause(tokio::time::timeout(stall_limit(), stream.next()), cancel).await? {
            Ok(next) => next,
            Err(_) => return Err(stalled(url)),
        };
        let Some(chunk) = next else { break };
        let chunk = chunk.map_err(|e| format!("{}: обрыв загрузки ({})", url, net_err(&e)))?;
        take(&chunk)?;
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    // Хеш сильнее размера: у популярных сборок в индексе встречается неверный
    // fileSize при верном sha1 (Better MC: Structory 1286460 против реальных
    // 1286462), и такой файл не скачивался никогда — сотни отказов в неделю.
    // Размер решает сам только там, где проверить хеш нечем.
    if let (Some(h), Some(s)) = (hasher, sum) {
        let got = h.hex();
        if !s.matches(&got) {
            return Err(format!("{}: {}", url, SUM_MISMATCH));
        }
        return Ok(());
    }
    if let Some(want) = size {
        if written != want {
            return Err(format!("{}: размер {} вместо {}", url, written, want));
        }
    }
    Ok(())
}

/// For content whose file name is its own hash (Mojang assets): an existing file
/// needs no re-verification.
pub(crate) async fn download_new(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
) -> Result<(), String> {
    if dest.exists() {
        return Ok(());
    }
    fetch(url, dest, sum, size).await
}

/// For sources without a reference hash whose content changes between versions
/// (installers, modpack archives).
pub(crate) async fn download_fresh(url: &str, dest: &Path) -> Result<(), String> {
    fetch(url, dest, None, None).await
}

/// Same, for archives an install job downloads: the job's cancel flag stops the
/// transfer mid-body instead of after the last byte.
/// Сейчас вызывается только тестом отмены: установка каталожных сборок ушла на
/// свой путь загрузки, а функция остаётся общим инструментом.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn download_fresh_cancellable(
    url: &str,
    dest: &Path,
    cancel: &Halt,
) -> Result<(), String> {
    fetch_cancellable(url, dest, None, None, Some(cancel), None).await
}

/// Verification reads and hashes the file, so it runs off the async runtime to
/// avoid blocking the worker thread that other downloads share.
pub(crate) async fn download_checked(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
) -> Result<(), String> {
    download_checked_cancellable(url, dest, sum, size, None).await
}

pub(crate) async fn download_checked_cancellable(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&Halt>,
) -> Result<(), String> {
    if already_intact(dest, sum, size).await {
        return Ok(());
    }
    fetch_cancellable(url, dest, sum, size, cancel, None).await
}

/// True when the destination already holds the wanted file; a copy that fails the check is removed.
async fn already_intact(dest: &Path, sum: Option<Sum<'_>>, size: Option<u64>) -> bool {
    if !dest.exists() {
        return false;
    }
    let owned = sum.map(OwnedSum::of);
    let path = dest.to_path_buf();
    let ok = tokio::task::spawn_blocking(move || file_matches(&path, owned.as_ref().map(OwnedSum::sum), size))
        .await
        .unwrap_or(false);
    if !ok {
        let _ = std::fs::remove_file(dest);
    }
    ok
}

/// `download_checked` for a file that belongs to a batch (assets, libraries). While the batch is
/// in its tail and this file has been running for `HEDGE_AFTER`, the same file is asked for a
/// second time over the other route and the spare pool of connections; the first complete,
/// verified answer wins. Each attempt writes its own temporary file, so they cannot tread on
/// each other.
pub(crate) async fn download_checked_hedged(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    tail: &super::hedge::Tail,
) -> Result<(), String> {
    download_hedged_after(url, dest, sum, size, tail, super::hedge::HEDGE_AFTER).await
}

async fn download_hedged_after(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    tail: &super::hedge::Tail,
    after: Duration,
) -> Result<(), String> {
    if already_intact(dest, sum, size).await {
        return Ok(());
    }
    let started = std::time::Instant::now();
    let primary = fetch_via(url, dest, sum, size, None, None, Via::default());
    let backup = fetch_via(url, dest, sum, size, None, None, Via { spare: true, swap: true });
    super::hedge::first_ok(primary, tail.due(started, after), backup).await
}

/// A digest that can cross into `spawn_blocking`.
struct OwnedSum(u8, String);

impl OwnedSum {
    fn of(sum: Sum<'_>) -> Self {
        match sum {
            Sum::Sha1(v) => OwnedSum(1, v.to_string()),
            Sum::Sha256(v) => OwnedSum(2, v.to_string()),
            Sum::Sha512(v) => OwnedSum(3, v.to_string()),
        }
    }

    fn sum(&self) -> Sum<'_> {
        match self.0 {
            1 => Sum::Sha1(&self.1),
            2 => Sum::Sha256(&self.1),
            _ => Sum::Sha512(&self.1),
        }
    }
}

/// То же скачивание, но с отчётом о ходе. Архив сборки весит гигабайты, и без
/// отчёта полоса стоит на одном числе всю закачку - игрок читает это как
/// зависание и приходит в поддержку (KoMaM, 16.09.2026: «бесконечная загрузка 12%»).
pub(crate) async fn download_checked_progress(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&Halt>,
    on: &Progress<'_>,
) -> Result<(), String> {
    let usable = sum.filter(|s| s.is_usable());
    if let Some(s) = usable {
        if already_fetched(dest, s, size).await {
            return Ok(());
        }
    }
    if dest.exists() {
        let _ = std::fs::remove_file(dest);
    }
    if let (Some(s), Some(total)) = (usable, size) {
        let single_route = super::mirror::routes(url).await.len() == 1;
        if total >= SEGMENTED_MIN_BYTES && single_route {
            if let Segmented::Done = fetch_segmented(url, dest, s, total, cancel, on).await? {
                return Ok(());
            }
        }
        // A part file that outlives the call: an archive cut at 80% by a dropped
        // line, a cancel or a closed launcher continues from there instead of zero.
        if total >= RESUME_MIN_BYTES && single_route {
            drop_stale_parts(dest, &resumable_part(dest, s.expected()));
            let idle = Halt::default();
            return download_resumable_sum(url, dest, s, total, cancel.unwrap_or(&idle), on).await;
        }
    }
    fetch_cancellable(url, dest, sum, size, cancel, Some(on)).await
}

/// Bytes of an older build of the same file never complete: the pack or Java
/// moved on, and the part would sit next to it for good.
fn drop_stale_parts(dest: &Path, keep: &Path) {
    let (Some(dir), Some(name)) = (dest.parent(), dest.file_name()) else { return };
    let prefix = format!("{}.", name.to_string_lossy());
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        let n = e.file_name().to_string_lossy().to_string();
        if n.starts_with(&prefix) && n.ends_with(RESUMABLE_PART_SUFFIX) && p != keep && p.is_file() {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// A previous install may have finished the download and failed later (unpack,
/// disk, a crash): the archive on disk is still good and is not fetched again.
async fn already_fetched(dest: &Path, sum: Sum<'_>, size: Option<u64>) -> bool {
    let Ok(meta) = std::fs::metadata(dest) else { return false };
    if size.is_some_and(|want| meta.len() != want) {
        return false;
    }
    let owned = OwnedSum::of(sum);
    let path = dest.to_path_buf();
    tokio::task::spawn_blocking(move || hash_matches(&path, &owned.sum())).await.unwrap_or(false)
}

/// From this size an archive is fetched over several connections at once.
/// Pack archives run to gigabytes, and on long routes a single TCP stream
/// tops out far below the line: one player in ten got a 1.4 GB pack at about
/// 1.3 MB/s, which is the half-hour install.
const SEGMENTED_MIN_BYTES: u64 = 256 * 1024 * 1024;
const SEGMENTS: u64 = 4;

enum Segmented {
    Done,
    /// The server ignores ranges or the declared size was wrong: the caller
    /// falls back to one plain stream, which settles both.
    Unsupported,
}

enum SpanErr {
    Unsupported,
    Failed(String),
}

async fn fetch_segmented(
    url: &str,
    dest: &Path,
    sum: Sum<'_>,
    size: u64,
    cancel: Option<&Halt>,
    on: &Progress<'_>,
) -> Result<Segmented, String> {
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("{}: {}", p.display(), e))?;
    }
    let part = part_path(dest);
    let _cleanup = PartGuard(part.clone());
    std::fs::File::create(&part)
        .and_then(|f| f.set_len(size))
        .map_err(|e| format!("{}: {}", part.display(), e))?;
    let got = std::sync::atomic::AtomicU64::new(0);
    let span = size.div_ceil(SEGMENTS);
    let spans = (0..SEGMENTS)
        .map(|i| (i * span, ((i + 1) * span).min(size)))
        .filter(|(a, b)| a < b)
        .map(|(a, b)| fetch_span(url, &part, a, b, cancel, &got, size, on));
    match futures::future::try_join_all(spans).await {
        Ok(_) => {}
        Err(SpanErr::Unsupported) => return Ok(Segmented::Unsupported),
        Err(SpanErr::Failed(e)) => return Err(e),
    }
    let owned = OwnedSum::of(sum);
    let path = part.clone();
    let intact = tokio::task::spawn_blocking(move || hash_matches(&path, &owned.sum()))
        .await
        .unwrap_or(false);
    if !intact {
        return Ok(Segmented::Unsupported);
    }
    publish(&part, dest, Some(sum), Some(size))?;
    Ok(Segmented::Done)
}

/// One byte range `[start, end)` written in place; a cut connection resumes
/// from the last byte that landed.
#[allow(clippy::too_many_arguments)]
async fn fetch_span(
    url: &str,
    part: &Path,
    start: u64,
    end: u64,
    cancel: Option<&Halt>,
    got: &std::sync::atomic::AtomicU64,
    total: u64,
    on: &Progress<'_>,
) -> Result<(), SpanErr> {
    use std::io::{Seek, SeekFrom};
    let io = |e: std::io::Error| SpanErr::Failed(format!("{}: {}", part.display(), e));
    let mut at = start;
    let mut last = String::new();
    let mut attempt = 1;
    while attempt <= TRIES {
        let req = client().get(url).header("Range", format!("bytes={}-{}", at, end - 1));
        let mut paused = false;
        match or_pause(req.send(), cancel).await {
            Err(e) if e == PAUSED => paused = true,
            Err(e) => return Err(SpanErr::Failed(e)),
            Ok(Ok(resp)) if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT && range_starts_at(&resp, at) => {
                let mut file = std::fs::OpenOptions::new().write(true).open(part).map_err(io)?;
                file.seek(SeekFrom::Start(at)).map_err(io)?;
                let mut stream = resp.bytes_stream();
                while at < end {
                    match or_pause(stream.next(), cancel).await {
                        Err(e) if e == PAUSED => {
                            paused = true;
                            break;
                        }
                        Err(e) => return Err(SpanErr::Failed(e)),
                        Ok(None) => break,
                        Ok(Some(Ok(chunk))) => {
                            let take = chunk.len().min((end - at) as usize);
                            file.write_all(&chunk[..take]).map_err(io)?;
                            count_downloaded(take);
                            at += take as u64;
                            let now = got.fetch_add(take as u64, Ordering::Relaxed) + take as u64;
                            on(now, Some(total));
                        }
                        Ok(Some(Err(e))) => {
                            last = format!("{}: обрыв загрузки ({})", url, net_err(&e));
                            break;
                        }
                    }
                }
                file.flush().map_err(io)?;
            }
            Ok(Ok(resp)) if resp.status().is_success() || resp.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE => {
                return Err(SpanErr::Unsupported);
            }
            Ok(Ok(resp)) => last = status_failure(url, &resp),
            Ok(Err(e)) => last = format!("{}: {}", url, net_err(&e)),
        }
        if at >= end {
            return Ok(());
        }
        if paused {
            if let Some(halt) = cancel {
                halt.gate().await.map_err(SpanErr::Failed)?;
            }
            continue;
        }
        if cancelled(cancel) {
            return Err(SpanErr::Failed(CANCELLED.into()));
        }
        if attempt < TRIES {
            tokio::time::sleep(retry_pause(attempt, &last)).await;
        }
        attempt += 1;
    }
    Err(SpanErr::Failed(if last.is_empty() { format!("{}: ответ оборвался", url) } else { last }))
}

pub(crate) const RESUMABLE_PART_SUFFIX: &str = ".millida-part";

/// Named after the content, so bytes of an older build are never continued
/// into a newer one.
pub(crate) fn resumable_part(dest: &Path, sha256: &str) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(format!(".{}{}", sha256.get(..16).unwrap_or(sha256), RESUMABLE_PART_SUFFIX));
    dest.with_file_name(name)
}

/// For multi-gigabyte files served from our storage through the shield. The
/// shield answers every ranged request by pulling the object from that offset
/// to its end, so parallel ranges cost the origin the file several times over,
/// and an install that failed and threw its bytes away cost it all again on
/// every retry. One stream into a part file that outlives the attempt and the
/// install keeps it at one copy per player.
#[cfg(test)]
pub(crate) async fn download_resumable(
    url: &str,
    dest: &Path,
    sha256: &str,
    size: u64,
    cancel: &Halt,
    on: &Progress<'_>,
) -> Result<(), String> {
    download_resumable_sum(url, dest, Sum::Sha256(sha256), size, cancel, on).await
}

async fn download_resumable_sum(
    url: &str,
    dest: &Path,
    sum: Sum<'_>,
    size: u64,
    cancel: &Halt,
    on: &Progress<'_>,
) -> Result<(), String> {
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("{}: {}", p.display(), e))?;
    }
    let part = resumable_part(dest, sum.expected());
    let len = |p: &Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let mut stalled = 0;
    loop {
        if cancel.cancelled() {
            return Err(CANCELLED.into());
        }
        let have = len(&part);
        if have > size {
            let _ = std::fs::remove_file(&part);
            continue;
        }
        if have == size {
            break;
        }
        let err = match resume_once(url, &part, have, size, cancel, on).await {
            Ok(()) => continue,
            Err(e) if e == PAUSED => {
                cancel.gate().await?;
                continue;
            }
            Err(e) => e,
        };
        if cancel.cancelled() {
            return Err(CANCELLED.into());
        }
        stalled = if len(&part) > have { 0 } else { stalled + 1 };
        if stalled >= TRIES {
            return Err(err);
        }
        tokio::time::sleep(retry_pause(stalled.max(1), &err)).await;
    }
    let owned = OwnedSum::of(sum);
    let path = part.clone();
    let intact = tokio::task::spawn_blocking(move || hash_matches(&path, &owned.sum())).await.unwrap_or(false);
    if !intact {
        let _ = std::fs::remove_file(&part);
        return Err(format!("{}: контрольная сумма не сошлась, файл скачается заново", url));
    }
    if dest.exists() {
        let _ = std::fs::remove_file(dest);
    }
    publish(&part, dest, Some(sum), Some(size))
}

async fn resume_once(url: &str, part: &Path, have: u64, size: u64, cancel: &Halt, on: &Progress<'_>) -> Result<(), String> {
    let mut req = client().get(url);
    if have > 0 {
        req = req.header("Range", format!("bytes={}-", have));
    }
    let resp = or_pause(req.send(), Some(cancel)).await?.map_err(|e| format!("{}: {}", url, net_err(&e)))?;
    let status = resp.status();
    let mut at = if status == reqwest::StatusCode::OK {
        0
    } else if have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT && range_starts_at(&resp, have) {
        have
    } else {
        if status == reqwest::StatusCode::PARTIAL_CONTENT || status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
            let _ = std::fs::remove_file(part);
        }
        return Err(status_failure(url, &resp));
    };
    let opened = if at == 0 { std::fs::File::create(part) } else { std::fs::OpenOptions::new().append(true).open(part) };
    let mut file = opened.map_err(|e| format!("{}: {}", part.display(), e))?;
    on(at, Some(size));
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = or_pause(stream.next(), Some(cancel)).await? {
        let chunk = chunk.map_err(|e| format!("{}: обрыв загрузки ({})", url, net_err(&e)))?;
        if at + chunk.len() as u64 > size {
            drop(file);
            let _ = std::fs::remove_file(part);
            return Err(format!("{}: файл больше ожидаемого", url));
        }
        file.write_all(&chunk).map_err(|e| format!("{}: {}", part.display(), e))?;
        count_downloaded(chunk.len());
        at += chunk.len() as u64;
        on(at, Some(size));
    }
    file.flush().map_err(|e| e.to_string())?;
    if at < size {
        return Err(format!("{}: ответ оборвался", url));
    }
    Ok(())
}

fn range_starts_at(resp: &reqwest::Response, at: u64) -> bool {
    resp.headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes "))
        .and_then(|v| v.split('-').next())
        .and_then(|v| v.trim().parse::<u64>().ok())
        == Some(at)
}

/// Same contract as `download_checked`, plus the shared store: a file another
/// build already downloaded is linked instead of fetched again, and a file that
/// had to be fetched joins the store for the next build that wants it.
pub(crate) async fn download_verify(
    url: &str,
    dest: &Path,
    sha1: Option<&str>,
    size: Option<u64>,
) -> Result<(), String> {
    if let Some(sha1) = sha1.filter(|s| !s.is_empty()) {
        if !dest.exists() && super::dedup::link_from_store(sha1, dest, size) {
            return Ok(());
        }
        download_checked(url, dest, Some(Sum::Sha1(sha1)), size).await?;
        super::dedup::adopt_to_store(dest, sha1);
        return Ok(());
    }
    download_checked(url, dest, None, size).await
}

/// `download_verify` for a file of a batch whose tail may be duplicated (see `download_checked_hedged`).
pub(crate) async fn download_verify_hedged(
    url: &str,
    dest: &Path,
    sha1: Option<&str>,
    size: Option<u64>,
    tail: &super::hedge::Tail,
) -> Result<(), String> {
    if let Some(sha1) = sha1.filter(|s| !s.is_empty()) {
        if !dest.exists() && super::dedup::link_from_store(sha1, dest, size) {
            return Ok(());
        }
        download_checked_hedged(url, dest, Some(Sum::Sha1(sha1)), size, tail).await?;
        super::dedup::adopt_to_store(dest, sha1);
        return Ok(());
    }
    download_checked_hedged(url, dest, None, size, tail).await
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {

    /// ошибка + сколько скачано -> с чего продолжать. Сборка весит гигабайты, и
    /// обрыв на девяноста процентах не должен стоить полного повтора; но
    /// испорченный кусок продолжать нельзя ни при каком размере.
    #[test]
    fn a_broken_download_resumes_only_when_the_bytes_are_still_good() {
        let big = RESUME_MIN_BYTES + 1;
        let table: [(&str, u64, u64, &str); 6] = [
            ("https://x/y.zip → 502 Bad Gateway", big, big, "щит ответил ошибкой — байты целы, довозим хвост"),
            ("https://x/y.zip: обрыв загрузки (connection reset)", big, big, "обрыв связи портит только хвост"),
            ("https://x/y.zip: контрольная сумма не сошлась", big, 0, "испорчен сам файл — докачка его не починит"),
            ("https://x/y.zip: размер 5 вместо 7", big, 0, "недовезённый файл считается испорченным"),
            ("https://x/y.zip → 502 Bad Gateway", 1024, 0, "мелочь перекачать дешевле, чем возобновлять"),
            ("https://x/y.zip → 502 Bad Gateway", 0, 0, "нечего продолжать"),
        ];
        for (err, have, want, why) in table {
            assert_eq!(resume_after(err, have), want, "{}", why);
        }
    }

    use super::*;

    // Port 1 refuses immediately, so any network attempt fails fast.
    const DEAD: &str = "http://127.0.0.1:1/nope.json";

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-http-tests").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Two downloads of one file used to share `<name>.part`: whoever finished
    /// second found it renamed away and failed the whole install with
    /// "не удается найти указанный файл".
    #[test]
    fn concurrent_downloads_do_not_share_one_temp_file() {
        let dest = tmp("part").join("lwjgl.jar");
        let a = part_path(&dest);
        let b = part_path(&dest);
        assert_ne!(a, b, "каждая загрузка обязана писать в свой временный файл");
        assert_eq!(a.parent(), dest.parent(), "временный файл лежит рядом с целевым");
        assert!(
            a.file_name().unwrap().to_string_lossy().starts_with("lwjgl.jar."),
            "имя временного файла привязано к целевому: {:?}",
            a
        );
    }

    /// The loser of that race — and a jar the running game holds open — must not
    /// fail the install when the destination already holds the wanted bytes.
    #[test]
    fn publish_accepts_destination_written_by_the_other_download() {
        let dir = tmp("publish");
        let dest = dir.join("asset.bin");
        std::fs::write(&dest, b"ok").unwrap();
        let missing_part = dir.join("asset.bin.gone.part");
        assert!(
            publish(&missing_part, &dest, None, Some(2)).is_ok(),
            "готовый файл нужного размера — это успех, а не ошибка установки"
        );
        assert!(
            publish(&missing_part, &dest, None, Some(999)).is_err(),
            "чужой файл другого размера принимать нельзя"
        );
    }

    /// Отмена во время загрузки: раньше флаг смотрели только между файлами, и
    /// «Отменить» на архиве модпака ждало последнего байта, а три зеркала по три
    /// попытки продолжали качать после нажатия.
    #[tokio::test]
    async fn a_cancelled_download_gives_up_at_once() {
        let dest = tmp("cancel").join("pack.mrpack");
        let flag = Halt::default();
        flag.cancel();
        let err = download_fresh_cancellable(DEAD, &dest, &flag).await.unwrap_err();
        assert_eq!(err, CANCELLED, "отменённая загрузка обязана вернуть именно отмену");
        assert!(!dest.exists(), "после отмены целевой файл не создаётся");
        assert!(
            !part_path(&dest).exists(),
            "временный файл отменённой загрузки не должен оставаться на диске"
        );
    }

    /// Server state -> how long a cancel takes to land. A launch cancelled
    /// while Java was downloading over a stalled link kept going for the full
    /// read timeout, and a retry in that window started a second game.
    #[tokio::test]
    async fn cancel_reaches_a_stalled_download() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let cases: [(&str, &[u8]); 2] = [
            ("stalled before headers", b""),
            ("stalled mid-body", b"HTTP/1.1 200 OK
Content-Length: 1000000

PK"),
        ];
        for (name, sent) in cases {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/java.zip", listener.local_addr().unwrap());
            tokio::spawn(async move {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let _ = sock.write_all(sent).await;
                tokio::time::sleep(Duration::from_secs(120)).await;
            });
            let dest = tmp("stall").join(format!("{}.zip", name.len()));
            let flag = std::sync::Arc::new(Halt::default());
            let setter = flag.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(300)).await;
                setter.cancel();
            });
            let noop = |_: u64, _: Option<u64>| {};
            let res = tokio::time::timeout(
                Duration::from_secs(5),
                download_checked_progress(&url, &dest, None, None, Some(&flag), &noop),
            )
            .await;
            match res {
                Ok(Err(e)) => assert_eq!(e, CANCELLED, "{}: cancel must end the download as a cancel", name),
                other => panic!("{}: cancel did not land within 5 s ({:?}); the next launch would start beside it", name, other.map(|r| r.is_ok())),
            }
        }
    }

    #[test]
    fn part_file_is_removed_when_download_gives_up() {
        let part = tmp("guard").join("x.jar.part");
        std::fs::write(&part, b"half").unwrap();
        {
            let _g = PartGuard(part.clone());
        }
        assert!(!part.exists(), "оборванная загрузка не должна оставлять мусор");
    }

    #[test]
    fn cdn_bypass_appends_unique_parameter() {
        let plain = bypass_cdn_cache("https://maven.neoforged.net/releases/a.jar");
        assert!(plain.starts_with("https://maven.neoforged.net/releases/a.jar?nocache="));
        let with_query = bypass_cdn_cache("https://host/a.jar?x=1");
        assert!(with_query.starts_with("https://host/a.jar?x=1&nocache="));
        assert!(is_stale_cdn_miss("https://host/a.jar → 404 Not Found"));
        assert!(!is_stale_cdn_miss("https://host/a.jar: обрыв загрузки"));
    }

    /// A body cut mid-flight is what a filtered or unstable connection produces:
    /// the status is already 200, so retrying only helps if the read happens
    /// inside the attempt.
    #[tokio::test]
    async fn truncated_body_is_retried() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/assets.json", listener.local_addr().unwrap());
        tokio::spawn(async move {
            for served in 0..2u32 {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let body = if served == 0 { "[{\"binar" } else { "[{\"ok\":true}]" };
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{}",
                    body
                );
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        let v = get_json(&url).await.expect("вторая попытка должна вернуть тело целиком");
        assert_eq!(v[0]["ok"], true, "оборванный ответ не должен доходить до вызывающего кода");
    }

    #[tokio::test]
    async fn immutable_json_reads_disk_without_network() {
        let cache = tmp("immutable").join("meta.json");
        std::fs::write(&cache, br#"{"id":"26.2"}"#).unwrap();
        let v = get_json_immutable(DEAD, &cache).await.expect("кэш должен подхватиться");
        assert_eq!(v["id"], "26.2");
    }

    #[tokio::test]
    async fn fresh_json_uses_cache_until_ttl_expires() {
        let cache = tmp("fresh").join("manifest.json");
        std::fs::write(&cache, br#"{"latest":{"release":"26.2"}}"#).unwrap();
        let v = get_json_fresh(DEAD, &cache, Duration::from_secs(3600)).await.unwrap();
        assert_eq!(v["latest"]["release"], "26.2");
        let v2 = get_json_fresh(DEAD, &cache, Duration::from_millis(0)).await.unwrap();
        assert_eq!(v2["latest"]["release"], "26.2");
    }

    /// Answers each connection with the next canned response and hands back the
    /// request heads it saw, so a test can check what the launcher asked.
    async fn serve_sequence(replies: Vec<String>) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/version_manifest_v2.json", listener.local_addr().unwrap());
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            for reply in replies {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                log.lock().unwrap().push(String::from_utf8_lossy(&buf[..n]).to_lowercase());
                let _ = sock.write_all(reply.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        (url, seen)
    }

    fn ok_with_etag(body: &str, etag: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nETag: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            etag,
            body.len(),
            body
        )
    }

    const NOT_MODIFIED: &str = "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n";

    fn age(cache: &Path, by: Duration) {
        let f = std::fs::File::options().write(true).open(cache).unwrap();
        f.set_modified(std::time::SystemTime::now() - by).unwrap();
    }

    /// The version list past its TTL: an unchanged source answers 304 and the
    /// copy is served and counted fresh again, a changed source replaces it.
    /// Without the validators every check re-downloaded the whole 270 KB list,
    /// which is why the TTL had been stretched to six hours and a snapshot
    /// stayed invisible for the afternoon of its release (20.10.2026).
    #[tokio::test]
    async fn a_stale_version_list_is_revalidated_with_its_etag() {
        let budget = Duration::from_secs(10);
        let ttl = Duration::from_secs(300);
        let cache = tmp("conditional").join("version_manifest_v2.json");
        let (url, seen) = serve_sequence(vec![
            ok_with_etag(r#"{"v":"1"}"#, "\"a\""),
            NOT_MODIFIED.to_string(),
            ok_with_etag(r#"{"v":"2"}"#, "\"b\""),
        ])
        .await;

        let v = conditional_within(&url, &cache, ttl, budget).await.unwrap();
        assert_eq!(v["v"], "1", "без копии список берётся из сети");
        assert!(!seen.lock().unwrap()[0].contains("if-none-match"), "без копии спрашивать «изменилось ли» нечего");

        let v = conditional_within(&url, &cache, ttl, budget).await.unwrap();
        assert_eq!(v["v"], "1", "свежая копия отдаётся без сети");
        assert_eq!(seen.lock().unwrap().len(), 1, "в пределах TTL сеть не трогается");

        age(&cache, ttl * 2);
        let v = conditional_within(&url, &cache, ttl, budget).await.unwrap();
        assert_eq!(v["v"], "1", "304 — значит копия верна");
        assert!(seen.lock().unwrap()[1].contains("if-none-match: \"a\""), "устаревшая копия переспрашивается по своему ETag");
        assert!(copy_is_fresh(&cache, ttl), "после 304 копия снова считается свежей, иначе спрашивали бы на каждом открытии");

        age(&cache, ttl * 2);
        let v = conditional_within(&url, &cache, ttl, budget).await.unwrap();
        assert_eq!(v["v"], "2", "новый ответ источника заменяет копию — так появляется новый снапшот");
        assert_eq!(read_json_file(&cache).unwrap()["v"], "2", "новая версия списка ложится на диск для офлайна");
    }

    /// Another reader rewrote the copy without validators: sending the old
    /// ETag could earn a 304 for a body we no longer hold.
    #[tokio::test]
    async fn validators_of_another_body_are_not_sent() {
        let cache = tmp("conditional-foreign").join("version_manifest_v2.json");
        let (url, seen) = serve_sequence(vec![
            ok_with_etag(r#"{"v":"1"}"#, "\"a\""),
            ok_with_etag(r#"{"v":"3"}"#, "\"c\""),
        ])
        .await;
        conditional_within(&url, &cache, Duration::ZERO, Duration::from_secs(10)).await.unwrap();
        std::fs::write(&cache, br#"{"v":"old"}"#).unwrap();
        let v = conditional_within(&url, &cache, Duration::ZERO, Duration::from_secs(10)).await.unwrap();
        assert_eq!(v["v"], "3");
        assert!(
            !seen.lock().unwrap()[1].contains("if-none-match"),
            "ETag чужого тела отправлять нельзя: 304 закрепил бы старую копию"
        );
    }

    #[tokio::test]
    async fn the_version_list_survives_offline() {
        let cache = tmp("conditional-offline").join("version_manifest_v2.json");
        std::fs::write(&cache, br#"{"v":"cached"}"#).unwrap();
        let v = conditional_within(DEAD, &cache, Duration::ZERO, Duration::from_secs(10)).await.unwrap();
        assert_eq!(v["v"], "cached", "без сети список версий берётся с диска");
        let missing = tmp("conditional-none").join("version_manifest_v2.json");
        let err = conditional_within(DEAD, &missing, Duration::ZERO, Duration::from_secs(10)).await.unwrap_err();
        assert!(err.contains("нет офлайн-кэша"), "без копии и сети ошибка говорит, чего не хватает: {}", err);
    }

    #[tokio::test]
    async fn body_over_the_cap_is_refused() {
        let url = serve_once(Duration::ZERO, r#"{"a":"0123456789012345678901234567890123456789"}"#).await;
        let res = client().get(&url).send().await.unwrap();
        assert!(read_capped(res, 16).await.is_err(), "тело больше предела не читается");
        let url = serve_once(Duration::ZERO, r#"{"a":1}"#).await;
        let res = client().get(&url).send().await.unwrap();
        assert_eq!(read_capped(res, 16).await.unwrap(), br#"{"a":1}"#.to_vec());
    }

    async fn serve_once(delay: Duration, body: &'static str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/meta.json", listener.local_addr().unwrap());
        tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await;
            tokio::time::sleep(delay).await;
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = sock.write_all(head.as_bytes()).await;
            let _ = sock.shutdown().await;
        });
        url
    }

    /// Up to 10 s: on a loaded CI runner the late answer lands well after the
    /// 900 ms delay (3 s was not enough on the shared Linux runner, 29.09.2026).
    /// Only the time before failing grows; a copy that never updates still fails.
    async fn cache_becomes(cache: &Path, want: &str) -> bool {
        for _ in 0..200 {
            if read_json_file(cache).is_ok_and(|v| v["v"] == want) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        false
    }

    /// Metadata with a copy on disk: a network inside the budget gives fresh
    /// data, a slow one never holds the launch past the budget, and its late
    /// answer still refreshes the copy for the next launch.
    #[tokio::test]
    async fn a_launch_waits_for_fresh_metadata_only_within_the_budget() {
        let budget = Duration::from_millis(300);
        // The first client() loads the system certificate store — over a
        // second on the shared Linux runner — and that is not what this
        // test times.
        let _ = client();
        let cases: [(&str, Duration, &str, &str); 2] = [
            ("fast", Duration::ZERO, "new", "сеть успела — запуск получает свежие данные"),
            ("slow", Duration::from_millis(900), "old", "сеть не успела — запуск идёт на копии и не ждёт"),
        ];
        for (name, delay, want, why) in cases {
            let url = serve_once(delay, r#"{"v":"new"}"#).await;
            let cache = tmp(&format!("revalidate-{}", name)).join("meta.json");
            std::fs::write(&cache, br#"{"v":"old"}"#).unwrap();
            let started = std::time::Instant::now();
            let v = revalidated_within(&url, &cache, budget).await.expect("копия на диске - ошибки быть не может");
            assert_eq!(v["v"], want, "{}: {}", name, why);
            assert!(
                started.elapsed() < budget + Duration::from_millis(250),
                "{}: запуск ждал {:?} при бюджете {:?}",
                name,
                started.elapsed(),
                budget
            );
            assert!(
                cache_becomes(&cache, "new").await,
                "{}: ответ сети обязан лечь в копию, иначе без сети запуск навсегда останется на старых данных",
                name
            );
        }
    }

    // Both modes live in one test: DEEP_VERIFY is process-global and parallel
    // tests would toggle it under each other.
    #[tokio::test]
    async fn size_fast_path_and_deep_verify() {
        let dir = tmp("size-path");
        let f = dir.join("lib.jar");
        std::fs::write(&f, b"0123456789").unwrap();
        let wrong = "0000000000000000000000000000000000000000";
        assert!(!deep_verify(), "проверка стартует с выключенной глубокой сверкой");
        download_checked(DEAD, &f, Some(Sum::Sha1(wrong)), Some(10))
            .await
            .expect("совпал размер — перекачивать нечего");
        assert!(f.exists());

        let outer = DeepVerify::hold();
        let r = {
            let inner = DeepVerify::hold();
            drop(inner);
            assert!(deep_verify(), "вложенный держатель не должен снимать флаг у внешнего");
            download_checked(DEAD, &f, Some(Sum::Sha1(wrong)), Some(10)).await
        };
        drop(outer);
        assert!(!deep_verify(), "после освобождения всех держателей флаг снят");
        assert!(r.is_err(), "глубокая проверка обязана поймать несовпадение хеша");

        let g = dir.join("short.jar");
        std::fs::write(&g, b"012").unwrap();
        let r2 = download_checked(DEAD, &g, None, Some(10)).await;
        assert!(r2.is_err(), "размер не сошёлся — файл должен качаться заново");
    }

    /// вход -> вердикт. Индекс сборки Better MC обещает Structory в 1286460 байт,
    /// а файл весит 1286462 при верном sha1: такой файл не скачивался никогда.
    /// Верный хеш побеждает неверный размер, а без хеша размер решает сам.
    #[tokio::test]
    async fn a_matching_hash_beats_a_wrong_declared_size() {
        let dir = tmp("hash-over-size");
        let f = dir.join("structory.jar");
        std::fs::write(&f, b"0123456789").unwrap();
        let right = "87acec17cd9dcd20a716cc2cf67417b71c8a7016";
        download_checked(DEAD, &f, Some(Sum::Sha1(right)), Some(12))
            .await
            .expect("хеш сошёлся — неверный размер из индекса не повод качать заново");
        let wrong = "0000000000000000000000000000000000000000";
        let r = download_checked(DEAD, &f, Some(Sum::Sha1(wrong)), Some(12)).await;
        assert!(r.is_err(), "не сошлись ни размер, ни хеш — файл чужой");
    }

    #[derive(Clone, Copy)]
    enum RangeMode {
        Honest,
        IgnoresRange,
        CutsEveryAnswerAfter(usize),
    }

    async fn serve_ranges(body: Vec<u8>, mode: RangeMode) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/pack.zip", listener.local_addr().unwrap());
        let body = std::sync::Arc::new(body);
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let body = body.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                    let range = req
                        .lines()
                        .find_map(|l| l.strip_prefix("range: bytes="))
                        .and_then(|r| r.trim().split_once('-'))
                        .and_then(|(a, b)| {
                            let end = if b.is_empty() { body.len() - 1 } else { b.parse::<usize>().ok()? };
                            Some((a.parse::<usize>().ok()?, end))
                        });
                    let (head, slice) = match (mode, range) {
                        (RangeMode::IgnoresRange, _) | (_, None) => (
                            format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()),
                            body[..].to_vec(),
                        ),
                        (_, Some((a, b))) => (
                            format!(
                                "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                a, b, body.len(), b + 1 - a
                            ),
                            body[a..=b].to_vec(),
                        ),
                    };
                    let slice = match mode {
                        RangeMode::CutsEveryAnswerAfter(cut) => slice[..slice.len().min(cut)].to_vec(),
                        _ => slice,
                    };
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&slice).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        url
    }

    /// вход (как сервер отвечает на Range) -> вердикт. Архив сборки идёт в
    /// несколько соединений; без поддержки диапазонов — откат на один поток,
    /// оборванные куски докачиваются со своего места, итог сверяется по хешу.
    #[tokio::test]
    async fn a_big_archive_downloads_in_ranges_or_falls_back() {
        let body: Vec<u8> = (0..1_000_003u32).map(|i| (i % 251) as u8).collect();
        let sha1 = {
            use sha1::Digest as _;
            sha1::Sha1::digest(&body).iter().map(|b| format!("{:02x}", b)).collect::<String>()
        };
        let cases: [(RangeMode, bool, &str); 3] = [
            (RangeMode::Honest, true, "сервер отдаёт диапазоны — архив собирается из кусков"),
            (RangeMode::IgnoresRange, false, "сервер без диапазонов — вызывающий качает одним потоком"),
            (RangeMode::CutsEveryAnswerAfter(150_000), true, "обрывы докачиваются с последнего байта"),
        ];
        let noop = |_: u64, _: Option<u64>| {};
        for (i, (mode, segmented, why)) in cases.into_iter().enumerate() {
            let url = serve_ranges(body.clone(), mode).await;
            let dest = tmp(&format!("segmented-{}", i)).join("pack.zip");
            let r = fetch_segmented(&url, &dest, Sum::Sha1(&sha1), body.len() as u64, None, &noop)
                .await
                .unwrap_or_else(|e| panic!("{}: {}", why, e));
            assert_eq!(matches!(r, Segmented::Done), segmented, "{}", why);
            if segmented {
                assert_eq!(std::fs::read(&dest).unwrap(), body, "{}: собранный файл отличается от исходного", why);
            } else {
                assert!(!dest.exists(), "{}: при откате на диске не должно остаться полуфайла", why);
            }
        }
    }

    /// Неверная сумма у собранного из кусков файла не публикуется: откат на
    /// обычную закачку, которая и выдаст ошибку сверки.
    #[tokio::test]
    async fn a_segmented_archive_with_a_wrong_hash_is_not_published() {
        let body: Vec<u8> = vec![7u8; 4096];
        let url = serve_ranges(body.clone(), RangeMode::Honest).await;
        let dest = tmp("segmented-wrong-hash").join("pack.zip");
        let noop = |_: u64, _: Option<u64>| {};
        let wrong = "0000000000000000000000000000000000000000";
        let r = fetch_segmented(&url, &dest, Sum::Sha1(wrong), body.len() as u64, None, &noop).await;
        assert!(matches!(r, Ok(Segmented::Unsupported)), "несошедшийся хеш обязан вернуть откат, а не готовый файл");
        assert!(!dest.exists(), "файл с чужим содержимым не должен лечь на место");
    }

    /// (server, bytes left by an earlier install, hash) -> outcome. A game file
    /// is gigabytes: whatever already landed must be continued, not fetched
    /// again, and must survive a failed install; only a wrong hash discards it.
    #[tokio::test]
    async fn a_game_file_continues_from_what_already_landed() {
        let body: Vec<u8> = (0..1_000_003u32).map(|i| (i % 251) as u8).collect();
        let good = sha256_hex(&body);
        let wrong = "0".repeat(64);
        type Case<'a> = (Option<RangeMode>, usize, &'a str, bool, bool, &'a str);
        let cases: [Case; 5] = [
            (Some(RangeMode::CutsEveryAnswerAfter(150_000)), 0, good.as_str(), true, false, "a cut that still moved bytes is not a failed try"),
            (Some(RangeMode::Honest), 600_000, good.as_str(), true, false, "the part of a failed install is continued"),
            (Some(RangeMode::IgnoresRange), 600_000, good.as_str(), true, false, "a server without ranges starts the file over"),
            (Some(RangeMode::Honest), 0, wrong.as_str(), false, false, "a wrong hash discards the bytes"),
            (None, 600_000, good.as_str(), false, true, "an unreachable server keeps the part for the next install"),
        ];
        for (i, (mode, seeded, sha, ok, part_kept, why)) in cases.into_iter().enumerate() {
            let url = match mode {
                Some(m) => serve_ranges(body.clone(), m).await,
                None => DEAD.to_string(),
            };
            let dest = tmp(&format!("resumable-{}", i)).join("game.pak");
            let part = resumable_part(&dest, sha);
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            if seeded > 0 {
                std::fs::write(&part, &body[..seeded]).unwrap();
            }
            let first = std::sync::Mutex::new(None);
            let on = |got: u64, _: Option<u64>| {
                let mut f = first.lock().unwrap_or_else(|e| e.into_inner());
                if f.is_none() {
                    *f = Some(got);
                }
            };
            let halt = Halt::default();
            let r = tokio::time::timeout(Duration::from_secs(20), download_resumable(&url, &dest, sha, body.len() as u64, &halt, &on))
                .await
                .unwrap_or_else(|_| panic!("{}: the download never finished", why));
            assert_eq!(r.is_ok(), ok, "{}: {:?}", why, r);
            if ok {
                assert_eq!(std::fs::read(&dest).unwrap(), body, "{}: the file differs from the source", why);
                if matches!(mode, Some(RangeMode::Honest)) && seeded > 0 {
                    assert_eq!(*first.lock().unwrap(), Some(seeded as u64), "{}: progress must start from the bytes on disk", why);
                }
            } else {
                assert!(!dest.exists(), "{}: a failed download must not land in place", why);
            }
            assert_eq!(part.exists(), part_kept, "{}: part file", why);
        }
    }

    /// (path, what ends the pause) -> outcome. Nothing downloads while paused,
    /// a resume finishes the file intact, and a cancel during a pause still
    /// ends the install as a cancel, on both the plain and the ranged path.
    #[tokio::test]
    async fn a_paused_download_waits_resumes_and_still_cancels() {
        let body: Vec<u8> = (0..1_000_003u32).map(|i| (i % 251) as u8).collect();
        let sha1 = {
            use sha1::Digest as _;
            sha1::Sha1::digest(&body).iter().map(|b| format!("{:02x}", b)).collect::<String>()
        };
        let cases: [(bool, bool, &str); 4] = [
            (false, false, "plain stream, resumed"),
            (false, true, "plain stream, cancelled while paused"),
            (true, false, "ranged download, resumed"),
            (true, true, "ranged download, cancelled while paused"),
        ];
        let noop = |_: u64, _: Option<u64>| {};
        let hold = Duration::from_millis(400);
        for (i, (ranged, cancel_it, why)) in cases.into_iter().enumerate() {
            let url = serve_ranges(body.clone(), RangeMode::Honest).await;
            let dest = tmp(&format!("pause-{}", i)).join("pack.zip");
            let halt = std::sync::Arc::new(Halt::default());
            halt.set_paused(true);
            let h = halt.clone();
            tokio::spawn(async move {
                tokio::time::sleep(hold).await;
                if cancel_it {
                    h.cancel();
                } else {
                    h.set_paused(false);
                }
            });
            let started = std::time::Instant::now();
            let size = body.len() as u64;
            let r = tokio::time::timeout(Duration::from_secs(10), async {
                if ranged {
                    fetch_segmented(&url, &dest, Sum::Sha1(&sha1), size, Some(&halt), &noop).await.map(|_| ())
                } else {
                    download_checked_progress(&url, &dest, Some(Sum::Sha1(&sha1)), Some(size), Some(&halt), &noop).await
                }
            })
            .await
            .unwrap_or_else(|_| panic!("{}: the download never came back from the pause", why));
            // Сколько прошло и с чем вернулось — в тексте отказа: 13.10.2026 этот тест один раз упал на
            // раннере GitHub именно здесь, и по одной строке «bytes moved» причину было не восстановить.
            let took = started.elapsed();
            assert!(took >= hold - Duration::from_millis(50), "{}: bytes moved while paused: came back after {:?} with {:?}", why, took, r);
            if cancel_it {
                assert_eq!(r.unwrap_err(), CANCELLED, "{}: a cancel during a pause must end as a cancel", why);
                assert!(!dest.exists(), "{}: a cancelled download must not leave a file in place", why);
            } else {
                r.unwrap_or_else(|e| panic!("{}: {}", why, e));
                assert_eq!(std::fs::read(&dest).unwrap(), body, "{}: the resumed file differs from the source", why);
            }
        }
    }

    /// вход -> пауза перед повтором. 429 от нашего зеркала значит «подожди
    /// минутное окно»: короткая пауза сжигала попытки внутри того же окна.
    #[test]
    fn rate_limit_waits_longer_than_a_dropped_connection() {
        let throttled = format!("https://api.millida.net/v2/launcher/dl → {}", reqwest::StatusCode::TOO_MANY_REQUESTS);
        assert!(retry_pause(1, &throttled) >= Duration::from_secs(5), "429 должен ждать окно лимита");
        assert_eq!(retry_pause(1, "x: обрыв загрузки (нет связи (reset))"), Duration::from_millis(400), "обрыв повторяется сразу");
    }

    /// The shield answered 429 to thousands of launchers at once after the
    /// 0.2.37 mod release, and each retried on a fixed short schedule.
    #[test]
    fn a_throttled_download_waits_as_asked_doubles_and_spreads() {
        let s = Duration::from_secs;
        let cases: [(u32, Option<Duration>, f64, Duration, &str); 7] = [
            (1, None, 0.0, s(5), "first retry waits the base window"),
            (2, None, 0.0, s(10), "each attempt doubles the wait"),
            (4, None, 0.0, s(40), "doubling keeps going without a server hint"),
            (1, Some(s(30)), 0.0, s(30), "Retry-After longer than the backoff wins"),
            (3, Some(s(2)), 0.0, s(20), "a short Retry-After never shortens the backoff"),
            (1, Some(s(3600)), 0.0, s(120), "a huge Retry-After is capped"),
            (1, None, 1.0, Duration::from_millis(7500), "jitter adds up to half of the wait"),
        ];
        for (attempt, server, jitter, want, why) in cases {
            assert_eq!(throttle_pause(attempt, server, jitter), want, "{}", why);
        }
        assert_eq!(throttle_pause(40, None, 0.0), s(120), "a large attempt number must not overflow the shift");
        for _ in 0..64 {
            let j = jitter_unit();
            assert!((0.0..1.0).contains(&j), "jitter must stay in [0, 1): {}", j);
        }
    }

    /// The failure text is the only channel from the transfer to the retry
    /// loops, so its Retry-After marker has to survive the round trip.
    #[test]
    fn retry_after_rides_in_the_failure_text() {
        let url = "https://cdn.millida.net/mod/millida-mod-fabric-1.21.1-0.2.37.jar";
        let too_many = reqwest::StatusCode::TOO_MANY_REQUESTS;
        type Case<'a> = (reqwest::StatusCode, Option<&'a str>, Option<u64>, bool, &'a str);
        let cases: [Case; 6] = [
            (too_many, Some("30"), Some(30), true, "seconds from the shield are kept"),
            (too_many, Some(" 7 "), Some(7), true, "spaces around the number are fine"),
            (too_many, None, None, true, "429 without a header still counts as throttled"),
            (too_many, Some("Wed, 21 Oct 2026 07:28:00 GMT"), None, true, "an HTTP-date falls back to doubling"),
            (reqwest::StatusCode::SERVICE_UNAVAILABLE, Some("12"), Some(12), true, "503 with a wait is a throttle too"),
            (reqwest::StatusCode::NOT_FOUND, None, None, false, "404 is final, not a limit"),
        ];
        for (status, header, wait, throttled, why) in cases {
            let text = status_text(url, status, header);
            assert_eq!(server_wait(&text), wait.map(Duration::from_secs), "{}: {}", why, text);
            assert_eq!(is_throttled(&text), throttled, "{}: {}", why, text);
            assert!(text.starts_with(url), "{}: the URL stays in front for telemetry grouping", why);
        }
        assert!(is_transient("x: нет связи (reset)"), "a dropped line is worth another round");
        assert!(!is_transient(&format!("x: {}", SUM_MISMATCH)), "a wrong checksum will not fix itself");
    }

    /// Failed lookup -> whether the catalogue already gave its final answer.
    #[test]
    fn only_an_absent_address_is_a_final_answer() {
        let url = "https://api.millida.net/v2/launcher/mr/v2/project/Thaumcraft/version";
        let cases: [(String, bool, &str); 5] = [
            (status_message(url, reqwest::StatusCode::NOT_FOUND), true, "30.10: a mod id guessed as a Modrinth slug kept a «Поставить» that ended in this 404"),
            (status_message(url, reqwest::StatusCode::GONE), true, "a removed project is just as absent"),
            (status_message(url, reqwest::StatusCode::BAD_GATEWAY), false, "a mirror outage is worth another click"),
            (status_message(url, reqwest::StatusCode::TOO_MANY_REQUESTS), false, "a throttle passes"),
            (format!("нет связи (reset) — {}", url), false, "a dropped line says nothing about the project"),
        ];
        for (err, absent, why) in cases {
            assert_eq!(is_absent_answer(&err), absent, "{}: {}", why, err);
        }
    }

    /// The backend tells launcher releases apart by this header in its logs; a fixed
    /// "1.0" made every build look the same.
    #[test]
    fn user_agent_carries_the_real_app_version() {
        let expected = format!("MillidaLauncher/{} (+https://millida.net)", env!("CARGO_PKG_VERSION"));
        assert_eq!(UA, expected, "User-Agent обязан нести версию из Cargo.toml, которую CI ставит при выпуске");
        assert_ne!(env!("CARGO_PKG_VERSION"), "", "пустая версия дала бы «MillidaLauncher/» без номера");
    }
}

#[cfg(test)]
mod launch_speed_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("millida-speed-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Answers the first `hung` connections with headers and a few bytes, then goes silent;
    /// every later connection gets the whole body.
    async fn serve_hanging(hung: usize, body: &'static [u8]) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/object", listener.local_addr().unwrap());
        let seen = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = seen.clone();
        tokio::spawn(async move {
            let mut n = 0usize;
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                n += 1;
                count.store(n, Ordering::Relaxed);
                let stall = n <= hung;
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = sock.read(&mut buf).await;
                    let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    let _ = sock.write_all(head.as_bytes()).await;
                    if stall {
                        let _ = sock.write_all(&body[..2]).await;
                        // Holds the connection open without sending: the shape of a hung socket.
                        tokio::time::sleep(Duration::from_secs(60)).await;
                    } else {
                        let _ = sock.write_all(body).await;
                        let _ = sock.shutdown().await;
                    }
                });
            }
        });
        (url, seen)
    }

    /// Answers after `head_delay`, then sends the whole body at once.
    async fn serve_late_head(head_delay: Duration, body: &'static [u8]) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/object", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = sock.read(&mut buf).await;
                    tokio::time::sleep(head_delay).await;
                    let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(body).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        url
    }

    #[tokio::test]
    async fn a_slow_first_answer_is_not_a_stall_but_silence_between_chunks_still_is() {
        let dir = tmp("late-head");
        let url = serve_late_head(Duration::from_millis(400), b"0123456789").await;
        let dest = dir.join("o.bin");
        // 250 ms between chunks, so 750 ms for the first answer: the answer at 400 ms is in time.
        STALL_TEST
            .scope(Duration::from_millis(250), fetch(&url, &dest, None, Some(10)))
            .await
            .expect("a server that opens the file late is slow, not hung");
        assert_eq!(std::fs::read(&dest).unwrap(), b"0123456789");
        assert!(header_limit() > stall_limit(), "the first answer gets more time than a pause between chunks");
    }

    #[tokio::test]
    async fn a_download_with_no_bytes_for_the_stall_limit_fails_with_a_named_timeout() {
        let dir = tmp("stall");
        let (url, seen) = serve_hanging(10, b"0123456789").await;
        let dest = dir.join("o.bin");
        let started = std::time::Instant::now();
        let err = STALL_TEST
            .scope(Duration::from_millis(250), fetch(&url, &dest, None, Some(10)))
            .await
            .expect_err("a silent connection is not a download");
        assert!(is_stall(&err), "the failure says it was silence: {err}");
        assert!(
            err.contains("timed out"),
            "the page's error classifier (errorKind.ts) reads this phrase as a timeout: {err}"
        );
        assert!(!dest.exists(), "nothing half-written is left under the final name");
        assert!(started.elapsed() < Duration::from_secs(8), "three quarter-second tries, not three minutes");
        assert_eq!(seen.load(Ordering::Relaxed), 3, "the same route is retried while it is the only one");
    }

    #[test]
    fn a_stalled_file_does_not_move_the_whole_source_behind_the_mirror() {
        let err = stalled("https://resources.download.minecraft.net/ab/abcd");
        assert!(is_stall(&err));
        assert!(
            !super::super::mirror::abandon_direct("https://resources.download.minecraft.net/ab/abcd", &err),
            "one hung file is not proof that the direct road is blocked; the mirror has its own rate limit"
        );
        assert!(!is_stall("https://x: нет связи (connection reset)"), "a refused connection is not a stall");
    }

    #[tokio::test]
    async fn the_tail_of_a_batch_is_saved_by_a_second_attempt() {
        let dir = tmp("hedge");
        let body: &'static [u8] = b"the last asset of the batch";
        let (url, seen) = serve_hanging(1, body).await;
        let dest = dir.join("a.bin");
        let sum = sha1_hex(body);
        let tail = super::super::hedge::Tail::new(1);
        let started = std::time::Instant::now();
        let got = STALL_TEST
            .scope(
                Duration::from_secs(20),
                download_hedged_after(&url, &dest, Some(Sum::Sha1(&sum)), Some(body.len() as u64), &tail, Duration::from_millis(150)),
            )
            .await;
        assert_eq!(got, Ok(()));
        assert_eq!(std::fs::read(&dest).unwrap(), body, "the duplicate's bytes are the ones published");
        assert!(started.elapsed() < Duration::from_secs(5), "no waiting for the hung connection");
        assert_eq!(seen.load(Ordering::Relaxed), 2, "exactly one duplicate was made");
        let leftovers = std::fs::read_dir(&dir).unwrap().flatten().filter(|e| e.file_name().to_string_lossy().ends_with(".part")).count();
        assert_eq!(leftovers, 0, "the dropped attempt cleans its temporary file");
    }

    #[tokio::test]
    async fn the_body_of_a_batch_is_not_duplicated() {
        let dir = tmp("nohedge");
        let body: &'static [u8] = b"plain file";
        let (url, seen) = serve_hanging(0, body).await;
        let dest = dir.join("b.bin");
        let sum = sha1_hex(body);
        let tail = super::super::hedge::Tail::new(100);
        let got = download_hedged_after(&url, &dest, Some(Sum::Sha1(&sum)), Some(body.len() as u64), &tail, Duration::ZERO).await;
        assert_eq!(got, Ok(()));
        assert_eq!(seen.load(Ordering::Relaxed), 1, "99 files to go: one request is enough");
    }

    #[tokio::test]
    async fn a_file_already_on_disk_costs_no_request() {
        let dir = tmp("have");
        let dest = dir.join("c.bin");
        std::fs::write(&dest, b"here").unwrap();
        let sum = sha1_hex(b"here");
        let tail = super::super::hedge::Tail::new(1);
        let got = download_hedged_after("http://127.0.0.1:1/never", &dest, Some(Sum::Sha1(&sum)), Some(4), &tail, Duration::ZERO).await;
        assert_eq!(got, Ok(()));
    }

    async fn wait_for(cache: &Path, want: &str) -> bool {
        for _ in 0..100 {
            if read_json_file(cache).is_ok_and(|v| v["v"] == want) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    }

    async fn serve_json(body: &'static str) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/list.json", listener.local_addr().unwrap());
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let mut buf = [0u8; 1024];
                let _ = sock.read(&mut buf).await;
                let reply = format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                let _ = sock.write_all(reply.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        url
    }

    #[tokio::test]
    async fn a_stale_list_is_used_at_once_and_refreshed_for_the_next_launch() {
        let dir = tmp("swr");
        let cache = dir.join("list.json");
        std::fs::write(&cache, br#"{"v":"old"}"#).unwrap();
        let url = serve_json(r#"{"v":"new"}"#).await;
        let got = get_json_swr(&url, &cache, Duration::ZERO).await.unwrap();
        assert_eq!(got["v"], "old", "the launch does not wait for the network");
        assert!(wait_for(&cache, "new").await, "the answer lands in the copy for next time");
    }

    #[tokio::test]
    async fn a_fresh_list_costs_no_request_and_a_missing_one_is_fetched() {
        let dir = tmp("swr2");
        let cache = dir.join("list.json");
        std::fs::write(&cache, br#"{"v":"cached"}"#).unwrap();
        let got = get_json_swr("http://127.0.0.1:1/unreachable.json", &cache, Duration::from_secs(600)).await.unwrap();
        assert_eq!(got["v"], "cached");
        let url = serve_json(r#"{"v":"first"}"#).await;
        let nothing = dir.join("none.json");
        let got = get_json_swr(&url, &nothing, Duration::from_secs(600)).await.unwrap();
        assert_eq!(got["v"], "first", "no copy at all: the request runs to its end");
        assert!(read_json_file(&nothing).is_ok(), "and is kept");
    }
}
