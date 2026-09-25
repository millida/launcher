use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, serde::Serialize)]
pub struct FoundInstance { pub name: String, pub version: String, pub loader: String, pub path: String, pub source: String }

/// A spinning HDD with a full drive can walk for minutes; the user is waiting on
/// a modal, so the sweep stops with whatever it found by then.
const VOLUME_BUDGET: Duration = Duration::from_secs(12);
const CACHE_TTL: Duration = Duration::from_secs(300);

static CACHE: Mutex<Option<(Instant, Vec<FoundInstance>)>> = Mutex::new(None);

/// Paths the core itself surfaced — a `scan_imports` result or a native dialog
/// pick. `import_instance` accepts nothing else: an arbitrary path from the
/// webview would pull any directory on disk into the game root.
static VOUCHED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

pub(crate) fn vouch(path: &Path) {
    let mut list = VOUCHED.lock().unwrap_or_else(|e| e.into_inner());
    if !list.iter().any(|p| p == path) {
        list.push(path.to_path_buf());
    }
}

fn vouch_all(found: &[FoundInstance]) {
    let mut list = VOUCHED.lock().unwrap_or_else(|e| e.into_inner());
    for item in found {
        let p = PathBuf::from(&item.path);
        if !list.iter().any(|k| k == &p) {
            list.push(p);
        }
    }
}

fn is_vouched(path: &Path) -> bool {
    VOUCHED.lock().unwrap_or_else(|e| e.into_inner()).iter().any(|p| p == path)
}

fn fresh(stamp: Instant, now: Instant) -> bool {
    now.duration_since(stamp) < CACHE_TTL
}

pub(crate) fn home() -> PathBuf { dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")) }

pub(crate) fn launcher_roots() -> Vec<(&'static str, PathBuf)> {
    let h = home();
    let app = if cfg!(target_os = "macos") { h.join("Library/Application Support") }
              else if cfg!(target_os = "windows") { std::env::var("APPDATA").map(PathBuf::from).unwrap_or(h.join("AppData/Roaming")) }
              else { h.join(".local/share") };
    vec![
        ("PrismLauncher", app.join("PrismLauncher/instances")),
        ("MultiMC", app.join("MultiMC/instances")),
        ("ATLauncher", app.join("ATLauncher/instances")),
        ("GDLauncher", app.join("gdlauncher_next/instances")),
        ("CurseForge", h.join("curseforge/minecraft/Instances")),
        ("Modrinth App", app.join("com.modrinth.theseus/profiles")),
        ("Modrinth App", app.join("ModrinthApp/profiles")),
    ]
}

/// Launchers sharing a single .minecraft: each entry in versions/ acts as a profile.
pub(crate) fn dot_minecraft_roots() -> Vec<(&'static str, PathBuf)> {
    let h = home();
    let app = if cfg!(target_os = "macos") { h.join("Library/Application Support") }
              else if cfg!(target_os = "windows") { std::env::var("APPDATA").map(PathBuf::from).unwrap_or(h.join("AppData/Roaming")) }
              else { h.clone() };
    let dot = if cfg!(target_os = "macos") { app.join("minecraft") } else { app.join(".minecraft") };
    vec![
        ("TLauncher / Minecraft", dot),
        ("TL Legacy", app.join(".tlauncher/legacy/Minecraft/game")),
        ("TLauncher", app.join(".minecraft_tlauncher")),
    ]
}

/// Launchers are often installed off the system drive, so scan mounted volumes.
fn volume_roots() -> Vec<PathBuf> {
    let mut out = vec![];
    #[cfg(target_os = "windows")]
    {
        let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into()).to_uppercase();
        for letter in b'A'..=b'Z' {
            let d = format!("{}:", letter as char);
            if d == sys { continue }
            let p = PathBuf::from(format!("{}\\", d));
            if std::fs::read_dir(&p).is_ok() { out.push(p) }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        for base in ["/Volumes", "/media", "/mnt", "/run/media"] {
            let Ok(rd) = std::fs::read_dir(base) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                if !p.is_dir() { continue }
                if std::fs::read_dir(p.join("Users")).is_ok() || std::fs::read_dir(&p).is_ok() { out.push(p) }
            }
        }
    }
    out
}

fn skip_dir(name: &str) -> bool {
    let l = name.to_lowercase();
    l.starts_with('$')
        || l.starts_with('.') && l != ".minecraft" && !l.starts_with(".tlauncher") && l != ".local"
        || matches!(l.as_str(),
            "windows" | "program files" | "program files (x86)" | "programdata" | "node_modules"
            | "system volume information" | "recovery" | "appdata" | "temp" | "tmp"
            | "windows.old" | "perflogs" | "onedrive" | "steamapps" | "workshop")
}

