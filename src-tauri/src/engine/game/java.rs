use crate::engine::*;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

/// Inside Flatpak the JDKs come from openjdk SDK extensions. There is no
/// extension for Java 16, and Minecraft 1.17 runs fine on 17.
#[cfg(target_os = "linux")]
fn bundled_java(major: u64) -> Option<PathBuf> {
    if !is_flatpak() {
        return None;
    }
    let want = if major == 16 { 17 } else { major };
    let bin = PathBuf::from(format!("/app/jdk/{}/bin/java", want));
    if bin.exists() { Some(bin) } else { None }
}

#[cfg(not(target_os = "linux"))]
fn bundled_java(_major: u64) -> Option<PathBuf> {
    None
}

/// On macOS the JRE home lives inside the bundle.
fn java_home(jdir: &Path) -> PathBuf {
    if cfg!(target_os = "macos") { jdir.join("Contents/Home") } else { jdir.to_path_buf() }
}

fn java_bin(jdir: &Path) -> PathBuf {
    let name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    java_home(jdir).join("bin").join(name)
}

/// jvm.cfg is the first file the JVM reads; without it the process dies before
/// main. Java 9+ keeps it in lib/, Java 8 in lib/<arch>/.
fn has_jvm_cfg(home: &Path) -> bool {
    if home.join("lib").join("jvm.cfg").exists() {
        return true;
    }
    std::fs::read_dir(home.join("lib"))
        .map(|rd| rd.flatten().any(|e| e.path().join("jvm.cfg").exists()))
        .unwrap_or(false)
}

/// The archive unpacks alphabetically, so bin/ appears long before lib/: an
/// interrupted extraction leaves a runnable-looking JRE with no jvm.cfg.
fn java_usable(jdir: &Path) -> bool {
    java_bin(jdir).exists() && has_jvm_cfg(&java_home(jdir))
}

fn parse_major(first_line: &str) -> Option<u32> {
    let quoted = first_line.split('"').nth(1)?;
    let mut parts = quoted.split(['.', '_', '-', '+']);
    let head = parts.next()?.parse::<u32>().ok()?;
    if head == 1 { parts.next()?.parse().ok() } else { Some(head) }
}

/// A 32-bit JVM caps the heap far below what modded packs need, so it is never
/// preferred over a fresh download.
fn probe_major(path: &Path) -> Option<u32> {
    let out = quiet(&mut Command::new(path)).arg("-version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    if !text.contains("64-Bit") {
        return None;
    }
    // JAVA_TOOL_OPTIONS makes the JVM print a notice above the version line.
    text.lines().find_map(parse_major)
}

fn push_children(out: &mut Vec<PathBuf>, base: &Path) {
    if let Ok(rd) = std::fs::read_dir(base) {
        for e in rd.flatten() {
            if e.path().is_dir() {
                out.push(e.path());
            }
        }
    }
}

fn system_java_homes() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = vec![];
    if let Ok(h) = std::env::var("JAVA_HOME") {
        if !h.trim().is_empty() {
            out.push(PathBuf::from(h));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let vendors = [
            "Java",
            "Eclipse Adoptium",
            "Eclipse Foundation",
            "AdoptOpenJDK",
            "Microsoft",
            "Amazon Corretto",
            "Zulu",
            "BellSoft",
            "Semeru",
            "RedHat",
            "JetBrains",
        ];
        let mut roots: Vec<PathBuf> = vec![];
        for var in ["ProgramFiles", "ProgramW6432"] {
            if let Ok(p) = std::env::var(var) {
                roots.push(PathBuf::from(p));
            }
        }
        if let Ok(p) = std::env::var("LOCALAPPDATA") {
            roots.push(PathBuf::from(p).join("Programs"));
        }
        for root in roots {
            for v in vendors {
                push_children(&mut out, &root.join(v));
            }
        }
    }
    #[cfg(target_os = "linux")]
    for base in ["/usr/lib/jvm", "/usr/lib64/jvm", "/opt/java", "/app/jdk"] {
        push_children(&mut out, Path::new(base));
    }
    #[cfg(target_os = "macos")]
    {
        push_children(&mut out, Path::new("/Library/Java/JavaVirtualMachines"));
        if let Ok(h) = std::env::var("HOME") {
            push_children(&mut out, &PathBuf::from(h).join("Library/Java/JavaVirtualMachines"));
        }
    }
    out
}

fn path_java_bins() -> Vec<PathBuf> {
    let finder = if cfg!(target_os = "windows") { "where" } else { "which" };
    let Ok(out) = quiet(&mut Command::new(finder)).arg("java").output() else { return vec![] };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| PathBuf::from(l.trim()))
        .filter(|p| p.exists())
        .collect()
}

fn scan_system_java() -> Vec<(PathBuf, u32)> {
    let mut bins: Vec<PathBuf> = system_java_homes()
        .into_iter()
        .filter(|d| java_usable(d))
        .map(|d| java_bin(&d))
        .collect();
    bins.extend(path_java_bins());
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for b in bins {
        if !seen.insert(b.to_string_lossy().to_string()) {
            continue;
        }
        if let Some(m) = probe_major(&b) {
            out.push((b, m));
        }
    }
    out
}

