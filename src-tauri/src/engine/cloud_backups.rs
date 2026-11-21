// Cloud world backups (PLUS): a world zip goes to storage through a one-time address our API hands out,
// and comes back as a separate world. The account token stays in the core; the storage address never
// comes from the webview, only from the API answer, and is checked before use.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::engine::*;

const BASE: &str = "/launcher/cloud-backups";
const MAX_ID: usize = 128;
const MAX_HEADERS: usize = 16;
const CHUNK: usize = 256 * 1024;
const EMIT_EVERY: Duration = Duration::from_millis(200);
const STORAGE_ERROR_BYTES: usize = 4 * 1024;
const PROGRESS_EVENT: &str = "cloud-backup-progress";

pub const CLOUD_TRANSFER_CANCELLED: &str = "Передача отменена";
const NEED_PLUS: &str = "Облачные бэкапы миров доступны с PLUS";
const NEED_LOGIN: &str = "Войди в аккаунт Millida, чтобы хранить миры в облаке";
const UNREACHABLE: &str = "Облако сейчас недоступно из твоей сети — попробуй позже или через другую сеть";
/// The API hands out presigned addresses of this storage and nothing else.
const STORAGE_SUFFIX: &str = ".r2.cloudflarestorage.com";

#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupItem {
    pub id: String,
    pub build: String,
    pub world: String,
    pub bytes: u64,
    pub sha256: String,
    pub created_at: String,
}

#[derive(Serialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupsStatus {
    pub signed_in: bool,
    pub plus: bool,
    pub quota_bytes: u64,
    pub used_bytes: u64,
    pub max_per_world: u32,
    pub max_file_bytes: u64,
    pub items: Vec<CloudBackupItem>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TransferProgress<'a> {
    key: &'a str,
    profile: &'a str,
    world: &'a str,
    /// "pack" | "hash" | "upload" | "download" | "restore"
    phase: &'a str,
    done: u64,
    total: u64,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn checked_id(id: &str) -> Result<&str, String> {
    if valid_id(id) {
        Ok(id)
    } else {
        Err("Неизвестная копия в облаке".into())
    }
}

fn parse_item(v: &Value) -> Option<CloudBackupItem> {
    let item: CloudBackupItem = serde_json::from_value(v.clone()).ok()?;
    let hex_ok = item.sha256.len() == 64 && item.sha256.chars().all(|c| c.is_ascii_hexdigit());
    (valid_id(&item.id) && hex_ok).then_some(item)
}

fn parse_status(v: &Value) -> CloudBackupsStatus {
    let num = |k: &str| v.get(k).and_then(Value::as_u64).unwrap_or(0);
    CloudBackupsStatus {
        signed_in: true,
        plus: v.get("plus").and_then(Value::as_bool).unwrap_or(false),
        quota_bytes: num("quotaBytes"),
        used_bytes: num("usedBytes"),
        max_per_world: u32::try_from(num("maxPerWorld")).unwrap_or(u32::MAX),
        max_file_bytes: num("maxFileBytes"),
        items: v.get("items").and_then(Value::as_array).map(|a| a.iter().filter_map(parse_item).collect()).unwrap_or_default(),
    }
}

/// The API answers refusals with a code; the text the player sees says what to do about it.
fn api_problem(e: String) -> String {
    if e.contains("PLUS_REQUIRED") || e == "http 403" {
        return NEED_PLUS.into();
    }
    if e.contains("QUOTA_EXCEEDED") {
        return "В облаке не хватает места — удали старые копии и повтори".into();
    }
    if e.contains("FILE_TOO_LARGE") || e == "http 413" {
        return "Мир слишком большой для облака".into();
    }
    if e.contains("SIZE_MISMATCH") {
        return "Файл изменился во время загрузки — повтори".into();
    }
    if e.contains("STORAGE_UNAVAILABLE") || e == "http 503" {
        return UNREACHABLE.into();
    }
    if e == UNAUTHORIZED {
        return "Сессия Millida закончилась — войди в аккаунт заново".into();
    }
    e
}