fn root_kind(name: &str) -> Option<(&'static str, bool)> {
    let l = name.to_lowercase();
    match l.as_str() {
        ".minecraft" | "minecraft" | ".minecraft_tlauncher" => Some(("Minecraft на диске", true)),
        "instances" => Some(("Другой лаунчер", false)),
        "prismlauncher" | "multimc" | "atlauncher" | "gdlauncher_next" | "modrinthapp"
        | "com.modrinth.theseus" | "curseforge" | "tlauncher" | ".tlauncher" => Some(("Лаунчер на диске", false)),
        _ => None,
    }
}

/// Shallow volume walk, 3 levels deep. Returns (source, root, is_shared_dot_minecraft).
fn scan_volume(root: &Path, depth: usize, deadline: Instant, out: &mut Vec<(String, PathBuf, bool)>) {
    if depth > 3 || out.len() > 64 || Instant::now() >= deadline { return }
    let Ok(rd) = std::fs::read_dir(root) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue }
        let name = e.file_name().to_string_lossy().to_string();
        if skip_dir(&name) { continue }
        match root_kind(&name) {
            Some((src, is_dot)) if is_dot => out.push((src.to_string(), p.clone(), true)),
            Some((src, _)) => {
                for sub in ["instances", "Instances", "profiles", "minecraft/Instances"] {
                    let c = p.join(sub);
                    if c.is_dir() { out.push((src.to_string(), c, false)) }
                }
                if name.eq_ignore_ascii_case("instances") { out.push((src.to_string(), p.clone(), false)) }
                if p.join("versions").is_dir() { out.push((src.to_string(), p.clone(), true)) }
            }
            None => scan_volume(&p, depth + 1, deadline, out),
        }
    }
}

type SourceRoots = Vec<(String, PathBuf)>;

fn extra_roots() -> (SourceRoots, SourceRoots) {
    let mut found = vec![];
    let deadline = Instant::now() + VOLUME_BUDGET;
    for vol in volume_roots() { scan_volume(&vol, 1, deadline, &mut found) }
    let mut dots = vec![];
    let mut insts = vec![];
    for (src, path, is_dot) in found {
        if is_dot { dots.push((src, path)) } else { insts.push((src, path)) }
    }
    (dots, insts)
}

/// Some launchers keep instance metadata in their own database, so version and
/// loader are recovered from the launch log, Fabric remappedJars and version json.
pub(crate) fn detect_from_game_dir(dir: &Path) -> Option<(String, String)> {
    if let Ok(log) = std::fs::read_to_string(dir.join("logs/latest.log")) {
        for line in log.lines().take(80) {
            if let Some(rest) = line.split("Loading Minecraft ").nth(1) {
                let ver = rest.split_whitespace().next().unwrap_or("").to_string();
                let loader = if rest.contains("Quilt") { "quilt" }
                    else if rest.contains("Fabric") { "fabric" }
                    else { "vanilla" };
                if !ver.is_empty() { return Some((ver, loader.to_string())) }
            }
            if line.contains("NeoForge") && line.contains("Minecraft") {
                if let Some(v) = line.split("Minecraft ").nth(1).and_then(|r| r.split_whitespace().next()) {
                    return Some((v.to_string(), "neoforge".into()));
                }
            }
            if line.contains("Forge mod loading") || line.contains("MinecraftForge") {
                if let Some(v) = line.split("Minecraft ").nth(1).and_then(|r| r.split_whitespace().next()) {
                    return Some((v.to_string(), "forge".into()));
                }
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(dir.join(".fabric/remappedJars")) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if let Some(rest) = name.strip_prefix("minecraft-") {
                let ver = rest.split('-').next().unwrap_or("").to_string();
                if !ver.is_empty() { return Some((ver, "fabric".into())) }
            }
        }
    }
    // versions/<id>/<id>.json is authoritative even if the game never ran
    if let Ok(rd) = std::fs::read_dir(dir.join("versions")) {
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() { continue }
            let id = e.file_name().to_string_lossy().to_string();
            let Ok(txt) = std::fs::read_to_string(p.join(format!("{}.json", id))) else { continue };
            let Ok(v) = serde_json::from_str::<Value>(&txt) else { continue };
            let ver = game_version_of(&id, &v);
            if ver.is_empty() { continue }
            let loader = match loader_from_version_json(&v) {
                Some(l) => l,
                None => loader_from_id(&id),
            };
            return Some((ver, loader));
        }
    }
    None
}