/// Probing spawns a JVM per candidate, so the result is cached for the session.
fn system_java(major: u64) -> Option<PathBuf> {
    static CACHE: std::sync::OnceLock<Vec<(PathBuf, u32)>> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(scan_system_java)
        .iter()
        .find(|(_, m)| u64::from(*m) == major)
        .map(|(p, _)| p.clone())
}

/// Majors the launcher is willing to fetch. The value reaches a URL and a
/// directory name, so it never comes from the webview unchecked.
pub const JAVA_MAJORS: &[u64] = &[8, 11, 17, 21, 25];

/// Downloads a managed runtime into the data directory, skipping whatever the
/// system already offers. Shared by the automatic path and the explicit
/// "download this major" action so both install exactly the same way.
pub(crate) async fn install_managed_java(app: &AppHandle, major: u64) -> Result<PathBuf, String> {
    let jdir = data_dir().join("java").join(major.to_string());
    let bin = java_bin(&jdir);
    if java_usable(&jdir) {
        return Ok(bin);
    }
    let _ = std::fs::remove_dir_all(&jdir);
    // Unpack into staging and move with a single rename so the target directory
    // is either complete or absent.
    let staging = data_dir().join("java").join(format!(".{}-new", major));
    let _ = std::fs::remove_dir_all(&staging);
    if let Err(e) = install_java(app, major, &staging).await {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    if let Some(p) = jdir.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&staging, &jdir).map_err(|e| {
        let _ = std::fs::remove_dir_all(&staging);
        format!("Не удалось установить Java: {}", e)
    })?;
    if java_usable(&jdir) { Ok(bin) } else { Err("Java не найдена после распаковки".into()) }
}

pub(crate) async fn ensure_java(app: &AppHandle, major: u64) -> Result<PathBuf, String> {
    let major = if major == 16 { 17 } else { major };
    if let Some(bin) = bundled_java(major) {
        return Ok(bin);
    }
    let jdir = data_dir().join("java").join(major.to_string());
    if java_usable(&jdir) {
        return Ok(java_bin(&jdir));
    }
    if let Some(sys) = system_java(major) {
        return Ok(sys);
    }
    install_managed_java(app, major).await
}

/// Fetches a major on demand. The webview may only name a version from the
/// published list: the number ends up in the Adoptium URL and in a path.
pub async fn download_java_runtime(app: &AppHandle, major: u64) -> Result<String, String> {
    if !JAVA_MAJORS.contains(&major) {
        return Err("Такую версию Java лаунчер не скачивает".into());
    }
    let bin = install_managed_java(app, major).await?;
    java_version_of(&bin).ok_or_else(|| "Java скачалась, но не запускается".to_string())
}

/// Installs, or reuses, the runtime for a major the webview named. Same closed
/// list as the manual download, but it goes through `ensure_java`, so inside
/// Flatpak the bundled SDK extension is used instead of a fresh Adoptium fetch.
pub async fn ensure_java_major(app: &AppHandle, major: u64) -> Result<String, String> {
    if !JAVA_MAJORS.contains(&major) {
        return Err("Такую версию Java лаунчер не ставит".into());
    }
    let bin = ensure_java(app, major).await?;
    java_version_of(&bin).ok_or_else(|| "Java установилась, но не запускается".to_string())
}

struct JavaPackage {
    url: String,
    sha256: String,
    size: Option<u64>,
}

/// The archive is executed right after unpacking, so an entry without an https
/// link and a full sha256 is dropped rather than installed unverified.
fn adoptium_package(assets: &serde_json::Value) -> Option<JavaPackage> {
    let pkg = &assets.as_array()?.first()?["binary"]["package"];
    let url = pkg["link"].as_str().filter(|u| u.starts_with("https://"))?.to_string();
    let sha256 = pkg["checksum"].as_str()?.to_lowercase();
    if !is_sha256(&sha256) {
        return None;
    }
    Some(JavaPackage { url, sha256, size: pkg["size"].as_u64() })
}

fn is_sha256(digest: &str) -> bool {
    digest.len() == 64 && digest.chars().all(|c| c.is_ascii_hexdigit())
}

/// Azul answers a package listing without digests, so the uuid from the listing
/// is resolved to the package record that carries sha256_hash.
fn azul_uuid(list: &serde_json::Value) -> Option<String> {
    let uuid = list.as_array()?.first()?["package_uuid"].as_str()?;
    if uuid.len() > 64 || !uuid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    Some(uuid.to_string())
}

fn azul_package(detail: &serde_json::Value) -> Option<JavaPackage> {
    let url = detail["download_url"]
        .as_str()
        .filter(|u| u.starts_with("https://cdn.azul.com/"))?
        .to_string();
    let sha256 = detail["sha256_hash"].as_str()?.to_lowercase();
    if !is_sha256(&sha256) {
        return None;
    }
    Some(JavaPackage { url, sha256, size: detail["size"].as_u64() })
}

