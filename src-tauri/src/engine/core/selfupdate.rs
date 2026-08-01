use minisign_verify::{PublicKey, Signature};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::http::{download_fresh, get_json};
use super::paths::{data_dir, is_flatpak};
use super::safepath::safe_file_name;
#[cfg(not(windows))]
use super::paths::open_path;

// Fallback update channel for when the updater plugin cannot deliver. It reads
// the same signed manifest and verifies it with the same key from
// tauri.conf.json, so the fallback is not a hole through which a compromised CDN
// could run an arbitrary installer.
const FALLBACK_ENDPOINTS: &[&str] = &["https://launcher-storage.millida.net/latest.json"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackUpdate {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub file: String,
    pub signature: String,
    pub source: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackInstall {
    pub version: String,
    pub path: String,
    pub started: bool,
}

fn platform_key() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("windows-x86_64"),
        ("windows", "aarch64") => Ok("windows-aarch64"),
        ("macos", "aarch64") => Ok("darwin-aarch64"),
        ("macos", "x86_64") => Ok("darwin-x86_64"),
        ("linux", "x86_64") => Ok("linux-x86_64"),
        ("linux", "aarch64") => Ok("linux-aarch64"),
        (os, arch) => Err(format!("нет сборки под {} {}", os, arch)),
    }
}

/// Endpoints come from the updater plugin config; the constant above is only a
/// safety net for an empty config.
fn endpoints(app: &AppHandle) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(cfg) = app.config().plugins.0.get("updater") {
        if let Some(list) = cfg["endpoints"].as_array() {
            for e in list {
                if let Some(url) = e.as_str() {
                    let url = url
                        .replace("{{target}}", std::env::consts::OS)
                        .replace("{{arch}}", std::env::consts::ARCH)
                        .replace("{{current_version}}", &app.package_info().version.to_string());
                    if !out.contains(&url) {
                        out.push(url);
                    }
                }
            }
        }
    }
    for url in FALLBACK_ENDPOINTS {
        if !out.iter().any(|u| u == url) {
            out.push((*url).to_string());
        }
    }
    out
}

fn pubkey(app: &AppHandle) -> Result<String, String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|c| c["pubkey"].as_str().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "в конфиге нет открытого ключа обновлений".to_string())
}

