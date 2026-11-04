// Fallback launcher update: takes the version list from launcher-storage.millida.net (addresses from tauri.conf.json), downloads the new build from GitHub or from our mirror and checks the Millida signature (minisign).
// If the signature does not match, the file is deleted and not run. Running the installer, replacing the .app on macOS and the AppImage on Linux are described at each function.
use minisign_verify::{PublicKey, Signature};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::http::{download_checked, download_fresh, get_json, Sum};
use super::selfdelta::{self, DeltaOffer};
use super::silentupdate;
use super::paths::{data_dir, is_flatpak};
use super::prefs::ui_pref;
use super::safepath::safe_file_name;
#[cfg(not(windows))]
use super::paths::open_path;

// Fallback update channel for when the updater plugin cannot deliver. It reads
// the same signed manifest and verifies it with the same key from
// tauri.conf.json, so the fallback is not a hole through which a compromised CDN
// could run an arbitrary installer.
// Fallback address of the version list. It returns json with the version, the file link and the signature. The main path goes through the Tauri updater plugin.
const FALLBACK_ENDPOINTS: &[&str] = &["https://launcher-storage.millida.net/latest.json"];

// Testing channel. The player opts in from settings and then sees a release
// before everyone else, so a heavy change lands on a few hundred machines
// before it lands on all of them.
const BETA_PREF: &str = "m-beta";

pub(crate) fn beta_channel() -> bool {
    ui_pref(BETA_PREF).as_deref() == Some("1")
}

/// The beta manifest sits next to the stable one under the same name, signed by
/// the same key: the setting picks a file, never a host. A URL the webview could
/// choose would be an update channel anyone with XSS could point anywhere.
fn beta_url(url: &str) -> Option<String> {
    // The query (`?v=…`) stays: without it the edge serves its own stale copy
    // of the manifest (see `endpoints` in tauri.conf.json).
    let (path, query) = match url.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (url, None),
    };
    let (head, tail) = path.rsplit_once('/')?;
    match tail {
        "latest.json" => Some(match query {
            Some(q) => format!("{}/beta.json?{}", head, q),
            None => format!("{}/beta.json", head),
        }),
        _ => None,
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackUpdate {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub file: String,
    pub signature: String,
    pub source: String,
    /// The same bytes on our CDN when `url` points at the GitHub release: if
    /// GitHub is unreachable the file comes from here and must pass the same
    /// signature check.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mirror: Option<String>,
    /// The manifest marks this release as one that must not wait for the player to quit
    /// (`"critical": true` at the top or in the platform entry). Absent means an ordinary release.
    #[serde(default)]
    pub critical: bool,
    /// A patch from named older executables to this one, when the release publishes it (selfdelta.rs). The window
    /// never sees it: the core decides whether to use it.
    #[serde(skip)]
    pub delta: Option<DeltaOffer>,
}

/// `critical` in the manifest, at the top level or on the platform's own entry.
pub(crate) fn manifest_critical(doc: &serde_json::Value, platform_key: &str) -> bool {
    doc["critical"].as_bool().unwrap_or(false) || doc["platforms"][platform_key]["critical"].as_bool().unwrap_or(false)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FallbackInstall {
    pub version: String,
    pub path: String,
    pub started: bool,
}

/// What the new copy does after an install the launcher started itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Restart {
    /// The player quit: nothing starts again.
    No,
    /// The new copy opens its window: the player pressed «Обновить», or started the launcher and an update was waiting.
    Show,
    /// The new copy starts in the tray without a window and the installer shows nothing: an install while nobody looks
    /// (the launcher sat in the tray, or was started at login).
    Tray,
}

/// The flag the system passes at login (commands::system::AUTOSTART_ARG): a copy started with it stays in the tray.
/// Kept here so the engine does not reach up into the commands; a test holds the two equal.
pub(crate) const TRAY_START_ARG: &str = "--autostart";

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

/// Same lookup order as the updater plugin: a deb or rpm install must get its
/// own package, since the AppImage behind the bare key cannot replace it.
fn platform_keys() -> Result<Vec<String>, String> {
    let base = platform_key()?;
    let package = match tauri::utils::platform::bundle_type() {
        Some(tauri::utils::config::BundleType::Deb) => Some("deb"),
        Some(tauri::utils::config::BundleType::Rpm) => Some("rpm"),
        _ => None,
    };
    Ok(package.map(|p| format!("{}-{}", base, p)).into_iter().chain([base.to_string()]).collect())
}

/// Endpoints come from the updater plugin config; the constant above is only a
/// safety net for an empty config.
/// Порядок опроса манифестов. Вынесен из чтения конфига, потому что именно
/// порядок и решает, что получит тестировщик: бета обязана стоять перед своим
/// же стабильным соседом, а сеть тут ни при чём.
fn channel_order(configured: &[String], beta: bool) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let push = |url: String, out: &mut Vec<String>| {
        if !out.contains(&url) {
            out.push(url);
        }
    };
    for url in configured.iter().map(|u| u.to_string()).chain(FALLBACK_ENDPOINTS.iter().map(|u| u.to_string())) {
        if beta {
            if let Some(b) = beta_url(&url) {
                push(b, &mut out);
            }
        }
        push(url, &mut out);
    }
    out
}

