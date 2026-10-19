// authlib-injector agent: a small jar attached to the game with the -javaagent flag. It points login and skins to the Millida server.
// Downloaded from the project's GitHub release (pinned version and sha256) and put into agents/ in the launcher data. It is loaded only after the sha256 check.
use crate::engine::*;
use std::path::PathBuf;

/// The agent runs inside the game as -javaagent, so its build is pinned in the
/// code: address and sha256 are ours, never taken from a third-party feed.
/// A feed that is hacked or hijacked could otherwise hand out a jar together
/// with its own matching hash. The pin is the upstream GitHub release v1.2.8
/// (build 56); a new build is a code change reviewed here.
const AUTHLIB_PINNED_URL: &str =
    "https://github.com/yushijinhun/authlib-injector/releases/download/v1.2.8/authlib-injector-1.2.8.jar";
const AUTHLIB_PINNED_SHA256: &str = "9c7f4343e6c82034958ffb48c14a2cb0c85928be7283103ce17da00c6d5a7b10";
/// Written next to the jar. Anything else (an older feed build number) means "fetch the pinned jar again".
const AUTHLIB_STAMP: &str = "pinned-1.2.8";

pub async fn ensure_authlib_injector() -> Result<PathBuf, String> {
    let dir = data_dir().join("agents");
    std::fs::create_dir_all(&dir).map_err(|e| io_fail("Агент скинов", &dir, &e))?;
    let jar = dir.join("authlib-injector.jar");
    let stamp = dir.join("authlib-injector.version");
    // Обрезанный или пустой агент JVM не грузит и выходит до окна («Error
    // opening zip file or JAR manifest missing»): такой файл качаем заново.
    if jar.exists() && !zip_readable(&jar) {
        // A damaged agent is deleted and downloaded again.
        let _ = std::fs::remove_file(&jar);
        let _ = std::fs::remove_file(&stamp);
    }
    let have = std::fs::read_to_string(&stamp).unwrap_or_default();
    if jar.exists() && have == AUTHLIB_STAMP {
        return Ok(jar);
    }
    // The jar of an earlier launcher (feed build) is replaced by the pinned one.
    // The new one downloads next to the working agent (.next) and replaces it
    // only after the sha256 check, so an unreachable host never leaves the
    // launch with no agent (offline mode, no multiplayer, no skin).
    let next = dir.join("authlib-injector.jar.next");
    let _ = std::fs::remove_file(&next);
    let fetched = download_checked(AUTHLIB_PINNED_URL, &next, Some(Sum::Sha256(AUTHLIB_PINNED_SHA256)), None)
        .await
        .and_then(|_| std::fs::rename(&next, &jar).map_err(|e| e.to_string()));
    match fetched {
        Ok(()) => {
            let _ = std::fs::write(&stamp, AUTHLIB_STAMP);
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

#[cfg(test)]
mod pin_tests {
    use super::*;

    #[test]
    fn the_pin_is_a_full_sha256_on_the_project_release() {
        assert_eq!(AUTHLIB_PINNED_SHA256.len(), 64);
        assert!(AUTHLIB_PINNED_SHA256.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(AUTHLIB_PINNED_URL.starts_with("https://github.com/yushijinhun/authlib-injector/releases/download/"));
        assert!(AUTHLIB_PINNED_URL.contains("1.2.8") && AUTHLIB_STAMP.contains("1.2.8"));
    }
}
