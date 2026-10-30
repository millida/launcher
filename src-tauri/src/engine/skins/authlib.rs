// authlib-injector agent: a small jar attached to the game with the -javaagent flag. It points login and skins to the Millida server.
// Downloaded from the project's GitHub release (pinned version and sha256) and put into agents/ in the launcher data. It is loaded only after the sha256 check.
use crate::engine::game::ansi_readable_as_is;
use crate::engine::*;
use serde_json::Value;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Duration;

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

/// After start the JVM attaches the agent jar through JDK_Canonicalize, which
/// expands 8.3 names back to the long ones and encodes them in the ANSI code
/// page. A user folder outside that page becomes `?`, and the game exits with
/// «Unexpected error (103) returned by AddToSystemClassLoaderSearch». Such a
/// profile runs a checked copy of the jar from a folder whose long name fits.
///
/// The only folder whose long name always fits is under ProgramData, where any
/// Windows user may create folders. The copy goes into a folder of this user
/// alone: it is created with an owner-only protected DACL, a folder that
/// already exists is accepted only when this user owns it and it is not a
/// junction, and the folder and the jar are held open without delete or write
/// sharing for as long as the game runs, so neither can be swapped between
/// the sha256 check and the JVM reading the jar.
pub struct GameAgent {
    pub path: PathBuf,
    _pins: Vec<std::fs::File>,
}

const AGENT_COPY_NAME: &str = "authlib-injector-1.2.8.jar";

pub fn agent_for_game(jar: &Path) -> Result<GameAgent, String> {
    if ansi_readable_as_is(jar) {
        return Ok(GameAgent { path: jar.to_path_buf(), _pins: Vec::new() });
    }
    private_copy(jar).map_err(|e| {
        format!(
            "Java не может прочитать путь к агенту: в имени папки пользователя Windows есть символы вне системной кодировки, а запасная папка недоступна ({})",
            e
        )
    })
}

fn private_copy(jar: &Path) -> Result<GameAgent, String> {
    let base = program_data().filter(|d| ansi_readable_as_is(d)).ok_or("нет папки с подходящим именем")?;
    let (dir, dir_pin) = private_dir::claim(&base)?;
    let (path, jar_pin) = pinned_copy(jar, &dir)?;
    Ok(GameAgent { path, _pins: vec![dir_pin, jar_pin] })
}

fn pinned_copy(src: &Path, dir: &Path) -> Result<(PathBuf, std::fs::File), String> {
    std::fs::create_dir_all(dir).map_err(|e| io_fail("Агент скинов", dir, &e))?;
    let dest = dir.join(AGENT_COPY_NAME);
    if let Ok(pin) = open_checked(&dest) {
        return Ok((dest, pin));
    }
    let part = dir.join(format!("{}.{}.part", AGENT_COPY_NAME, std::process::id()));
    if let Err(e) = std::fs::copy(src, &part).and_then(|_| std::fs::rename(&part, &dest)) {
        let _ = std::fs::remove_file(&part);
        return Err(io_fail("Агент скинов", &dest, &e));
    }
    let pin = open_checked(&dest)?;
    Ok((dest, pin))
}

fn open_checked(path: &Path) -> Result<std::fs::File, String> {
    use std::io::Read;
    let mut f = open_without_write_sharing(path).map_err(|e| io_fail("Агент скинов", path, &e))?;
    let mut bytes = Vec::new();
    f.read_to_end(&mut bytes).map_err(|e| io_fail("Агент скинов", path, &e))?;
    if sha256_hex(&bytes) != AUTHLIB_PINNED_SHA256 {
        return Err(format!("копия агента не прошла проверку sha256: {}", mask_home(&path.to_string_lossy())));
    }
    Ok(f)
}

#[cfg(windows)]
fn open_without_write_sharing(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows::Win32::Storage::FileSystem::FILE_SHARE_READ;
    std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ.0).open(path)
}

#[cfg(not(windows))]
fn open_without_write_sharing(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::File::open(path)
}