/// Main class and libraries identify the loader regardless of the folder name.
pub(crate) fn loader_from_version_json(v: &Value) -> Option<String> {
    let main = v["mainClass"].as_str().unwrap_or("").to_lowercase();
    let libs = v["libraries"].as_array().map(|a| a.iter()
        .filter_map(|l| l["name"].as_str()).collect::<Vec<_>>().join(" ").to_lowercase())
        .unwrap_or_default();
    let hay = format!("{} {}", main, libs);
    if hay.contains("neoforged") || hay.contains("neoforge") { return Some("neoforge".into()) }
    if hay.contains("quiltmc") || hay.contains("quilt") { return Some("quilt".into()) }
    if hay.contains("fabricmc") || hay.contains("fabric") { return Some("fabric".into()) }
    if hay.contains("minecraftforge") || hay.contains("fmlclient") || hay.contains("bootstraplauncher") {
        return Some("forge".into())
    }
    None
}

pub(crate) fn loader_from_mods_dir(dir: &Path) -> Option<String> {
    let mods = dir.join("mods");
    let Ok(rd) = std::fs::read_dir(&mods) else { return None };
    let mut votes: std::collections::HashMap<&'static str, usize> = std::collections::HashMap::new();
    let mut seen = 0;
    for e in rd.flatten() {
        if seen >= 60 { break }
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()).map(|x| !x.eq_ignore_ascii_case("jar")).unwrap_or(true) { continue }
        seen += 1;
        if let Some(l) = loader_from_mod_jar(&p) { *votes.entry(l).or_default() += 1; }
    }
    votes.into_iter().max_by_key(|(_, n)| *n).map(|(l, _)| l.to_string())
}

fn loader_from_mod_jar(jar: &Path) -> Option<&'static str> {
    let f = std::fs::File::open(jar).ok()?;
    let mut zip = zip::ZipArchive::new(f).ok()?;
    if zip.by_name("META-INF/neoforge.mods.toml").is_ok() { return Some("neoforge") }
    if let Ok(mut e) = zip.by_name("META-INF/mods.toml") {
        let mut s = String::new();
        use std::io::Read;
        let _ = e.read_to_string(&mut s);
        return Some(if s.to_lowercase().contains("neoforge") { "neoforge" } else { "forge" });
    }
    if zip.by_name("quilt.mod.json").is_ok() { return Some("quilt") }
    if zip.by_name("fabric.mod.json").is_ok() { return Some("fabric") }
    if zip.by_name("mcmod.info").is_ok() { return Some("forge") }
    None
}

pub(crate) fn loader_from_id(id: &str) -> String {
    let l = id.to_lowercase();
    if l.contains("neoforge") { "neoforge".into() }
    else if l.contains("fabric") { "fabric".into() }
    else if l.contains("quilt") { "quilt".into() }
    else if l.contains("forge") { "forge".into() }
    else { "vanilla".into() }
}

/// Extracts the plain game version out of ids like "1.20.1-forge-47.2.0".
///
/// Returns empty when neither value carries a game version: TLauncher names a
/// modpack's version folder after the pack («NightfallCraft - The Casket of
/// Reveries -2.2.9.7»), and taking that name for the game version gave a build
/// that every launch refused with «Версия … не найдена».
pub(crate) fn base_version(id: &str, inherits: &str) -> String {
    if !inherits.is_empty() {
        return snapshot_like(inherits).or_else(|| mc_token(inherits)).unwrap_or_else(|| inherits.to_string());
    }
    snapshot_like(id).or_else(|| mc_token(id)).unwrap_or_default()
}

const FIRST_YEAR_RELEASE: u32 = 26;

/// Year-based releases can not be newer than next year. The bound keeps loader
/// builds that share the shape out: «1.19.2-forge-43.2.14» must read as 1.19.2.
fn newest_year_release() -> u32 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let year = (1970 + secs / 31_556_952) % 100;
    (year as u32 + 1).max(FIRST_YEAR_RELEASE + 1)
}

/// A release number of the game: the old `1.N` / `1.N.M` or the year-based
/// `26.N` / `26.N.M` that followed 1.21.11.
pub(crate) fn is_release_version(s: &str) -> bool {
    let nums: Vec<&str> = s.split('.').collect();
    if !(2..=3).contains(&nums.len()) || !nums.iter().all(|n| (1..=2).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    if nums[0] == "1" {
        return true;
    }
    let year = nums[0].parse::<u32>().unwrap_or(0);
    let drop = nums[1].parse::<u32>().unwrap_or(0);
    (FIRST_YEAR_RELEASE..=newest_year_release()).contains(&year) && drop >= 1
}

/// The longest release number in free text.
fn mc_token(s: &str) -> Option<String> {
    let mut best: Option<String> = None;
    for part in s.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
        let part = part.trim_matches('.');
        if is_release_version(part) && best.as_ref().is_none_or(|b| part.len() > b.len()) {
            best = Some(part.to_string());
        }
    }
    best
}

