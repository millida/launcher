use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Accepts only http(s) URLs with a real host. Kept free of side effects so the
/// verdict can be tested without opening anything.
pub fn validate_external_url(url: &str) -> Result<url::Url, String> {
    let raw = url.trim();
    if raw.contains(['\r', '\n', '\0']) {
        return Err("Некорректная ссылка".into());
    }
    let parsed = url::Url::parse(raw).map_err(|_| "Некорректная ссылка".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Ссылку такого вида лаунчер не открывает".into());
    }
    if parsed.host().is_none() {
        return Err("Некорректная ссылка".into());
    }
    Ok(parsed)
}

/// Opens http(s) links through platform APIs only. Shelling out would let shell
/// metacharacters in the URL be executed.
pub fn open_external(url: &str) -> Result<(), String> {
    let parsed = validate_external_url(url)?;
    open_resolved(&parsed)
}

/// The link must reach the user even when the OS has no working handler for it:
/// after every browser candidate fails, the page opens in a launcher window,
/// which cannot fail because the launcher itself is a webview.
pub fn open_external_anyhow(app: &AppHandle, url: &str) -> Result<(), String> {
    let parsed = validate_external_url(url)?;
    if open_resolved(&parsed).is_ok() {
        return Ok(());
    }
    open_in_app(app, &parsed)
}

const VIEW_LABEL: &str = "external";

fn open_in_app(app: &AppHandle, url: &url::Url) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(VIEW_LABEL) {
        win.navigate(url.clone()).map_err(|e| e.to_string())?;
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, VIEW_LABEL, WebviewUrl::External(url.clone()))
        .title(url.host_str().unwrap_or("Millida"))
        .inner_size(1060.0, 780.0)
        .min_inner_size(420.0, 480.0)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(windows))]