struct Target {
    os: &'static str,
    ext: &'static str,
    arch: &'static str,
}

fn target() -> Target {
    let (os, ext) = if cfg!(target_os = "macos") {
        ("mac", "tar.gz")
    } else if cfg!(target_os = "windows") {
        ("windows", "zip")
    } else {
        ("linux", "tar.gz")
    };
    let arch = if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" };
    Target { os, ext, arch }
}

async fn adoptium_source(major: u64, t: &Target) -> Result<JavaPackage, String> {
    // The JRE is executed right after unpacking, so it is fetched through the
    // assets endpoint, which returns a sha256 alongside the link.
    let url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?architecture={}&image_type=jre&os={}&vendor=eclipse",
        major, t.arch, t.os
    );
    // The archive is checksum-verified, so a remembered answer is as safe as a
    // fresh one and keeps a flaky connection from blocking a launch entirely.
    let cache = data_dir().join("java").join(format!("adoptium-{}-{}-{}.json", major, t.os, t.arch));
    let assets = get_json_cached(&url, &cache).await?;
    adoptium_package(&assets).ok_or_else(|| {
        let _ = std::fs::remove_file(&cache);
        "нет сборки JRE для этой системы".to_string()
    })
}

/// Adoptium serves its archives from github.com, which whole networks cannot
/// reach; Azul is a second vendor on an unrelated CDN, so a blocked or timing
/// out primary no longer leaves the player without a runtime.
async fn azul_source(major: u64, t: &Target) -> Result<JavaPackage, String> {
    let os = match t.os {
        "mac" => "macos",
        other => other,
    };
    let list_url = format!(
        "https://api.azul.com/metadata/v1/zulu/packages/?java_version={}&os={}&arch={}&archive_type={}&java_package_type=jre&javafx_bundled=false&release_status=ga&latest=true&availability_types=CA&page_size=1",
        major, os, t.arch, t.ext
    );
    let list_cache = data_dir().join("java").join(format!("azul-{}-{}-{}.json", major, os, t.arch));
    let list = get_json_cached(&list_url, &list_cache).await?;
    let uuid = azul_uuid(&list).ok_or_else(|| {
        let _ = std::fs::remove_file(&list_cache);
        "нет сборки JRE для этой системы".to_string()
    })?;
    let detail_url = format!("https://api.azul.com/metadata/v1/zulu/packages/{}", uuid);
    let detail_cache = data_dir().join("java").join(format!("azul-pkg-{}.json", uuid));
    let detail = get_json_immutable(&detail_url, &detail_cache).await?;
    azul_package(&detail).ok_or_else(|| {
        let _ = std::fs::remove_file(&detail_cache);
        let _ = std::fs::remove_file(&list_cache);
        "ответ без sha256 — архив нечем проверить".to_string()
    })
}