#[cfg(windows)]
mod private_dir {
    use std::fs::File;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use std::path::{Path, PathBuf};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, LocalFree, ERROR_ALREADY_EXISTS, HANDLE, HLOCAL};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SetSecurityInfo,
        SDDL_REVISION_1, SE_FILE_OBJECT,
    };
    use windows::Win32::Security::{
        EqualSid, GetSecurityDescriptorDacl, GetTokenInformation, TokenUser, ACL, DACL_SECURITY_INFORMATION,
        OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateDirectoryW, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, READ_CONTROL, WRITE_DAC,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn fail(step: &str, e: impl std::fmt::Display) -> String {
        format!("{}: {}", step, e)
    }

    pub fn claim(base: &Path) -> Result<(PathBuf, File), String> {
        let user = UserSid::current()?;
        let dir = base.join(format!("net.millida.launcher.agents.{}", user.text));
        let pin = owned(&dir, &user)?;
        Ok((dir, pin))
    }

    #[cfg(test)]
    pub(super) fn claim_at(dir: &Path) -> Result<File, String> {
        owned(dir, &UserSid::current()?)
    }

    struct UserSid {
        token_user: Vec<u64>,
        text: String,
    }

    impl UserSid {
        fn current() -> Result<Self, String> {
            // SAFETY: the token handle is closed on every path, the SID points into
            // token_user, which lives as long as the struct, and the string from
            // ConvertSidToStringSidW is copied before LocalFree releases it.
            unsafe {
                let mut token = HANDLE::default();
                OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).map_err(|e| fail("токен процесса", e))?;
                let mut len = 0u32;
                let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
                let mut token_user = vec![0u64; (len as usize).div_ceil(8).max(1)];
                let got = GetTokenInformation(token, TokenUser, Some(token_user.as_mut_ptr().cast()), len, &mut len);
                let _ = CloseHandle(token);
                got.map_err(|e| fail("пользователь Windows", e))?;
                let sid = (*(token_user.as_ptr() as *const TOKEN_USER)).User.Sid;
                let mut raw = PWSTR::null();
                ConvertSidToStringSidW(sid, &mut raw).map_err(|e| fail("SID пользователя", e))?;
                let text = raw.to_string();
                let _ = LocalFree(Some(HLOCAL(raw.0.cast())));
                let text = text.map_err(|e| fail("SID пользователя", e))?;
                Ok(Self { token_user, text })
            }
        }

        fn sid(&self) -> PSID {
            // SAFETY: token_user holds the TOKEN_USER filled in by current().
            unsafe { (*(self.token_user.as_ptr() as *const TOKEN_USER)).User.Sid }
        }
    }

    struct Descriptor(PSECURITY_DESCRIPTOR);

    impl Drop for Descriptor {
        fn drop(&mut self) {
            // SAFETY: the descriptor was allocated by the system with LocalAlloc.
            unsafe {
                let _ = LocalFree(Some(HLOCAL(self.0 .0)));
            }
        }
    }

    fn owned(dir: &Path, user: &UserSid) -> Result<File, String> {
        let sddl: Vec<u16> = format!("O:{0}D:P(A;OICI;FA;;;{0})(A;OICI;FA;;;SY)", user.text).encode_utf16().chain([0]).collect();
        let wide: Vec<u16> = dir.as_os_str().encode_wide().chain([0]).collect();
        // SAFETY: every pointer handed to the API points into a buffer that
        // outlives the call, and the descriptors are freed by their guards.
        unsafe {
            let mut sd = PSECURITY_DESCRIPTOR::default();
            ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(sddl.as_ptr()), SDDL_REVISION_1, &mut sd, None)
                .map_err(|e| fail("права папки агента", e))?;
            let sd = Descriptor(sd);
            let sa = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd.0 .0,
                bInheritHandle: false.into(),
            };
            if let Err(e) = CreateDirectoryW(PCWSTR(wide.as_ptr()), Some(&sa)) {
                if e.code() != ERROR_ALREADY_EXISTS.to_hresult() {
                    return Err(fail("папка агента", e));
                }
            }
            let pin = std::fs::OpenOptions::new()
                .access_mode(READ_CONTROL.0 | WRITE_DAC.0 | FILE_READ_ATTRIBUTES.0)
                .share_mode((FILE_SHARE_READ | FILE_SHARE_WRITE).0)
                .custom_flags((FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT).0)
                .open(dir)
                .map_err(|e| fail("папка агента", e))?;
            let attrs = pin.metadata().map_err(|e| fail("папка агента", e))?.file_attributes();
            if attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0 || attrs & FILE_ATTRIBUTE_DIRECTORY.0 == 0 {
                return Err("на месте папки агента стоит ссылка или файл".into());
            }
            let handle = HANDLE(pin.as_raw_handle());
            let mut owner = PSID::default();
            let mut owner_sd = PSECURITY_DESCRIPTOR::default();
            GetSecurityInfo(handle, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION, Some(&mut owner), None, None, None, Some(&mut owner_sd))
                .ok()
                .map_err(|e| fail("владелец папки агента", e))?;
            let owner_sd = Descriptor(owner_sd);
            let mine = EqualSid(owner, user.sid()).is_ok();
            drop(owner_sd);
            if !mine {
                return Err("папку агента создал другой пользователь Windows".into());
            }
            let mut present = Default::default();
            let mut defaulted = Default::default();
            let mut dacl: *mut ACL = std::ptr::null_mut();
            GetSecurityDescriptorDacl(sd.0, &mut present, &mut dacl, &mut defaulted).map_err(|e| fail("права папки агента", e))?;
            SetSecurityInfo(handle, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, None, None, Some(dacl), None)
                .ok()
                .map_err(|e| fail("права папки агента", e))?;
            Ok(pin)
        }
    }
}

