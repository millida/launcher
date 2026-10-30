// Horizon (github.com/horizon-rust/horizon, MIT): a native Rust client for vanilla Minecraft 26.3, offered as an opt-in beta
// engine for a vanilla 26.3 build next to the usual Java start.
use super::launch::{crash_tail, read_log_file, spawn_log_reader, wait_log_readers, was_stopped, watch_session, LAUNCH_CAPTURE, LOG_DRAIN_WAIT};
use super::launch_perf::LaunchPerf;
use super::pack_launch::platform_os_arch;
use super::pipeline::graph::{Graph, Node};
use crate::engine::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub const HORIZON_GAME_VERSION: &str = "26.3";
/// The window offers the usual Java start when a launch error carries this prefix.
pub const HORIZON_FAIL_PREFIX: &str = "horizon: ";
pub const HORIZON_RELEASE: &str = "v0.2.93";

const ENGINE_FILE: &str = "horizon.json";
const READY_MARK: &str = ".millida-ready";
const PREPARED_MARK: &str = ".millida-prepared";
const RESOURCES_MANIFEST: &str = "horizon-resources.json";
const RELEASE_URL: &str = "https://github.com/horizon-rust/horizon/releases/download";
const MOJANG_META: &str = "https://piston-meta.mojang.com/v1/packages";
const MOJANG_JAR_HOSTS: [&str; 2] = ["piston-data.mojang.com", "launcher.mojang.com"];
const START_WATCH: Duration = Duration::from_secs(4);
const MAX_NAME_LEN: usize = 16;
const CRASH_ACTIONS: [&str; 2] = ["open-folder", "share-log"];

const NOT_FOR_VERSION: &str = "Horizon работает только на Minecraft 26.3";
const NOT_FOR_LOADER: &str = "Horizon работает только на сборке без модов (Vanilla)";
const NOT_FOR_PLATFORM: &str = "Horizon пока не выходит для этой системы";
const NOT_FOR_CATALOGUE: &str = "Horizon не запускает сборки из каталога";
const NO_VULKAN: &str = "Horizon не нашёл Vulkan — обнови драйвер видеокарты";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ReleaseAsset {
    os: &'static str,
    arch: &'static str,
    name: &'static str,
    sha256: &'static str,
    size: u64,
}

// Pinned by hand from the release's SHA256SUMS: updating Horizon means changing HORIZON_RELEASE and these together.
// Linux ships only a tar.gz, which the launcher's checked zip extraction does not read, so it is left out.
const ASSETS: [ReleaseAsset; 2] = [
    ReleaseAsset {
        os: "windows",
        arch: "x86_64",
        name: "horizon-windows-x64.zip",
        sha256: "5a51908167d7d51599157eb667a6b021de6a46a9601590c2d1293c77d3dca4a4",
        size: 31_690_610,
    },
    ReleaseAsset {
        os: "macos",
        arch: "arm64",
        name: "horizon-macos-arm64.zip",
        sha256: "1298251da5ff615a08552bea2823dcbda489350bcbefd523b7b78327aba6d157",
        size: 29_404_466,
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Unavailable {
    Version,
    Loader,
    Platform,
    Catalogue,
}

impl Unavailable {
    fn text(self) -> &'static str {
        match self {
            Unavailable::Version => NOT_FOR_VERSION,
            Unavailable::Loader => NOT_FOR_LOADER,
            Unavailable::Platform => NOT_FOR_PLATFORM,
            Unavailable::Catalogue => NOT_FOR_CATALOGUE,
        }
    }
}

fn eligibility(version: &str, loader: &str, os: &str, arch: &str) -> Result<&'static ReleaseAsset, Unavailable> {
    let asset = ASSETS.iter().find(|a| a.os == os && a.arch == arch).ok_or(Unavailable::Platform)?;
    if version != HORIZON_GAME_VERSION {
        return Err(Unavailable::Version);
    }
    if loader != "vanilla" {
        return Err(Unavailable::Loader);
    }
    Ok(asset)
}

fn host_eligibility(version: &str, loader: &str) -> Result<&'static ReleaseAsset, Unavailable> {
    let (os, arch) = platform_os_arch();
    eligibility(version, loader, os, arch)
}

/// Catalogue builds pass the pack access check and kill switch in the Java
/// pipeline; Horizon starts before those gates, so it never runs them.
fn catalogue_build(profile: &str) -> bool {
    let settings = std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .unwrap_or(Value::Null);
    trusted_pack_slug(profile).is_some() || catalog_pack_settings(&settings)
}

