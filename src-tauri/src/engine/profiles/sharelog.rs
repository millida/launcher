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
    let mut out = hide_flag_value(&out, "--accessToken");
    for key in SECRET_KEYS {
        if out.contains(key) {
            out = hide_after(&out, key);
        }
    }
    let out = mask_user_dirs(&out);
    mask_ip_addresses(&out)
}

/// Lines a legacy game prints with the session in them: 1.8.9 and 1.7.10 write
/// «(Session ID is token:<access>:<uuid>)». Cut in every log that leaves the process:
/// the public page and the live log on screen both go through `redact_log`.
const SECRET_KEYS: [&str; 3] = ["Session ID is ", "accessToken=", "access_token="];

/// The nick never replaces a fragment shorter than this: «Al» would eat half the log.
const NICK_MIN_CHARS: usize = 3;

/// A line of the live log before it reaches the screen. Players send screenshots of it to
/// support and streamers keep it open on air, so the account token, the session id and the
/// home folder are always cut; the nick only when the player asks (`nick`). The log file on
/// disk keeps everything: it is what a crash is read from.
pub(crate) fn redact_live_line(line: &str, home: Option<&str>, nick: Option<&str>) -> String {
    let mut out = redact_log(line, home);
    if let Some(n) = nick.map(str::trim).filter(|n| n.chars().count() >= NICK_MIN_CHARS) {
        out = replace_ci(&out, n, "Player");
    }
    out
}

/// Case-insensitive replacement of every `needle` (a nick: «Steve», «steve», «STEVE»).
///
/// Matches char by char on the original text: lowercasing a whole line changes the
/// byte length of some chars (`Ⱥ` 2→3, the ohm sign U+2126 3→2), and offsets taken from
/// the lowered copy cut the original mid-char (panic, the live log froze).
pub(crate) fn replace_ci(text: &str, needle: &str, with: &str) -> String {
    let want: Vec<char> = needle.chars().flat_map(char::to_lowercase).collect();
    if want.is_empty() {
        return text.to_string();
    }
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    let mut i = 0;
    while i < chars.len() {
        match ci_match_len(&chars[i..], &want) {
            Some(n) => {
                out.push_str(&text[last..chars[i].0]);
                out.push_str(with);
                i += n;
                last = chars.get(i).map_or(text.len(), |c| c.0);
            }
            None => i += 1,
        }
    }
    out.push_str(&text[last..]);
    out
}

/// How many chars at the start of `from` lowercase exactly into `want`.
fn ci_match_len(from: &[(usize, char)], want: &[char]) -> Option<usize> {
    let mut k = 0;
    for (n, &(_, c)) in from.iter().enumerate() {
        for l in c.to_lowercase() {
            if want.get(k) != Some(&l) {
                return None;
            }
            k += 1;
        }
        if k == want.len() {
            return Some(n + 1);
        }
    }
    None
}

/// The value right after `key` (up to a space, quote or bracket) becomes «<hidden>».
pub(crate) fn hide_after(text: &str, key: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(key) {
        let after = i + key.len();
        out.push_str(&rest[..after]);
        let tail = &rest[after..];
        let end = tail.find([' ', ',', '&', '"', '\'', ']', ')', '\n', '\r', '\t']).unwrap_or(tail.len());
        if end > 0 {
            out.push_str("<hidden>");
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
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
    use super::{redact_live_line, redact_log, rejection_message, replace_ci, share_url, EMPTY_LOG};
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
    fn hiding_the_nick_survives_chars_whose_lowercase_has_another_length() {
        // «Ⱥ» grows by a byte when lowered and the ohm sign U+2126 shrinks by one: the line
        // keeps its length, but every offset after them moved (a panic froze the live log).
        let cases: [(&str, &str, &str); 7] = [
            // The old code cut the line inside «Ж» here and panicked.
            ("Ⱥ steveЖ \u{2126}", "Steve", "Ⱥ PlayerЖ \u{2126}"),
            ("[CHAT] Ⱥ \u{2126} <Steve> hi", "Steve", "[CHAT] Ⱥ \u{2126} <Player> hi"),
            ("ȺȺȺ steve \u{2126}\u{2126}\u{2126} STEVE", "Steve", "ȺȺȺ Player \u{2126}\u{2126}\u{2126} Player"),
            ("\u{2126}steve", "STEVE", "\u{2126}Player"),
            ("<ȺLEX> ok", "ⱥlex", "<Player> ok"),
            ("İstanbul Steve", "steve", "İstanbul Player"),
            ("no nick here Ⱥ", "Steve", "no nick here Ⱥ"),
        ];
        for (line, nick, want) in cases {
            assert_eq!(replace_ci(line, nick, "Player"), want, "{line}");
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

    #[test]
    fn a_live_line_loses_the_session_and_keeps_the_rest() {
        let cases: [(&str, Option<&str>, &str, &str); 7] = [
            ("[12:00:01] [Client thread/INFO]: (Session ID is token:eyJ0.abc.def:8667ba71b85a4004af54457a9734eed7)", None, "[12:00:01] [Client thread/INFO]: (Session ID is <hidden>)", "1.8.9 prints the access token in the session line"),
            ("[main/INFO]: Setting user: Steve", None, "[main/INFO]: Setting user: Steve", "the nick stays when the player did not ask to hide it"),
            ("[main/INFO]: Setting user: Steve", Some("Steve"), "[main/INFO]: Setting user: Player", "with the switch on the nick becomes Player"),
            ("<STEVE> hi, steve here", Some("Steve"), "<Player> hi, Player here", "every case of the nick is hidden"),
            ("[main/INFO]: Setting user: Al", Some("Al"), "[main/INFO]: Setting user: Al", "a two-letter nick would eat half the log, so it is left"),
            ("--username Steve --accessToken eyJ0.abc.def --version 1.21.1", None, "--username Steve --accessToken <hidden> --version 1.21.1", "a loader echoing the command line"),
            ("url?accessToken=eyJ0.abc&x=1 access_token=zzz", None, "url?accessToken=<hidden>&x=1 access_token=<hidden>", "query-string forms of the token"),
        ];
        for (line, nick, want, why) in cases {
            assert_eq!(redact_live_line(line, None, nick), want, "{why}");
        }
        assert_eq!(redact_live_line("Unexpected token: '}' at 3", None, None), "Unexpected token: '}' at 3", "a parse error is not a secret and must stay readable");
    }

    #[test]
    fn the_shared_log_and_the_live_log_hide_the_same_secrets() {
        let lines = [
            "[12:00:01] [Client thread/INFO]: (Session ID is token:eyJ0.abc.def:8667ba71b85a4004af54457a9734eed7)",
            "2026-11-20 12:00:01 [INFO] (Session ID is token:eyJ7.ten.ten:0123456789abcdef0123456789abcdef)",
            "--username Steve --accessToken eyJ0.sec.ret --version 1.21.1",
            "url?accessToken=eyJ0.qs.sec&x=1 access_token=eyJ0.snake",
        ];
        for line in lines {
            let shared = redact_log(line, None);
            let live = redact_live_line(line, None, None);
            assert!(!shared.contains("eyJ"), "the public log leaks a token: {shared}");
            assert!(!live.contains("eyJ"), "the live log leaks a token: {live}");
            assert_eq!(shared, live, "both paths must cut the same: {line}");
        }
        let whole = lines.join("\n");
        let shared = redact_log(&whole, None);
        assert!(!shared.contains("eyJ"), "a whole file must not leak either: {shared}");
        assert_eq!(shared.lines().count(), lines.len(), "cutting must not eat line breaks");
    }
}