/// Game versions without a `1.N` in them: snapshots and the old eras.
fn snapshot_like(s: &str) -> Option<String> {
    let s = s.trim();
    if s.is_empty() || s.len() > 32 || !s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return None;
    }
    let b = s.as_bytes();
    let weekly = b.len() >= 6
        && b[..2].iter().all(u8::is_ascii_digit)
        && b[2] == b'w'
        && b[3..5].iter().all(u8::is_ascii_digit)
        && b[5].is_ascii_lowercase();
    let old = ["b1.", "a1.", "c0.", "rd-", "inf-"].iter().any(|p| s.starts_with(p));
    (weekly || old).then(|| s.to_string())
}

/// The game version a full version json was built on, read from what the
/// loader itself put there: its libraries and its `--fml.mcVersion`.
fn version_from_meta(meta: &Value) -> Option<String> {
    if let Some(v) = meta["jar"].as_str().and_then(mc_token) {
        return Some(v);
    }
    if let Some(args) = meta["arguments"]["game"].as_array() {
        let flat: Vec<&str> = args.iter().filter_map(|a| a.as_str()).collect();
        if let Some(i) = flat.iter().position(|a| *a == "--fml.mcVersion") {
            if let Some(v) = flat.get(i + 1).and_then(|v| mc_token(v)) {
                return Some(v);
            }
        }
    }
    for lib in meta["libraries"].as_array().into_iter().flatten() {
        let name = lib["name"].as_str().unwrap_or("");
        let mut it = name.split(':');
        let (Some(group), Some(artifact), Some(ver)) = (it.next(), it.next(), it.next()) else { continue };
        match (group, artifact) {
            ("net.minecraftforge", "forge" | "fmlloader" | "fmlcore" | "minecraftforge")
            | ("net.fabricmc", "intermediary")
            | ("org.quiltmc", "hashed")
            | ("net.minecraft", "client") => {
                if let Some(v) = mc_token(ver) {
                    return Some(v);
                }
            }
            ("net.neoforged", "neoforge") => {
                if let Some(v) = neoforge_game_version(ver) {
                    return Some(v);
                }
            }
            _ => {}
        }
    }
    None
}

/// Game version of a `versions/<id>/<id>.json`: its parent, then what the
/// loader wrote into it, then the folder name. Empty when none of them knows.
pub(crate) fn game_version_of(id: &str, meta: &Value) -> String {
    let inherits = meta["inheritsFrom"].as_str().unwrap_or("").trim();
    if let Some(v) = snapshot_like(inherits).or_else(|| mc_token(inherits)) {
        return v;
    }
    if let Some(v) = version_from_meta(meta) {
        return v;
    }
    base_version(id, "")
}

/// Game version a build was made for, voted by the names of its mods:
/// «zmedievalmusic-1.20.1-2.2.jar», «caelus-forge-3.2.0+1.20.1.jar». Used to
/// mend builds imported before the version folder name stopped being taken for
/// the game version — their original folder is gone, their mods are not.
pub(crate) fn version_from_mod_names(dir: &Path) -> Option<String> {
    let rd = std::fs::read_dir(dir.join("mods")).ok()?;
    let mut votes: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_lowercase();
        let Some(stem) = name.strip_suffix(".jar") else { continue };
        if let Some(v) = mc_token(stem) {
            *votes.entry(v).or_default() += 1;
        }
    }
    let mut ranked: Vec<(String, usize)> = votes.into_iter().collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let (top, n) = ranked.first()?.clone();
    let second = ranked.get(1).map(|x| x.1).unwrap_or(0);
    (n >= 3 && n >= second * 2).then_some(top)
}

/// Whether a stored game version can be one at all. A name with spaces or
/// non-Latin letters is a pack title that got into the version field.
pub(crate) fn version_is_plausible(v: &str) -> bool {
    v == "latest" || mc_token(v).is_some() || snapshot_like(v).is_some()
}

/// A build whose version field holds a pack title instead of a game version
/// (imported from TLauncher before `base_version` stopped taking the folder
/// name). The version is recovered from its mods and saved; if the mods do not
/// tell it, the player gets told what to do instead of «Версия … не найдена».
pub fn mend_profile_version(p: &mut Profile) -> Result<(), String> {
    if version_is_plausible(&p.version) {
        return Ok(());
    }
    let Some(v) = version_from_mod_names(&profile_dir(&p.name)) else {
        return Err(format!(
            "Сборка «{}» не знает свою версию Minecraft — в ней записано «{}». Открой настройки сборки и выбери версию игры или импортируй её заново",
            p.name,
            p.version.chars().take(64).collect::<String>()
        ));
    };
    p.version = v;
    let mut all = load_profiles();
    if let Some(x) = all.iter_mut().find(|x| x.name == p.name) {
        x.version = p.version.clone();
        save_profiles(&all)?;
    }
    Ok(())
}

