use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::process::Command;
use std::time::Duration;

use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_RANGE, LOCATION, RANGE};
use reqwest::StatusCode;

use crate::manifest::{self, Build};

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

const MAX_INSTALLER_BYTES: u64 = 1024 * 1024 * 1024;
const STALE_AFTER: Duration = Duration::from_secs(3600);
const MAX_REDIRECTS: usize = 5;
const DOWNLOAD_ATTEMPTS: usize = 3;

const PARALLEL_PARTS: u64 = 4;
const PARALLEL_MIN_BYTES: u64 = 4 * 1024 * 1024;
const PART_BUFFER: usize = 256 * 1024;

/// Not %TEMP%: that path comes from TMP/TEMP in the environment, and whoever
/// starts the stub (a browser, a messenger) controls it — a world-writable
/// folder there would let a neighbour swap the installer between the signature
/// check and the launch. %LOCALAPPDATA% is ours, and rules that forbid running
/// executables out of %TEMP% do not fire on it either.
#[cfg(windows)]
fn base_dir() -> PathBuf {
    match std::env::var_os("LOCALAPPDATA") {
        Some(local) if !local.is_empty() => PathBuf::from(local).join("Millida").join("setup"),
        _ => std::env::temp_dir(),
    }
}

/// Same reasoning as on Windows, and /tmp is the worse case of it: shared by
/// every account on the machine.
#[cfg(unix)]
fn base_dir() -> PathBuf {
    let home = home_dir().ok();
    #[cfg(target_os = "macos")]
    let dir = home.map(|h| h.join("Library").join("Caches").join("Millida").join("setup"));
    #[cfg(not(target_os = "macos"))]
    let dir = std::env::var_os("XDG_CACHE_HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| home.map(|h| h.join(".cache")))
        .map(|cache| cache.join("millida").join("setup"));
    dir.unwrap_or_else(std::env::temp_dir)
}

#[cfg(unix)]
pub fn home_dir() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| "не найдена домашняя папка: переменная HOME пуста".to_string())
}

/// The file the manifest points at for this platform: an NSIS installer, an
/// AppImage or a packed .app.
#[cfg(windows)]
pub const PAYLOAD_NAME: &str = "millida-launcher-setup.exe";
#[cfg(target_os = "linux")]
pub const PAYLOAD_NAME: &str = "millida-launcher.AppImage";
#[cfg(target_os = "macos")]
pub const PAYLOAD_NAME: &str = "millida-launcher.app.tar.gz";

/// Removes the working directory on every path out, including the error ones:
/// a half-downloaded installer left behind is what an antivirus reports.
pub struct Workspace(PathBuf);

impl Workspace {
    pub fn create() -> Result<Self, String> {
        static SEQ: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = base_dir().join(format!("{}{}", own_prefix(), seq));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).map_err(|e| format!("не создать рабочую папку: {}", e))?;
        Ok(Self(dir))
    }

    pub fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn own_prefix() -> String {
    format!("millida-setup-{}-", std::process::id())
}

/// Closing the window kills the process before Drop runs, so leftovers from an
/// aborted run are swept on the next start rather than trusted to unwinding.
pub fn sweep_stale() {
    let Ok(entries) = std::fs::read_dir(base_dir()) else {
        return;
    };
    let mine = own_prefix();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("millida-setup-") || name.starts_with(&mine) {
            continue;
        }
        // The folder is shared by every session of one user, the mutex is not:
        // a fresh folder may belong to a live installer in another session.
        let fresh = entry
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| t.elapsed().map(|age| age < STALE_AFTER).unwrap_or(true))
            .unwrap_or(false);
        if !fresh {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// The lock a second copy trips over: two installers would race over the same
/// working files and hand the same app to two unpackers at once.
#[cfg(unix)]
pub struct Lock(PathBuf);

#[cfg(unix)]
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(unix)]
pub enum Instance {
    Held(#[allow(dead_code)] Lock),
    AlreadyRunning,
    Unknown,
}

/// A lock file that could not be taken at all is not a second copy: refusing to
/// start there would look like the installer doing nothing.
#[cfg(unix)]
pub fn single_instance() -> Instance {
    let dir = base_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return Instance::Unknown;
    }
    let path = dir.join("setup.lock");
    for _ in 0..2 {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(_) => return Instance::Held(Lock(path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                // A killed run leaves the file behind, and only a fresh one
                // really means another installer is working right now.
                let fresh = std::fs::metadata(&path)
                    .and_then(|meta| meta.modified())
                    .map(|time| time.elapsed().map(|age| age < STALE_AFTER).unwrap_or(true))
                    .unwrap_or(true);
                if fresh {
                    return Instance::AlreadyRunning;
                }
                if std::fs::remove_file(&path).is_err() {
                    return Instance::Unknown;
                }
            }
            Err(_) => return Instance::Unknown,
        }
    }
    Instance::Unknown
}