fn build_eligibility(catalogue: bool, version: &str, loader: &str) -> Result<&'static ReleaseAsset, Unavailable> {
    if catalogue {
        return Err(Unavailable::Catalogue);
    }
    host_eligibility(version, loader)
}

fn failure(reason: impl std::fmt::Display) -> String {
    format!("{}{}", HORIZON_FAIL_PREFIX, reason)
}

fn as_failure(e: String) -> String {
    if e == LAUNCH_CANCELLED { e } else { failure(e) }
}

#[derive(serde::Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HorizonState {
    pub available: bool,
    pub enabled: bool,
    pub reason: Option<String>,
    pub release: String,
}

fn state_of(version: &str, loader: &str, enabled: bool) -> HorizonState {
    let verdict = host_eligibility(version, loader);
    HorizonState {
        available: verdict.is_ok(),
        enabled,
        reason: verdict.err().map(|u| u.text().to_string()),
        release: HORIZON_RELEASE.to_string(),
    }
}

fn find_profile(profile: &str) -> Option<Profile> {
    load_profiles().into_iter().find(|p| p.name == profile)
}

fn engine_path(profile: &str) -> PathBuf {
    profile_dir(profile).join(ENGINE_FILE)
}

fn engine_on(profile: &str) -> bool {
    std::fs::read(engine_path(profile))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .is_some_and(|v| v["engine"].as_str() == Some("horizon"))
}

/// For the new-build window, before the build exists.
pub fn horizon_state_for(version: &str, loader: &str) -> HorizonState {
    state_of(version, loader, false)
}

pub fn horizon_state(profile: &str) -> HorizonState {
    match find_profile(profile) {
        Some(_) if catalogue_build(profile) => HorizonState {
            available: false,
            enabled: false,
            reason: Some(NOT_FOR_CATALOGUE.to_string()),
            release: HORIZON_RELEASE.to_string(),
        },
        Some(p) => state_of(&p.version, &p.loader_id(), engine_on(profile)),
        None => state_of("", "", false),
    }
}

pub fn set_horizon(profile: &str, on: bool) -> Result<HorizonState, String> {
    let p = find_profile(profile).ok_or_else(|| "Сборка не найдена".to_string())?;
    let path = engine_path(profile);
    if on {
        build_eligibility(catalogue_build(profile), &p.version, &p.loader_id()).map_err(|u| u.text().to_string())?;
        write_json_atomic(&path, &json!({ "engine": "horizon", "release": HORIZON_RELEASE }))?;
    } else {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io_fail("Horizon", &path, &e)),
        }
    }
    Ok(horizon_state(profile))
}

static JAVA_ONCE: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// The next Play of this build goes the usual Java way once; the build keeps Horizon on.
pub fn horizon_java_once(profile: &str) {
    let mut once = JAVA_ONCE.lock().unwrap_or_else(|e| e.into_inner());
    if !once.iter().any(|p| p == profile) {
        once.push(profile.to_string());
    }
}

fn take_java_once(profile: &str) -> bool {
    let mut once = JAVA_ONCE.lock().unwrap_or_else(|e| e.into_inner());
    let before = once.len();
    once.retain(|p| p != profile);
    once.len() != before
}

/// Checked again at Play: the build may have moved to another version or loader since Horizon was turned on.
pub(crate) fn horizon_wanted(profile: &str, version: &str, loader: &str) -> Option<Result<&'static ReleaseAsset, String>> {
    if !engine_on(profile) || take_java_once(profile) || catalogue_build(profile) {
        return None;
    }
    Some(host_eligibility(version, loader).map_err(|u| failure(u.text())))
}

fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{}.exe", name) } else { name.to_string() }
}

fn required_files() -> [String; 3] {
    [exe("horizon-client"), exe("horizon-prepare"), "research-lock.json".to_string()]
}

fn horizon_root() -> PathBuf {
    data_dir().join("horizon")
}

fn release_dir() -> PathBuf {
    horizon_root().join("releases").join(HORIZON_RELEASE)
}

fn resources(dir: &Path) -> PathBuf {
    dir.join(".local").join("horizon-client").join(HORIZON_GAME_VERSION)
}