pub async fn cloud_backups_status() -> Result<CloudBackupsStatus, String> {
    if millida_token().is_none() {
        return Ok(CloudBackupsStatus::default());
    }
    let v = millida_api_auth(BASE.to_string(), "GET".into(), None).await.map_err(api_problem)?;
    Ok(parse_status(&v))
}

/// A one-time storage address from the API answer. It is never taken from the webview, and
/// still has to be https to the storage host: any other host, a literal address or a local
/// name would let a broken answer aim the transfer elsewhere.
fn transfer_url(raw: &str) -> Result<url::Url, String> {
    let broken = || "Сервис облака прислал неверный адрес хранилища".to_string();
    if raw.contains(['\r', '\n', '\0', ' ']) {
        return Err(broken());
    }
    let u = url::Url::parse(raw.trim()).map_err(|_| broken())?;
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return Err(broken());
    }
    let Some(url::Host::Domain(host)) = u.host() else { return Err(broken()) };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let account = host.strip_suffix(STORAGE_SUFFIX).unwrap_or_default();
    if account.is_empty() || !account.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(broken());
    }
    Ok(u)
}

/// Headers the presigned upload was signed with. Content-Length is part of the signature: it
/// must equal the file and is sent by the launcher itself; Host must match the checked address.
fn transfer_headers(v: Option<&Value>, bytes: u64) -> Result<reqwest::header::HeaderMap, String> {
    use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
    let broken = || "Сервис облака прислал неверные заголовки загрузки".to_string();
    let mut out = HeaderMap::new();
    let Some(v) = v.filter(|v| !v.is_null()) else { return Ok(out) };
    let map = v.as_object().ok_or_else(broken)?;
    if map.len() > MAX_HEADERS {
        return Err(broken());
    }
    for (k, val) in map {
        let name = HeaderName::from_bytes(k.as_bytes()).map_err(|_| broken())?;
        if matches!(name.as_str(), "host" | "transfer-encoding" | "connection" | "cookie") {
            return Err(broken());
        }
        let text = val.as_str().map(str::to_string).or_else(|| val.as_u64().map(|n| n.to_string())).ok_or_else(broken)?;
        if name == reqwest::header::CONTENT_LENGTH {
            if text.trim().parse::<u64>().ok() != Some(bytes) {
                return Err("Сервис облака ждёт файл другого размера — повтори".into());
            }
            continue;
        }
        out.insert(name, HeaderValue::from_str(&text).map_err(|_| broken())?);
    }
    Ok(out)
}

fn transfers() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static T: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    T.get_or_init(|| Mutex::new(HashMap::new()))
}

/// A transfer in progress, cancellable by its key; leaves the registry on every exit.
struct Transfer {
    key: String,
    cancel: Arc<AtomicBool>,
}

impl Transfer {
    fn start(key: String) -> Result<Transfer, String> {
        let mut m = transfers().lock().unwrap_or_else(|e| e.into_inner());
        if m.contains_key(&key) {
            return Err("Эта копия уже передаётся — дождись конца".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        m.insert(key.clone(), cancel.clone());
        Ok(Transfer { key, cancel })
    }

    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            return Err(CLOUD_TRANSFER_CANCELLED.into());
        }
        Ok(())
    }
}

impl Drop for Transfer {
    fn drop(&mut self) {
        transfers().lock().unwrap_or_else(|e| e.into_inner()).remove(&self.key);
    }
}

pub fn cloud_backup_cancel(key: &str) -> bool {
    match transfers().lock().unwrap_or_else(|e| e.into_inner()).get(key) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            true
        }
        None => false,
    }
}

/// Progress for the worlds tab, at most every `EMIT_EVERY` and always at the end of a phase.
#[derive(Clone)]
struct Reporter {
    app: AppHandle,
    key: String,
    profile: String,
    world: String,
    last: Arc<Mutex<Option<Instant>>>,
}

impl Reporter {
    fn new(app: &AppHandle, key: &str, profile: &str, world: &str) -> Reporter {
        Reporter {
            app: app.clone(),
            key: key.into(),
            profile: profile.into(),
            world: world.into(),
            last: Arc::new(Mutex::new(None)),
        }
    }