#[cfg(not(windows))]
mod private_dir {
    use std::fs::File;
    use std::path::{Path, PathBuf};

    pub fn claim(_base: &Path) -> Result<(PathBuf, File), String> {
        Err("запасная папка есть только в Windows".into())
    }
}

#[cfg(windows)]
fn program_data() -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_ProgramData, KF_FLAG_DEFAULT};
    // SAFETY: the returned buffer is copied out before CoTaskMemFree releases it.
    unsafe {
        let p = SHGetKnownFolderPath(&FOLDERID_ProgramData, KF_FLAG_DEFAULT, None).ok()?;
        let out = p.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(p.0 as _));
        out
    }
}

#[cfg(not(windows))]
fn program_data() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod pin_tests {
    use super::*;

    #[test]
    fn a_readable_jar_is_used_in_place() {
        let jar = std::env::temp_dir().join("millida-agent-test").join("authlib-injector.jar");
        if !ansi_readable_as_is(&jar) {
            eprintln!("the temp folder itself is outside the code page, nothing to check");
            return;
        }
        let agent = agent_for_game(&jar).expect("a readable path needs no copy and cannot fail");
        assert_eq!(agent.path, jar, "a jar Java can already read must not be copied anywhere");
        assert!(agent._pins.is_empty(), "nothing to hold open when the jar stays in the private profile");
    }

    #[test]
    fn a_copy_with_a_foreign_hash_is_never_handed_to_the_jvm() {
        let dir = std::env::temp_dir().join(format!("millida-agent-pin-{}", std::process::id()));
        let src = dir.join("src.jar");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&src, b"not the pinned agent").unwrap();
        let verdict = pinned_copy(&src, &dir.join("copy"));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(verdict.is_err(), "a jar that is not the pinned build would run as -javaagent inside the game");
    }

    #[cfg(windows)]
    #[test]
    fn the_held_copy_cannot_be_overwritten_while_the_game_runs() {
        let dir = std::env::temp_dir().join(format!("millida-agent-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("held.jar");
        std::fs::write(&file, b"x").unwrap();
        let held = open_without_write_sharing(&file).unwrap();
        let write = std::fs::OpenOptions::new().write(true).open(&file);
        let reread = std::fs::File::open(&file);
        let rename = std::fs::rename(&file, dir.join("other.jar"));
        drop(held);
        let _ = std::fs::remove_dir_all(&dir);
        assert!(write.is_err(), "another process could swap the agent after the sha256 check");
        assert!(rename.is_err(), "the checked file could be replaced by renaming another one over it");
        assert!(reread.is_ok(), "the JVM still has to read the held jar");
    }

    #[cfg(windows)]
    #[test]
    fn the_shared_folder_is_accepted_only_as_a_real_folder_of_this_user() {
        let root = std::env::temp_dir().join(format!("millida-agent-dir-{}", std::process::id()));
        let mine = root.join("mine");
        let target = root.join("elsewhere");
        let link = root.join("link");
        std::fs::create_dir_all(&target).unwrap();
        let fresh = private_dir::claim_at(&mine).map(drop);
        let again = private_dir::claim_at(&mine).map(drop);
        let made = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&target)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        let junction = private_dir::claim_at(&link).map(drop);
        let _ = std::fs::remove_dir(&link);
        let _ = std::fs::remove_dir_all(&root);
        assert!(fresh.is_ok(), "a folder the launcher creates itself must be usable: {:?}", fresh);
        assert!(again.is_ok(), "the folder from the previous launch is ours and must be reused: {:?}", again);
        assert!(made, "the test could not create a junction, the refusal below would prove nothing");
        assert!(junction.is_err(), "a junction planted by another user would redirect the JVM to a jar the check never saw");
    }

    #[test]
    fn the_pin_is_a_full_sha256_on_the_project_release() {
        assert_eq!(AUTHLIB_PINNED_SHA256.len(), 64);
        assert!(AUTHLIB_PINNED_SHA256.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(AUTHLIB_PINNED_URL.starts_with("https://github.com/yushijinhun/authlib-injector/releases/download/"));
        assert!(AUTHLIB_PINNED_URL.contains("1.2.8") && AUTHLIB_STAMP.contains("1.2.8"));
    }
}

/// The skin server's description is reused this long without asking the server at all.
const YGG_FRESH: Duration = Duration::from_secs(10 * 60);
/// With an older copy on disk a launch waits this long for the live answer (it used to be 30 s
/// times three tries, on every launch with a Millida account).
const YGG_WAIT: Duration = Duration::from_secs(3);

fn yggdrasil_copy_path(url: &str) -> PathBuf {
    let tag = sha256_hex(url.as_bytes());
    data_dir().join("agents").join(format!("yggdrasil-{}.json", &tag[..16]))
}

/// What the Millida skin server says about itself (public key, skin domains), which the launcher
/// hands to the agent so the game does not fetch it at start. One GET to the server given in
/// `url`; no token and no account data. A copy on disk makes the launch independent of how the
/// server feels today: a fresh copy is used as is, an older one gives the server three seconds.
pub(crate) async fn yggdrasil_meta(url: &str) -> Result<Value, String> {
    let target = url.to_string();
    meta_with_copy(&yggdrasil_copy_path(url), YGG_FRESH, YGG_WAIT, move || async move { get_json(&target).await }).await
}

async fn meta_with_copy<F, Fut>(copy: &Path, fresh: Duration, wait: Duration, fetch: F) -> Result<Value, String>
where
    F: FnOnce() -> Fut + Send + 'static,
    Fut: Future<Output = Result<Value, String>> + Send + 'static,
{
    let cached = std::fs::read(copy)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter(Value::is_object);
    let age = std::fs::metadata(copy).ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok());
    let Some(known) = cached else {
        // Nothing to fall back on: the request runs the way it always did.
        let live = fetch().await?;
        if live.is_object() {
            write_json_quiet(copy, &live);
        }
        return Ok(live);
    };
    if age.is_some_and(|a| a < fresh) {
        return Ok(known);
    }
    let path = copy.to_path_buf();
    let job = tokio::spawn(async move {
        let live = fetch().await;
        match &live {
            Ok(v) if v.is_object() => write_json_quiet(&path, v),
            // A server that does not answer is asked again after `fresh`, not on every launch.
            _ => {
                if let Ok(f) = std::fs::File::options().write(true).open(&path) {
                    let _ = f.set_modified(std::time::SystemTime::now());
                }
            }
        }
        live
    });
    match tokio::time::timeout(wait, job).await {
        Ok(Ok(Ok(live))) if live.is_object() => Ok(live),
        _ => Ok(known),
    }
}