fn digits(v: &str) -> Vec<u64> {
    v.split(['.', '-', '+'])
        .map(|p| p.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

pub(crate) fn is_newer(remote: &str, current: &str) -> bool {
    let clean = |v: &str| v.trim().trim_start_matches('v').to_string();
    let (r, c) = (clean(remote), clean(current));
    match (semver::Version::parse(&r), semver::Version::parse(&c)) {
        (Ok(a), Ok(b)) => a > b,
        _ => digits(&r) > digits(&c),
    }
}

/// %20 is the only accepted percent-escape: anything else could smuggle a path
/// separator past the file-name check.
fn file_from_url(url: &str) -> Result<String, String> {
    let tail = url.split(['?', '#']).next().unwrap_or(url);
    let name = tail.rsplit('/').next().unwrap_or("").replace("%20", " ");
    if name.contains('%') {
        return Err(format!("недопустимое имя файла обновления: {}", name));
    }
    safe_file_name(&name)
}

pub async fn fallback_check(app: &AppHandle) -> Result<Option<FallbackUpdate>, String> {
    fetch_manifest(app, true).await
}

/// Accepts any manifest version, including the current one — recovery repairs a
/// corrupted install by reinstalling the same artifact.
pub async fn fallback_latest(app: &AppHandle) -> Result<Option<FallbackUpdate>, String> {
    fetch_manifest(app, false).await
}

async fn fetch_manifest(app: &AppHandle, require_newer: bool) -> Result<Option<FallbackUpdate>, String> {
    // Flatpak updates itself and /app is read-only, so there is nowhere to
    // install a downloaded artifact.
    if is_flatpak() {
        return Ok(None);
    }
    let key = platform_key()?;
    let current = app.package_info().version.to_string();
    let mut last = "нет ни одного источника обновления".to_string();
    for url in endpoints(app) {
        let doc = match get_json(&url).await {
            Ok(v) => v,
            Err(e) => {
                last = e;
                continue;
            }
        };
        let version = doc["version"].as_str().unwrap_or("").trim().trim_start_matches('v').to_string();
        if version.is_empty() {
            last = format!("{}: в манифесте нет версии", url);
            continue;
        }
        if require_newer && !is_newer(&version, &current) {
            return Ok(None);
        }
        let entry = &doc["platforms"][key];
        let link = entry["url"].as_str().unwrap_or("").trim().to_string();
        let signature = entry["signature"].as_str().unwrap_or("").trim().to_string();
        if link.is_empty() || signature.is_empty() {
            last = format!("{}: в манифесте нет сборки для {}", url, key);
            continue;
        }
        return Ok(Some(FallbackUpdate {
            file: file_from_url(&link)?,
            version,
            notes: doc["notes"].as_str().unwrap_or("").to_string(),
            url: link,
            signature,
            source: url,
        }));
    }
    Err(last)
}

fn decode_text(b64: &str) -> Result<String, String> {
    use base64::Engine as _;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("не разобрать base64: {}", e))?;
    String::from_utf8(raw).map_err(|e| e.to_string())
}

fn verify(file: &Path, signature_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    let key = PublicKey::decode(decode_text(pubkey_b64)?.trim())
        .map_err(|e| format!("ключ обновлений не разобран: {}", e))?;
    let sig = Signature::decode(decode_text(signature_b64)?.trim())
        .map_err(|e| format!("подпись обновления не разобрана: {}", e))?;
    let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
    key.verify(&bytes, &sig, true)
        .map_err(|_| "подпись обновления не сошлась".to_string())
}

fn updates_dir() -> PathBuf {
    data_dir().join("updates")
}

fn drop_stale(keep: &Path) {
    let sig = sig_path(keep);
    if let Ok(rd) = std::fs::read_dir(updates_dir()) {
        for e in rd.flatten() {
            let p = e.path();
            if p != keep && p != sig {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

fn sig_path(file: &Path) -> PathBuf {
    let mut name = file.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".millidasig");
    file.with_file_name(name)
}

/// Downloads ahead of time and stores the signature next to the artifact so the
/// launch step can re-verify it without network access.
pub async fn fallback_stage(app: &AppHandle, upd: &FallbackUpdate) -> Result<PathBuf, String> {
    let dir = updates_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(safe_file_name(&upd.file)?);
    let key = pubkey(app)?;
    if !(dest.exists() && verify(&dest, &upd.signature, &key).is_ok()) {
        download_fresh(&upd.url, &dest).await?;
        if let Err(e) = verify(&dest, &upd.signature, &key) {
            let _ = std::fs::remove_file(&dest);
            return Err(e);
        }
    }
    std::fs::write(sig_path(&dest), upd.signature.as_bytes()).map_err(|e| e.to_string())?;
    drop_stale(&dest);
    Ok(dest)
}

/// Only accepts paths inside the updates directory and re-verifies the signature:
/// the file could have been swapped between download and launch.
pub fn fallback_run(app: &AppHandle, path: &str) -> Result<FallbackInstall, String> {
    let file = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("обновление не найдено: {}", e))?;
    let dir = updates_dir().canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&dir) {
        return Err("файл обновления лежит вне папки обновлений".into());
    }
    let signature = std::fs::read_to_string(sig_path(&file)).map_err(|e| format!("нет подписи обновления: {}", e))?;
    verify(&file, signature.trim(), &pubkey(app)?)?;
    let started = run_installer(&file)?;
    Ok(FallbackInstall { version: String::new(), path: file.to_string_lossy().to_string(), started })
}

pub async fn fallback_stage_latest(app: &AppHandle) -> Result<Option<FallbackInstall>, String> {
    let Some(upd) = fallback_check(app).await? else { return Ok(None) };
    let file = fallback_stage(app, &upd).await?;
    Ok(Some(FallbackInstall { version: upd.version, path: file.to_string_lossy().to_string(), started: false }))
}

/// Windows hands off to the installer; macOS and Linux replace the .app bundle
/// or AppImage in place. When there is nothing to replace (deb/rpm, not launched
/// from a bundle) the containing folder is opened instead.
///
/// `true` = the caller must terminate this process.
pub fn run_installer(file: &Path) -> Result<bool, String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(md) = std::fs::metadata(file) {
            let mut perm = md.permissions();
            perm.set_mode(perm.mode() | 0o111);
            let _ = std::fs::set_permissions(file, perm);
        }
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new(file);
        super::proc::quiet(&mut cmd);
        cmd.spawn().map_err(|e| format!("установщик не запустился: {}", e))?;
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        match install_app_bundle(file) {
            Ok(()) => Ok(true),
            Err(e) => {
                open_path(&file.parent().unwrap_or(file).to_string_lossy());
                Err(e)
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match install_appimage(file) {
            Ok(true) => Ok(true),
            Ok(false) => {
                open_path(&file.parent().unwrap_or(file).to_string_lossy());
                Ok(false)
            }
            Err(e) => {
                open_path(&file.parent().unwrap_or(file).to_string_lossy());
                Err(e)
            }
        }
    }
}

/// Relaunches only after the current process exits: single-instance would
/// otherwise see it alive and just raise the old window.
#[cfg(unix)]
fn relaunch_after_exit(target: &Path, opener: &str) -> Result<(), String> {
    let script = format!(
        r#"while kill -0 "$1" 2>/dev/null; do sleep 0.2; done; sleep 0.5; {}"#,
        opener
    );
    std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("millida-relaunch")
        .arg(std::process::id().to_string())
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("новая копия не запустилась: {}", e))
}

/// Unpacks beside the bundle (same volume, so the swap is a rename rather than a
/// copy) and moves the old bundle aside instead of deleting it: the running
/// process still loads its frameworks from there.
#[cfg(target_os = "macos")]
fn install_app_bundle(archive: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().map(|e| e.eq_ignore_ascii_case("app")).unwrap_or(false))
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "лаунчер запущен не из бандла .app".to_string())?;
    let parent = bundle.parent().ok_or_else(|| "у бандла нет родительской папки".to_string())?.to_path_buf();
    // Under Gatekeeper app translocation the bundle runs from a throwaway copy,
    // so replacing it there would have no effect on the next launch.
    if bundle.to_string_lossy().contains("/AppTranslocation/") {
        return Err("лаунчер запущен из образа — перенеси его в «Программы»".into());
    }

    let stage = parent.join(".millida-update");
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage)
        .map_err(|e| format!("нет прав на запись в {}: {}", parent.display(), e))?;

    let unpacked = unpack_bundle(archive, &stage);
    let fresh = match unpacked {
        Ok(p) => p,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&stage);
            return Err(e);
        }
    };

    // Permissions and the quarantine attribute are fixed before the swap: an
    // archived bundle can arrive without the write bit.
    let _ = std::process::Command::new("/bin/chmod").arg("-R").arg("u+w").arg(&fresh).status();
    let _ = std::process::Command::new("/usr/bin/xattr").arg("-cr").arg(&fresh).status();

    let retired = parent.join(format!(".millida-old-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&retired);
    std::fs::rename(&bundle, &retired).map_err(|e| {
        let _ = std::fs::remove_dir_all(&stage);
        format!("старую копию не сдвинуть ({}): {}", bundle.display(), e)
    })?;
    if let Err(e) = std::fs::rename(&fresh, &bundle) {
        let _ = std::fs::rename(&retired, &bundle);
        let _ = std::fs::remove_dir_all(&stage);
        return Err(format!("новая копия не встала на место: {}", e));
    }
    let _ = std::fs::remove_dir_all(&stage);
    relaunch_after_exit(&bundle, r#"open -n "$2""#)
}

/// Uses the system tar: it preserves the symlinks inside Contents/Frameworks and
/// the permission bits a signed bundle needs in order to launch.
#[cfg(target_os = "macos")]
fn unpack_bundle(archive: &Path, stage: &Path) -> Result<PathBuf, String> {
    let st = std::process::Command::new("/usr/bin/tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(stage)
        .status()
        .map_err(|e| format!("tar не запустился: {}", e))?;
    if !st.success() {
        return Err("архив обновления не распаковался".to_string());
    }
    std::fs::read_dir(stage)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().map(|e| e.eq_ignore_ascii_case("app")).unwrap_or(false))
        .ok_or_else(|| "в архиве обновления нет бандла .app".to_string())
}

/// Retired bundles cannot be removed during the update itself (the live process
/// still maps frameworks from them), so they are swept at startup.
#[cfg(target_os = "macos")]
pub fn sweep_retired_bundles() {
    let Ok(exe) = std::env::current_exe() else { return };
    let Some(parent) = exe
        .ancestors()
        .find(|p| p.extension().map(|e| e.eq_ignore_ascii_case("app")).unwrap_or(false))
        .and_then(|p| p.parent())
    else {
        return;
    };
    let Ok(rd) = std::fs::read_dir(parent) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with(".millida-old-") || name == ".millida-update" {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// Writing into a running AppImage fails with ETXTBSY, but renaming over it is
/// allowed, so the new file is staged alongside and renamed into place.
/// `false` = nothing to install (deb/rpm, or the artifact is not an AppImage).
#[cfg(all(unix, not(target_os = "macos")))]
fn install_appimage(file: &Path) -> Result<bool, String> {
    let Some(current) = std::env::var_os("APPIMAGE").map(PathBuf::from) else { return Ok(false) };
    let name = file.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !name.ends_with(".appimage") {
        return Ok(false);
    }
    let mut tmp_name = current.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    tmp_name.push(".new");
    let tmp = current.with_file_name(tmp_name);
    std::fs::copy(file, &tmp).map_err(|e| format!("нет прав на запись в {}: {}", current.display(), e))?;
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755));
    }
    if let Err(e) = std::fs::rename(&tmp, &current) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("новая копия не встала на место: {}", e));
    }
    relaunch_after_exit(&current, r#"exec "$2""#).map(|_| true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("1.0.49", "1.0.11"));
        assert!(is_newer("1.1.0", "1.0.99"));
        assert!(!is_newer("1.0.11", "1.0.49"));
        assert!(!is_newer("1.0.49", "1.0.49"));
        assert!(is_newer("v1.0.50", "1.0.49"));
    }

    #[test]
    fn compares_versions_beyond_semver() {
        assert!(is_newer("1.0.49.2", "1.0.49"));
        assert!(!is_newer("1.0", "1.0.1"));
    }

    #[test]
    fn takes_file_name_from_url() {
        assert_eq!(
            file_from_url("https://cdn/1.0.49/x86_64-pc-windows-msvc/Millida-Launcher_1.0.49_x64-setup.exe").unwrap(),
            "Millida-Launcher_1.0.49_x64-setup.exe"
        );
        assert_eq!(file_from_url("https://cdn/1.0.49/win/Millida%20Launcher.exe").unwrap(), "Millida Launcher.exe");
    }

    #[test]
    fn rejects_path_in_file_name() {
        assert!(file_from_url("https://cdn/x/..%2F..%2Fevil.exe").is_err());
        assert!(file_from_url("https://cdn/x/").is_err());
    }

    /// Hits the live manifest and artifact, so it runs only via
    /// `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore = "hits the network"]
    async fn live_manifest_and_signature() {
        let conf: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string("tauri.conf.json").expect("tauri.conf.json")).expect("json");
        let updater = &conf["plugins"]["updater"];
        let key = updater["pubkey"].as_str().expect("pubkey").to_string();
        let url = updater["endpoints"][0].as_str().expect("endpoint").to_string();

        let doc = get_json(&url).await.expect("манифест не отдался");
        assert!(!doc["version"].as_str().unwrap_or("").is_empty(), "в манифесте нет версии");
        let entry = &doc["platforms"][platform_key().unwrap()];
        let link = entry["url"].as_str().expect("нет ссылки под эту платформу");
        let signature = entry["signature"].as_str().expect("нет подписи под эту платформу");

        let dest = std::env::temp_dir().join("millida-update-live").join(file_from_url(link).unwrap());
        download_fresh(link, &dest).await.expect("артефакт не скачался");
        verify(&dest, signature, &key).expect("подпись артефакта не сошлась");
        let _ = std::fs::remove_file(&dest);
    }
}