/// Vendors wrap the runtime differently: Adoptium puts bin/ at the top of the
/// archive, Azul on macOS nests another zulu-NN.jre directory inside. One extra
/// level is unwrapped so both land where java_bin looks.
fn unwrap_single_dir(jdir: &Path) -> Result<(), String> {
    if java_usable(jdir) {
        return Ok(());
    }
    let mut entries = std::fs::read_dir(jdir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .collect::<Vec<_>>();
    if entries.len() != 1 {
        return Ok(());
    }
    let inner = entries.pop().expect("length checked above");
    if !inner.is_dir() || !java_usable(&inner) {
        return Ok(());
    }
    let lifted = jdir.with_file_name(format!(
        "{}-lift",
        jdir.file_name().and_then(|n| n.to_str()).unwrap_or("java")
    ));
    let _ = std::fs::remove_dir_all(&lifted);
    std::fs::rename(&inner, &lifted).map_err(|e| e.to_string())?;
    std::fs::remove_dir_all(jdir).map_err(|e| e.to_string())?;
    std::fs::rename(&lifted, jdir).map_err(|e| e.to_string())
}

fn forget_java_metadata(major: u64, t: &Target) {
    let dir = data_dir().join("java");
    for name in [
        format!("adoptium-{}-{}-{}.json", major, t.os, t.arch),
        format!("azul-{}-{}-{}.json", major, if t.os == "mac" { "macos" } else { t.os }, t.arch),
    ] {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

async fn install_java(app: &AppHandle, major: u64, jdir: &Path) -> Result<(), String> {
    emit(app, "java", 0.0, &format!("Скачиваем Java {}…", major));
    let t = target();
    let mut reasons = Vec::new();
    let archive = data_dir().join(format!("java-{}.{}", major, t.ext));
    // Второй поставщик нужен не только когда молчит справочник, но и когда
    // молчит его файловое зеркало: у Adoptium это github, и «сборка не
    // запускается, ошибка на скачивании Java» приходила именно оттуда. Падение
    // загрузки — повод взять следующего, а не повод сдаться.
    let mut fetched = false;
    for (vendor, found) in [
        ("Adoptium", adoptium_source(major, &t).await),
        ("Azul", azul_source(major, &t).await),
    ] {
        match found {
            Err(e) => reasons.push(format!("{}: {}", vendor, e)),
            Ok(pkg) => {
                // A remembered answer can point at a release that has since been
                // pulled; dropping the cache turns the next attempt back into a
                // fresh lookup.
                match download_checked(&pkg.url, &archive, Some(Sum::Sha256(&pkg.sha256)), pkg.size).await {
                    Ok(()) => {
                        fetched = true;
                        break;
                    }
                    Err(e) => {
                        forget_java_metadata(major, &t);
                        reasons.push(format!("{}: {}", vendor, e));
                    }
                }
            }
        }
    }
    if !fetched {
        return Err(format!(
            "Не удалось скачать Java {} — {}. Проверь интернет, VPN или фаервол.",
            major,
            reasons.join("; ")
        ));
    }
    emit(app, "java", 60.0, "Распаковываем Java…");
    std::fs::create_dir_all(jdir).map_err(|e| e.to_string())?;
    let unpacked = if t.ext == "zip" {
        unzip_strip1(&archive, jdir)
    } else {
        quiet(&mut Command::new("tar"))
            .args(["-xzf"]).arg(&archive).arg("-C").arg(jdir).arg("--strip-components=1")
            .status()
            .map_err(|e| e.to_string())
            .and_then(|s| if s.success() { Ok(()) } else { Err("Не удалось распаковать Java".into()) })
    };
    let _ = std::fs::remove_file(&archive);
    unpacked?;
    unwrap_single_dir(jdir)?;
    if java_usable(jdir) {
        Ok(())
    } else {
        Err("Java распаковалась не полностью — попробуй запустить ещё раз".into())
    }
}

/// Discord detects games by process name and labels any java.exe as Minecraft,
/// overriding our Rich Presence. Launching a renamed copy avoids that; the copy
/// must sit in the same bin/ because the JVM locates its home relative to the
/// executable. Falls back to the original when copying is not permitted.
pub(crate) fn branded_java(java: &Path) -> PathBuf {
    let name = if cfg!(target_os = "windows") { "MillidaLauncher.exe" } else { "MillidaLauncher" };
    let dir = match java.parent() {
        Some(d) => d,
        None => return java.to_path_buf(),
    };
    let alias = dir.join(name);
    let src_len = std::fs::metadata(java).map(|m| m.len()).unwrap_or(0);
    if src_len == 0 {
        return java.to_path_buf();
    }
    if std::fs::metadata(&alias).map(|m| m.len()).ok() != Some(src_len) {
        if std::fs::copy(java, &alias).is_err() {
            return java.to_path_buf();
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&alias, std::fs::Permissions::from_mode(0o755));
        }
    }
    if alias.exists() { alias } else { java.to_path_buf() }
}

#[derive(serde::Serialize)]
pub struct JavaInfo { pub path: String, pub version: String }

#[derive(serde::Serialize)]
pub struct JavaRuntime {
    pub major: u32,
    pub size: u64,
    pub path: String,
    pub in_use: bool,
}

/// Java majors required by installed profiles, read from on-disk version
/// metadata only so this stays offline.
fn required_majors() -> std::collections::HashSet<u32> {
    let root = game_root();
    let mut out = std::collections::HashSet::new();
    for p in load_profiles() {
        let meta = root
            .join("versions")
            .join(&p.version)
            .join(format!("{}-meta.json", p.version));
        let major = std::fs::read(&meta)
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["javaVersion"]["majorVersion"].as_u64())
            .unwrap_or(21);
        out.insert(major as u32);
    }
    out
}

pub fn list_java_runtimes() -> Vec<JavaRuntime> {
    let need = required_majors();
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(data_dir().join("java")) {
        for e in rd.flatten() {
            let Some(major) = e.file_name().to_string_lossy().parse::<u32>().ok() else { continue };
            if !e.path().is_dir() { continue }
            out.push(JavaRuntime {
                major,
                size: dir_size(&e.path()),
                path: e.path().to_string_lossy().to_string(),
                in_use: need.contains(&major),
            });
        }
    }
    out.sort_by_key(|r| r.major);
    out
}

pub fn remove_java_runtime(major: u32) -> Result<u64, String> {
    if required_majors().contains(&major) {
        return Err("Эта Java нужна одной из сборок".into());
    }
    let dir = data_dir().join("java").join(major.to_string());
    if !dir.is_dir() {
        return Err("Такая Java не установлена".into());
    }
    let freed = dir_size(&dir);
    std::fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить: {}", e))?;
    Ok(freed)
}

/// `java -version` writes to stderr: `openjdk version "21.0.2"`. A binary that
/// cannot start writes its loader error to the very same stream, so taking the
/// first line would report `libjli.so: cannot open shared object file` as the
/// installed Java version and let a dead binary through every check below.
fn version_line(stderr: &str) -> Option<String> {
    stderr.lines().map(str::trim).find(|l| parse_major(l).is_some()).map(str::to_string)
}

pub(crate) fn java_version_of(path: &Path) -> Option<String> {
    let out = quiet(&mut Command::new(path)).arg("-version").output().ok()?;
    version_line(&String::from_utf8_lossy(&out.stderr))
}

/// Java binaries the launcher discovered on its own: managed runtimes under the
/// data directory, vendor install locations and whatever PATH points at.
fn java_candidates() -> Vec<PathBuf> {
    let mut cands: Vec<PathBuf> = vec![];
    let bin_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    if let Ok(rd) = std::fs::read_dir(data_dir().join("java")) {
        for e in rd.flatten() {
            let b = if cfg!(target_os = "macos") { e.path().join("Contents/Home/bin").join(bin_name) }
                    else { e.path().join("bin").join(bin_name) };
            if b.exists() { cands.push(b); }
        }
    }
    cands.extend(system_java_homes().into_iter().filter(|d| java_usable(d)).map(|d| java_bin(&d)));
    cands.extend(path_java_bins());
    cands
}

const TRUSTED_MAX: usize = 16;

/// Paths the user picked in the native file dialog. Kept on disk because the
/// choice has to survive a restart: the picked JRE may live anywhere, so it can
/// never be re-derived from the known JRE locations.
fn trusted_java_index() -> PathBuf {
    data_dir().join("java").join("trusted.json")
}

fn trusted_java_paths() -> Vec<String> {
    std::fs::read(trusted_java_index())
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<String>>(&b).ok())
        .unwrap_or_default()
}

