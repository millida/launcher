use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;

pub(crate) const AUTHLIB_LATEST: &str = "https://authlib-injector.yushi.moe/artifact/latest.json";
/// Build used when the feed is unreachable. Without the agent the launch falls
/// back to offline: no multiplayer and, on a vanilla profile, no skin at all —
/// a single unreachable host must not cost that. The mirror is the upstream
/// GitHub release, and the digest is the one the feed publishes for build 56.
const AUTHLIB_PINNED_URL: &str =
    "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar";
const AUTHLIB_PINNED_SHA256: &str = "9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10";

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

    // loaded into the JVM as -javaagent, so an unverified jar is never used:
    // a feed without a usable address or digest falls back to the pinned build,
    // never to an unchecked download.
    let signed = meta["download_url"]
        .as_str()
        .filter(|u| u.starts_with("https://"))
        .and_then(|u| {
            let sum = meta["checksums"]["sha256"].as_str().unwrap_or("").to_lowercase();
            let hex = sum.len() == 64 && sum.chars().all(|c| c.is_ascii_hexdigit());
            hex.then(|| (u.to_string(), sum))
        });
    let (url, expected, stamped) = match signed {
        Some((u, s)) => (u, s, build),
        None => (AUTHLIB_PINNED_URL.to_string(), AUTHLIB_PINNED_SHA256.to_string(), String::new()),
    };
    // A newer build downloads next to the working agent, never over it:
    // `download_checked` drops a file whose digest no longer matches before it
    // fetches, so a release the player cannot reach right now used to leave the
    // launch with no agent at all — offline mode, no multiplayer and, on a
    // vanilla build, no skin either.
    let next = dir.join("authlib-injector.jar.next");
    let _ = std::fs::remove_file(&next);
    let fetched = download_checked(&url, &next, Some(Sum::Sha256(&expected)), None)
        .await
        .and_then(|_| std::fs::rename(&next, &jar).map_err(|e| e.to_string()));
    match fetched {
        Ok(()) => {
            let _ = std::fs::write(&stamp, &stamped);
            Ok(jar)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&next);
            if jar.exists() {
                return Ok(jar);
            }
            Err(e)
        }
    }
}