    fn emit(&self, phase: &str, done: u64, total: u64) {
        {
            let mut last = self.last.lock().unwrap_or_else(|e| e.into_inner());
            let due = done >= total || last.is_none_or(|t| t.elapsed() >= EMIT_EVERY);
            if !due {
                return;
            }
            *last = Some(Instant::now());
        }
        let _ = self.app.emit(
            PROGRESS_EVENT,
            TransferProgress { key: &self.key, profile: &self.profile, world: &self.world, phase, done, total },
        );
    }
}

fn hash_file(path: &Path, cancel: &AtomicBool, report: &Reporter) -> Result<(u64, String), String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path).map_err(|e| format!("Не удалось открыть бэкап: {}", e))?;
    let total = f.metadata().map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut done = 0u64;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(CLOUD_TRANSFER_CANCELLED.into());
        }
        let n = f.read(&mut buf).map_err(|e| format!("Не удалось прочитать бэкап: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(buf.get(..n).unwrap_or_default());
        done += n as u64;
        report.emit("hash", done, total);
    }
    Ok((done, hex_lower(&hasher.finalize())))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Cloudflare is not reachable from every network; the cause stays in the log.
fn unreachable(e: &reqwest::Error) -> String {
    eprintln!("[cloud-backups] storage unreachable: {}", net_err(e));
    UNREACHABLE.into()
}

fn gb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

async fn storage_refusal(res: reqwest::Response) -> String {
    let status = res.status().as_u16();
    let body = read_capped(res, STORAGE_ERROR_BYTES).await.unwrap_or_default();
    eprintln!("[cloud-backups] storage answered {status}: {}", String::from_utf8_lossy(&body));
    format!("Хранилище не приняло передачу (код {}) — повтори", status)
}

async fn put_file(path: &Path, url: url::Url, headers: reqwest::header::HeaderMap, bytes: u64, t: &Transfer, report: &Reporter) -> Result<(), String> {
    use tokio::io::AsyncReadExt;
    let file = tokio::fs::File::open(path).await.map_err(|e| format!("Не удалось открыть бэкап: {}", e))?;
    let cancel = t.cancel.clone();
    let report = report.clone();
    // Read in pieces as the request goes out: a 2 GB world never sits in memory.
    let stream = futures::stream::unfold((file, 0u64, false), move |(mut file, sent, over)| {
        let cancel = cancel.clone();
        let report = report.clone();
        async move {
            if over {
                return None;
            }
            if cancel.load(Ordering::Relaxed) {
                return Some((Err(std::io::Error::other(CLOUD_TRANSFER_CANCELLED)), (file, sent, true)));
            }
            let mut buf = vec![0u8; CHUNK];
            match file.read(&mut buf).await {
                Ok(0) => None,
                Ok(n) => {
                    buf.truncate(n);
                    let sent = sent + n as u64;
                    report.emit("upload", sent, bytes);
                    Some((Ok(buf), (file, sent, false)))
                }
                Err(e) => Some((Err(e), (file, sent, true))),
            }
        }
    });
    let res = client()
        .put(url.as_str())
        .headers(headers)
        .header(reqwest::header::CONTENT_LENGTH, bytes.to_string())
        .body(reqwest::Body::wrap_stream(stream))
        .send()
        .await;
    t.check()?;
    let res = res.map_err(|e| unreachable(&e))?;
    if !res.status().is_success() {
        return Err(storage_refusal(res).await);
    }
    Ok(())
}

async fn upload_path(app: &AppHandle, t: &Transfer, profile: &str, world: &str, path: &Path) -> Result<CloudBackupItem, String> {
    let report = Reporter::new(app, &t.key, profile, world);
    let status = cloud_backups_status().await?;
    if !status.signed_in {
        return Err(NEED_LOGIN.into());
    }
    if !status.plus {
        return Err(NEED_PLUS.into());
    }
    let (p, cancel, r) = (path.to_path_buf(), t.cancel.clone(), report.clone());
    let (bytes, sha256) = tauri::async_runtime::spawn_blocking(move || hash_file(&p, &cancel, &r))
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
    if status.max_file_bytes > 0 && bytes > status.max_file_bytes {
        return Err(format!("Мир весит {} ГБ, а в облако помещается файл до {} ГБ", gb(bytes), gb(status.max_file_bytes)));
    }
    t.check()?;
    let body = serde_json::json!({ "build": profile, "world": world, "bytes": bytes, "sha256": sha256 });
    let slot = millida_api_auth(format!("{}/uploads", BASE), "POST".into(), Some(body)).await.map_err(api_problem)?;
    let id = slot.get("id").and_then(Value::as_str).filter(|id| valid_id(id)).ok_or("Сервис облака прислал неполный ответ")?.to_string();
    let sent = match (transfer_url(slot.get("uploadUrl").and_then(Value::as_str).unwrap_or_default()), transfer_headers(slot.get("uploadHeaders"), bytes)) {
        (Ok(url), Ok(headers)) => put_file(path, url, headers, bytes, t, &report).await,
        (Err(e), _) | (_, Err(e)) => Err(e),
    };
    if let Err(e) = sent {
        // The reserved slot holds quota until the server expires it; freeing it now is a courtesy, its failure changes nothing.
        let _ = millida_api_auth(format!("{}/{}", BASE, id), "DELETE".into(), None).await;
        return Err(e);
    }
    let done = millida_api_auth(format!("{}/{}/complete", BASE, id), "POST".into(), None).await.map_err(api_problem)?;
    parse_item(&done).ok_or_else(|| "Сервис облака не подтвердил копию — обнови список".to_string())
}

/// Uploads an existing zip of `world` from the build's backups folder.
pub(crate) async fn upload_world_zip(app: &AppHandle, profile: &str, world: &str, path: PathBuf) -> Result<CloudBackupItem, String> {
    let t = Transfer::start(format!("up:{}/{}", profile, world))?;
    upload_path(app, &t, profile, world, &path).await
}

/// "В облако": `backup` names a zip already in the list, otherwise the world is zipped first.
pub async fn cloud_backup_upload(app: AppHandle, profile: String, folder: String, backup: Option<String>) -> Result<CloudBackupItem, String> {
    let world = safe_file_name(&folder)?;
    let t = Transfer::start(format!("up:{}/{}", profile, world))?;
    let path = match backup {
        Some(name) => {
            let name = safe_file_name(&name)?;
            if !name.ends_with(".zip") || !name.starts_with(&format!("{}-", world)) {
                return Err("Это не бэкап этого мира".into());
            }
            let path = safe_child(&backups_dir(&profile), &name)?;
            if !path.is_file() {
                return Err("Бэкап не найден".into());
            }
            path
        }
        None => {
            Reporter::new(&app, &t.key, &profile, &world).emit("pack", 0, 1);
            let (p, w) = (profile.clone(), world.clone());
            let made = tauri::async_runtime::spawn_blocking(move || backup_world(p, w))
                .await
                .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
            PathBuf::from(made)
        }
    };
    upload_path(&app, &t, &profile, &world, &path).await
}

/// Removes the downloaded file on every exit, including the error paths.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        if self.0.exists() {
            if let Err(e) = std::fs::remove_file(&self.0) {
                eprintln!("[cloud-backups] temporary {} stays: {e}", self.0.display());
            }
        }
    }
}

