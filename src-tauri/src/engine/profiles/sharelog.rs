// "Share log": on the player's button, sends the chosen log to the public site mclo.gs and returns the link.
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

pub async fn share_log(profile: String, name: String) -> Result<String, String> {
    // path arrives over IPC and is uploaded publicly, so confine it to the profile
    let path = safe_join(&profile_dir(&profile), &name)?;
    if !is_log_path(&name) { return Err("Делиться можно только логами сборки".into()); }
    let mut content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.len() > 1_900_000 {
        let cut = content.len() - 1_900_000;
        let start = (cut..content.len()).find(|i| content.is_char_boundary(*i)).unwrap_or(content.len());
        content = content[start..].to_string();
    }
    // mclo.gs answers an empty text with "Required field 'content' is empty": the request is not sent at all.
    if content.trim().is_empty() { return Err(EMPTY_LOG.into()); }
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned());
    let content = redact_log(&content, home.as_deref());
    // Third-party service mclo.gs, not Millida: the log becomes a public page. Sent only after the button click.
    let resp: Value = client().post("https://api.mclo.gs/1/log")
        .form(&[("content", content)])
        .send().await.map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    if resp["success"] == true {
        Ok(resp["url"].as_str().unwrap_or("").to_string())
    } else {
        Err(resp["error"].as_str().unwrap_or("mclo.gs отклонил лог").to_string())
    }
}

/// Лог уходит на публичный mclo.gs: домашняя папка (в ней имя пользователя)
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
    use super::{redact_log, EMPTY_LOG};

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