fn open_resolved(url: &url::Url) -> Result<(), String> {
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn open_resolved(url: &url::Url) -> Result<(), String> {
    let target = url.as_str();
    if win::shell_execute(target) {
        return Ok(());
    }
    for exe in win::browsers() {
        if win::spawn(&exe, target) {
            return Ok(());
        }
    }
    if win::spawn(std::path::Path::new("explorer.exe"), target) {
        return Ok(());
    }
    Err("на этом компьютере не нашёлся браузер".into())
}

#[cfg(windows)]
mod win {
    use std::ffi::{OsStr, OsString};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ,
    };
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const USER_CHOICE: &str =
        r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice";
    const APP_PATHS: &str = r"Software\Microsoft\Windows\CurrentVersion\App Paths";
    const BROWSER_EXES: &[&str] = &[
        "chrome.exe",
        "msedge.exe",
        "firefox.exe",
        "browser.exe",
        "opera.exe",
        "brave.exe",
        "vivaldi.exe",
    ];
    const KNOWN_PATHS: &[&str] = &[
        r"Microsoft\Edge\Application\msedge.exe",
        r"Google\Chrome\Application\chrome.exe",
        r"Mozilla Firefox\firefox.exe",
        r"Yandex\YandexBrowser\Application\browser.exe",
        r"BraveSoftware\Brave-Browser\Application\brave.exe",
    ];
    const PATH_ROOTS: &[&str] = &["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"];

    fn wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    /// SEE_MASK_FLAG_NO_UI suppresses the shell's own "no application is
    /// associated" dialog: a broken https association must fall through to the
    /// next candidate instead of dead-ending the user with a system error box.
    pub fn shell_execute(url: &str) -> bool {
        let file = wide(url);
        let verb = wide("open");
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.nShow = SW_SHOWNORMAL;
        unsafe { ShellExecuteExW(&mut info) != 0 }
    }

    pub fn spawn(exe: &Path, url: &str) -> bool {
        Command::new(exe)
            .arg(url)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .is_ok()
    }

    fn reg_string(root: HKEY, path: &str, name: Option<&str>) -> Option<String> {
        let sub = wide(path);
        let value = name.map(wide);
        let value_ptr = value.as_ref().map_or(std::ptr::null(), |v| v.as_ptr());
        let mut bytes: u32 = 0;
        unsafe {
            if RegGetValueW(
                root,
                sub.as_ptr(),
                value_ptr,
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut bytes,
            ) != 0
            {
                return None;
            }
            let mut buf = vec![0u16; bytes as usize / 2 + 1];
            let mut size = bytes;
            if RegGetValueW(
                root,
                sub.as_ptr(),
                value_ptr,
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buf.as_mut_ptr().cast(),
                &mut size,
            ) != 0
            {
                return None;
            }
            let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(OsString::from_wide(&buf[..len]).to_string_lossy().into_owned())
        }
    }

    /// Registry open commands look like `"C:\...\browser.exe" -osint -url "%1"`,
    /// while App Paths holds a bare path; both spellings must yield the exe.
    fn exe_from_command(command: &str) -> Option<PathBuf> {
        let command = command.trim();
        let path = match command.strip_prefix('"') {
            Some(rest) => rest.split('"').next()?.to_string(),
            None => {
                let end = command.to_ascii_lowercase().find(".exe").map(|i| i + 4)?;
                command[..end].to_string()
            }
        };
        Some(PathBuf::from(path.trim()))
    }

    fn installed_exe(command: Option<String>) -> Option<PathBuf> {
        let path = exe_from_command(command.as_deref()?)?;
        path.is_file().then_some(path)
    }

    /// Every browser the machine can offer, best guess first: the user's own
    /// choice, then anything installed, then the usual install locations.
    pub fn browsers() -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = Vec::new();
        let mut push = |found: Option<PathBuf>| {
            if let Some(path) = found {
                if !out.contains(&path) {
                    out.push(path);
                }
            }
        };

        if let Some(prog_id) = reg_string(HKEY_CURRENT_USER, USER_CHOICE, Some("ProgId")) {
            let key = format!(r"{prog_id}\shell\open\command");
            push(installed_exe(reg_string(HKEY_CLASSES_ROOT, &key, None)));
        }
        for exe in BROWSER_EXES {
            let key = format!(r"{APP_PATHS}\{exe}");
            for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
                push(installed_exe(reg_string(root, &key, None)));
            }
        }
        for root in PATH_ROOTS {
            let Some(base) = std::env::var_os(root) else { continue };
            for rel in KNOWN_PATHS {
                let path = PathBuf::from(&base).join(rel);
                push(path.is_file().then_some(path));
            }
        }
        out
    }

    #[cfg(test)]
    mod tests {
        use super::exe_from_command;

        #[test]
        fn exe_is_extracted_from_both_registry_spellings() {
            // (input, extracted path or None, why this case exists)
            let cases: &[(&str, Option<&str>, &str)] = &[
                (
                    r#""C:\Program Files\Nope\browser.exe" -osint -url "%1""#,
                    Some(r"C:\Program Files\Nope\browser.exe"),
                    "shell\\open\\command quotes the exe and appends switches",
                ),
                (
                    r"C:\Program Files\Nope\browser.exe",
                    Some(r"C:\Program Files\Nope\browser.exe"),
                    "App Paths stores a bare path with no switches",
                ),
                (
                    r"C:\Program Files\Nope\browser.exe -url %1",
                    Some(r"C:\Program Files\Nope\browser.exe"),
                    "an unquoted path with spaces must stop at the .exe, not at the first space",
                ),
                ("", None, "an empty value carries no path"),
                (
                    r"C:\Program Files\Nope\browser",
                    None,
                    "a value without .exe is not a launchable program",
                ),
            ];

            for (input, expected, why) in cases {
                let parsed = exe_from_command(input);
                assert_eq!(
                    parsed.as_deref().map(|p| p.to_string_lossy().into_owned()),
                    expected.map(|s| s.to_string()),
                    "exe_from_command({input:?}) returned {parsed:?}. \
                     Reason this case is pinned: {why}",
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::validate_external_url;

    #[test]
    fn external_url_verdicts() {
        // (input, should be accepted, why this case exists)
        let cases: &[(&str, bool, &str)] = &[
            ("https://millida.net/news", true, "plain https must keep working"),
            ("http://millida.net/news", true, "plain http must keep working"),
            ("HTTPS://MILLIDA.NET/news", true, "scheme comparison must be case-insensitive"),
            ("https://millida.net/p?a=1&b=2", true, "query strings must survive intact"),
            ("http:foo", true, "scheme-relative http is normalised to a real host by the URL parser"),
            ("  https://millida.net/  ", true, "surrounding whitespace must be trimmed, not rejected"),
            ("javascript:alert(1)", false, "javascript: would execute code in the opening context"),
            ("file:///C:/Windows", false, "file: would expose the local filesystem"),
            ("data:text/html,<script>alert(1)</script>", false, "data: can carry inline HTML/JS"),
            ("http:///", false, "http with an empty host is not a real destination"),
            ("millida://deeplink", false, "our own deep-link scheme must not be re-entered from a link"),
            ("https://millida.net/\r\nHeader: x", false, "CR/LF enable injection into whatever consumes the URL"),
            ("https://millida.net/\0evil", false, "NUL truncates the URL in C-string based platform APIs"),
            ("", false, "empty input is not a URL"),
            ("   ", false, "whitespace-only input is not a URL"),
        ];

        for (input, expected_ok, why) in cases {
            let verdict = validate_external_url(input);
            assert_eq!(
                verdict.is_ok(),
                *expected_ok,
                "validate_external_url({input:?}) returned {verdict:?}, expected {}. \
                 Reason this case is pinned: {why}",
                if *expected_ok { "Ok" } else { "Err" },
            );
        }
    }

    #[test]
    fn query_is_not_truncated_at_first_ampersand() {
        let parsed = validate_external_url("https://millida.net/p?a=1&b=2")
            .expect("a normal https URL with two query parameters must be accepted");
        assert_eq!(
            parsed.query(),
            Some("a=1&b=2"),
            "the whole query string must reach the browser; an earlier revision cut the URL \
             at the first '&', silently dropping parameters",
        );
    }

    #[test]
    fn accepted_url_keeps_its_host_and_scheme() {
        let parsed = validate_external_url("HTTPS://MILLIDA.NET/news")
            .expect("upper-case scheme and host must be accepted");
        assert_eq!(parsed.scheme(), "https", "scheme must normalise to lower case");
        assert_eq!(
            parsed.host_str(),
            Some("millida.net"),
            "host must be preserved so the user lands on the site they clicked",
        );
    }
}