fn endpoints(app: &AppHandle) -> Vec<String> {
    let mut configured: Vec<String> = Vec::new();
    if let Some(cfg) = app.config().plugins.0.get("updater") {
        if let Some(list) = cfg["endpoints"].as_array() {
            for e in list {
                if let Some(url) = e.as_str() {
                    configured.push(
                        url.replace("{{target}}", std::env::consts::OS)
                            .replace("{{arch}}", std::env::consts::ARCH)
                            .replace("{{current_version}}", &app.package_info().version.to_string()),
                    );
                }
            }
        }
    }
    channel_order(&configured, beta_channel())
}

// The public signing key comes from tauri.conf.json. The private part belongs to Millida and is not in this repository.
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
    let keys = platform_keys()?;
    let current = app.package_info().version.to_string();
    let mut last = "нет ни одного источника обновления".to_string();
    // Beta sits in front of its own stable sibling, and only that pair is
    // compared: the scan still stops at the first stable manifest that works, so
    // a manifest signed by another key never competes with this one.
    let mut best: Option<FallbackUpdate> = None;
    for url in endpoints(app) {
        let beta = url.split('?').next().unwrap_or(&url).ends_with("/beta.json");
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
        let entry = |key: &str| {
            let e = &doc["platforms"][key];
            let link = e["url"].as_str().unwrap_or("").trim().to_string();
            let signature = e["signature"].as_str().unwrap_or("").trim().to_string();
            let mirror = e["mirror"].as_str().map(|m| m.trim().to_string()).filter(|m| m.starts_with("https://"));
            let critical = manifest_critical(&doc, key);
            (!link.is_empty() && !signature.is_empty()).then(|| (link, signature, mirror, critical, selfdelta::parse_offer(&e["delta"])))
        };
        let Some((link, signature, mirror, critical, delta)) = keys.iter().find_map(|k| entry(k.as_str())) else {
            last = format!("{}: в манифесте нет сборки для {}", url, keys.join(" / "));
            continue;
        };
        let found = FallbackUpdate {
            file: file_from_url(&link)?,
            version,
            notes: doc["notes"].as_str().unwrap_or("").to_string(),
            url: link,
            signature,
            source: url,
            mirror,
            critical,
            delta,
        };
        if best.as_ref().is_none_or(|b| is_newer(&found.version, &b.version)) {
            best = Some(found);
        }
        if !beta {
            break;
        }
    }
    let Some(found) = best else {
        return Err(last);
    };
    if !update_acceptable(&found.version, &current, require_newer) {
        return Ok(None);
    }
    Ok(Some(found))
}

/// Rollback protection. The manifest is signed, but a signed OLD release is
/// still a valid signature: a hijacked or stale manifest could pin players to a
/// build with known holes. So a version lower than the running one is never
/// offered, on any path. `allow_same` is for recovery, which reinstalls the same
/// artifact over a damaged install. (The beta -> stable switch just waits for
/// the next stable that is newer than the running beta.)
pub(crate) fn update_acceptable(remote: &str, current: &str, require_newer: bool) -> bool {
    if require_newer {
        is_newer(remote, current)
    } else {
        is_newer(remote, current) || !is_newer(current, remote)
    }
}

fn decode_text(b64: &str) -> Result<String, String> {
    use base64::Engine as _;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("не разобрать base64: {}", e))?;
    String::from_utf8(raw).map_err(|e| e.to_string())
}

// minisign signature check: key and signature in base64, as Tauri issues them. If the signature does not match, the update is not installed.
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

/// The Windows updater relaunches the new build with the arguments of the old
/// one, so a launcher started at login carries `--autostart` into the relaunch
/// and would hide itself in the tray right after the player pressed "Update".
/// The marker lives outside `updates_dir`, which `drop_stale` empties.
fn show_after_update_marker() -> PathBuf {
    data_dir().join("show-after-update")
}

const SHOW_AFTER_UPDATE_TTL: std::time::Duration = std::time::Duration::from_secs(600);

fn show_after_update_fresh(age: Option<std::time::Duration>) -> bool {
    age.is_some_and(|a| a <= SHOW_AFTER_UPDATE_TTL)
}

pub fn mark_show_after_update() -> Result<(), String> {
    std::fs::create_dir_all(data_dir()).map_err(|e| format!("нет папки данных лаунчера: {}", e))?;
    std::fs::write(show_after_update_marker(), b"")
        .map_err(|e| format!("не записана отметка показа окна после обновления: {}", e))
}

/// Consumed on every start, so an install that never happened cannot surface
/// the window at some later login.
pub fn take_show_after_update() -> bool {
    let marker = show_after_update_marker();
    let age = std::fs::metadata(&marker)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok());
    if age.is_some() {
        let _ = std::fs::remove_file(&marker);
    }
    show_after_update_fresh(age)
}

fn drop_stale(keep: &Path) {
    drop_stale_in(&updates_dir(), keep);
}