fn trust_java_path(path: &Path) {
    let entry = path.to_string_lossy().to_string();
    let mut all = trusted_java_paths();
    all.retain(|p| p != &entry);
    all.insert(0, entry);
    all.truncate(TRUSTED_MAX);
    let _ = write_json_atomic(&trusted_java_index(), &all);
}

/// Symlinks and 8.3 short names make two spellings of the same binary compare
/// unequal, so paths are matched after canonicalisation.
fn same_file(a: &Path, b: &Path) -> bool {
    let real = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    real(a) == real(b)
}

fn java_file_name_ok(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else { return false };
    if cfg!(target_os = "windows") { name.eq_ignore_ascii_case("java.exe") } else { name == "java" }
}

/// The JRE launcher only works inside its own runtime: it finds libjli and
/// jvm.cfg relative to itself. A sandboxed file dialog answers with a single-file
/// copy under /run/user/<uid>/doc, which is named `java`, is executable, and dies
/// on the first library it needs — so the surrounding tree is what decides.
/// Resolved first: /usr/bin/java is a symlink chain into the real JRE, and the
/// tree only exists at the far end of it.
fn java_tree_ok(bin: &Path) -> bool {
    let real = std::fs::canonicalize(bin).unwrap_or_else(|_| bin.to_path_buf());
    real.parent().and_then(|b| b.parent()).is_some_and(has_jvm_cfg)
}

/// Why a path the user typed or picked cannot be started. The generic "choose it
/// with the button" answer sends Flatpak users into the file dialog, which hands
/// back a broken single-file path, so each case says what actually helps.
pub fn java_reject_reason(path: &Path) -> String {
    if !java_file_name_ok(path) {
        let want = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
        return format!("Нужен сам файл {} из папки bin выбранной Java", want);
    }
    if !path.is_file() {
        if is_flatpak() {
            return "Flatpak не видит папки системы, поэтому такую Java запустить нельзя — впиши номер версии (например 25), лаунчер скачает её сам".into();
        }
        return "По этому пути файла java нет".into();
    }
    if !java_tree_ok(path) {
        let base = "Это одиночный файл java без своей папки lib — Java запускается только целиком";
        if is_flatpak() {
            return format!("{}. Во Flatpak выбор системной Java не работает — впиши номер версии (например 25), скачаем сами", base);
        }
        return format!("{}. Выбери bin/java внутри папки установленной Java", base);
    }
    "Эту Java лаунчер ещё не проверял — выбери её кнопкой «Обзор…» или впиши номер версии, скачаем сами".into()
}

/// The webview may name a Java binary, and the launcher then executes it, so the
/// path has to be one the core produced itself: a discovered JRE or a file the
/// user picked in the native dialog. Anything else would turn a scripting hole
/// in the UI into "run this arbitrary executable".
pub fn java_path_allowed(path: &Path) -> bool {
    if !java_file_name_ok(path) || !path.is_file() || !java_tree_ok(path) {
        return false;
    }
    java_candidates().iter().any(|c| same_file(c, path))
        || trusted_java_paths().iter().any(|c| same_file(Path::new(c), path))
}

/// Java the user picked for every build that has none of its own. Stored next to
/// the trusted index and re-validated on read: the file may have been written by
/// an older build, and the binary can disappear between launches.
fn default_java_index() -> PathBuf {
    data_dir().join("java").join("default.json")
}

