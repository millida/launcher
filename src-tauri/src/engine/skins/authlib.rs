use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;

pub(crate) const AUTHLIB_LATEST: &str = "https://authlib-injector.yushi.moe/artifact/latest.json";

pub async fn ensure_authlib_injector() -> Result<PathBuf, String> {
    let dir = data_dir().join("agents");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let jar = dir.join("authlib-injector.jar");
    let stamp = dir.join("authlib-injector.version");

    let meta: Value = get_json(AUTHLIB_LATEST).await.unwrap_or(Value::Null);
    let build = meta["build_number"].as_u64().map(|b| b.to_string()).unwrap_or_default();
    let have = std::fs::read_to_string(&stamp).unwrap_or_default();
    if jar.exists() && (build.is_empty() || have == build) {
        return Ok(jar);
    }

    let url = meta["download_url"]
        .as_str()
        .filter(|u| u.starts_with("https://"))
        .ok_or("не удалось узнать адрес authlib-injector")?;
    // loaded into the JVM as -javaagent, so an unverified jar is never used
    let expected = meta["checksums"]["sha256"].as_str().unwrap_or("").to_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("нет контрольной суммы authlib-injector".into());
    }
    download_checked(url, &jar, Some(Sum::Sha256(&expected)), None).await?;
    let _ = std::fs::write(&stamp, &build);
    Ok(jar)
}