async fn download_checked(url: url::Url, item: &CloudBackupItem, dest: &Path, t: &Transfer, report: &Reporter) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let res = client().get(url.as_str()).send().await.map_err(|e| unreachable(&e))?;
    transfer_url(res.url().as_str())?;
    if !res.status().is_success() {
        return Err(storage_refusal(res).await);
    }
    if res.content_length().is_some_and(|n| n != item.bytes) {
        return Err("Файл в облаке не совпадает с копией — удали её и загрузи заново".into());
    }
    if let Some(dir) = dest.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| format!("Не удалось создать временную папку: {}", e))?;
    }
    let mut out = tokio::fs::File::create(dest).await.map_err(|e| format!("Не удалось записать файл: {}", e))?;
    let mut hasher = Sha256::new();
    let mut got = 0u64;
    let mut body = res.bytes_stream();
    while let Some(chunk) = body.next().await {
        t.check()?;
        let chunk = chunk.map_err(|e| unreachable(&e))?;
        got += chunk.len() as u64;
        if got > item.bytes {
            return Err("Файл в облаке не совпадает с копией — удали её и загрузи заново".into());
        }
        hasher.update(&chunk);
        out.write_all(&chunk).await.map_err(|e| format!("Не удалось записать файл: {}", e))?;
        report.emit("download", got, item.bytes);
    }
    out.flush().await.map_err(|e| format!("Не удалось записать файл: {}", e))?;
    if got != item.bytes || hex_lower(&hasher.finalize()) != item.sha256.to_ascii_lowercase() {
        return Err("Копия скачалась повреждённой — повтори".into());
    }
    Ok(())
}

