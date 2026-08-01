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