pub fn default_java() -> Option<PathBuf> {
    let raw: String = std::fs::read(default_java_index())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())?;
    let p = PathBuf::from(raw.trim());
    java_path_allowed(&p).then_some(p)
}

pub fn default_java_info() -> Option<JavaInfo> {
    let p = default_java()?;
    let version = java_version_of(&p)?;
    Some(JavaInfo { path: p.to_string_lossy().to_string(), version })
}

pub fn set_default_java(path: Option<String>) -> Result<(), String> {
    let path = path.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    let Some(path) = path else {
        let _ = std::fs::remove_file(default_java_index());
        return Ok(());
    };
    if !java_path_allowed(Path::new(&path)) {
        return Err(java_reject_reason(Path::new(&path)));
    }
    write_json_atomic(&default_java_index(), &path).map_err(|e| format!("Не удалось сохранить выбор: {}", e))
}

pub fn detect_java() -> Vec<JavaInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for c in java_candidates() {
        let cs = c.to_string_lossy().to_string();
        if !seen.insert(cs.clone()) { continue }
        if let Some(v) = java_version_of(&c) { out.push(JavaInfo { path: cs, version: v }); }
    }
    out
}

pub fn test_java(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !java_path_allowed(&p) {
        return Err(java_reject_reason(&p));
    }
    java_version_of(&p).ok_or_else(|| "Не удалось запустить Java по этому пути".to_string())
}