/// "дд.мм" of an ISO timestamp, empty when the text is not one.
fn day_month(iso: &str) -> String {
    let digits = |r: std::ops::Range<usize>| iso.get(r).filter(|s| s.chars().all(|c| c.is_ascii_digit())).map(str::to_string);
    match (iso.get(4..5), iso.get(7..8), digits(5..7), digits(8..10)) {
        (Some("-"), Some("-"), Some(mm), Some(dd)) => format!("{}.{}", dd, mm),
        _ => String::new(),
    }
}

fn cloud_world_name(name: &str, created_at: &str) -> String {
    match day_month(created_at) {
        d if d.is_empty() => format!("{} (облако)", name),
        d => format!("{} (облако {})", name, d),
    }
}

/// "Восстановить на этот ПК": the copy becomes a NEW world in `profile`, never over an existing one.
pub async fn cloud_backup_restore(app: AppHandle, profile: String, id: String) -> Result<WorldInfo, String> {
    let id = checked_id(&id)?.to_string();
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let t = Transfer::start(format!("down:{}", id))?;
    let status = cloud_backups_status().await?;
    if !status.signed_in {
        return Err(NEED_LOGIN.into());
    }
    let item = status.items.into_iter().find(|i| i.id == id).ok_or("Копии уже нет в облаке — обнови список")?;
    let report = Reporter::new(&app, &t.key, &profile, &item.world);
    let link = millida_api_auth(format!("{}/{}/download", BASE, id), "GET".into(), None).await.map_err(api_problem)?;
    let url = transfer_url(link.get("url").and_then(Value::as_str).unwrap_or_default())?;
    let tmp = TempFile(data_dir().join("tmp").join("cloud-worlds").join(format!("{}.zip", id)));
    download_checked(url, &item, &tmp.0, &t, &report).await?;
    t.check()?;
    report.emit("restore", 0, 1);
    let archive = tmp.0.clone();
    let created = item.created_at.clone();
    let restored = tauri::async_runtime::spawn_blocking(move || restore_archive_as(&profile, &archive, |name| cloud_world_name(name, &created)))
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))?;
    drop(tmp);
    restored
}

