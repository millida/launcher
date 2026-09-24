use crate::engine::*;
use serde_json::Value;

/// Only text files under logs/ or crash-reports/ count as shareable logs.
pub(crate) fn is_log_path(name: &str) -> bool {
    let n = name.replace('\\', "/");
    let known_dir = n.starts_with("logs/") || n.starts_with("crash-reports/");
    let known_ext = n.ends_with(".log") || n.ends_with(".txt");
    known_dir && known_ext
}

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
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned());
    let content = redact_log(&content, home.as_deref());
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
    hide_flag_value(&out, "--accessToken")
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
    use super::redact_log;

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
}