pub fn scan_imports() -> Vec<FoundInstance> {
    {
        let hit = CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((stamp, list)) = hit.as_ref() {
            if fresh(*stamp, Instant::now()) {
                let list = list.clone();
                vouch_all(&list);
                return list;
            }
        }
    }
    let out = walk_imports();
    *CACHE.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), out.clone()));
    vouch_all(&out);
    out
}

fn walk_imports() -> Vec<FoundInstance> {
    let (extra_dots, extra_insts) = extra_roots();
    let dots: Vec<(String, PathBuf)> = dot_minecraft_roots().into_iter()
        .map(|(s, p)| (s.to_string(), p)).chain(extra_dots).collect();
    let insts: Vec<(String, PathBuf)> = launcher_roots().into_iter()
        .map(|(s, p)| (s.to_string(), p)).chain(extra_insts).collect();
    walk_roots(dots, insts)
}

/// Builds in a folder the player pointed at when the automatic search found
/// nothing: read it as a .minecraft (versions/), as a folder of instances,
/// and as one instance on its own. Found paths are vouched like scan results,
/// so import_instance accepts them.
pub fn scan_import_dir(dir: &Path) -> Vec<FoundInstance> {
    let src = "Папка".to_string();
    let mut out = walk_roots(vec![(src.clone(), dir.to_path_buf())], vec![(src.clone(), dir.to_path_buf())]);
    if let Some(parent) = dir.parent() {
        for f in walk_roots(vec![], vec![(src.clone(), parent.to_path_buf())]) {
            if Path::new(&f.path) == dir && !out.iter().any(|x| x.path == f.path) {
                out.push(f);
            }
        }
    }
    vouch_all(&out);
    out
}

fn walk_roots(dots: SourceRoots, insts: SourceRoots) -> Vec<FoundInstance> {
    let mut out: Vec<FoundInstance> = vec![];
    for (src, root) in dots {
        let versions = root.join("versions");
        let Ok(rd) = std::fs::read_dir(&versions) else { continue };
        for e in rd.flatten() {
            let dir = e.path();
            if !dir.is_dir() { continue }
            let id = dir.file_name().unwrap().to_string_lossy().to_string();
            let json = dir.join(format!("{}.json", id));
            if !json.exists() { continue }
            let meta = std::fs::read_to_string(&json).ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .unwrap_or(Value::Null);
            let inherits = meta["inheritsFrom"].as_str().unwrap_or("").to_string();
            let version = game_version_of(&id, &meta);
            if version.is_empty() { continue }
            let mut loader = loader_from_id(&id);
            if loader == "vanilla" {
                if let Some(l) = loader_from_version_json(&meta) { loader = l }
            }
            // in a shared .minecraft mods/ belongs to every version at once, so only
            // modded versions (those with inheritsFrom) may be judged by it
            if loader == "vanilla" && !inherits.is_empty() {
                if let Some(l) = loader_from_mods_dir(&root) { loader = l }
            }
            let path = root.to_string_lossy().to_string();
            if out.iter().any(|x: &FoundInstance| x.name == id && x.path == path) { continue }
            out.push(FoundInstance {
                name: id.clone(),
                version,
                loader,
                path,
                source: src.clone(),
            });
        }
    }
    for (src, root) in insts {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for e in rd.flatten() {
            let dir = e.path();
            if !dir.is_dir() { continue }
            let name = dir.file_name().unwrap().to_string_lossy().to_string();
            let mut version = String::new();
            let mut loader = "vanilla".to_string();
            if let Ok(txt) = std::fs::read_to_string(dir.join("mmc-pack.json")) {
                if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                    for c in v["components"].as_array().cloned().unwrap_or_default() {
                        match c["uid"].as_str().unwrap_or("") {
                            "net.minecraft" => version = c["version"].as_str().unwrap_or("").to_string(),
                            "net.fabricmc.fabric-loader" => loader = "fabric".into(),
                            "org.quiltmc.quilt-loader" => loader = "quilt".into(),
                            "net.minecraftforge" => loader = "forge".into(),
                            "net.neoforged" => loader = "neoforge".into(),
                            _ => {}
                        }
                    }
                }
            }
            if version.is_empty() {
                if let Ok(txt) = std::fs::read_to_string(dir.join("profile.json")) {
                    if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                        version = v["metadata"]["game_version"].as_str()
                            .or(v["game_version"].as_str())
                            .unwrap_or("").to_string();
                        let ml = v["metadata"]["loader"].as_str()
                            .or(v["loader"].as_str())
                            .unwrap_or("").to_lowercase();
                        if !ml.is_empty() && ml != "vanilla" { loader = loader_from_id(&ml) }
                    }
                }
            }
            if version.is_empty() {
                for f in ["minecraftinstance.json", "instance.json", "config.json", "manifest.json"] {
                    if let Ok(txt) = std::fs::read_to_string(dir.join(f)) {
                        if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                            version = v["gameVersion"].as_str()
                                .or(v["baseModLoader"]["minecraftVersion"].as_str())
                                .or(v["minecraft"]["version"].as_str())
                                .or(v["loaderVersion"]["minecraftVersion"].as_str())
                                // ATLauncher writes a version-json shaped instance.json,
                                // where the version sits in inheritsFrom/id
                                .or(v["inheritsFrom"].as_str())
                                .or(v["launcher"]["version"].as_str())
                                .or(v["id"].as_str())
                                .unwrap_or("").to_string();
                            let ml = v["baseModLoader"]["name"].as_str()
                                .or(v["loaderVersion"]["loaderType"].as_str())
                                .or(v["launcher"]["loaderVersion"]["type"].as_str())
                                .or(v["minecraft"]["modLoaders"][0]["id"].as_str()).unwrap_or("").to_lowercase();
                            if ml.contains("fabric") { loader = "fabric".into() }
                            else if ml.contains("quilt") { loader = "quilt".into() }
                            else if ml.contains("neoforge") { loader = "neoforge".into() }
                            else if ml.contains("forge") { loader = "forge".into() }
                            if !version.is_empty() {
                                if loader == "vanilla" { loader = loader_from_id(&version) }
                                version = base_version(&version, "");
                                break
                            }
                        }
                    }
                }
            }
            let game = ["minecraft", ".minecraft"].iter().map(|d| dir.join(d)).find(|p| p.exists()).unwrap_or(dir.clone());
            if version.is_empty() {
                if let Some((v, l)) = detect_from_game_dir(&game) {
                    version = v;
                    if loader == "vanilla" { loader = l }
                }
            }
            // launcher manifests often omit the loader, the mods do not
            if loader == "vanilla" {
                if let Some(l) = loader_from_mods_dir(&game) { loader = l }
            }
            if version.is_empty() { continue }
            let path = dir.to_string_lossy().to_string();
            if out.iter().any(|x: &FoundInstance| x.path == path) { continue }
            out.push(FoundInstance { name, version, loader, path, source: src.clone() });
        }
    }
    out
}