pub async fn cloud_backup_delete(id: String) -> Result<(), String> {
    let id = checked_id(&id)?;
    millida_api_auth(format!("{}/{}", BASE, id), "DELETE".into(), None).await.map_err(api_problem)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_named_https_storage_is_reachable() {
        let cases = [
            ("https://acc1.r2.cloudflarestorage.com/millida-catalog/launcher-world-backups/k?X-Amz-Signature=1", true, "a presigned R2 address"),
            ("https://api.millida.net/v2/launcher/cloud-backups/x/blob", false, "only the storage host is opened, not any host the API names"),
            ("https://r2.cloudflarestorage.com/b/k", false, "the bare suffix is not an account host"),
            ("https://evil.com/.r2.cloudflarestorage.com/b", false, "the suffix must be the host, not the path"),
            ("https://acc.r2.cloudflarestorage.com.evil.com/b", false, "a lookalike host that only contains the suffix"),
            ("https://a.b.r2.cloudflarestorage.com/b", false, "a nested name is not an account host"),
            ("http://acc.r2.cloudflarestorage.com/b/k", false, "plain http would leak the world on the way"),
            ("https://127.0.0.1/upload", false, "a loopback literal is the player's own machine"),
            ("https://[::1]/upload", false, "an IPv6 literal as well"),
            ("https://192.168.0.10/upload", false, "a LAN literal"),
            ("https://localhost/upload", false, "a local name"),
            ("https://nas.local/upload", false, "an mDNS name of the home network"),
            ("https://intranet/upload", false, "a single-label name resolves inside a network"),
            ("https://user:pw@acc.r2.cloudflarestorage.com/x", false, "credentials in the address are not ours to send"),
            ("file:///C:/Windows/win.ini", false, "not a network address at all"),
            ("https://acc.r2.cloudflarestorage.com/a\nb", false, "a header-splitting attempt"),
        ];
        for (raw, ok, why) in cases {
            assert_eq!(transfer_url(raw).is_ok(), ok, "{raw}: {why}");
        }
    }

    #[test]
    fn storage_headers_cannot_change_the_framing() {
        let fine = serde_json::json!({ "Content-Type": "application/zip", "Content-Length": "5" });
        assert_eq!(
            transfer_headers(Some(&fine), 5).map(|h| h.len()),
            Ok(1),
            "Content-Length is checked against the file and then sent by the launcher itself, never twice",
        );
        let numeric = serde_json::json!({ "Content-Length": 5 });
        assert!(transfer_headers(Some(&numeric), 5).is_ok(), "a number is a valid length too");
        assert!(
            transfer_headers(Some(&fine), 6).is_err(),
            "a signed length that differs from the file makes storage refuse the upload after the whole transfer",
        );
        assert!(transfer_headers(None, 5).is_ok_and(|h| h.is_empty()), "no headers is a normal answer");
        for bad in ["Host", "Transfer-Encoding", "Cookie"] {
            let mut map = serde_json::Map::new();
            map.insert(bad.to_string(), Value::from("x"));
            let v = Value::Object(map);
            assert!(transfer_headers(Some(&v), 5).is_err(), "{bad} must stay under the launcher's control");
        }
        let not_text = serde_json::json!({ "x-a": true });
        assert!(transfer_headers(Some(&not_text), 5).is_err(), "a header value is text or a number");
    }

    #[test]
    fn restored_world_is_named_by_the_cloud_date() {
        assert_eq!(cloud_world_name("Мой мир", "2026-11-21T10:00:00.000Z"), "Мой мир (облако 21.11)");
        assert_eq!(cloud_world_name("Мой мир", "garbage"), "Мой мир (облако)", "a broken date never breaks the restore");
        assert_eq!(day_month("2026-1"), "", "a cut timestamp is not sliced past its end");
    }

    #[test]
    fn status_drops_items_it_cannot_trust() {
        let v = serde_json::json!({
            "plus": true, "quotaBytes": 10u64 << 30, "usedBytes": 5, "maxPerWorld": 3, "maxFileBytes": 2u64 << 30,
            "items": [
                { "id": "a1", "build": "B", "world": "W", "bytes": 5, "sha256": "a".repeat(64), "createdAt": "2026-11-21T00:00:00Z" },
                { "id": "../x", "build": "B", "world": "W", "bytes": 5, "sha256": "a".repeat(64), "createdAt": "" },
                { "id": "a2", "build": "B", "world": "W", "bytes": 5, "sha256": "short", "createdAt": "" }
            ]
        });
        let s = parse_status(&v);
        assert!(s.plus && s.signed_in);
        assert_eq!(s.items.len(), 1, "an id that is not a plain token would travel into an API path, a bad digest cannot be verified");
        assert_eq!(s.max_per_world, 3);
    }

    #[test]
    fn refusals_read_as_what_to_do() {
        assert_eq!(api_problem("http 403".into()), NEED_PLUS);
        assert!(api_problem("QUOTA_EXCEEDED".into()).contains("места"));
        assert_eq!(api_problem("http 503".into()), UNREACHABLE, "storage down reads as the network, with a retry");
        assert_eq!(api_problem("нет связи".into()), "нет связи", "other errors keep their diagnosis");
    }
}
