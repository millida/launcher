// Millida hosting panel: server console stream, file download and upload.
// Talks only to api.millida.net with the Millida account token. The user picks the file to upload in a dialog.
// Live server console. The API serves an SSE stream without CORS headers, so it
// is consumed here and forwarded to the frontend as "host-console" events.
// Cancellation works by generation counter: only the newest stream stays active.
use crate::{engine, secrets};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static CONSOLE_GEN: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub async fn host_console_start(app: AppHandle, id: String) -> Result<(), String> {
    check_id(&id)?;
    // The Millida token comes from secrets and goes only to api.millida.net in the Authorization header.
    let token = secrets::get("millida")
        .or_else(|| secrets::get("mc"))
        .ok_or("нет токена Millida")?;
    let generation = CONSOLE_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let url = format!("{}/hosting/servers/{}/console/stream", engine::MILLIDA_API, id);
    tauri::async_runtime::spawn(async move {
        let req = engine::client()
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .header("Accept", "text/event-stream");
        let mut res = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit("host-console", format!("⚠ соединение: {}", e));
                return;
            }
        };
        if !res.status().is_success() {
            // Служба уже объяснила отказ словами («сервер переезжает», «ноды
            // недоступны»), и это ровно то, что человеку надо прочитать. Номер
            // кода не говорит ему ничего и отправляет в поддержку.
            let code = res.status().as_u16();
            let body = res.text().await.unwrap_or_default();
            let said = console_refusal(&body);
            let _ = app.emit(
                "host-console",
                match said {
                    Some(text) => format!("⚠ {}", text),
                    None => format!("⚠ консоль недоступна (код {})", code),
                },
            );
            return;
        }
        let mut buf = String::new();
        loop {
            if CONSOLE_GEN.load(Ordering::SeqCst) != generation {
                break;
            }
            match res.chunk().await {
                Ok(Some(bytes)) => {
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(pos) = buf.find('\n') {
                        let line: String = buf.drain(..=pos).collect();
                        let line = line.trim_end_matches(['\r', '\n']);
                        // SSE: only "data:" frames matter, ": ping" comments are skipped.
                        // The node replays the tail of the log before this
                        // marker, so the client can tell the history it already
                        // shows from what the server writes next.
                        if line.trim_start_matches(':').trim() == "replay-end" {
                            let _ = app.emit("host-console-replay-end", ());
                            continue;
                        }
                        let data = line
                            .strip_prefix("data: ")
                            .or_else(|| line.strip_prefix("data:"));
                        if let Some(d) = data {
                            if !d.is_empty() {
                                let _ = app.emit("host-console", d.to_string());
                            }
                        }
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn host_console_stop() {
    CONSOLE_GEN.fetch_add(1, Ordering::SeqCst);
}

// This is just the base64 alphabet. We have our own encoder for uploading a file in chunks inside JSON.
const B64: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[((n >> 18) & 63) as usize] as char);
        out.push(B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn token() -> Result<String, String> {
    secrets::get("millida")
        .or_else(|| secrets::get("mc"))
        .ok_or_else(|| "нет токена Millida".to_string())
}

/// id сервера подставляется в путь API: только [A-Za-z0-9_-], иначе «?», «#»,
/// «%2f» или «\\» увели бы запрос с токеном на другую ручку (аудит 24.09.2026, R7).
fn check_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if !ok {
        return Err("bad id".into());
    }
    Ok(())
}

/// The download URL is token-scoped and cannot be opened in a browser, so the
/// file is fetched here and saved to a user-picked path.
#[tauri::command]
pub async fn host_download(app: AppHandle, id: String, path: Option<String>) -> Result<Option<String>, String> {
    check_id(&id)?;
    let token = token()?;
    let Some(p) = path else {
        return download_world(&app, &id, &token).await;
    };
    let name = p.rsplit('/').next().unwrap_or("file").to_string();
    let url = format!(
        "{}/hosting/servers/{}/files/download?path={}",
        engine::MILLIDA_API,
        id,
        urlencoding_encode(&p)
    );
    let title = name.clone();
    let dest = engine::save_file(engine::dialog().set_file_name(&title).set_title(crate::engine::ui("Куда сохранить"))).await;
    let Some(dest) = dest else { return Ok(None) };

    let mut res = engine::client()
        // Downloads a server file from Millida hosting (api.millida.net, with the token) to the place the user picked.
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("http {}", res.status().as_u16()));
    }
    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    use std::io::Write;
    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

const WORLD_PROGRESS_EVENT: &str = "host-world-download";
const EXPORT_POLL: Duration = Duration::from_secs(2);
const CHUNK_START: u64 = 8 * 1024 * 1024;
const CHUNK_MAX: u64 = 64 * 1024 * 1024;
const CHUNK_MIN: u64 = 1024 * 1024;
const CHUNK_FAST: Duration = Duration::from_secs(10);
const CHUNK_SLOW: Duration = Duration::from_secs(40);
/// The shield in front of the API cuts any request at about two minutes, so a
/// chunk has to fit well inside that window at the measured speed.
const CHUNK_BUDGET: Duration = Duration::from_secs(60);
const CHUNK_ATTEMPTS: usize = 6;
const RETRY_DELAYS: [Duration; 3] = [Duration::from_secs(1), Duration::from_secs(3), Duration::from_secs(6)];
const WHOLE_BODY_PROGRESS_STEP: u64 = 1024 * 1024;

#[derive(Clone, serde::Serialize)]
struct WorldProgress {
    phase: &'static str,
    received: u64,
    total: u64,
}

#[derive(serde::Deserialize)]
struct WorldExportJob {
    state: String,
    #[serde(default)]
    error: String,
}

fn world_progress(app: &AppHandle, phase: &'static str, received: u64, total: u64) {
    let _ = app.emit(WORLD_PROGRESS_EVENT, WorldProgress { phase, received, total });
}

async fn refusal(res: reqwest::Response) -> String {
    let status = res.status().as_u16();
    let text = res.text().await.unwrap_or_default();
    engine::api_error_message(&text).unwrap_or_else(|| format!("http {}", status))
}

/// The node builds the world archive in a background job that outlives any
/// single request, so the download is export, poll until ready, then fetch the
/// archive in Range chunks that each fit under the shield's request ceiling.
async fn download_world(app: &AppHandle, id: &str, token: &str) -> Result<Option<String>, String> {
    let dest = engine::save_file(engine::dialog().set_file_name("world.tar.gz").set_title(crate::engine::ui("Куда сохранить"))).await;
    let Some(dest) = dest else { return Ok(None) };
    let base = format!("{}/hosting/servers/{}/world", engine::MILLIDA_API, id);

    world_progress(app, "archiving", 0, 0);
    let res = engine::client()
        // Asks Millida hosting (api.millida.net, with the token) to pack the server world into an archive on the node.
        .post(format!("{}/export", base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(refusal(res).await);
    }
    let started: WorldExportJob = res.json().await.map_err(|e| e.to_string())?;
    if started.state != "ready" {
        wait_world_export(&format!("{}/export/job", base), token).await?;
    }

    world_progress(app, "downloading", 0, 0);
    fetch_world(app, &format!("{}/download", base), token, &dest).await?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

/// "none" while waiting means the job ended without a file (the node agent was
/// restarted mid-build), so downloading would only hit "archive not built".
async fn wait_world_export(url: &str, token: &str) -> Result<(), String> {
    loop {
        tokio::time::sleep(EXPORT_POLL).await;
        let res = engine::client()
            // Polls Millida hosting (api.millida.net, with the token) for the world archive build state.
            .get(url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            return Err(refusal(res).await);
        }
        let job: WorldExportJob = res.json().await.map_err(|e| e.to_string())?;
        match job.state.as_str() {
            "ready" => return Ok(()),
            "failed" if job.error.trim().is_empty() => return Err("Архив мира не собрался — повтори попытку".into()),
            "failed" => return Err(job.error),
            "none" => return Err("Сборка архива прервалась — повтори попытку".into()),
            _ => {}
        }
    }
}

/// Removes the unfinished archive on every exit path; after the rename the
/// file is gone and the removal is a no-op.
struct PartFile(PathBuf);

impl Drop for PartFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_owned();
    name.push(".part");
    PathBuf::from(name)
}

enum Piece {
    Range { bytes: Vec<u8>, total: u64 },
    Whole(reqwest::Response),
}

async fn fetch_world(app: &AppHandle, url: &str, token: &str, dest: &Path) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let part = PartFile(part_path(dest));
    let mut file = tokio::fs::File::create(&part.0).await.map_err(|e| e.to_string())?;
    let mut offset = 0u64;
    let mut size = CHUNK_START;
    loop {
        let started = Instant::now();
        let (piece, used) = fetch_range(url, token, offset, size).await?;
        size = used;
        match piece {
            Piece::Whole(mut res) => {
                let total = res.content_length().unwrap_or(0);
                let mut shown = 0u64;
                while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
                    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                    offset += chunk.len() as u64;
                    if offset - shown >= WHOLE_BODY_PROGRESS_STEP {
                        shown = offset;
                        world_progress(app, "downloading", offset, total);
                    }
                }
                world_progress(app, "downloading", offset, offset);
                break;
            }
            Piece::Range { bytes, total } => {
                if bytes.is_empty() {
                    return Err("Сервер перестал отдавать архив — повтори попытку".into());
                }
                file.write_all(&bytes).await.map_err(|e| e.to_string())?;
                offset += bytes.len() as u64;
                world_progress(app, "downloading", offset, total);
                if offset >= total {
                    break;
                }
                size = tune_chunk(size, bytes.len() as u64, started.elapsed());
            }
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    file.sync_all().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&part.0, dest).await.map_err(|e| format!("{}: {}", dest.display(), e))
}

/// One chunk with retries. Only network faults, 429 and 5xx are retried, each
/// time with a smaller piece: a cut caused by the request ceiling repeats at
/// the same size forever. A refusal ("archive not built", no rights) goes up
/// at once with the service's own words.
async fn fetch_range(url: &str, token: &str, offset: u64, size: u64) -> Result<(Piece, u64), String> {
    let mut piece = size;
    let mut last = String::new();
    for attempt in 0..CHUNK_ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(RETRY_DELAYS[(attempt - 1).min(RETRY_DELAYS.len() - 1)]).await;
            piece = (piece / 2).max(CHUNK_MIN);
        }
        let sent = engine::client()
            // Downloads the packed world archive from Millida hosting (api.millida.net, with the token) one byte range at a time.
            .get(url)
            .header("Authorization", format!("Bearer {}", token))
            .header(reqwest::header::RANGE, format!("bytes={}-{}", offset, offset + piece - 1))
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send()
            .await;
        let res = match sent {
            Ok(res) => res,
            Err(e) => {
                last = e.to_string();
                continue;
            }
        };
        let status = res.status();
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            let total = res
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(|h| content_range_total(h, offset))
                .ok_or("Сервер отдал архив в непонятном виде — повтори попытку")?;
            match res.bytes().await {
                Ok(bytes) => return Ok((Piece::Range { bytes: bytes.to_vec(), total }, piece)),
                Err(e) => {
                    last = e.to_string();
                    continue;
                }
            }
        }
        if status.is_success() {
            return Ok((Piece::Whole(res), piece));
        }
        let code = status.as_u16();
        let said = refusal(res).await;
        if code < 500 && code != 429 {
            return Err(said);
        }
        last = said;
    }
    Err(last)
}