pub fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("MillidaLauncherSetup/1")
        .connect_timeout(Duration::from_secs(15))
        // The blocking client only has a whole-request timeout, and its default
        // of 30 seconds would not cover half the installer. Generous enough for
        // a slow mobile connection.
        .timeout(Duration::from_secs(7200))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("не поднять сетевой клиент: {}", e))
}

/// Redirects are followed by hand so that every hop, not just the first, is
/// checked against the host list.
fn fetch(client: &Client, url: &str, limit: u64, fresh: bool) -> Result<Response, String> {
    fetch_range(client, url, limit, fresh, None).map(|(response, _)| response)
}

/// Returns the response and the URL it finally came from, so a parallel
/// download can reuse the already-checked address instead of walking the
/// redirect chain again for every part.
fn fetch_range(
    client: &Client,
    url: &str,
    limit: u64,
    fresh: bool,
    range: Option<(u64, u64)>,
) -> Result<(Response, url::Url), String> {
    let mut current = manifest::check_url(url)?;
    for _ in 0..=MAX_REDIRECTS {
        let mut request = client.get(current.clone());
        if fresh {
            request = request.header("Cache-Control", "no-cache");
        }
        if let Some((from, to)) = range {
            request = request.header(RANGE, format!("bytes={}-{}", from, to));
        }
        let response = request
            .send()
            .map_err(|e| format!("не достучаться до {}: {}", current, e))?;
        let status = response.status();
        if status.is_redirection() {
            let target = response
                .headers()
                .get(LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| format!("сервер перенаправил без адреса: {}", current))?;
            current = next_hop(&current, target)?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("сервер ответил {} на {}", status.as_u16(), current));
        }
        if range.is_none() && response.content_length().is_some_and(|len| len > limit) {
            return Err(format!("файл больше допустимого: {}", current));
        }
        return Ok((response, current));
    }
    Err("слишком много перенаправлений".into())
}

/// Asks for one byte to learn the size and whether the server serves ranges at
/// all — a HEAD would be cheaper, but caches in front of the storage answer it
/// inconsistently.
fn probe(client: &Client, url: &str) -> Option<(url::Url, u64)> {
    let (response, resolved) = fetch_range(client, url, MAX_INSTALLER_BYTES, false, Some((0, 0))).ok()?;
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let total: u64 = response
        .headers()
        .get(CONTENT_RANGE)?
        .to_str()
        .ok()?
        .rsplit('/')
        .next()?
        .trim()
        .parse()
        .ok()?;
    if total == 0 || total > MAX_INSTALLER_BYTES {
        return None;
    }
    Some((resolved, total))
}

/// Split out because this is the security-critical half of following a
/// redirect: a protocol-relative or absolute Location must land back on the
/// host list, not just the first URL of the chain.
fn next_hop(current: &url::Url, location: &str) -> Result<url::Url, String> {
    let next = current
        .join(location)
        .map_err(|_| format!("непонятный адрес перенаправления: {}", location))?;
    manifest::check_url(next.as_str())
}

pub fn fetch_build(client: &Client) -> Result<Build, String> {
    let mut failures: Vec<String> = Vec::new();
    for url in manifest::MANIFEST_URLS {
        let attempt = fetch(client, url, MAX_MANIFEST_BYTES, true).and_then(|response| {
            let mut body = String::new();
            response
                .take(MAX_MANIFEST_BYTES)
                .read_to_string(&mut body)
                .map_err(|e| format!("не прочитать ответ {}: {}", url, e))?;
            manifest::parse(&body)
        });
        match attempt {
            Ok(build) => return Ok(build),
            // Every reason, not just the last one: the first is usually the
            // real cause and the last one is about the fallback mirror.
            Err(e) => failures.push(e),
        }
    }
    Err(if failures.is_empty() { "нет ни одного источника".into() } else { failures.join("; ") })
}

pub fn download(
    client: &Client,
    url: &str,
    dest: &Path,
    mut report: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    // The fast path is tried once: either it finishes in seconds, or the server
    // serves no ranges and the plain sequential download takes over with its own
    // retries.
    if let Some((resolved, total)) = probe(client, url).filter(|(_, total)| *total >= PARALLEL_MIN_BYTES) {
        match download_parts(client, &resolved, dest, total, &mut report) {
            Ok(()) => return Ok(()),
            Err(_) => {
                let _ = std::fs::remove_file(dest);
            }
        }
    }
    let mut last = String::new();
    for attempt in 1..=DOWNLOAD_ATTEMPTS {
        match download_once(client, url, dest, &mut report) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = e;
                let _ = std::fs::remove_file(dest);
                if attempt < DOWNLOAD_ATTEMPTS {
                    std::thread::sleep(Duration::from_secs(2));
                }
            }
        }
    }
    Err(last)
}

