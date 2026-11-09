// "Share log": on the player's button, sends the chosen log to logs.millida.net and returns the public link.
// Before sending, the home folder and the --accessToken value are cut out of the text. Only .log and .txt from logs/ and crash-reports/ of the modpack are taken.
use crate::engine::*;
use serde_json::Value;

/// Only text files under logs/ or crash-reports/ count as shareable logs.
pub(crate) fn is_log_path(name: &str) -> bool {
    let n = name.replace('\\', "/");
    let known_dir = n.starts_with("logs/") || n.starts_with("crash-reports/");
    let known_ext = n.ends_with(".log") || n.ends_with(".txt");
    known_dir && known_ext
}

/// The text is matched by the interface, which then tries the next log: keep it in step with src/lib/crashSupport.ts.
pub(crate) const EMPTY_LOG: &str = "Лог пустой";

/// The service keeps at most 2 000 000 characters and cuts the head; staying under it
/// in bytes means the tail, where the crash is, always arrives as the launcher sent it.
pub(crate) const SHARE_LOG_MAX_BYTES: usize = 1_900_000;

const SHARE_ENDPOINT: &str = "https://logs.millida.net/v2/logs";
const SHARE_HOST: &str = "logs.millida.net";
const SHARE_SOURCE: &str = "millida-launcher";
const SHARE_REJECTED: &str = "logs.millida.net отклонил лог";
const SHARE_TOO_OFTEN: &str = "Слишком часто — попробуй позже";

pub async fn share_log(profile: String, name: String) -> Result<String, String> {
    // path arrives over IPC and is uploaded publicly, so confine it to the profile
    let path = safe_join(&profile_dir(&profile), &name)?;
    if !is_log_path(&name) { return Err("Делиться можно только логами сборки".into()); }
    let mut content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.len() > SHARE_LOG_MAX_BYTES {
        let cut = content.len() - SHARE_LOG_MAX_BYTES;
        let start = (cut..content.len()).find(|i| content.is_char_boundary(*i)).unwrap_or(content.len());
        content = content[start..].to_string();
    }
    // The service rejects an empty text with 400, and the interface needs EMPTY_LOG to try the next log.
    if content.trim().is_empty() { return Err(EMPTY_LOG.into()); }
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned());
    let content = redact_log(&content, home.as_deref());
    // The log becomes a public page, so it is sent only after the button click.
    let res = client().post(SHARE_ENDPOINT)
        .json(&serde_json::json!({ "content": content, "source": SHARE_SOURCE }))
        .send().await.map_err(|e| net_err(&e))?;
    let status = res.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS { return Err(SHARE_TOO_OFTEN.into()); }
    if !status.is_success() {
        // 413 and proxy errors come as HTML, so a body that is not JSON only loses the server's wording.
        let body: Value = res.json().await.unwrap_or(Value::Null);
        return Err(rejection_message(&body).unwrap_or_else(|| SHARE_REJECTED.to_string()));
    }
    let body: Value = res.json().await.map_err(|e| net_err(&e))?;
    share_url(&body).ok_or_else(|| SHARE_REJECTED.to_string())
}

/// The link is opened in the browser, so only an https page on the service itself is accepted.
fn share_url(body: &Value) -> Option<String> {
    let raw = body["url"].as_str()?;
    let url = url::Url::parse(raw).ok()?;
    let trusted = url.scheme() == "https" && url.host_str() == Some(SHARE_HOST) && url.port().is_none();
    trusted.then(|| url.to_string())
}

/// Validation errors carry "message" as a string or as a list of strings.
fn rejection_message(body: &Value) -> Option<String> {
    let text = match &body["message"] {
        Value::String(s) => s.trim().to_string(),
        Value::Array(items) => items.iter().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("; "),
        _ => return None,
    };
    (!text.is_empty()).then_some(text)
}

/// Лог уходит на публичную страницу logs.millida.net: домашняя папка (в ней имя пользователя)
/// заменяется на «~», а значение --accessToken вырезается (аудит 24.09.2026, R8).
pub(crate) fn redact_log(content: &str, home: Option<&str>) -> String {
    let mut out = content.to_string();
    if let Some(h) = home.map(|h| h.trim_end_matches(['/', '\\'])).filter(|h| h.len() > 1) {
        let mut variants = vec![h.to_string(), h.replace('\\', "/"), h.replace('/', "\\")];
        variants.dedup();
        for v in variants {
            out = out.replace(&v, "~");
        }
    }
    let out = hide_flag_value(&out, "--accessToken");
    let out = mask_user_dirs(&out);
    mask_ip_addresses(&out)
}