/// Total size from "bytes <start>-<end>/<total>", accepted only when the range
/// starts where the file so far ends: anything else would splice the archive.
fn content_range_total(header: &str, offset: u64) -> Option<u64> {
    let rest = header.trim().strip_prefix("bytes ")?;
    let (span, total) = rest.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let start: u64 = start.trim().parse().ok()?;
    let end: u64 = end.trim().parse().ok()?;
    let total: u64 = total.trim().parse().ok()?;
    if start != offset || end < start || end >= total {
        return None;
    }
    Some(total)
}

/// A fast chunk doubles the next one within what the link can carry inside
/// the budget, a slow one halves it.
fn tune_chunk(current: u64, got: u64, took: Duration) -> u64 {
    if got < current {
        return current;
    }
    if took <= CHUNK_FAST {
        let ms = (took.as_millis() as u64).max(1);
        let affordable = (got.saturating_mul(CHUNK_BUDGET.as_millis() as u64) / ms).max(CHUNK_MIN);
        return current.saturating_mul(2).min(CHUNK_MAX).min(affordable);
    }
    if took >= CHUNK_SLOW {
        return (current / 2).max(CHUNK_MIN);
    }
    current
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Chunked upload: the API limits body size, so the first chunk truncates the
/// target file and the rest are appended.
#[tauri::command]
pub async fn host_upload(id: String, dir: String) -> Result<Option<String>, String> {
    check_id(&id)?;
    let token = token()?;
    let picked = engine::pick_file(engine::dialog().set_title(crate::engine::ui("Файл для сервера"))).await;
    let Some(src) = picked else { return Ok(None) };
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("не удалось прочитать имя файла")?;
    let bytes = std::fs::read(&src).map_err(|e| e.to_string())?;
    if bytes.len() > 512 * 1024 * 1024 {
        return Err("файл больше 512 МБ".into());
    }
    let base = dir.trim_end_matches('/');
    let target = if base.is_empty() || base == "." { name.clone() } else { format!("{}/{}", base, name) };
    let url = format!(
        "{}/hosting/servers/{}/files/upload?path={}",
        engine::MILLIDA_API,
        id,
        urlencoding_encode(&target)
    );

    const CHUNK: usize = 6 * 1024 * 1024;
    let mut append = false;
    for chunk in bytes.chunks(CHUNK) {
        let res = engine::client()
            // Uploads a file the user picked to their server, in 6 MB chunks, base64 inside JSON.
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .json(&serde_json::json!({ "contentBase64": b64(chunk), "append": append }))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status().as_u16();
            let text = res.text().await.unwrap_or_default();
            return Err(engine::api_error_message(&text).unwrap_or_else(|| format!("http {}", status)));
        }
        append = true;
    }
    Ok(Some(target))
}