#[cfg(test)]
mod meta_tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn copy_in(name: &str, body: Option<&str>, age: Duration) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("millida-ygg-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("meta.json");
        if let Some(body) = body {
            std::fs::write(&path, body).unwrap();
            let f = std::fs::File::options().write(true).open(&path).unwrap();
            f.set_modified(std::time::SystemTime::now() - age).unwrap();
        }
        path
    }

    #[tokio::test]
    async fn a_fresh_copy_is_used_without_asking_the_server() {
        let copy = copy_in("fresh", Some(r#"{"meta":{"serverName":"cached"}}"#), Duration::from_secs(60));
        let asked = Arc::new(AtomicUsize::new(0));
        let a = asked.clone();
        let got = meta_with_copy(&copy, YGG_FRESH, YGG_WAIT, move || async move {
            a.fetch_add(1, Ordering::Relaxed);
            Ok(json!({"meta": {"serverName": "live"}}))
        })
        .await
        .unwrap();
        assert_eq!(got["meta"]["serverName"], "cached");
        assert_eq!(asked.load(Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn an_old_copy_gives_the_server_a_short_wait_then_wins_the_launch() {
        let copy = copy_in("slow", Some(r#"{"meta":{"serverName":"cached"}}"#), Duration::from_secs(3600));
        let started = std::time::Instant::now();
        let got = meta_with_copy(&copy, YGG_FRESH, Duration::from_millis(150), || async {
            tokio::time::sleep(Duration::from_secs(20)).await;
            Ok(json!({"meta": {"serverName": "live"}}))
        })
        .await
        .unwrap();
        assert_eq!(got["meta"]["serverName"], "cached", "a hung server does not hold the launch for 30 s");
        assert!(started.elapsed() < Duration::from_secs(3));

        let got = meta_with_copy(&copy, YGG_FRESH, Duration::from_secs(2), || async { Ok(json!({"meta": {"serverName": "live"}})) })
            .await
            .unwrap();
        assert_eq!(got["meta"]["serverName"], "live", "an answer that arrives in time is the one used");
        let kept: Value = serde_json::from_slice(&std::fs::read(&copy).unwrap()).unwrap();
        assert_eq!(kept["meta"]["serverName"], "live", "and it replaces the copy");
    }

    #[tokio::test]
    async fn a_failing_server_with_a_copy_is_not_a_failed_launch_and_is_left_alone_for_a_while() {
        let copy = copy_in("down", Some(r#"{"meta":{"serverName":"cached"}}"#), Duration::from_secs(3600));
        let got = meta_with_copy(&copy, YGG_FRESH, Duration::from_secs(2), || async { Err("http 502".to_string()) })
            .await
            .unwrap();
        assert_eq!(got["meta"]["serverName"], "cached");
        tokio::time::sleep(Duration::from_millis(100)).await;
        let age = std::fs::metadata(&copy).unwrap().modified().unwrap().elapsed().unwrap();
        assert!(age < Duration::from_secs(60), "the copy's age restarts, so the next launches skip the dead server");
    }

    #[tokio::test]
    async fn without_a_copy_the_old_behaviour_stays_and_its_error_is_reported() {
        let copy = copy_in("none", None, Duration::ZERO);
        let err = meta_with_copy(&copy, YGG_FRESH, YGG_WAIT, || async { Err("http 502".to_string()) }).await.unwrap_err();
        assert_eq!(err, "http 502", "the launch then falls back to offline mode with the real reason");
        let ok = meta_with_copy(&copy, YGG_FRESH, YGG_WAIT, || async { Ok(json!({"meta": {}})) }).await.unwrap();
        assert!(ok.is_object());
        assert!(copy.exists(), "the first good answer becomes the copy");
    }

    #[test]
    fn each_server_address_has_its_own_copy() {
        assert_ne!(yggdrasil_copy_path("https://a.example/yggdrasil"), yggdrasil_copy_path("https://b.example/yggdrasil"));
    }
}