/// Probes a binary the user picked in the native dialog and, when it really is a
/// JRE, remembers it as an allowed Java for later launches.
pub fn accept_picked_java(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !java_file_name_ok(&p) || !p.is_file() || !java_tree_ok(&p) {
        return Err(java_reject_reason(&p));
    }
    let version = java_version_of(&p).ok_or_else(|| "Не удалось запустить Java по этому пути".to_string())?;
    trust_java_path(&p);
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join("millida-java-test").join(name);
        let _ = std::fs::remove_dir_all(&d);
        let bin = java_bin(&d);
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::write(&bin, b"x").unwrap();
        d
    }

    #[test]
    fn half_unpacked_jre_is_not_usable() {
        let d = make("broken");
        assert!(!java_usable(&d));
    }

    #[test]
    fn jre_with_jvm_cfg_is_usable() {
        let d = make("ok");
        let lib = java_home(&d).join("lib");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("jvm.cfg"), b"-server KNOWN").unwrap();
        assert!(java_usable(&d));
    }

    #[test]
    fn major_is_read_from_version_line() {
        assert_eq!(parse_major("openjdk version \"21.0.2\" 2024-01-16"), Some(21));
        assert_eq!(parse_major("java version \"1.8.0_402\""), Some(8));
        assert_eq!(parse_major("openjdk version \"17\""), Some(17));
        assert_eq!(parse_major("openjdk 21.0.2"), None);
    }

    fn temp_file(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join("millida-java-guard");
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join(name);
        std::fs::write(&p, b"x").unwrap();
        p
    }

    #[test]
    fn java_binary_name_verdicts() {
        let win = cfg!(target_os = "windows");
        // (file name, should be accepted, why this case exists)
        let cases: &[(&str, bool, &str)] = &[
            ("java.exe", win, "the Windows JRE launcher is the only accepted name there"),
            ("JAVA.EXE", win, "Windows file names are case-insensitive"),
            ("java", !win, "the Unix JRE launcher"),
            ("javaw.exe", false, "javaw is not probed and would hide its own output"),
            ("cmd.exe", false, "the whole point: no other executable may be started"),
            ("java.exe.bat", false, "double extension is a different program"),
            ("java-old", false, "a name that merely starts with java is not the JRE launcher"),
            ("", false, "an empty path has no file name"),
        ];

        for (name, expected_ok, why) in cases {
            let verdict = java_file_name_ok(Path::new(name));
            assert_eq!(
                verdict, *expected_ok,
                "java_file_name_ok({name:?}) returned {verdict}, expected {expected_ok}. \
                 Reason this case is pinned: {why}",
            );
        }
    }

    /// Discord labels any process named java/javaw as Minecraft and that label
    /// replaces our Rich Presence: the game must start under a name Discord has
    /// no game entry for, and it must stay in the JRE's own bin/ or the JVM
    /// fails to find its home.
    #[test]
    fn game_process_is_never_named_like_java() {
        let dir = std::env::temp_dir().join("millida-java-brand").join("bin");
        std::fs::create_dir_all(&dir).unwrap();
        let java = dir.join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
        std::fs::write(&java, b"jre").unwrap();

        let exe = branded_java(&java);

        let name = exe.file_name().unwrap().to_string_lossy().to_ascii_lowercase();
        assert!(
            !name.starts_with("java"),
            "the game started as {name:?}: Discord matches process names and would show Minecraft              instead of Millida Launcher",
        );
        assert_eq!(
            exe.parent(),
            java.parent(),
            "the renamed copy left the JRE bin/ ({exe:?}): the JVM locates its home relative to the              executable and would refuse to start",
        );
        assert!(exe.exists(), "the copy the game is started from must exist");
        std::fs::remove_file(&java).ok();
    }

    /// The webview can pass any string to `test_java`; only binaries the core
    /// itself discovered or the user picked in the native dialog may run.
    #[test]
    fn unknown_paths_are_never_executed() {
        let bin_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
        let planted = temp_file(bin_name);
        assert!(
            !java_path_allowed(&planted),
            "a file named like the JRE launcher but sitting outside every known JRE location must be refused"
        );
        assert!(test_java(planted.to_string_lossy().to_string()).is_err(), "test_java must refuse it too");

        let other = temp_file("evil.exe");
        assert!(!java_path_allowed(&other), "an arbitrary executable must be refused");

        let missing = std::env::temp_dir().join("millida-java-guard").join("nope").join(bin_name);
        assert!(!java_path_allowed(&missing), "a path that does not exist cannot be a JRE");
    }

    /// The Java chosen in settings is started for every build that has none of
    /// its own, so it goes through the same gate as a per-build path.
    #[test]
    fn default_java_refuses_unvouched_paths() {
        let bin_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
        let planted = temp_file(bin_name);
        assert!(
            set_default_java(Some(planted.to_string_lossy().to_string())).is_err(),
            "a file named like the JRE launcher but outside every known JRE location must not become the default Java"
        );
        assert!(
            set_default_java(Some(temp_file("evil.exe").to_string_lossy().to_string())).is_err(),
            "an arbitrary executable must never be stored as the default Java"
        );
    }

    /// A sandboxed file dialog answers with a single-file copy of the binary. It
    /// is named `java`, it is executable, and it dies on `libjli.so`, so the tree
    /// around it is what separates a real JRE from a useless proxy.
    #[test]
    fn lone_java_binary_is_not_a_runtime() {
        let d = make("lone");
        let bin = java_bin(&d);
        assert!(!java_tree_ok(&bin), "java without its own lib/jvm.cfg cannot start a JVM");
        assert!(
            accept_picked_java(bin.to_string_lossy().to_string()).is_err(),
            "picking a single-file java must be refused instead of stored as a working runtime"
        );

        let lib = java_home(&d).join("lib");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("jvm.cfg"), b"-server KNOWN").unwrap();
        assert!(java_tree_ok(&bin), "the same binary inside a complete JRE is fine");
    }

    /// `java -version` and a failing loader both write to stderr, so a version has
    /// to be recognised as one — otherwise `libjli.so: cannot open shared object
    /// file` is stored and shown to the user as the installed Java version.
    #[test]
    fn only_a_real_version_line_counts() {
        // (stderr of `java -version`, version reported, why this case is pinned)
        let cases: &[(&str, Option<&str>, &str)] = &[
            (
                "openjdk version \"25.0.1\" 2025-10-21\nOpenJDK Runtime Environment\n",
                Some("openjdk version \"25.0.1\" 2025-10-21"),
                "a normal answer",
            ),
            ("java version \"1.8.0_402\"\n", Some("java version \"1.8.0_402\""), "the Java 8 spelling"),
            (
                "Picked up JAVA_TOOL_OPTIONS: -Dfoo\nopenjdk version \"21.0.2\" 2024-01-16\n",
                Some("openjdk version \"21.0.2\" 2024-01-16"),
                "the JVM prints an options notice above the version line",
            ),
            (
                "/run/user/1000/doc/S6NX/java: error while loading shared libraries: libjli.so: cannot open shared object file: No such file or directory\n",
                None,
                "the sandbox single-file copy fails exactly like this and used to be stored as a working Java",
            ),
            ("Error occurred during initialization of VM\n", None, "a JVM that dies before printing a version"),
            ("", None, "no output at all"),
        ];
        for (stderr, expected, why) in cases {
            let got = version_line(stderr);
            assert_eq!(
                got.as_deref(),
                *expected,
                "stderr {stderr:?} reported {got:?}, expected {expected:?}. Pinned because: {why}",
            );
        }
    }

    #[test]
    fn downloadable_majors_are_a_closed_list() {
        // The number reaches the Adoptium URL and a directory name.
        assert!(JAVA_MAJORS.contains(&21), "the current default runtime must stay fetchable");
        assert!(!JAVA_MAJORS.contains(&0), "a major the launcher cannot map to a release must not be requestable");
    }

    /// Writes the trusted-paths index into the launcher data directory, so it is
    /// run manually: `cargo test -- --ignored`.
    #[test]
    #[ignore = "writes into the launcher data directory"]
    fn picked_java_stays_allowed() {
        let bin_name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
        let picked = temp_file(bin_name);
        assert!(!java_path_allowed(&picked), "not allowed before it is picked");
        trust_java_path(&picked);
        assert!(java_path_allowed(&picked), "a Java picked in the dialog must keep working after a restart");
        let mut left = trusted_java_paths();
        left.retain(|p| !same_file(Path::new(p), &picked));
        let _ = write_json_atomic(&trusted_java_index(), &left);
    }

    fn assets(link: &str, checksum: &str) -> serde_json::Value {
        serde_json::json!([{
            "binary": { "package": { "link": link, "checksum": checksum, "size": 42u64 } }
        }])
    }

    #[test]
    fn adoptium_entry_verdicts() {
        let good = "7fe2324cc5901a89aaa0e8dc232075c59f2aca5270c533bdb1b861a5274af834";
        // (link, checksum, accepted, why this case is pinned)
        let cases: &[(&str, &str, bool, &str)] = &[
            ("https://github.com/a/OpenJDK17U-jre.zip", good, true, "a normal Adoptium answer"),
            ("http://github.com/a/OpenJDK17U-jre.zip", good, false, "plain HTTP could be swapped in transit"),
            ("https://github.com/a/OpenJDK17U-jre.zip", "", false, "no checksum means the archive cannot be verified"),
            ("https://github.com/a/OpenJDK17U-jre.zip", "7fe232", false, "a truncated digest is not a sha256"),
            ("https://github.com/a/OpenJDK17U-jre.zip", &good.replace('7', "z"), false, "a non-hex digest never matches"),
        ];
        for (link, checksum, expected, why) in cases {
            let got = adoptium_package(&assets(link, checksum)).is_some();
            assert_eq!(got, *expected, "link {link:?} checksum {checksum:?} accepted={got}, expected {expected}. Pinned because: {why}");
        }
        assert!(adoptium_package(&serde_json::json!([])).is_none(), "an empty answer offers no JRE");
        assert_eq!(
            adoptium_package(&assets("https://h/x.zip", good)).map(|p| p.sha256),
            Some(good.to_string()),
            "the digest must reach download_checked unchanged"
        );
    }

    #[test]
    fn azul_entry_verdicts() {
        let good = "6653196e329d393ea2ef007af90517c01781dbf5aac02fdfa84d912a55bf78f3";
        let detail = |url: &str, sum: &str| serde_json::json!({ "download_url": url, "sha256_hash": sum });
        // (download_url, sha256, accepted, why this case is pinned)
        let cases: &[(&str, &str, bool, &str)] = &[
            ("https://cdn.azul.com/zulu/bin/zulu21-jre.zip", good, true, "a normal Azul answer"),
            ("http://cdn.azul.com/zulu/bin/zulu21-jre.zip", good, false, "plain HTTP could be swapped in transit"),
            ("https://cdn.evil.com/zulu/bin/zulu21-jre.zip", good, false, "only the vendor CDN may serve an executed archive"),
            ("https://cdn.azul.com/zulu/bin/zulu21-jre.zip", "", false, "no checksum means the archive cannot be verified"),
            ("https://cdn.azul.com/zulu/bin/zulu21-jre.zip", "6653196e", false, "a truncated digest is not a sha256"),
        ];
        for (url, sum, expected, why) in cases {
            let got = azul_package(&detail(url, sum)).is_some();
            assert_eq!(got, *expected, "url {url:?} sha256 {sum:?} accepted={got}, expected {expected}. Pinned because: {why}");
        }
        assert_eq!(
            azul_package(&detail("https://cdn.azul.com/zulu/bin/z.zip", good)).map(|p| p.sha256),
            Some(good.to_string()),
            "the digest must reach download_checked unchanged"
        );
    }

    #[test]
    fn azul_uuid_must_be_path_safe() {
        let list = |uuid: &str| serde_json::json!([{ "package_uuid": uuid }]);
        assert!(azul_uuid(&list("55b71f6b-cb92-4a1f-8d96-dcb5bc680881")).is_some(), "a normal uuid resolves the package");
        assert!(azul_uuid(&list("../../etc/passwd")).is_none(), "the uuid reaches a URL and a cache file name");
        assert!(azul_uuid(&list("a b")).is_none(), "a space would split the request line");
        assert!(azul_uuid(&serde_json::json!([])).is_none(), "an empty listing offers no JRE");
    }

    #[test]
    fn nested_runtime_is_lifted_to_the_top() {
        let d = std::env::temp_dir().join("millida-java-test").join("nested-jre");
        let _ = std::fs::remove_dir_all(&d);
        let inner = d.join("zulu-21.jre");
        let lib = java_home(&inner).join("lib");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("jvm.cfg"), b"-server KNOWN").unwrap();
        let bin = java_home(&inner).join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(if cfg!(target_os = "windows") { "java.exe" } else { "java" }), b"x").unwrap();
        assert!(!java_usable(&d), "the runtime starts one level too deep");
        unwrap_single_dir(&d).unwrap();
        assert!(java_usable(&d), "a vendor that nests the runtime must still install");
    }

    #[test]
    fn java8_arch_subdir_is_usable() {
        let d = make("java8");
        let lib = java_home(&d).join("lib").join("amd64");
        std::fs::create_dir_all(&lib).unwrap();
        std::fs::write(lib.join("jvm.cfg"), b"-server KNOWN").unwrap();
        assert!(java_usable(&d));
    }
}