fn drop_stale_in(dir: &Path, keep: &Path) {
    let sig = sig_path(keep);
    let ver = ver_path(keep);
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p != keep && p != sig && p != ver {
                // Deletes old downloaded updates in our own updates folder.
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

pub(crate) fn sig_path(file: &Path) -> PathBuf {
    let mut name = file.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".millidasig");
    file.with_file_name(name)
}

/// The version a staged file was downloaded for. The core finds a staged update by it after the
/// window (which used to hold the downloaded bytes in memory) is gone or rebuilt.
pub(crate) fn ver_path(file: &Path) -> PathBuf {
    let mut name = file.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".millidaver");
    file.with_file_name(name)
}

fn is_sidecar(file: &Path) -> bool {
    file.extension().is_some_and(|e| e == "millidasig" || e == "millidaver")
}

/// Staged files newer than the running build, newest first. Pure: the disk walk and the
/// signature check are the caller's.
fn staged_candidates(found: Vec<(PathBuf, String)>, current: &str) -> Vec<(PathBuf, String)> {
    let mut list: Vec<(PathBuf, String)> = found
        .into_iter()
        .map(|(p, v)| (p, v.trim().trim_start_matches('v').to_string()))
        .filter(|(_, v)| !v.is_empty() && is_newer(v, current))
        .collect();
    list.sort_by(|a, b| {
        if is_newer(&a.1, &b.1) {
            std::cmp::Ordering::Less
        } else if is_newer(&b.1, &a.1) {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    list
}

/// Every staged file with the version written beside it, as found on disk. The signature is the caller's business.
fn staged_found(dir: &Path) -> Vec<(PathBuf, String)> {
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.flatten()
        .map(|entry| entry.path())
        .filter(|path| !is_sidecar(path))
        .filter_map(|path| std::fs::read_to_string(ver_path(&path)).ok().map(|version| (path, version)))
        .collect()
}

/// A file the core finished staging is findable by the next window and by the tray: the signature and the version go
/// beside it. A patch is staged the same way as an installer (the review found it without the version file, so the
/// core never saw it again once the window was unloaded).
fn record_staged(file: &Path, signature: &str, version: &str) -> Result<(), String> {
    std::fs::write(sig_path(file), signature.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::write(ver_path(file), version.as_bytes()).map_err(|e| e.to_string())
}

/// The end of the patch road: a built exe that passed the signature check is staged like an installer (signature and
/// version beside it, so the core finds it again); one that did not is removed.
fn keep_built(file: &Path, signature: &str, version: &str, verified: Result<(), String>) -> Result<(), String> {
    if let Err(e) = verified {
        let _ = std::fs::remove_file(file);
        return Err(e);
    }
    record_staged(file, signature, version)
}

/// Cheap: is there a staged update newer than this build? Looks at the version files only, never at the (large) file
/// itself, so the tray can ask often. `staged_update` is the one that checks the signature.
pub fn staged_hint(app: &AppHandle) -> bool {
    staged_hint_version(app).is_some()
}

/// The newest staged version newer than this build, if any (same cheap look as `staged_hint`).
pub fn staged_hint_version(app: &AppHandle) -> Option<String> {
    if is_flatpak() {
        return None;
    }
    staged_candidates(staged_found(&updates_dir()), &app.package_info().version.to_string()).into_iter().next().map(|(_, v)| v)
}

/// An update the core already downloaded and verified: lives on disk, so it survives the window
/// being destroyed for the tray or a game and does not have to be downloaded again.
pub fn staged_update(app: &AppHandle) -> Option<FallbackInstall> {
    if is_flatpak() {
        return None;
    }
    let key = pubkey(app).ok()?;
    let current = app.package_info().version.to_string();
    for (path, version) in staged_candidates(staged_found(&updates_dir()), &current) {
        let Ok(signature) = std::fs::read_to_string(sig_path(&path)) else { continue };
        match verify(&path, signature.trim(), &key) {
            Ok(()) => return Some(FallbackInstall { version, path: path.to_string_lossy().to_string(), started: false }),
            Err(e) => eprintln!("[update] staged {} is not usable: {e}", path.display()),
        }
    }
    None
}

/// The player quits from the tray while the window is gone: a staged update goes in now, without
/// restarting (the player closed the launcher and expects it to stay closed). True: the
/// installer is running and this process must end.
pub fn install_staged_on_exit(app: &AppHandle) -> bool {
    let Some(staged) = staged_update(app) else { return false };
    match fallback_run(app, &staged.path, false) {
        Ok(run) => run.started,
        Err(e) => {
            eprintln!("[update] staged update was not started on exit: {e}");
            false
        }
    }
}

/// Flatpak mounts /app read-only and updates through its own repository: the
/// manifest is read only to tell the player a new version exists.
fn refuse_inside_flatpak() -> Result<(), String> {
    if is_flatpak() {
        return Err(FLATPAK_UPDATE_HINT.to_string());
    }
    Ok(())
}

const FLATPAK_UPDATE_HINT: &str =
    "лаунчер из Flatpak обновляется через магазин приложений или командой flatpak update net.millida.launcher";

/// One preparation of an update at a time. The core's tray loop and the window can both ask for the same file: two
/// downloads into one path made the loser delete the winner's good file (on Windows its rename fails while the
/// winner's check holds the file open, and the cleanup after the failure removes the destination). The second asker
/// waits, then finds the verified file already there and does nothing.
fn staging_turn() -> &'static tokio::sync::Mutex<()> {
    static TURN: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    TURN.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Downloads ahead of time and stores the signature next to the artifact so the
/// launch step can re-verify it without network access.
pub async fn fallback_stage(app: &AppHandle, upd: &FallbackUpdate) -> Result<PathBuf, String> {
    let _turn = staging_turn().lock().await;
    stage_full(app, upd).await
}

/// Same, but a patch from the installed exe is tried first when the release has one and this build can take it. Any
/// failure of the patch road is a reason to download the installer, never to stop.
pub async fn fallback_stage_prefer_delta(app: &AppHandle, upd: &FallbackUpdate) -> Result<PathBuf, String> {
    let _turn = staging_turn().lock().await;
    match stage_delta(app, upd).await {
        Ok(Some(path)) => Ok(path),
        Ok(None) => stage_full(app, upd).await,
        Err(e) => {
            eprintln!("[update] обновление патчем не вышло ({}), качаем установщик", e);
            stage_full(app, upd).await
        }
    }
}

async fn stage_full(app: &AppHandle, upd: &FallbackUpdate) -> Result<PathBuf, String> {
    refuse_inside_flatpak()?;
    let dir = updates_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(safe_file_name(&upd.file)?);
    let key = pubkey(app)?;
    if !(dest.exists() && verify(&dest, &upd.signature, &key).is_ok()) {
        // GitHub first, then our CDN mirror: either source must produce the
        // exact bytes the release key signed.
        let mut last = String::new();
        let mut ok = false;
        for link in std::iter::once(&upd.url).chain(upd.mirror.iter()) {
            let got = match download_fresh(link, &dest).await {
                Ok(()) => verify(&dest, &upd.signature, &key),
                Err(e) => Err(e),
            };
            match got {
                Ok(()) => {
                    ok = true;
                    break;
                }
                Err(e) => {
                    let _ = std::fs::remove_file(&dest);
                    last = e;
                }
            }
        }
        if !ok {
            return Err(last);
        }
    }
    record_staged(&dest, &upd.signature, &upd.version)?;
    drop_stale(&dest);
    Ok(dest)
}

/// Patch road: the installed exe plus the patch built from exactly it give the new exe; its own signature decides.
/// `Ok(None)` means there is nothing to try (no offer, not Windows, a critical release, a read-only folder).
async fn stage_delta(app: &AppHandle, upd: &FallbackUpdate) -> Result<Option<PathBuf>, String> {
    let Some(offer) = upd.delta.as_ref() else { return Ok(None) };
    // A patch of this version that already failed to go in is not tried again, by whoever asks (the core remembers it,
    // the window's own note lives only in the window).
    if upd.critical || silentupdate::delta_bad_for(&upd.version) || !selfdelta::eligible() {
        return Ok(None);
    }
    refuse_inside_flatpak()?;
    let current = std::env::current_exe().map_err(|e| e.to_string())?;
    let base_sha = {
        let path = current.clone();
        tokio::task::spawn_blocking(move || selfdelta::sha256_file(&path)).await.map_err(|e| e.to_string())??
    };
    let Some(patch) = selfdelta::pick(offer, &base_sha).cloned() else { return Ok(None) };
    let dir = updates_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(safe_file_name(&selfdelta::staged_name(&upd.version))?);
    let key = pubkey(app)?;
    if dest.exists() && verify(&dest, &offer.exe_signature, &key).is_ok() {
        record_staged(&dest, &offer.exe_signature, &upd.version)?;
        return Ok(Some(dest));
    }
    let patch_file = dir.join(format!("{}.patch", dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    let mut last = String::new();
    let mut got = false;
    for link in std::iter::once(&patch.url).chain(patch.mirror.iter()) {
        match download_checked(link, &patch_file, Some(Sum::Sha256(&patch.sha256)), Some(patch.size)).await {
            Ok(()) => {
                got = true;
                break;
            }
            Err(e) => last = e,
        }
    }
    if !got {
        let _ = std::fs::remove_file(&patch_file);
        return Err(last);
    }
    let (offer2, cur2, patch2, dest2) = (offer.clone(), current, patch_file.clone(), dest.clone());
    let built = tokio::task::spawn_blocking(move || selfdelta::build_exe(&cur2, &patch2, &offer2, &dest2)).await.map_err(|e| e.to_string());
    let _ = std::fs::remove_file(&patch_file);
    built??;
    // The signature of the FINISHED file, made with the release key: whatever the patch road did, a file that does not
    // pass this is never kept.
    keep_built(&dest, &offer.exe_signature, &upd.version, verify(&dest, &offer.exe_signature, &key))?;
    drop_stale(&dest);
    Ok(Some(dest))
}

/// What the window needs to know after a patch was staged: the version and the file, plus how many bytes travelled.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeltaStaged {
    pub version: String,
    pub path: String,
    pub patch_bytes: u64,
    pub full_bytes: u64,
}

/// For the plugin road: the window found an update through the plugin and asks whether a patch can replace the full
/// download. `None` = no (nothing offered, nothing to patch from, or the patch failed); the plugin then downloads as before.
pub async fn delta_stage_latest(app: &AppHandle) -> Result<Option<DeltaStaged>, String> {
    let Some(upd) = fallback_check(app).await? else { return Ok(None) };
    let Some(offer) = upd.delta.clone() else { return Ok(None) };
    let sizes = {
        let base = std::env::current_exe().ok().and_then(|p| selfdelta::sha256_file(&p).ok()).unwrap_or_default();
        selfdelta::pick(&offer, &base).map(|p| (p.size, offer.exe_size))
    };
    let _turn = staging_turn().lock().await;
    match stage_delta(app, &upd).await? {
        Some(path) => {
            let (patch_bytes, full_bytes) = sizes.unwrap_or((0, 0));
            Ok(Some(DeltaStaged { version: upd.version, path: path.to_string_lossy().into_owned(), patch_bytes, full_bytes }))
        }
        None => Ok(None),
    }
}

/// Only accepts paths inside the updates directory and re-verifies the signature:
/// the file could have been swapped between download and launch.
pub fn fallback_run(app: &AppHandle, path: &str, restart: bool) -> Result<FallbackInstall, String> {
    fallback_run_as(app, path, if restart { Restart::Show } else { Restart::No })
}

/// Same, with the choice of what starts afterwards. A patch that could not be put in place is remembered by the core
/// itself: the next stage takes the full installer, whoever asked (the window, the tray, the start of the launcher).
pub fn fallback_run_as(app: &AppHandle, path: &str, restart: Restart) -> Result<FallbackInstall, String> {
    refuse_inside_flatpak()?;
    let file = std::path::Path::new(path)
        .canonicalize()
        .map_err(|e| format!("обновление не найдено: {}", e))?;
    let dir = updates_dir().canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&dir) {
        return Err("файл обновления лежит вне папки обновлений".into());
    }
    let signature = std::fs::read_to_string(sig_path(&file)).map_err(|e| format!("нет подписи обновления: {}", e))?;
    verify(&file, signature.trim(), &pubkey(app)?)?;
    let started = match run_installer_as(&file, restart) {
        Ok(started) => started,
        Err(e) => {
            if selfdelta::is_delta_file(&file) {
                silentupdate::delta_failed(&file);
            }
            return Err(e);
        }
    };
    Ok(FallbackInstall { version: String::new(), path: file.to_string_lossy().to_string(), started })
}

pub async fn fallback_stage_latest(app: &AppHandle, skip_delta: bool) -> Result<Option<FallbackInstall>, String> {
    let Some(upd) = fallback_check(app).await? else { return Ok(None) };
    let file = if skip_delta { fallback_stage(app, &upd).await? } else { fallback_stage_prefer_delta(app, &upd).await? };
    Ok(Some(FallbackInstall { version: upd.version, path: file.to_string_lossy().to_string(), started: false }))
}

/// Same switches the updater plugin passes. Without `/UPDATE` the NSIS wizard
/// defaults to running the old uninstaller with its "delete app data" box,
/// which wipes the game folder and the saved login.
#[cfg(any(windows, test))]
const NSIS_UPDATE_ARGS: [&str; 2] = ["/P", "/UPDATE"];

/// `/R` makes the installer start the launcher again. An install on exit must
/// not pass it: the player closed the launcher and expects it to stay closed.
/// An install while nobody looks runs silent (`/S`: no progress window at all) and starts the new copy with the login
/// flag, which keeps it in the tray. The updater plugin passes the old copy's arguments the same way, after `/ARGS`.
#[cfg(any(windows, test))]
fn nsis_args(restart: Restart) -> Vec<&'static str> {
    match restart {
        Restart::No => NSIS_UPDATE_ARGS.to_vec(),
        Restart::Show => NSIS_UPDATE_ARGS.iter().copied().chain(["/R"]).collect(),
        Restart::Tray => vec!["/S", "/UPDATE", "/R", "/ARGS", TRAY_START_ARG],
    }
}

/// Windows hands off to the installer; macOS and Linux replace the .app bundle
/// or AppImage in place. When there is nothing to replace (deb/rpm, not launched
/// from a bundle) the containing folder is opened instead.
///
/// `true` = the caller must terminate this process.
pub fn run_installer(file: &Path, restart: bool) -> Result<bool, String> {
    run_installer_as(file, if restart { Restart::Show } else { Restart::No })
}

/// Same, with the choice of what starts afterwards.
pub fn run_installer_as(file: &Path, restart: Restart) -> Result<bool, String> {
    if selfdelta::is_delta_file(file) {
        return selfdelta::install(file, restart);
    }
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
        // Runs the downloaded NSIS installer with /P /UPDATE. The file just passed the signature check in fallback_run.
        let mut cmd = std::process::Command::new(file);
        cmd.args(nsis_args(restart));
        super::proc::quiet(&mut cmd);
        cmd.spawn().map_err(|e| format!("установщик не запустился: {}", e))?;
        Ok(true)
    }
    #[cfg(target_os = "macos")]
    {
        match install_app_bundle(file, restart) {
            Ok(()) => Ok(true),
            Err(e) => {
                open_path(&file.parent().unwrap_or(file).to_string_lossy());
                Err(e)
            }
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if is_system_package(file) {
            open_path(&file.to_string_lossy());
            return Ok(false);
        }
        match install_appimage(file, restart) {
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

/// The shell command that starts the new copy. After a silent install in the tray it carries the login flag, so the
/// copy stays in the tray instead of opening a window under someone who is not looking.
#[cfg(any(unix, test))]
fn relaunch_command(opener: &str, args_marker: &str, restart: Restart) -> String {
    match restart {
        Restart::Tray => format!("{opener}{args_marker} {TRAY_START_ARG}"),
        Restart::No | Restart::Show => opener.to_string(),
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
    // A short sh script: waits until our process closes, then starts the new copy. The command line is built in the code above, nothing foreign gets in.
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
fn install_app_bundle(archive: &Path, restart: Restart) -> Result<(), String> {
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
    // Cleans our own temporary .millida-update folder next to the app.
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
    // chmod u+w and xattr -cr on the freshly unpacked copy: removes the macOS quarantine flag. The archive passed the Millida signature check before, but Gatekeeper is not run on it.
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
    relaunch_after_exit(&bundle, &relaunch_command(r#"open -n "$2""#, " --args", restart))
}

/// Uses the system tar: it preserves the symlinks inside Contents/Frameworks and
/// the permission bits a signed bundle needs in order to launch.
#[cfg(target_os = "macos")]
fn unpack_bundle(archive: &Path, stage: &Path) -> Result<PathBuf, String> {
    // Unpacking with the system tar. It keeps the links inside the signed .app.
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
            // Deletes leftovers of earlier updates next to the app (.millida-old-*, .millida-update).
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// A deb or rpm goes to the system package installer: replacing files under
/// /usr needs root, which only the package manager is allowed to ask for.
#[cfg(any(all(unix, not(target_os = "macos")), test))]
fn is_system_package(file: &Path) -> bool {
    let ext = file.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    ext == "deb" || ext == "rpm"
}

/// Writing into a running AppImage fails with ETXTBSY, but renaming over it is
/// allowed, so the new file is staged alongside and renamed into place.
/// `false` = nothing to install (deb/rpm, or the artifact is not an AppImage).
#[cfg(all(unix, not(target_os = "macos")))]
fn install_appimage(file: &Path, restart: Restart) -> Result<bool, String> {
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
    relaunch_after_exit(&current, &relaunch_command(r#"exec "$2""#, "", restart)).map(|_| true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn staged(list: &[(&str, &str)]) -> Vec<(PathBuf, String)> {
        list.iter().map(|(f, v)| (PathBuf::from(f), v.to_string())).collect()
    }

    /// input -> verdict. What the core finds on disk after the window is gone: only builds newer
    /// than the running one, the newest first; a leftover of an old release is never installed.
    #[test]
    fn a_staged_update_is_found_by_its_version() {
        let found = staged(&[("old.exe", "2.0.299"), ("new.exe", "2.0.301"), ("same.exe", "2.0.300"), ("newer.exe", "v2.0.302\n"), ("junk.exe", "")]);
        let got: Vec<String> = staged_candidates(found, "2.0.300").into_iter().map(|(p, v)| format!("{}={}", p.display(), v)).collect();
        assert_eq!(got, ["newer.exe=2.0.302", "new.exe=2.0.301"]);
        assert!(staged_candidates(staged(&[("a.exe", "2.0.300")]), "2.0.300").is_empty(), "та же версия уже стоит");
        assert!(staged_candidates(Vec::new(), "2.0.300").is_empty());
    }

    #[test]
    fn signature_and_version_files_are_not_updates_themselves() {
        assert!(is_sidecar(Path::new("Millida_2.0.301_setup.exe.millidasig")));
        assert!(is_sidecar(Path::new("Millida_2.0.301_setup.exe.millidaver")));
        assert!(!is_sidecar(Path::new("Millida_2.0.301_setup.exe")));
        let f = Path::new("updates/Millida_2.0.301_setup.exe");
        assert_eq!(ver_path(f), Path::new("updates/Millida_2.0.301_setup.exe.millidaver"));
        assert_ne!(ver_path(f), sig_path(f));
    }

    /// input -> verdict. Only a marker left by the install the player just
    /// started may override the hidden start at login.
    #[test]
    fn only_a_fresh_marker_shows_the_relaunched_window() {
        let cases: [(Option<u64>, bool, &str); 4] = [
            (None, false, "no marker: a login autostart must stay in the tray"),
            (Some(0), true, "marker from the install that just finished"),
            (Some(600), true, "a slow installer still lands inside the window"),
            (Some(601), false, "a marker left by an install that never ran must not pop the window at a later login"),
        ];
        for (age, want, why) in cases {
            assert_eq!(
                show_after_update_fresh(age.map(std::time::Duration::from_secs)),
                want,
                "age {age:?}s: {why}"
            );
        }
    }

    /// input -> verdict. The testing channel picks a FILE next to the stable
    /// manifest, never a host: a setting that could name a URL would be an
    /// update channel anyone with a webview hole could aim anywhere.
    #[test]
    fn testing_channel_only_swaps_the_manifest_name() {
        let cases: [(&str, Option<&str>); 6] = [
            (
                "https://launcher-storage.millida.net/v2/latest.json",
                Some("https://launcher-storage.millida.net/v2/beta.json"),
            ),
            (
                "https://launcher-storage.millida.net/v2/gh/latest.json?v=2.0.203",
                Some("https://launcher-storage.millida.net/v2/gh/beta.json?v=2.0.203"),
            ),
            (
                "https://launcher-storage.millida.net/latest.json",
                Some("https://launcher-storage.millida.net/beta.json"),
            ),
            ("https://launcher-storage.millida.net/v2/install.json", None),
            ("https://evil.example/latest.json.txt", None),
            ("latest.json", None),
        ];
        for (input, want) in cases {
            assert_eq!(
                beta_url(input).as_deref(),
                want,
                "{input:?} must map to {want:?}: the testing channel may only point at a                  beta.json beside the manifest the build was configured with"
            );
        }
    }

    /// вход → вердикт: что и в каком порядке спрашивает канал обновлений.
    ///
    /// Порядок здесь и есть вся фича: бета стоит перед своим стабильным
    /// соседом, а без галки её адрес не спрашивается вовсе — иначе «тестируем
    /// на части людей» превратилось бы в «стучимся всеми».
    #[test]
    fn testing_channel_asks_beta_before_its_own_stable_neighbour() {
        let configured = vec!["https://launcher-storage.millida.net/v2/latest.json".to_string()];

        let off = channel_order(&configured, false);
        assert_eq!(
            off,
            vec![
                "https://launcher-storage.millida.net/v2/latest.json".to_string(),
                "https://launcher-storage.millida.net/latest.json".to_string(),
            ],
            "без галки бета не спрашивается вовсе"
        );

        let on = channel_order(&configured, true);
        assert_eq!(
            on,
            vec![
                "https://launcher-storage.millida.net/v2/beta.json".to_string(),
                "https://launcher-storage.millida.net/v2/latest.json".to_string(),
                "https://launcher-storage.millida.net/beta.json".to_string(),
                "https://launcher-storage.millida.net/latest.json".to_string(),
            ],
            "с галкой каждая бета идёт перед своим стабильным соседом"
        );

        assert!(
            on.iter().position(|u| u.ends_with("/v2/beta.json"))
                < on.iter().position(|u| u.ends_with("/v2/latest.json")),
            "бета обязана опрашиваться первой: иначе тестировщик получит общую сборку"
        );
    }

    #[test]
    fn fallback_installer_runs_in_update_mode() {
        assert!(
            NSIS_UPDATE_ARGS.contains(&"/UPDATE"),
            "без /UPDATE мастер NSIS запускает старый деинсталлятор с галкой «Удалить данные» — игрок теряет сборки и вход"
        );
        assert!(
            NSIS_UPDATE_ARGS.contains(&"/P"),
            "без /P установщик открывает полный мастер вместо тихой установки поверх"
        );
    }

    #[test]
    fn install_on_exit_keeps_launcher_closed() {
        assert!(
            !nsis_args(Restart::No).contains(&"/R"),
            "/R при установке на выходе снова открывает лаунчер: игрок закрыл его, а он появляется опять"
        );
        assert!(
            nsis_args(Restart::Show).contains(&"/R"),
            "«Обновить сейчас» и самовосстановление обязаны поднять лаунчер после установки"
        );
        for restart in [Restart::No, Restart::Show, Restart::Tray] {
            assert!(
                nsis_args(restart).contains(&"/UPDATE"),
                "без /UPDATE мастер NSIS запускает деинсталлятор с удалением данных ({restart:?})"
            );
        }
    }

    /// The install nobody watches: silent (no progress window), the new copy comes back to the tray with the login flag
    /// that keeps its window hidden, and `/ARGS` is last because the installer takes everything after it as the arguments.
    #[test]
    fn a_tray_install_is_silent_and_returns_to_the_tray() {
        let args = nsis_args(Restart::Tray);
        assert_eq!(args, ["/S", "/UPDATE", "/R", "/ARGS", "--autostart"]);
        assert!(!args.contains(&"/P"), "/P рисует окно с полосой под тем, кто не смотрит");
        assert_eq!(args.last(), Some(&TRAY_START_ARG));
        assert_eq!(nsis_args(Restart::Show), ["/P", "/UPDATE", "/R"], "кнопка и старт с окном остаются как были");
        assert_eq!(TRAY_START_ARG, crate::commands::system::AUTOSTART_ARG, "флаг входа — один и тот же в ядре и в запуске системой");
    }

    #[test]
    fn the_new_copy_on_mac_and_linux_gets_the_login_flag_only_for_the_tray() {
        assert_eq!(relaunch_command(r#"open -n "$2""#, " --args", Restart::Tray), r#"open -n "$2" --args --autostart"#);
        assert_eq!(relaunch_command(r#"exec "$2""#, "", Restart::Tray), r#"exec "$2" --autostart"#);
        assert_eq!(relaunch_command(r#"open -n "$2""#, " --args", Restart::Show), r#"open -n "$2""#);
        assert_eq!(relaunch_command(r#"exec "$2""#, "", Restart::No), r#"exec "$2""#);
    }

    /// The review found it: a staged patch had a signature but no version file, so once the window was gone the core
    /// never saw it again, "Выход" from the tray did not install it and the 10-minute download deleted it.
    #[test]
    fn a_staged_patch_is_found_by_the_core_like_an_installer() {
        let dir = std::env::temp_dir().join(format!("millida-staged-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let patch = dir.join(selfdelta::staged_name("2.0.9"));
        let installer = dir.join("Millida-Launcher_2.0.8_x64-setup.exe");
        std::fs::write(&patch, b"patched exe").unwrap();
        std::fs::write(&installer, b"installer").unwrap();
        record_staged(&patch, "patch-signature", "2.0.9").unwrap();
        record_staged(&installer, "installer-signature", "2.0.8").unwrap();
        assert_eq!(std::fs::read_to_string(sig_path(&patch)).unwrap(), "patch-signature");
        assert_eq!(std::fs::read_to_string(ver_path(&patch)).unwrap(), "2.0.9");

        let mut found = staged_found(&dir);
        found.sort();
        assert_eq!(found.len(), 2, "sidecars are not updates: {found:?}");
        let got = staged_candidates(found, "2.0.7");
        assert_eq!(got.iter().map(|(_, v)| v.as_str()).collect::<Vec<_>>(), ["2.0.9", "2.0.8"], "the patch is newest and found first");
        assert!(selfdelta::is_delta_file(&got[0].0));
        assert!(staged_candidates(staged_found(&dir), "2.0.9").iter().all(|(_, v)| v != "2.0.9"), "the version that is running is not an update");
        // the end of the patch road is what writes them: a good file is recorded, a bad one is removed
        let built = dir.join(selfdelta::staged_name("2.0.10"));
        std::fs::write(&built, b"built").unwrap();
        keep_built(&built, "sig", "2.0.10", Ok(())).unwrap();
        assert_eq!(std::fs::read_to_string(ver_path(&built)).unwrap(), "2.0.10", "the finished patch is findable once the window is gone");
        let bad = dir.join(selfdelta::staged_name("2.0.11"));
        std::fs::write(&bad, b"wrong").unwrap();
        assert!(keep_built(&bad, "sig", "2.0.11", Err("signature".into())).is_err());
        assert!(!bad.exists() && !ver_path(&bad).exists(), "a file that fails the signature is never kept");
        let _ = std::fs::remove_file(&built);
        let _ = std::fs::remove_file(sig_path(&built));
        let _ = std::fs::remove_file(ver_path(&built));
        // a fresh staging of the same version leaves the patch and its sidecars alone
        drop_stale_in(&dir, &patch);
        assert!(patch.exists() && sig_path(&patch).exists() && ver_path(&patch).exists());
        assert!(!installer.exists(), "the older installer is the stale one");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_older_manifest_is_never_offered() {
        assert!(update_acceptable("2.0.211", "2.0.210", true));
        assert!(!update_acceptable("2.0.210", "2.0.210", true));
        assert!(!update_acceptable("2.0.209", "2.0.210", true));
        // recovery: same version is fine, older is not
        assert!(update_acceptable("2.0.210", "2.0.210", false));
        assert!(update_acceptable("v2.0.211", "2.0.210", false));
        assert!(!update_acceptable("2.0.209", "2.0.210", false));
    }

    #[test]
    fn a_release_is_critical_only_when_the_manifest_says_so() {
        use serde_json::json;
        assert!(!manifest_critical(&json!({"version": "1.0.1", "platforms": {"windows-x86_64": {}}}), "windows-x86_64"));
        assert!(manifest_critical(&json!({"critical": true, "platforms": {}}), "windows-x86_64"), "the whole release");
        assert!(
            manifest_critical(&json!({"platforms": {"windows-x86_64": {"critical": true}}}), "windows-x86_64"),
            "or only the build for this system"
        );
        assert!(
            !manifest_critical(&json!({"platforms": {"darwin-aarch64": {"critical": true}}}), "windows-x86_64"),
            "another system's flag is not ours"
        );
        assert!(!manifest_critical(&json!({"critical": "yes"}), "windows-x86_64"), "only a real boolean counts");
    }

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
    fn system_packages_go_to_the_package_installer() {
        let cases: [(&str, bool, &str); 5] = [
            ("Millida-Launcher_2.0.150_amd64.deb", true, "deb needs root, only the package manager may ask for it"),
            ("Millida-Launcher-2.0.150-1.x86_64.RPM", true, "extension case must not decide the install path"),
            ("Millida-Launcher_2.0.150_amd64.AppImage", false, "an AppImage is replaced in place"),
            ("Millida-Launcher.deb.AppImage", false, "only the final extension names the format"),
            ("Millida-Launcher", false, "no extension is not a package"),
        ];
        for (name, want, why) in cases {
            assert_eq!(is_system_package(Path::new(name)), want, "{}: {}", name, why);
        }
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