#[cfg(windows)]
fn write_at(file: &File, buffer: &[u8], offset: u64) -> std::io::Result<usize> {
    use std::os::windows::fs::FileExt;
    file.seek_write(buffer, offset)
}

#[cfg(not(windows))]
fn write_at(file: &File, buffer: &[u8], offset: u64) -> std::io::Result<usize> {
    use std::os::unix::fs::FileExt;
    file.write_at(buffer, offset)
}

fn download_parts(
    client: &Client,
    url: &url::Url,
    dest: &Path,
    total: u64,
    report: &mut impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

    let file = File::create(dest).map_err(|e| format!("не создать файл установщика: {}", e))?;
    file.set_len(total).map_err(|e| format!("не разметить файл установщика: {}", e))?;

    let chunk = total.div_ceil(PARALLEL_PARTS);
    let done = AtomicU64::new(0);
    let finished = AtomicUsize::new(0);
    let failures: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    let parts = (0..PARALLEL_PARTS)
        .map(|index| (index * chunk, ((index + 1) * chunk).min(total) - 1))
        .filter(|(from, to)| from <= to)
        .collect::<Vec<_>>();

    std::thread::scope(|scope| {
        for (from, to) in &parts {
            let (from, to) = (*from, *to);
            let (file, done, finished, failures) = (&file, &done, &finished, &failures);
            scope.spawn(move || {
                // Counted even on a panic: otherwise the reporting loop below
                // would wait forever for a thread that is already gone.
                struct Tally<'a>(&'a AtomicUsize);
                impl Drop for Tally<'_> {
                    fn drop(&mut self) {
                        self.0.fetch_add(1, Ordering::Release);
                    }
                }
                let _tally = Tally(finished);
                if let Err(e) = fetch_part(client, url, file, from, to, done) {
                    if let Ok(mut list) = failures.lock() {
                        list.push(e);
                    }
                }
            });
        }
        while finished.load(Ordering::Acquire) < parts.len() {
            report(done.load(Ordering::Relaxed), Some(total));
            std::thread::sleep(Duration::from_millis(100));
        }
    });

    if let Some(reason) = failures.lock().ok().and_then(|list| list.first().cloned()) {
        return Err(reason);
    }
    let written = done.load(Ordering::Relaxed);
    if written != total {
        return Err(format!("скачано {} байт из {}", written, total));
    }
    report(total, Some(total));
    Ok(())
}

fn fetch_part(
    client: &Client,
    url: &url::Url,
    file: &File,
    from: u64,
    to: u64,
    done: &std::sync::atomic::AtomicU64,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    let (mut response, _) = fetch_range(client, url.as_str(), MAX_INSTALLER_BYTES, false, Some((from, to)))?;
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err("сервер перестал отдавать файл по частям".into());
    }
    let mut buffer = vec![0u8; PART_BUFFER];
    let mut offset = from;
    loop {
        let read = response.read(&mut buffer).map_err(|e| format!("загрузка оборвалась: {}", e))?;
        if read == 0 {
            break;
        }
        if offset + read as u64 > to + 1 {
            return Err("сервер прислал больше запрошенного".into());
        }
        let written = write_at(file, &buffer[..read], offset).map_err(|e| format!("не записать файл установщика: {}", e))?;
        if written != read {
            return Err("файл записался не полностью".into());
        }
        offset += read as u64;
        done.fetch_add(read as u64, Ordering::Relaxed);
    }
    if offset != to + 1 {
        return Err("часть файла пришла не целиком".into());
    }
    Ok(())
}

fn download_once(
    client: &Client,
    url: &str,
    dest: &Path,
    report: &mut impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let mut response = fetch(client, url, MAX_INSTALLER_BYTES, false)?;
    let total = response.content_length();
    let mut file = File::create(dest).map_err(|e| format!("не создать файл установщика: {}", e))?;
    let mut buffer = vec![0u8; 64 * 1024];
    let mut done: u64 = 0;
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("загрузка оборвалась: {}", e))?;
        if read == 0 {
            break;
        }
        done += read as u64;
        if done > MAX_INSTALLER_BYTES {
            return Err("установщик оказался больше допустимого".into());
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("не записать файл установщика: {}", e))?;
        report(done, total);
    }
    file.flush().map_err(|e| format!("не записать файл установщика: {}", e))?;
    if total.is_some_and(|len| len != done) {
        return Err("загрузка оборвалась на середине".into());
    }
    Ok(())
}

fn decode_text(value: &str) -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|e| format!("не разобрать base64: {}", e))?;
    String::from_utf8(raw).map_err(|e| e.to_string())
}