const USER_DIR_MARKERS: [&str; 4] = ["\\Users\\", "/Users/", "/home/", "\\Documents and Settings\\"];

/// A log can mention another account's folder or a path the home check missed
/// (a second drive, a junction); the segment after the marker is the OS username.
fn mask_user_dirs(text: &str) -> String {
    let mut out = text.to_string();
    for marker in USER_DIR_MARKERS {
        let mut rebuilt = String::with_capacity(out.len());
        let mut rest = out.as_str();
        while let Some(i) = rest.find(marker) {
            let after = i + marker.len();
            rebuilt.push_str(&rest[..after]);
            let tail = &rest[after..];
            let end = tail.find(['/', '\\', '\'', '"', ',', ')', ']', '\n', '\r', ' ', '\t', ':', ';']).unwrap_or(tail.len());
            let name = &tail[..end];
            let keep = name.is_empty() || name.eq_ignore_ascii_case("Public") || name.eq_ignore_ascii_case("Shared") || name == "<user>";
            rebuilt.push_str(if keep { name } else { "<user>" });
            rest = &tail[end..];
        }
        rebuilt.push_str(rest);
        out = rebuilt;
    }
    out
}

fn ip_neighbour_blocks(c: Option<char>) -> bool {
    c.is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}

fn ipv4_at(chars: &[char], start: usize) -> Option<usize> {
    let mut i = start;
    for octet in 0..4 {
        let from = i;
        while i < chars.len() && chars[i].is_ascii_digit() && i - from < 3 { i += 1; }
        if i == from { return None; }
        if i < chars.len() && chars[i].is_ascii_digit() { return None; }
        let value: u32 = chars[from..i].iter().collect::<String>().parse().ok()?;
        if value > 255 { return None; }
        if octet < 3 {
            if chars.get(i) != Some(&'.') { return None; }
            i += 1;
        }
    }
    Some(i)
}

fn ipv6_at(chars: &[char], start: usize) -> Option<usize> {
    let mut i = start;
    while i < chars.len() && (chars[i].is_ascii_hexdigit() || chars[i] == ':') { i += 1; }
    let token: String = chars[start..i].iter().collect();
    let colons = token.matches(':').count();
    let groups = token.split(':').filter(|g| !g.is_empty()).count();
    let has_digit = token.chars().any(|c| c.is_ascii_digit());
    let looks_v6 = has_digit && ((token.contains("::") && groups >= 2) || colons == 7);
    let loopback = token == "::1" || token == "::";
    (looks_v6 && !loopback && !token.contains(":::")).then_some(i)
}

