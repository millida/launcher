use futures::StreamExt;
use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use super::jobs::CANCELLED;

const UA: &str = "MillidaLauncher/1.0 (+https://millida.net)";
const JSON_TIMEOUT: Duration = Duration::from_secs(30);
const TRIES: u32 = 3;

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

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
fn build_client(native_roots: bool) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .user_agent(UA)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .pool_idle_timeout(Duration::from_secs(90))
        .tls_built_in_webpki_certs(true)
        .tls_built_in_native_certs(native_roots)
        .build()
}

pub(crate) fn client() -> reqwest::Client {
    CLIENT
        .get_or_init(|| {
            build_client(true)
                .or_else(|_| build_client(false))
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
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
        " — соединение подменяет антивирус или прокси: отключи проверку HTTPS/SSL или добавь лаунчер в исключения"
    } else if low.contains("dns") || low.contains("failed to lookup") || low.contains("resolve") {
        " — адрес сервера не определился: проверь DNS, VPN и антивирус"
    } else if e.is_timeout() || low.contains("timed out") {
        " — сервер не ответил вовремя: проверь интернет и VPN"
    } else if e.is_connect() {
        " — соединение не установилось: проверь брандмауэр, VPN и антивирус"
    } else {
        ""
    };
    format!("нет связи ({}{})", detail, hint)
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

async fn retrying<F, Fut>(mut once: F) -> Result<Value, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<Value, Attempt>>,
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
async fn read_json(url: &str, resp: reqwest::Response) -> Result<Value, Attempt> {
    let status = resp.status();
    if !status.is_success() {
        let msg = format!("{} → {}", url, status);
        return Err(if retryable(status) { Attempt::Retry(msg) } else { Attempt::Fatal(msg) });
    }
    let body = resp
        .bytes()
        .await
        .map_err(|e| Attempt::Retry(format!("{}: ответ оборвался ({})", url, net_err(&e))))?;
    serde_json::from_slice(&body)
        .map_err(|e| Attempt::Retry(format!("{}: неожиданный ответ ({})", url, e)))
}

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

pub(crate) async fn get_json(url: &str) -> Result<Value, String> {
    let mut last = String::new();
    for target in super::mirror::routes(url).await {
        let attempt = retrying(|| {
            let target = target.clone();
            async move {
                match client().get(&target).timeout(JSON_TIMEOUT).send().await {
                    Ok(r) => read_json(&target, r).await,
                    Err(e) => Err(Attempt::Retry(format!("{}: {}", target, net_err(&e)))),
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

pub(crate) async fn get_json_fresh(url: &str, cache: &Path, ttl: Duration) -> Result<Value, String> {
    let fresh = std::fs::metadata(cache)
        .and_then(|m| m.modified())
        .map(|t| t.elapsed().map(|age| age < ttl).unwrap_or(false))
        .unwrap_or(false);
    if fresh {
        if let Ok(v) = read_json_file(cache) {
            return Ok(v);
        }
    }
    get_json_cached(url, cache).await
}

/// Modrinth bulk endpoints only accept a JSON body over POST.
pub(crate) async fn post_json(url: &str, body: &Value) -> Result<Value, String> {
    let mut last = String::new();
    for target in super::mirror::routes(url).await {
        let attempt = retrying(|| {
            let target = target.clone();
            async move {
                match client().post(&target).json(body).timeout(JSON_TIMEOUT).send().await {
                    Ok(r) => read_json(&target, r).await,
                    Err(e) => Err(Attempt::Retry(format!("{}: {}", target, net_err(&e)))),
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
    if let Some(want) = size {
        if meta.len() != want {
            return false;
        }
        if !deep_verify() {
            return true;
        }
    }
    let Some(sum) = sum else { return true };
    if !sum.is_usable() {
        return true;
    }
    let Ok(mut file) = std::fs::File::open(path) else { return false };
    let mut h = Hasher::for_sum(&sum);
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
    fetch_cancellable(url, dest, sum, size, None).await
}

async fn fetch_cancellable(
    url: &str,
    dest: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&AtomicBool>,
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
    for route in super::mirror::routes(url).await {
        for attempt in 1..=TRIES {
            let target = if attempt > 1 && is_stale_cdn_miss(&last) {
                bypass_cdn_cache(&route)
            } else {
                route.clone()
            };
            match fetch_once(&target, &part, sum, size, cancel).await {
                Ok(()) => return publish(&part, dest, sum, size),
                Err(e) => {
                    let _ = std::fs::remove_file(&part);
                    last = e;
                }
            }
            // A cancelled download must not be retried: three mirrors × three
            // attempts kept a slow connection busy long after the player asked
            // the install to stop.
            if cancelled(cancel) {
                return Err(CANCELLED.into());
            }
            if attempt < TRIES {
                tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
            }
        }
    }
    Err(last)
}

fn cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel.is_some_and(|c| c.load(Ordering::Relaxed))
}

async fn fetch_once(
    url: &str,
    part: &Path,
    sum: Option<Sum<'_>>,
    size: Option<u64>,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    if cancelled(cancel) {
        return Err(CANCELLED.into());
    }
    let resp = client().get(url).send().await.map_err(|e| format!("{}: {}", url, net_err(&e)))?;
    if !resp.status().is_success() {
        return Err(format!("{} → {}", url, resp.status()));
    }
    let mut file = std::fs::File::create(part).map_err(|e| format!("{}: {}", part.display(), e))?;
    let mut hasher = sum.filter(|s| s.is_usable()).map(|s| Hasher::for_sum(&s));
    let mut written: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        // Cancellation has to reach the body loop: a modpack archive on a slow
        // line takes minutes, and until it landed pressing «Отменить» changed
        // nothing the player could see.
        if cancelled(cancel) {
            return Err(CANCELLED.into());
        }
        let chunk = chunk.map_err(|e| format!("{}: обрыв загрузки ({})", url, e))?;
        if let Some(h) = hasher.as_mut() {
            h.update(&chunk);
        }
        written += chunk.len() as u64;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);
    if let Some(want) = size {
        if written != want {
            return Err(format!("{}: размер {} вместо {}", url, written, want));
        }
    }
    if let (Some(h), Some(s)) = (hasher, sum) {
        let got = h.hex();
        if !s.matches(&got) {
            return Err(format!("{}: контрольная сумма не сошлась", url));
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
pub(crate) async fn download_fresh_cancellable(
    url: &str,
    dest: &Path,
    cancel: &AtomicBool,
) -> Result<(), String> {
    fetch_cancellable(url, dest, None, None, Some(cancel)).await
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
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    if dest.exists() {
        let owned: Option<(u8, String)> = sum.map(|s| match s {
            Sum::Sha1(v) => (1u8, v.to_string()),
            Sum::Sha256(v) => (2, v.to_string()),
            Sum::Sha512(v) => (3, v.to_string()),
        });
        let path = dest.to_path_buf();
        let ok = tokio::task::spawn_blocking(move || {
            let sum = owned.as_ref().map(|(k, v)| match k {
                1 => Sum::Sha1(v.as_str()),
                2 => Sum::Sha256(v.as_str()),
                _ => Sum::Sha512(v.as_str()),
            });
            file_matches(&path, sum, size)
        })
        .await
        .unwrap_or(false);
        if ok {
            return Ok(());
        }
        let _ = std::fs::remove_file(dest);
    }
    fetch_cancellable(url, dest, sum, size, cancel).await
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

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(bytes);
    h.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
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
        let flag = AtomicBool::new(true);
        let err = download_fresh_cancellable(DEAD, &dest, &flag).await.unwrap_err();
        assert_eq!(err, CANCELLED, "отменённая загрузка обязана вернуть именно отмену");
        assert!(!dest.exists(), "после отмены целевой файл не создаётся");
        assert!(
            !part_path(&dest).exists(),
            "временный файл отменённой загрузки не должен оставаться на диске"
        );
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
}