/// Что служба ответила об отказе. Тело приходит от сети, поэтому берём только
/// короткую человеческую строку и ничего не додумываем: длинный текст в консоли
/// - это чужой HTML страницы ошибки, а не объяснение.
fn console_refusal(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let said = value["message"].as_str()?.trim();
    if said.is_empty() || said.chars().count() > 200 {
        return None;
    }
    Some(said.to_string())
}

#[cfg(test)]
mod console_tests {
    use super::console_refusal;

    /// Вход → вердикт. «http 409» игрок читал как поломку лаунчера и шёл в
    /// поддержку, хотя служба в том же ответе писала, что сервер переезжает.
    #[test]
    fn server_id_is_a_plain_token() {
        for good in ["abc", "A-1_b", "0f3e2a"] {
            assert!(super::check_id(good).is_ok(), "{good}");
        }
        for bad in ["", "a/b", "..", "a?x=1", "a#b", "a%2fb", "a\\b", "a b", "а"] {
            assert!(super::check_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_refusal_is_shown_in_words_when_the_service_gave_any() {
        assert_eq!(
            console_refusal(r#"{"message":"Сервер переезжает на другую ноду","statusCode":409}"#).as_deref(),
            Some("Сервер переезжает на другую ноду"),
        );
        assert_eq!(console_refusal("").as_deref(), None, "пустое тело объяснением не считается");
        assert_eq!(console_refusal("<html>502</html>").as_deref(), None, "страница ошибки - не объяснение");
        assert_eq!(console_refusal(r#"{"message":""}"#).as_deref(), None);
        assert_eq!(
            console_refusal(r#"{"message":"Ноды хостинга сейчас недоступны — попробуй через минуту"}"#).as_deref(),
            Some("Ноды хостинга сейчас недоступны — попробуй через минуту"),
        );
        let long = "я".repeat(201);
        assert_eq!(
            console_refusal(&format!(r#"{{"message":"{}"}}"#, long)).as_deref(),
            None,
            "простыню в консоль не льём: там её никто не прочитает",
        );
    }
}

#[cfg(test)]
mod world_download_tests {
    use super::{content_range_total, part_path, tune_chunk, CHUNK_MAX, CHUNK_MIN};
    use std::time::Duration;

    #[test]
    fn content_range_is_trusted_only_where_the_file_ends() {
        let cases: [(&str, u64, Option<u64>, &str); 7] = [
            ("bytes 0-8388607/20000000", 0, Some(20_000_000), "first chunk of a larger archive"),
            ("bytes 8388608-19999999/20000000", 8_388_608, Some(20_000_000), "last chunk ends exactly at total - 1"),
            ("bytes 100-199/1000", 0, None, "a range that starts elsewhere would splice the archive"),
            ("bytes 0-1000/1000", 0, None, "an end past the total means a broken header"),
            ("bytes 0-99/*", 0, None, "an unknown total gives no point to stop at"),
            ("items 0-99/100", 0, None, "only byte ranges are understood"),
            ("", 0, None, "a missing header is not a range"),
        ];
        for (header, offset, want, why) in cases {
            assert_eq!(content_range_total(header, offset), want, "{header} at {offset}: {why}");
        }
    }

    #[test]
    fn chunk_size_follows_the_link_and_stays_in_bounds() {
        let mb = 1024 * 1024;
        let cases: [(u64, u64, u64, u64, &str); 6] = [
            (8 * mb, 8 * mb, 2_000, 16 * mb, "a fast full chunk doubles the next one"),
            (64 * mb, 64 * mb, 1_000, CHUNK_MAX, "never above the ceiling"),
            (8 * mb, 8 * mb, 9_000, 16 * mb, "doubling still fits the 60 s budget at this speed"),
            (8 * mb, 8 * mb, 45_000, 4 * mb, "a slow chunk halves the next one"),
            (CHUNK_MIN, CHUNK_MIN, 90_000, CHUNK_MIN, "never below the floor, or the download stalls"),
            (8 * mb, 3 * mb, 1_000, 8 * mb, "the last short chunk says nothing about the link"),
        ];
        for (current, got, ms, want, why) in cases {
            assert_eq!(tune_chunk(current, got, Duration::from_millis(ms)), want, "{why}");
        }
    }

    #[test]
    fn unfinished_archive_never_takes_the_picked_name() {
        let part = part_path(std::path::Path::new("C:/worlds/world.tar.gz"));
        assert_eq!(
            part.to_string_lossy(),
            "C:/worlds/world.tar.gz.part",
            "a cut download must not look like a finished world archive",
        );
    }
}