fn release_ready(dir: &Path, asset: &ReleaseAsset) -> bool {
    std::fs::read_to_string(dir.join(READY_MARK)).is_ok_and(|s| s.trim() == asset.sha256)
        && required_files().iter().all(|f| dir.join(f).is_file())
}

fn prepared(dir: &Path) -> bool {
    dir.join(PREPARED_MARK).is_file() && resources(dir).join(RESOURCES_MANIFEST).is_file()
}

/// A folder this module made for its own staging; it goes away on every exit that did not hand it over.
struct StagingGuard(PathBuf);

impl Drop for StagingGuard {
    fn drop(&mut self) {
        if self.0.exists() {
            // Removes only the launcher's own temporary unpack folder of the Horizon release.
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(unix)]
fn make_runnable(dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    for name in ["horizon-client", "horizon-prepare"] {
        let path = dir.join(name);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).map_err(|e| io_fail("Horizon", &path, &e))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn make_runnable(_dir: &Path) -> Result<(), String> {
    Ok(())
}

fn keep_every_entry(_: &str) -> bool {
    false
}

/// The verified archive becomes the release folder only once it is unpacked whole; a broken older copy is
/// moved aside first and dropped only after the new one is in place.
fn install_release(archive: &Path, dir: &Path, sha256: &str) -> Result<(), String> {
    let parent = &dir.parent().map(Path::to_path_buf).unwrap_or_else(|| horizon_root().join("releases"));
    std::fs::create_dir_all(parent).map_err(|e| io_fail("Horizon", parent, &e))?;
    let staging = StagingGuard(parent.join(format!(".{}-staging-{}", HORIZON_RELEASE, unique_tag())));
    std::fs::create_dir_all(&staging.0).map_err(|e| io_fail("Horizon", &staging.0, &e))?;
    unzip_strip1(archive, &staging.0, keep_every_entry)?;
    if let Some(missing) = required_files().into_iter().find(|f| !staging.0.join(f).is_file()) {
        return Err(format!("В архиве Horizon нет файла {}", missing));
    }
    make_runnable(&staging.0)?;
    std::fs::write(staging.0.join(READY_MARK), sha256).map_err(|e| io_fail("Horizon", &staging.0, &e))?;
    if dir.exists() {
        let old = parent.join(format!(".{}-old-{}", HORIZON_RELEASE, unique_tag()));
        std::fs::rename(dir, &old).map_err(|e| io_fail("Horizon", dir, &e))?;
        if let Err(e) = std::fs::rename(&staging.0, dir) {
            let _ = std::fs::rename(&old, dir);
            return Err(io_fail("Horizon", dir, &e));
        }
        // The replaced copy had no ready mark: nothing in it was usable.
        let _ = std::fs::remove_dir_all(&old);
    } else {
        std::fs::rename(&staging.0, dir).map_err(|e| io_fail("Horizon", dir, &e))?;
    }
    Ok(())
}

async fn ensure_release(app: &AppHandle, asset: &'static ReleaseAsset) -> Result<PathBuf, String> {
    let dir = release_dir();
    if release_ready(&dir, asset) {
        return Ok(dir);
    }
    emit(app, "files", 5.0, "Скачиваем Horizon…");
    let downloads = horizon_root().join("downloads");
    std::fs::create_dir_all(&downloads).map_err(|e| io_fail("Horizon", &downloads, &e))?;
    let archive = downloads.join(asset.name);
    let url = format!("{}/{}/{}", RELEASE_URL, HORIZON_RELEASE, asset.name);
    let cancel = launch_cancel_flag();
    let shown = std::sync::atomic::AtomicU32::new(u32::MAX);
    let report = |got: u64, total: Option<u64>| {
        let total = total.unwrap_or(asset.size).max(1);
        let pct = (got.min(total) * 100 / total) as u32;
        if shown.swap(pct, std::sync::atomic::Ordering::Relaxed) != pct {
            emit(app, "files", 5.0 + pct as f32 * 0.25, "Скачиваем Horizon…");
        }
    };
    download_checked_progress(&url, &archive, Some(Sum::Sha256(asset.sha256)), Some(asset.size), cancel.as_deref(), &report)
        .await
        .map_err(|e| if e == CANCELLED { LAUNCH_CANCELLED.to_string() } else { format!("Не удалось скачать Horizon: {}", e) })?;
    let (a, d, sum) = (archive.clone(), dir.clone(), asset.sha256);
    tokio::task::spawn_blocking(move || install_release(&a, &d, sum)).await.map_err(|e| e.to_string())??;
    // The archive is not needed once its contents are in place and marked ready.
    let _ = std::fs::remove_file(&archive);
    Ok(dir)
}

#[derive(Debug, PartialEq, Eq)]
struct Lock {
    manifest_sha1: String,
    server_sha1: String,
    client_sha1: String,
}

fn sha1_hex(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn parse_lock(v: &Value) -> Option<Lock> {
    let mc = &v["minecraft"];
    if mc["version"].as_str() != Some(HORIZON_GAME_VERSION) {
        return None;
    }
    let pin = |key: &str| mc[key].as_str().filter(|s| sha1_hex(s)).map(str::to_ascii_lowercase);
    Some(Lock { manifest_sha1: pin("manifest_sha1")?, server_sha1: pin("server_sha1")?, client_sha1: pin("client_sha1")? })
}

/// The server jar Mojang lists for the pinned version, from Mojang's own hosts only, with the sha1 the release pins.
fn server_download(manifest: &Value, server_sha1: &str) -> Option<String> {
    let server = &manifest["downloads"]["server"];
    if !server["sha1"].as_str().is_some_and(|s| s.eq_ignore_ascii_case(server_sha1)) {
        return None;
    }
    let raw = server["url"].as_str()?;
    let url = reqwest::Url::parse(raw).ok()?;
    let trusted = url.scheme() == "https" && url.host_str().is_some_and(|h| MOJANG_JAR_HOSTS.contains(&h));
    trusted.then(|| url.to_string())
}

fn java_home_of(java: &Path) -> Option<PathBuf> {
    java.parent().and_then(Path::parent).map(Path::to_path_buf)
}

fn last_lines(raw: &[u8]) -> String {
    let text = String::from_utf8_lossy(raw);
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(3)..].join(" / ")
}

fn run_stoppable(cmd: &mut Command, halt: &Option<Arc<Halt>>) -> Result<std::process::Output, String> {
    match output_unless_stopped(cmd, || halt.as_ref().is_some_and(|h| h.cancelled())) {
        Ok(Ran::Done(out)) => Ok(out),
        Ok(Ran::Stopped) => Err(LAUNCH_CANCELLED.to_string()),
        Err(e) => Err(format!("Подготовка ресурсов Horizon не удалась: {}", e)),
    }
}

fn append_log(log: &Path, out: &std::process::Output) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log) {
        let _ = f.write_all(&out.stdout);
        let _ = f.write_all(&out.stderr);
    }
}

fn prepare_command(dir: &Path, java_home: &Path) -> Command {
    let mut cmd = Command::new(dir.join(exe("horizon-prepare")));
    quiet(&mut cmd);
    let mut path = vec![java_home.join("bin")];
    path.extend(std::env::var_os("PATH").iter().flat_map(std::env::split_paths));
    // horizon-prepare finds Java through JAVA_HOME and the PATH only.
    cmd.env("JAVA_HOME", java_home);
    if let Ok(joined) = std::env::join_paths(path) {
        cmd.env("PATH", joined);
    }
    cmd.current_dir(dir);
    cmd
}

/// Runs the release's own preparer on the files of this launcher's 26.3 install. Sounds are optional for
/// Horizon: their failure leaves the game silent and is only logged.
fn run_prepare(dir: &Path, game_root: &Path, java_home: &Path, server_jar: &Path, halt: Option<Arc<Halt>>) -> Result<(), String> {
    let log = horizon_root().join("prepare.log");
    let mut cmd = prepare_command(dir, java_home);
    cmd.arg("--root").arg(dir).arg("--prepare").arg("--server-jar").arg(server_jar).arg("--minecraft-dir").arg(game_root);
    let out = run_stoppable(&mut cmd, &halt)?;
    append_log(&log, &out);
    if !out.status.success() {
        return Err(format!("Подготовка ресурсов Horizon не удалась: {}", last_lines(&out.stderr)));
    }
    let mut sounds = prepare_command(dir, java_home);
    sounds.arg("sounds").arg("--root").arg(dir).arg("--minecraft-dir").arg(game_root);
    match run_stoppable(&mut sounds, &halt) {
        Ok(out) => append_log(&log, &out),
        Err(e) if e == LAUNCH_CANCELLED => return Err(e),
        Err(e) => eprintln!("[horizon] sounds: {}", e),
    }
    Ok(())
}

async fn ensure_prepared(app: &AppHandle, dir: &Path, game_root: &Path, java: &Path) -> Result<(), String> {
    if prepared(dir) {
        return Ok(());
    }
    let lock_path = dir.join("research-lock.json");
    let lock = std::fs::read(&lock_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .as_ref()
        .and_then(parse_lock)
        .ok_or_else(|| format!("В архиве Horizon нет файла {}", "research-lock.json"))?;
    emit(app, "files", 35.0, "Готовим ресурсы Horizon — это займёт пару минут…");
    let manifest = dir.join(".local").join("minecraft").join(HORIZON_GAME_VERSION).join("manifest.json");
    let jars = horizon_root().join("server-jars");
    for folder in [manifest.parent().unwrap_or(dir), jars.as_path()] {
        std::fs::create_dir_all(folder).map_err(|e| io_fail("Horizon", folder, &e))?;
    }
    // Horizon checks the version file by its exact bytes: this launcher keeps its own rewritten copy, so Mojang's
    // original is fetched by the sha1 the release pins.
    let meta_url = format!("{}/{}/{}.json", MOJANG_META, lock.manifest_sha1, HORIZON_GAME_VERSION);
    download_checked(&meta_url, &manifest, Some(Sum::Sha1(&lock.manifest_sha1)), None).await?;
    let manifest_json: Value = std::fs::read(&manifest)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let server_url = server_download(&manifest_json, &lock.server_sha1)
        .ok_or_else(|| format!("Подготовка ресурсов Horizon не удалась: {}", "server jar"))?;
    let server_jar = jars.join(format!("{}.jar", HORIZON_GAME_VERSION));
    download_checked(&server_url, &server_jar, Some(Sum::Sha1(&lock.server_sha1)), None).await?;
    check_cancel()?;
    let java_home = java_home_of(java).ok_or_else(|| "Java 25 не найдена".to_string())?;
    let halt = launch_cancel_flag();
    let (d, r, j, s) = (dir.to_path_buf(), game_root.to_path_buf(), java_home, server_jar);
    tokio::task::spawn_blocking(move || run_prepare(&d, &r, &j, &s, halt)).await.map_err(|e| e.to_string())??;
    if !resources(dir).join(RESOURCES_MANIFEST).is_file() {
        return Err(format!("Подготовка ресурсов Horizon не удалась: {}", RESOURCES_MANIFEST));
    }
    std::fs::write(dir.join(PREPARED_MARK), &lock.client_sha1).map_err(|e| io_fail("Horizon", dir, &e))
}

async fn java_25(app: &AppHandle, picked: &Path) -> Result<PathBuf, String> {
    if java_major_of_bin(picked) == Some(25) {
        return Ok(picked.to_path_buf());
    }
    ensure_java(app, 25).await
}

/// Only a Microsoft session is handed over: Horizon joins online servers through Mojang's session service,
/// which knows nothing of a Millida or offline account.
fn microsoft_session(auth: &Auth, nick: &str) -> Option<Value> {
    let name_ok = !nick.is_empty() && nick.chars().count() <= MAX_NAME_LEN;
    let uuid_ok = auth.uuid.chars().filter(|c| *c != '-').count() == 32 && auth.uuid.chars().all(|c| c == '-' || c.is_ascii_hexdigit());
    if auth.token.is_empty() || !auth.yggdrasil.is_empty() || !name_ok || !uuid_ok {
        return None;
    }
    let mut session = json!({ "name": nick, "uuid": auth.uuid, "access_token": auth.token, "user_type": "msa" });
    if !auth.xuid.is_empty() {
        session["xuid"] = Value::String(auth.xuid.clone());
    }
    Some(session)
}

/// Horizon reads the session file at start and deletes it; this removes it as well if the game never got to it.
struct SessionFile(PathBuf);

impl SessionFile {
    fn write(dir: &Path, session: &Value) -> Result<SessionFile, String> {
        use std::io::Write;
        std::fs::create_dir_all(dir).map_err(|e| io_fail("Horizon", dir, &e))?;
        let path = dir.join(format!("session-{}.json", unique_tag()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = SessionFile(path);
        let mut f = options.open(&file.0).map_err(|e| io_fail("Horizon", &file.0, &e))?;
        f.write_all(session.to_string().as_bytes()).map_err(|e| io_fail("Horizon", &file.0, &e))?;
        Ok(file)
    }
}

impl Drop for SessionFile {
    fn drop(&mut self) {
        // The game's one-time session file, written by this launch.
        let _ = std::fs::remove_file(&self.0);
    }
}

fn vulkan_missing(log: &str) -> bool {
    let low = log.to_ascii_lowercase();
    low.contains("vulkan") || low.contains("no suitable graphics adapter") || low.contains("requestadapter")
}

fn early_failure(code: Option<i32>, log: &str) -> String {
    if vulkan_missing(log) { NO_VULKAN.to_string() } else { early_exit_message(code, log) }
}

pub(crate) struct HorizonAsk {
    pub profile: String,
    pub nick: String,
    pub auth: Auth,
    pub settings: Value,
    pub asset: &'static ReleaseAsset,
}

static PREPARE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) async fn launch_horizon(app: AppHandle, ask: HorizonAsk, perf: LaunchPerf) -> Result<String, String> {
    let HorizonAsk { profile, nick, auth, settings, asset } = ask;
    let mut g = Graph::new(Some(launch_board(&app)), Some(perf));
    let vanilla = VersionAsk { version_id: HORIZON_GAME_VERSION.into(), loader: "vanilla".into(), loader_version: None, mode: Mode::Fetch };
    let installed = prepare_version(&mut g, &app, vanilla, Node::ready(None));
    let version = installed.get().await?;
    drop(g);
    let dir = {
        let _held = PREPARE_LOCK.lock().await;
        let java = java_25(&app, &version.java).await?;
        let dir = ensure_release(&app, asset).await.map_err(as_failure)?;
        ensure_prepared(&app, &dir, &version.root, &java).await.map_err(as_failure)?;
        dir
    };
    check_cancel()?;
    start_client(app, profile, nick, auth, &settings, &dir).await
}

async fn start_client(app: AppHandle, profile: String, nick: String, auth: Auth, settings: &Value, dir: &Path) -> Result<String, String> {
    emit(&app, "launch", 92.0, "Запускаем игру…");
    let game_dir = profile_dir(&profile);
    // Its own home, never the build's .minecraft: Horizon's saves and options must not mix with the Java game's.
    let home = game_dir.join("horizon");
    std::fs::create_dir_all(&home).map_err(|e| io_fail("Horizon", &home, &e))?;
    let client = dir.join(exe("horizon-client"));
    let mut cmd = Command::new(&client);
    quiet(&mut cmd);
    apply_gpu_pref(&mut cmd, &client, GpuPref::parse(settings["gpu"].as_str().unwrap_or("auto")));
    cmd.current_dir(&home)
        .env("HORIZON_HOME", &home)
        .arg("--resources")
        .arg(resources(dir))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let session = match microsoft_session(&auth, &nick) {
        Some(s) => {
            let file = SessionFile::write(&home.join("sessions"), &s).map_err(failure)?;
            cmd.arg("--session-file").arg(&file.0);
            Some(file)
        }
        None => {
            cmd.arg("--name").arg(&nick);
            None
        }
    };
    let log_path = game_dir.join(LAUNCH_CAPTURE);
    if let Some(logs) = log_path.parent() {
        std::fs::create_dir_all(logs).ok();
    }
    let log_file = std::fs::File::create(&log_path).map_err(|e| io_fail("Лог запуска", &log_path, &e))?;
    check_cancel()?;
    let start = Instant::now();
    let mut child = cmd.spawn().map_err(|e| failure(format!("Не удалось запустить Horizon: {}", e)))?;
    super::livelog::reset_live_log(&profile);
    let _ = app.emit("game-log-start", &profile);
    let log_file = Arc::new(Mutex::new(log_file));
    let server_now: ServerSlot = Arc::new(Mutex::new(None));
    let mut readers = Vec::new();
    if let Some(o) = child.stdout.take() {
        readers.push(spawn_log_reader(Box::new(o), log_file.clone(), app.clone(), server_now.clone()));
    }
    if let Some(e) = child.stderr.take() {
        readers.push(spawn_log_reader(Box::new(e), log_file.clone(), app.clone(), server_now.clone()));
    }
    let watch_until = Instant::now() + START_WATCH;
    while Instant::now() < watch_until {
        if cancelled() {
            let _ = child.kill();
            return Err(LAUNCH_CANCELLED.into());
        }
        if let Ok(Some(status)) = child.try_wait() {
            if status.success() {
                break;
            }
            wait_log_readers(&readers, LOG_DRAIN_WAIT);
            return Err(failure(early_failure(status.code(), &read_log_file(&log_path).unwrap_or_default())));
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    let pid = child.id();
    if let Ok(mut v) = RUNNING.lock() {
        v.push((profile.clone(), pid));
    }
    let app2 = app.clone();
    std::thread::spawn(move || {
        let _session = session;
        let (status, log_text, _) = watch_session(&mut child, start, pid, &profile, &server_now, &app2, |status| {
            if status.is_ok() {
                wait_log_readers(&readers, LOG_DRAIN_WAIT);
                read_log_file(&log_path).unwrap_or_default()
            } else {
                String::new()
            }
        });
        let failed = matches!(&status, Ok(s) if !s.success());
        if was_stopped(pid) || !failed {
            return;
        }
        let (code, what) = exit_code_text(status.as_ref().ok().and_then(|s| s.code()));
        let reason = match what {
            Some(w) => format!("Игра закрылась с ошибкой (код {} — {})", code, w),
            None => format!("Игра закрылась с ошибкой (код {})", code),
        };
        let mut diag = diagnose(&profile, &reason, &crash_tail(&log_text), &log_text)
            .classified("horizon", String::new())
            .with_exit(status.as_ref().map(super::earlyexit::exit_of).unwrap_or_default());
        diag.actions.retain(|a| CRASH_ACTIONS.contains(&a.kind.as_str()));
        crate::background::emit_main(&app2, "game-crash", diag);
    });
    emit(&app, "launch", 100.0, "Игра запущена");
    Ok("started".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (version, loader, os, arch) -> verdict. Horizon replaces the game, so anything but vanilla 26.3 on a
    /// platform with a pinned build must stay on Java.
    #[test]
    fn horizon_is_offered_only_for_vanilla_26_3_on_pinned_platforms() {
        type Case<'a> = (&'a str, &'a str, &'a str, &'a str, Result<&'a str, Unavailable>, &'a str);
        let cases: [Case; 8] = [
            ("26.3", "vanilla", "windows", "x86_64", Ok("horizon-windows-x64.zip"), "the supported case on Windows"),
            ("26.3", "vanilla", "macos", "arm64", Ok("horizon-macos-arm64.zip"), "the supported case on Apple silicon"),
            ("26.2", "vanilla", "windows", "x86_64", Err(Unavailable::Version), "Horizon renders only 26.3 resources"),
            ("1.21.4", "vanilla", "windows", "x86_64", Err(Unavailable::Version), "an older release is not Horizon's game"),
            ("26.3", "fabric", "windows", "x86_64", Err(Unavailable::Loader), "Java mods do not run in Horizon"),
            ("26.3", "neoforge", "macos", "arm64", Err(Unavailable::Loader), "a modded build would lose its mods silently"),
            ("26.3", "vanilla", "linux", "x86_64", Err(Unavailable::Platform), "Linux ships a tar.gz the checked extraction does not read"),
            ("26.3", "vanilla", "macos", "x86_64", Err(Unavailable::Platform), "there is no Intel Mac build"),
        ];
        for (version, loader, os, arch, want, why) in cases {
            let got = eligibility(version, loader, os, arch).map(|a| a.name);
            assert_eq!(got, want, "{why}: {version} {loader} {os}-{arch}");
        }
    }

    #[test]
    fn a_catalogue_build_never_starts_on_horizon() {
        assert_eq!(
            build_eligibility(true, HORIZON_GAME_VERSION, "vanilla").map(|a| a.name),
            Err(Unavailable::Catalogue),
            "Horizon starts before the pack access check and kill switch: a catalogue build on it would skip both",
        );
        assert_ne!(
            build_eligibility(false, HORIZON_GAME_VERSION, "vanilla").err(),
            Some(Unavailable::Catalogue),
            "an own vanilla build is not a catalogue build",
        );
    }

    /// The pinned table is the only trust anchor of the downloaded binaries.
    #[test]
    fn every_pinned_asset_has_a_full_sha256_and_size() {
        for a in ASSETS {
            assert!(a.sha256.len() == 64 && a.sha256.bytes().all(|b| b.is_ascii_hexdigit()), "{} must pin a full sha256, or a swapped archive would run", a.name);
            assert!(a.size > 0, "{} must pin its size", a.name);
            assert!(a.name.ends_with(".zip"), "{} must be a zip: only zips go through the checked extraction", a.name);
        }
    }

    /// manifest -> server jar url. The jar is run by the preparer's Java, so it comes only from Mojang with the
    /// sha1 the release pins.
    #[test]
    fn server_jar_comes_only_from_mojang_with_the_pinned_sha1() {
        let sha = "33680f5f2ac32864d6d7cf5e56a705fdb3e05f4c";
        let manifest = |url: &str, sum: &str| json!({ "downloads": { "server": { "url": url, "sha1": sum } } });
        let good = "https://piston-data.mojang.com/v1/objects/33680f5f2ac32864d6d7cf5e56a705fdb3e05f4c/server.jar";
        let cases: [(Value, Option<&str>, &str); 6] = [
            (manifest(good, sha), Some(good), "Mojang's own file is taken"),
            (manifest(good, "0000000000000000000000000000000000000000"), None, "a different jar than the release pins is refused"),
            (manifest("https://evil.example/server.jar", sha), None, "a foreign host is refused"),
            (manifest("http://piston-data.mojang.com/x/server.jar", sha), None, "plain http is refused"),
            (manifest("https://piston-data.mojang.com.evil.example/server.jar", sha), None, "a look-alike host is refused"),
            (json!({}), None, "a manifest without a server download gives nothing"),
        ];
        for (m, want, why) in cases {
            assert_eq!(server_download(&m, sha).as_deref(), want, "{why}");
        }
    }

    /// research-lock.json -> pins. A lock for another version would prepare the wrong game.
    #[test]
    fn lock_is_read_only_for_26_3_with_full_sha1_pins() {
        let pin = "e877b6a07acd633fb3bb475002175cec036e7b87";
        let lock = |version: &str, client: &str| {
            json!({ "minecraft": { "version": version, "manifest_sha1": pin, "server_sha1": pin, "client_sha1": client } })
        };
        assert!(parse_lock(&lock("26.3", pin)).is_some(), "the pinned version's lock is read");
        assert!(parse_lock(&lock("26.2", pin)).is_none(), "a lock for another version is refused");
        assert!(parse_lock(&lock("26.3", "abc")).is_none(), "a truncated sha1 is refused");
        assert!(parse_lock(&json!({})).is_none(), "an empty lock is refused");
    }

    /// account -> what the game gets. A Millida or offline token sent to Mojang's session service would only fail.
    #[test]
    fn only_a_microsoft_session_is_handed_to_horizon() {
        let uuid = "069a79f444e94726a5befca90e38aaf5";
        let auth = |token: &str, ygg: &str| Auth { token: token.into(), uuid: uuid.into(), xuid: String::new(), yggdrasil: ygg.into() };
        let cases: [(Auth, &str, bool, &str); 5] = [
            (auth("mc-token", ""), "Notch", true, "a Microsoft account plays online"),
            (auth("millida-token", "https://auth.millida.net"), "Notch", false, "a Millida session is not Mojang's"),
            (auth("", ""), "Notch", false, "an offline account has no session"),
            (auth("mc-token", ""), "SeventeenLetters1", false, "a name Horizon refuses is not written"),
            (Auth { uuid: "../../x".into(), ..auth("mc-token", "") }, "Notch", false, "a malformed uuid is not written"),
        ];
        for (a, nick, online, why) in cases {
            assert_eq!(microsoft_session(&a, nick).is_some(), online, "{why}");
        }
    }

    #[test]
    fn missing_vulkan_is_named_instead_of_a_raw_exit_code() {
        assert_eq!(early_failure(Some(1), "ERROR wgpu: Failed to create Vulkan instance"), NO_VULKAN, "the player must learn to update the driver");
        assert_ne!(early_failure(Some(1), "thread 'main' panicked at resources missing"), NO_VULKAN, "other failures keep their own reason");
    }

    #[test]
    fn java_once_is_spent_by_one_launch() {
        horizon_java_once("hz-test-build");
        assert!(take_java_once("hz-test-build"), "the fallback start must go the Java way");
        assert!(!take_java_once("hz-test-build"), "the next Play must try Horizon again");
    }

    #[test]
    fn launch_errors_carry_the_fallback_prefix_but_a_cancel_does_not() {
        assert!(as_failure("x".into()).starts_with(HORIZON_FAIL_PREFIX), "a failure must offer the Java start");
        assert_eq!(as_failure(LAUNCH_CANCELLED.into()), LAUNCH_CANCELLED, "a cancel is not a failure to offer anything for");
    }
}