fn copy_game_files(game: &Path, dst: &Path) -> Result<usize, String> {
    let mut copied = 0;
    for sub in ["mods", "config", "saves", "resourcepacks", "shaderpacks", "datapacks", "options.txt"] {
        let src = game.join(sub);
        // a symlink is not followed: `mods` pointing at ~/.ssh would otherwise
        // copy the target into the game folder (copy_dir_all skips nested ones)
        let Ok(meta) = std::fs::symlink_metadata(&src) else { continue };
        if meta.file_type().is_symlink() { continue; }
        let to = dst.join(sub);
        let r = if meta.is_dir() {
            std::fs::create_dir_all(&to).and_then(|_| copy_dir_all(&src, &to))
        } else if meta.is_file() {
            std::fs::copy(&src, &to).map(|_| ())
        } else {
            continue;
        };
        r.map_err(|e| format!("Не удалось скопировать {}: {}", sub, e))?;
        copied += 1;
    }
    Ok(copied)
}

pub fn import_instance(path: String, name: String, version: String, loader: String) -> Result<Profile, String> {
    let src = PathBuf::from(&path);
    if !is_vouched(&src) {
        return Err("Импортировать можно только сборку из списка найденных или выбранную в проводнике".into());
    }
    check_version_id(&version)?;
    if !["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&loader.as_str()) {
        return Err("Неизвестный загрузчик сборки".into());
    }
    // Prism/MultiMC keep game files under .minecraft/ or minecraft/
    let game = ["minecraft", ".minecraft"].iter().map(|d| src.join(d)).find(|p| p.exists()).unwrap_or(src.clone());
    let mut all = load_profiles();
    let nm = unique_profile_name(&name);
    let dst = profile_dir(&nm);
    std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
    match copy_game_files(&game, &dst) {
        Ok(0) => {
            let _ = std::fs::remove_dir_all(&dst);
            return Err("В выбранной папке нет файлов игры (mods, config, saves…)".into());
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dst);
            return Err(e);
        }
        Ok(_) => {}
    }
    let loader = if loader == "vanilla" { loader_from_mods_dir(&dst).unwrap_or(loader) } else { loader };
    let prof = Profile { name: nm, version, fabric: loader == "fabric", loader: Some(loader), loader_version: None, icon: None };
    all.insert(0, prof.clone());
    save_profiles(&all)?;
    Ok(prof)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// age -> verdict. The disk sweep is expensive enough that reopening the
    /// import dialog must reuse it, but a drive plugged in meanwhile has to show
    /// up without restarting the launcher.
    #[test]
    fn scan_cache_expires_after_its_ttl() {
        let now = Instant::now();
        let cases: [(Duration, bool); 4] = [
            (Duration::from_secs(0), true),
            (Duration::from_secs(60), true),
            (CACHE_TTL - Duration::from_secs(1), true),
            (CACHE_TTL + Duration::from_secs(1), false),
        ];
        for (age, want) in cases {
            let stamp = now - age;
            assert_eq!(
                fresh(stamp, now),
                want,
                "a scan {age:?} old must be {}: the dialog reuses whatever this says is fresh",
                if want { "reused" } else { "redone" },
            );
        }
    }

    /// A volume walk that ignores the deadline is what froze the window: the
    /// budget has to be small enough that a user waits seconds, not minutes.
    #[test]
    fn volume_budget_stays_within_what_a_user_will_wait() {
        assert!(
            VOLUME_BUDGET <= Duration::from_secs(20),
            "a {VOLUME_BUDGET:?} sweep is longer than anyone waits on a modal",
        );
    }

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-imports-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn jar_with(dir: &Path, file: &str, entry: &str, body: &str) {
        let f = std::fs::File::create(dir.join(file)).unwrap();
        let mut z = zip::ZipWriter::new(f);
        z.start_file(entry, zip::write::SimpleFileOptions::default()).unwrap();
        use std::io::Write;
        z.write_all(body.as_bytes()).unwrap();
        z.finish().unwrap();
    }

    /// TLauncher называет папку версии модпака его заголовком. Раньше имя
    /// уходило в версию игры целиком, и каждый запуск NightfallCraft падал с
    /// «Версия NightfallCraft - … -2.2.9.7 не найдена» (21% запусков сборки).
    #[test]
    fn a_pack_titled_version_folder_is_not_a_game_version() {
        let id = "NightfallCraft - The Casket of Reveries The Casket of Reveries -2.2.9.7";
        assert_eq!(base_version(id, ""), "", "заголовок сборки — не версия игры");
        let forge = serde_json::json!({
            "id": id,
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "arguments": { "game": ["--launchTarget", "forgeclient", "--fml.mcVersion", "1.20.1", "--fml.forgeVersion", "47.3.0"] },
            "libraries": [{ "name": "net.minecraftforge:fmlloader:1.20.1-47.3.0" }]
        });
        assert_eq!(game_version_of(id, &forge), "1.20.1");
        let by_lib = serde_json::json!({ "libraries": [{ "name": "net.minecraftforge:forge:1.20.1-47.3.0:universal" }] });
        assert_eq!(game_version_of(id, &by_lib), "1.20.1");
        let neo = serde_json::json!({ "libraries": [{ "name": "net.neoforged:neoforge:21.1.77" }] });
        assert_eq!(game_version_of("My Pack", &neo), "1.21.1");
        let neo0 = serde_json::json!({ "libraries": [{ "name": "net.neoforged:neoforge:21.0.167" }] });
        assert_eq!(game_version_of("My Pack", &neo0), "1.21");
        assert_eq!(game_version_of(id, &serde_json::json!({})), "", "ничего не известно — сборка не предлагается");
        assert_eq!(game_version_of("x", &serde_json::json!({ "inheritsFrom": "1.20.1-forge-47.3.0" })), "1.20.1");
    }

    /// Обычные имена папок и старые версии читаются как раньше.
    #[test]
    fn ordinary_version_ids_still_resolve() {
        assert_eq!(base_version("1.20.1-forge-47.2.0", ""), "1.20.1");
        assert_eq!(base_version("fabric-loader-0.16.9-1.21.1", ""), "1.21.1");
        assert_eq!(base_version("Forge 1.12.2", ""), "1.12.2");
        assert_eq!(base_version("anything", "1.19.2"), "1.19.2");
        assert_eq!(base_version("24w14a", ""), "24w14a");
        assert_eq!(base_version("b1.7.3", ""), "b1.7.3");
        assert!(version_is_plausible("1.20.1"));
        assert!(version_is_plausible("latest"));
        assert!(version_is_plausible("1.21-pre1"));
        assert!(!version_is_plausible("NightfallCraft - The Casket of Reveries The Casket of Reveries -2.2.9.7"));
        assert!(!version_is_plausible("Arcania Origins Arcania Origins"));
        assert!(!version_is_plausible("arcaniaaa"));
    }

    /// вход -> вердикт. После 1.21.11 игра нумеруется по годам (26.1, 26.2).
    /// В 2.0.0 проверка версии знала только «1.N», и каждый запуск сборки на
    /// 26.x падал с «Сборка … не знает свою версию Minecraft» — 4,6 тыс.
    /// запусков у сотни игроков за три дня.
    #[test]
    fn year_based_game_versions_are_versions() {
        let plausible: [(&str, bool, &str); 10] = [
            ("26.2", true, "Fabulously Optimized, OptiPVP — релиз по годам"),
            ("26.1.2", true, "патч по годам"),
            ("26.3", true, "свежий дроп"),
            ("26.1-snapshot-7", true, "снапшот новой нумерации"),
            ("26.2-rc-1", true, "кандидат новой нумерации"),
            ("1.21.11", true, "старая нумерация не потерялась"),
            ("26.0", false, "дропов с нулём не бывает — это сборка загрузчика"),
            ("15.0.0", false, "номер самой сборки, а не игры"),
            ("47.2.0", false, "сборка Forge"),
            ("Fabulously Optimized", false, "заголовок, а не версия"),
        ];
        for (v, want, why) in plausible {
            assert_eq!(version_is_plausible(v), want, "{}: {}", v, why);
        }
        let parsed: [(&str, &str, &str); 7] = [
            ("OptiPVP 26.2 OpenGL 26.2-OpenGL-1.1", "26.2", "версия игры в заголовке сборки"),
            ("fabric-loader-0.18.1-26.2", "26.2", "папка Fabric на новой версии"),
            ("26.1.2-forge-62.0.3", "26.1.2", "папка Forge на новой версии"),
            ("1.19.2-forge-43.2.14", "1.19.2", "сборка Forge длиннее версии игры, но не версия"),
            ("1.16.5-forge-36.2.39", "1.16.5", "сборка Forge 36.x не читается как год"),
            ("1.20-forge-46.0.14", "1.20", "короткая версия игры рядом с длинной сборкой"),
            ("Fabulously Optimized 15.0.0-alpha.3", "", "номер сборки — не версия игры"),
        ];
        for (id, want, why) in parsed {
            assert_eq!(base_version(id, ""), want, "{}: {}", id, why);
        }
        let neo = serde_json::json!({ "libraries": [{ "name": "net.neoforged:neoforge:26.2.0.83" }] });
        assert_eq!(game_version_of("My Pack", &neo), "26.2", "NeoForge по годам, а не 1.26.2");
    }

    /// Уже импортированные сборки чинятся по именам модов: папки TLauncher
    /// у игрока может не остаться, а моды лежат в самой сборке.
    #[test]
    fn mods_vote_for_the_game_version() {
        let dir = tmp("mod-vote");
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        for f in [
            "zmedievalmusic-1.20.1-2.2.jar",
            "caelus-forge-3.2.0+1.20.1.jar",
            "jei-1.20.1-forge-15.3.0.4.jar",
            "somemod-1.0.3.jar",
            "config.txt",
        ] {
            std::fs::write(dir.join("mods").join(f), b"").unwrap();
        }
        assert_eq!(version_from_mod_names(&dir).as_deref(), Some("1.20.1"));
        let few = tmp("mod-vote-few");
        std::fs::create_dir_all(few.join("mods")).unwrap();
        std::fs::write(few.join("mods").join("a-1.20.1.jar"), b"").unwrap();
        assert_eq!(version_from_mod_names(&few), None, "одного мода мало, чтобы решать за игрока");
    }

    #[test]
    fn version_json_reveals_loader_when_folder_name_lies() {
        let fabric = serde_json::json!({
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "libraries": [{ "name": "net.fabricmc:fabric-loader:0.16.9" }]
        });
        assert_eq!(loader_from_version_json(&fabric).as_deref(), Some("fabric"));
        let neo = serde_json::json!({
            "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
            "libraries": [{ "name": "net.neoforged.fancymodloader:loader:4.0.24" }]
        });
        assert_eq!(loader_from_version_json(&neo).as_deref(), Some("neoforge"));
        let vanilla = serde_json::json!({
            "mainClass": "net.minecraft.client.main.Main",
            "libraries": [{ "name": "org.lwjgl:lwjgl:3.3.3" }]
        });
        assert_eq!(loader_from_version_json(&vanilla), None);
    }

    #[test]
    fn mods_folder_reveals_loader() {
        let dir = tmp("mods-fabric");
        let mods = dir.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        jar_with(&mods, "sodium.jar", "fabric.mod.json", "{\"id\":\"sodium\"}");
        jar_with(&mods, "lithium.jar", "fabric.mod.json", "{\"id\":\"lithium\"}");
        assert_eq!(loader_from_mods_dir(&dir).as_deref(), Some("fabric"));

        let dir = tmp("mods-neoforge");
        let mods = dir.join("mods");
        std::fs::create_dir_all(&mods).unwrap();
        jar_with(&mods, "jei.jar", "META-INF/mods.toml", "modLoader=\"javafml\"\n[[mods]]\nmodId=\"jei\"");
        assert_eq!(loader_from_mods_dir(&dir).as_deref(), Some("forge"));

        let dir = tmp("mods-empty");
        std::fs::create_dir_all(dir.join("mods")).unwrap();
        assert_eq!(loader_from_mods_dir(&dir), None);
    }
}
