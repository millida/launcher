// Live server console. The API serves an SSE stream without CORS headers, so it
// is consumed here and forwarded to the frontend as "host-console" events.
// Cancellation works by generation counter: only the newest stream stays active.
use crate::{engine, secrets};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

static CONSOLE_GEN: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub async fn host_console_start(app: AppHandle, id: String) -> Result<(), String> {
    check_id(&id)?;
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
pub async fn host_download(id: String, path: Option<String>) -> Result<Option<String>, String> {
    check_id(&id)?;
    let token = token()?;
    let name = match &path {
        Some(p) => p.rsplit('/').next().unwrap_or("file").to_string(),
        None => "world.tar.gz".to_string(),
    };
    let url = match &path {
        Some(p) => format!(
            "{}/hosting/servers/{}/files/download?path={}",
            engine::MILLIDA_API,
            id,
            urlencoding_encode(p)
        ),
        None => format!("{}/hosting/servers/{}/world/download", engine::MILLIDA_API, id),
    };
    let title = name.clone();
    let dest = engine::save_file(engine::dialog().set_file_name(&title).set_title("Куда сохранить")).await;
    let Some(dest) = dest else { return Ok(None) };

    let mut res = engine::client()
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
    let picked = engine::pick_file(engine::dialog().set_title("Файл для сервера")).await;
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
