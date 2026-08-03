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
            let inherits = v["inheritsFrom"].as_str().unwrap_or("").to_string();
            let ver = base_version(&id, &inherits);
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
pub(crate) fn base_version(id: &str, inherits: &str) -> String {
    if !inherits.is_empty() { return inherits.to_string() }
    let mut best = String::new();
    for part in id.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
        if part.starts_with('1') && part.contains('.') && part.len() > best.len() { best = part.to_string() }
    }
    if best.is_empty() { id.to_string() } else { best }
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
    let mut out: Vec<FoundInstance> = vec![];
    let (extra_dots, extra_insts) = extra_roots();
    let dots: Vec<(String, PathBuf)> = dot_minecraft_roots().into_iter()
        .map(|(s, p)| (s.to_string(), p)).chain(extra_dots).collect();
    let insts: Vec<(String, PathBuf)> = launcher_roots().into_iter()
        .map(|(s, p)| (s.to_string(), p)).chain(extra_insts).collect();
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
            let version = base_version(&id, &inherits);
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
        if !src.exists() { continue; }
        let to = dst.join(sub);
        let r = if src.is_dir() {
            std::fs::create_dir_all(&to).and_then(|_| copy_dir_all(&src, &to))
        } else {
            std::fs::copy(&src, &to).map(|_| ())
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
