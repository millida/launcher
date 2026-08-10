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
    let build = || {
        let mut req = match m.as_str() {
            "GET" => client().get(url),
            "POST" => client().post(url),
            "PATCH" => client().patch(url),
            "PUT" => client().put(url),
            _ => client().delete(url),
        };
        if let Some(t) = token.as_ref() {
            req = req.header("Authorization", format!("Bearer {}", t));
        }
        if let Some(b) = body.as_ref() {
            req = req.json(b);
        }
        req
    };
    // a connect/timeout error means the request never reached the server, so
    // retrying is safe for any method
    let res = match build().send().await {
        Ok(r) => r,
        Err(e) if e.is_connect() || e.is_timeout() => {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            build().send().await.map_err(|e| net_err(&e))?
        }
        Err(e) => return Err(net_err(&e)),
    };
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        // 401 is returned as a code so callers know to refresh the session;
        // other failures carry the server's own explanation
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

pub const SEC_MILLIDA: &str = "millida";
pub const SEC_MILLIDA_REFRESH: &str = "millida-refresh";
/// Sessions issued before the refresh flow existed were stored under this name.
pub const SEC_MILLIDA_LEGACY: &str = "mc";
/// Tells the frontend that a failed refresh means the session is over.
pub const UNAUTHORIZED: &str = "unauthorized";

pub fn millida_token() -> Option<String> {
    crate::secrets::get(SEC_MILLIDA).or_else(|| crate::secrets::get(SEC_MILLIDA_LEGACY))
}

static REFRESH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

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
    match millida_refresh(&rt).await {
        Ok((access, next)) => {
            let _ = crate::secrets::set(SEC_MILLIDA, &access);
            let _ = crate::secrets::set(SEC_MILLIDA_REFRESH, &next);
            Refreshed::Token(access)
        }
        // Only 401/403 means the token is actually dead; other 4xx (429, or a
        // transient 400/404) must not log out a live session.
        Err(e) if e == "http 401" || e == "http 403" => Refreshed::Dead,
        Err(_) => Refreshed::Unavailable,
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
        .mime_str("application/zip")
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
    let text = res.text().await.unwrap_or_default();
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
    bytes: Vec<u8>,
    fields: Vec<(String, String)>,
) -> Result<Value, String> {
    let token = millida_token();
    let first = millida_upload(
        path.clone(),
        filename.clone(),
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
        Refreshed::Token(fresh) => millida_upload(path, filename, bytes, fields, Some(fresh)).await,
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

/// Device-code login. The issued pair goes straight into the vault, so the
/// webview only ever learns who signed in.
pub async fn millida_login_poll(device_code: String) -> Result<Value, String> {
    let body = serde_json::json!({ "deviceCode": device_code });
    let r = millida_api("/auth/launcher/poll".into(), "POST".into(), Some(body), None).await?;
    let status = r["status"].as_str().unwrap_or_default().to_string();
    if status != "ok" {
        return Ok(serde_json::json!({ "status": status }));
    }
    let access = r["accessToken"].as_str().unwrap_or_default();
    if access.is_empty() {
        return Err("в ответе нет accessToken".into());
    }
    let mut pairs = vec![(SEC_MILLIDA.to_string(), access.to_string())];
    if let Some(rt) = r["refreshToken"].as_str().filter(|s| !s.is_empty()) {
        pairs.push((SEC_MILLIDA_REFRESH.to_string(), rt.to_string()));
    }
    crate::secrets::set_many(pairs)?;
    Ok(serde_json::json!({ "status": "ok", "user": r["user"].clone() }))
}

#[cfg(test)]
mod tests {
    use super::{api_url, MILLIDA_API};

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