fn open_locked(file: &Path) -> std::io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_SHARE_READ: u32 = 1;
        std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ).open(file)
    }
    #[cfg(not(windows))]
    {
        File::open(file)
    }
}

/// Reads through a handle opened with writes and deletes denied, so the bytes
/// checked are the bytes on disk at that moment. The handle is closed before the
/// launch on purpose: holding it sends the antivirus check of the new file down
/// a slow path and turns a three-second install into a four-minute one.
pub fn verify(file: &Path, signature: &str) -> Result<(), String> {
    let mut handle = open_locked(file).map_err(|e| format!("не открыть скачанный установщик: {}", e))?;
    let key = PublicKey::decode(decode_text(manifest::PUBKEY)?.trim())
        .map_err(|e| format!("ключ обновлений не разобран: {}", e))?;
    let signature = Signature::decode(decode_text(signature)?.trim())
        .map_err(|e| format!("подпись установщика не разобрана: {}", e))?;
    let mut bytes = Vec::new();
    handle.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    key.verify(&bytes, &signature, true)
        .map_err(|_| "подпись установщика не сошлась".to_string())
}

/// /S installs without questions, /R starts the launcher afterwards. The NSIS
/// bundle is built in currentUser mode, so neither step asks for administrator
/// rights — with a per-machine bundle a silent install would fail silently.
#[cfg(windows)]
pub fn run_installer(file: &Path, cwd: &Path) -> Result<(), String> {
    let status = Command::new(file)
        .args(["/S", "/R"])
        // Otherwise the child inherits the Downloads folder, where any site can
        // drop a dll under a name the installer looks for.
        .current_dir(cwd)
        .status()
        .map_err(|e| format!("установщик не запустился: {}", e))?;
    match status.code() {
        Some(0) => Ok(()),
        Some(code) => Err(format!("установщик завершился с кодом {}", code)),
        None => Err("установщик был прерван".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sabotage check: if next_hop stops checking the host, this is the case
    /// that fails.
    #[test]
    fn redirect_verdicts() {
        let start = url::Url::parse("https://launcher-storage.millida.net/1.0.9/x/a-setup.exe").expect("адрес");
        let cases: &[(&str, bool)] = &[
            ("/1.0.9/y/b-setup.exe", true),
            ("b-setup.exe", true),
            ("https://launcher-storage.millida.net/other.exe", true),
            ("https://millida.net/launcher/other.exe", true),
            ("https://millida.net/uploads/other.exe", false),
            ("//evil.example/x.exe", false),
            ("http://launcher-storage.millida.net/x.exe", false),
            ("https://evil.example/x.exe", false),
            ("javascript:alert(1)", false),
            ("file:///C:/x.exe", false),
        ];
        for (location, expected) in cases {
            assert_eq!(
                next_hop(&start, location).is_ok(),
                *expected,
                "перенаправление на {} должно было быть {}: проверяется каждый шаг цепочки, а не только первый адрес",
                location,
                if *expected { "принято" } else { "отклонено" }
            );
        }
    }

    #[test]
    fn embedded_key_is_readable() {
        let text = decode_text(manifest::PUBKEY).expect("ключ обязан быть base64");
        assert!(
            PublicKey::decode(text.trim()).is_ok(),
            "вшитый ключ обязан читаться minisign: он единственный, и подменить его обновлением нельзя"
        );
    }

    #[test]
    fn verify_rejects_garbage_signature() {
        let dir = Workspace::create().expect("рабочая папка");
        let file = dir.file("probe.bin");
        std::fs::write(&file, b"payload").expect("файл");
        assert!(
            verify(&file, "bm9wZQ==").is_err(),
            "мусор вместо подписи обязан отклоняться: иначе стаб запустит любой скачанный файл"
        );
    }

    /// Pins the one thing unit tests cannot: that the artifact the release
    /// pipeline publishes really validates against the key baked into the stub.
    /// The stub cannot be fixed by an update, so a mismatch here is fatal.
    #[test]
    #[ignore = "goes over the network: run by hand"]
    fn live_build_matches_embedded_key() {
        let client = client().expect("сетевой клиент");
        let build = fetch_build(&client).expect("боевой манифест обязан читаться");
        let dir = Workspace::create().expect("рабочая папка");
        let file = dir.file("live-setup.exe");
        download(&client, &build.url, &file, |_, _| {}).expect("боевой установщик обязан скачиваться");
        verify(&file, &build.signature)
            .expect("подпись боевого установщика обязана сходиться с вшитым ключом");
    }

    #[test]
    fn workspace_removes_itself() {
        let path = {
            let dir = Workspace::create().expect("рабочая папка");
            std::fs::write(dir.file("probe.bin"), b"x").expect("файл");
            dir.0.clone()
        };
        assert!(!path.exists(), "рабочая папка обязана убираться и на путях ошибок");
    }
}