/// Server and player addresses appear in connection lines; they identify the
/// player and the server owner, so a public log keeps only loopback.
pub(crate) fn mask_ip_addresses(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let before = if i == 0 { None } else { Some(chars[i - 1]) };
        let starts_token = !ip_neighbour_blocks(before) && before != Some(':');
        if starts_token && chars[i].is_ascii_digit() {
            if let Some(end) = ipv4_at(&chars, i) {
                if !ip_neighbour_blocks(chars.get(end).copied()) {
                    let ip: String = chars[i..end].iter().collect();
                    let local = ip.starts_with("127.") || ip == "0.0.0.0";
                    out.push_str(if local { &ip } else { "<ip>" });
                    i = end;
                    continue;
                }
            }
        }
        if starts_token && (chars[i].is_ascii_hexdigit() || chars[i] == ':') {
            if let Some(end) = ipv6_at(&chars, i) {
                if !chars.get(end).is_some_and(|c| c.is_ascii_alphanumeric() || *c == '.') {
                    out.push_str("<ip>");
                    i = end;
                    continue;
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

fn hide_flag_value(text: &str, flag: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(pos) = rest.find(flag) {
        let after = pos + flag.len();
        out.push_str(&rest[..after]);
        let tail = &rest[after..];
        let gap = tail.len() - tail.trim_start_matches([' ', ',', '=', '\t']).len();
        out.push_str(&tail[..gap]);
        let value = &tail[gap..];
        let end = value.find([' ', ',', ']', '\n', '\r', '"', '\'']).unwrap_or(value.len());
        if end > 0 {
            out.push_str("<hidden>");
        }
        rest = &value[end..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod redact_tests {
    use super::{redact_log, rejection_message, share_url, EMPTY_LOG};
    use serde_json::json;

    #[test]
    fn only_a_service_page_is_handed_to_the_browser() {
        let cases: [(serde_json::Value, Option<&str>, &str); 6] = [
            (json!({ "url": "https://logs.millida.net/aB3xK9qLm2" }), Some("https://logs.millida.net/aB3xK9qLm2"), "the documented answer"),
            (json!({ "url": "http://logs.millida.net/aB3xK9qLm2" }), None, "plain http would leak the link on the way"),
            (json!({ "url": "https://logs.millida.net.evil.example/x" }), None, "a lookalike host must not be opened"),
            (json!({ "url": "https://logs.millida.net:8443/x" }), None, "a foreign port is not the public page"),
            (json!({ "raw": "https://logs.millida.net/x/raw" }), None, "without url there is no link to show"),
            (json!({ "url": "not a url" }), None, "garbage must not reach openUrl"),
        ];
        for (body, want, why) in cases {
            assert_eq!(share_url(&body).as_deref(), want, "{why}");
        }
    }

    #[test]
    fn the_server_wording_reaches_the_player() {
        let cases: [(serde_json::Value, Option<&str>, &str); 5] = [
            (json!({ "message": "content should not be empty" }), Some("content should not be empty"), "a single message"),
            (json!({ "message": ["content too long", "source invalid"] }), Some("content too long; source invalid"), "validation sends a list"),
            (json!({ "message": ["", "  "] }), None, "blank items fall back to the launcher text"),
            (json!({ "error": "Bad Request" }), None, "no message field"),
            (serde_json::Value::Null, None, "the body was not JSON"),
        ];
        for (body, want, why) in cases {
            assert_eq!(rejection_message(&body).as_deref(), want, "{why}");
        }
    }

    #[test]
    fn the_empty_log_message_is_the_one_the_interface_matches() {
        assert_eq!(EMPTY_LOG, "Лог пустой");
    }

    #[test]
    fn home_and_access_token_do_not_leave_the_machine() {
        let log = "C:\\Users\\Вася\\AppData\\x.jar [--username, Vasya, --accessToken, eyJabc.def, --uuid, 1] --accessToken  tok123 --version 1.21";
        let out = redact_log(log, Some("C:\\Users\\Вася"));
        assert!(!out.contains("Вася"), "{out}");
        assert!(!out.contains("eyJabc"), "{out}");
        assert!(!out.contains("tok123"), "{out}");
        assert!(out.contains("~\\AppData"), "{out}");
        assert!(out.contains("--uuid, 1"), "{out}");
        let unix = redact_log("/Users/daniil/Library/x /Users/daniil", Some("/Users/daniil/"));
        assert_eq!(unix, "~/Library/x ~");
    }

    #[test]
    fn addresses_and_foreign_user_folders_are_masked() {
        let cases: [(&str, &str, &str); 9] = [
            ("Connecting to 203.0.113.10, 25565", "Connecting to <ip>, 25565", "server address in the connect line"),
            ("/93.184.216.34:51234 lost connection", "/<ip>:51234 lost connection", "player address with port"),
            ("bound to 127.0.0.1:25565", "bound to 127.0.0.1:25565", "loopback helps debugging and identifies nobody"),
            ("Loading sodium-0.5.8.1.jar", "Loading sodium-0.5.8.1.jar", "a four-part mod version is not an address"),
            ("[12:34:56] [Render thread/INFO]", "[12:34:56] [Render thread/INFO]", "log timestamps must survive"),
            ("peer [2001:db8:85a3::8a2e:370:7334]", "peer [<ip>]", "IPv6 peer"),
            ("D:\\Users\\Petya\\mods\\x.jar", "D:\\Users\\<user>\\mods\\x.jar", "username on a second drive"),
            ("/home/petya/.minecraft", "/home/<user>/.minecraft", "linux home of another account"),
            ("C:\\Users\\Public\\Desktop", "C:\\Users\\Public\\Desktop", "the shared Public folder is not a person"),
        ];
        for (input, want, why) in cases {
            assert_eq!(redact_log(input, None), want, "{why}");
        }
    }
}
