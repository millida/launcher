// Export of a modpack to a .mrpack archive when the player asks. Symbolic links are not put into the archive. No network.
use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Symlinks are skipped: an export follows every file it lists, and a link in
/// a build or a world (config -> ~/.ssh) would pack the target into an archive
/// the player then hands to others.
pub(crate) fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() { continue; }
            let p = e.path();
            if ft.is_dir() { out.extend(walk(&p)); } else if ft.is_file() { out.push(p); }
        }
    }
    out
}

pub(crate) fn zip_add_overrides(
    zip: &mut zip::ZipWriter<std::fs::File>,
    pdir: &Path, subs: &[&str],
    known: &std::collections::HashSet<String>,
    opts: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Write;
    for sub in subs {
        for entry in walk(&pdir.join(sub)) {
            let name = entry.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.ends_with(".disabled") || name.starts_with("millida-") { continue }
            let rel = match entry.strip_prefix(pdir) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };
            if known.contains(&rel) { continue }
            zip.start_file(format!("overrides/{}", rel), opts).map_err(|e| e.to_string())?;
            let data = std::fs::read(&entry).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// .mrpack layout: files known to Modrinth go into modrinth.index.json, the
/// rest (configs, local files) into overrides/.
/// Имя файла выгрузки: название, которое ввёл игрок, а если в нём не осталось
/// допустимых символов — имя сборки, очищенное тем же фильтром. Ни разделителей
/// пути, ни точек в результате не бывает, поэтому файл всегда ложится прямо в
/// папку `exports`.
pub fn export_file_stem(name: &str, profile: &str) -> String {
    fn clean(s: &str) -> String {
        let kept: String =
            s.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-' || *c == '_').take(80).collect();
        kept.trim().to_string()
    }
    [clean(name), clean(profile)].into_iter().find(|s| !s.is_empty()).unwrap_or_else(|| "modpack".into())
}

/// The exact loader build the pack runs on. Modrinth App and Prism refuse an
/// index whose loader is "*", so an unpinned build exports the recommended
/// build it is launched with.
pub async fn export_loader_build(profile: &str) -> Option<String> {
    let prof = load_profiles().into_iter().find(|p| p.name == profile)?;
    if let Some(v) = prof.loader_version.clone().filter(|v| !v.trim().is_empty()) {
        return Some(v);
    }
    let builds = list_loader_versions(&prof.loader_id(), &prof.version).await.ok()?;
    builds.iter().find(|b| b.recommended).or(builds.first()).map(|b| b.version.clone())
}

pub fn export_mrpack(
    profile: String, out_path: String, name: String, version: String, description: String,
    loader_build: Option<String>,
) -> Result<String, String> {
    export_mrpack_with(profile, out_path, name, version, description, loader_build, None)
}

/// What the author of a build wants every copy of it to run with. Written as
/// `millida.json` beside the index: other launchers ignore an unknown root file.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorMeta {
    #[serde(default, skip_serializing_if = "is_zero")]
    pub ram_mb: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub java_major: Option<u64>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub lock_content: bool,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

pub const AUTHOR_META_FILE: &str = "millida.json";
/// The author asked that mods are not added to the build; a copy of it is the player's own.
pub const AUTHOR_LOCK_KEY: &str = "authorLocked";
const AUTHOR_RAM_MIN_MB: u32 = 1024;
const AUTHOR_RAM_MAX_MB: u32 = 32768;

impl AuthorMeta {
    /// The file arrives inside someone else's archive: only known Java versions
    /// and a sane memory range survive.
    pub fn checked(self) -> AuthorMeta {
        AuthorMeta {
            ram_mb: if (AUTHOR_RAM_MIN_MB..=AUTHOR_RAM_MAX_MB).contains(&self.ram_mb) { self.ram_mb } else { 0 },
            java_major: self.java_major.filter(|m| JAVA_MAJORS.contains(m)),
            lock_content: self.lock_content,
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == AuthorMeta::default()
    }
}

/// The build's own memory and Java, for an export that carries them.
pub fn author_meta_of(profile: &str, ram_mb: u32, lock_content: bool) -> AuthorMeta {
    let settings = profile_settings(profile);
    let ram = if ram_mb > 0 { ram_mb } else { settings["ramMb"].as_u64().unwrap_or(0) as u32 };
    AuthorMeta { ram_mb: ram, java_major: settings["javaMajor"].as_u64(), lock_content }.checked()
}

/// Applies an imported build's author settings. Memory is capped by this
/// machine: an author's 12 GB on an 8 GB laptop would not start at all.
pub(crate) fn apply_author_meta(profile: &str, meta: AuthorMeta) {
    let meta = meta.checked();
    if meta.is_empty() {
        return;
    }
    let mut patch = serde_json::Map::new();
    if meta.ram_mb > 0 {
        let total = total_ram_mb() as u32;
        let cap = if total > 0 { (total * 3 / 4).max(AUTHOR_RAM_MIN_MB) } else { meta.ram_mb };
        patch.insert("ramMb".into(), serde_json::json!(meta.ram_mb.min(cap)));
        patch.insert("authorRamMb".into(), serde_json::json!(meta.ram_mb));
    }
    if let Some(m) = meta.java_major {
        patch.insert("javaMajor".into(), serde_json::json!(m));
        patch.insert("authorJavaMajor".into(), serde_json::json!(m));
    }
    if meta.lock_content {
        patch.insert(AUTHOR_LOCK_KEY.into(), serde_json::json!(true));
    }
    merge_settings(profile, patch);
}

/// The author's «no extra mods» is enforced where files enter the build, not
/// only by hiding buttons: the catalogue, a dropped file and a dependency plan
/// all reach the core directly.
pub fn refuse_author_locked(profile: &str, kind: &str) -> Result<(), String> {
    if author_lock_blocks(&profile_settings(profile), kind) {
        return Err("Автор сборки запретил добавлять моды — сделай копию сборки и добавляй в неё".into());
    }
    Ok(())
}

pub(crate) fn author_lock_blocks(settings: &serde_json::Value, kind: &str) -> bool {
    kind == "mod" && settings[AUTHOR_LOCK_KEY].as_bool() == Some(true)
}

/// Reads `millida.json` from an unpacked archive; a missing or broken file means no wishes.
pub(crate) fn read_author_meta(root: &Path) -> AuthorMeta {
    std::fs::read(root.join(AUTHOR_META_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice::<AuthorMeta>(&b).ok())
        .unwrap_or_default()
        .checked()
}

pub fn export_mrpack_with(
    profile: String, out_path: String, name: String, version: String, description: String,
    loader_build: Option<String>, author: Option<AuthorMeta>,
) -> Result<String, String> {
    use std::io::Write;
    refuse_protected(&profile)?;
    let pdir = profile_dir(&profile);
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    let gv = prof.as_ref().map(|p| p.version.clone()).unwrap_or_default();
    let loader_id = prof.map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());

    let mut files_json = vec![];
    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in load_content_manifest(&profile) {
        if e.download_url.is_empty() || e.sha1.is_empty() || e.sha512.is_empty() { continue }
        if !pdir.join(content_dir(&e.kind)).join(&e.file_name).exists() { continue }
        let rel = format!("{}/{}", content_dir(&e.kind), e.file_name);
        known.insert(rel.clone());
        files_json.push(serde_json::json!({
            "path": rel,
            "hashes": {"sha1": e.sha1, "sha512": e.sha512},
            "downloads": [e.download_url],
            "fileSize": e.file_size,
            "env": {"client": "required", "server": "required"}
        }));
    }
    let mut deps = serde_json::Map::new();
    deps.insert("minecraft".into(), Value::String(gv));
    if let Some(key) = mrpack_loader_key(&loader_id) {
        let build = loader_build.filter(|v| !v.trim().is_empty()).ok_or_else(|| {
            "Не удалось узнать версию загрузчика сборки — запусти её один раз и повтори выгрузку".to_string()
        })?;
        deps.insert(key.into(), Value::String(build));
    }
    let index = serde_json::json!({
        "formatVersion": 1, "game": "minecraft",
        "versionId": if version.is_empty() { "1.0.0".to_string() } else { version },
        "name": if name.is_empty() { profile.clone() } else { name },
        "summary": description,
        "files": files_json,
        "dependencies": Value::Object(deps)
    });

    if let Some(p) = Path::new(&out_path).parent() { std::fs::create_dir_all(p).ok(); }
    let f = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("modrinth.index.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&index).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    if let Some(meta) = author.filter(|m| !m.is_empty()) {
        zip.start_file(AUTHOR_META_FILE, opts).map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    zip_add_overrides(&mut zip, &pdir, &["config", "mods", "resourcepacks", "shaderpacks", "datapacks"], &known, opts)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(out_path)
}

fn loader_for_export(profile: &str, loader_build: Option<String>) -> Result<(String, String, Option<String>), String> {
    let prof = load_profiles().into_iter().find(|p| p.name == profile).ok_or("Сборка не найдена — открой список сборок заново")?;
    let loader_id = prof.loader_id();
    let build = if loader_id == "vanilla" {
        None
    } else {
        Some(loader_build.filter(|v| !v.trim().is_empty()).ok_or_else(|| {
            "Не удалось узнать версию загрузчика сборки — запусти её один раз и повтори выгрузку".to_string()
        })?)
    };
    Ok((prof.version, loader_id, build))
}

const EXPORT_DIRS: [&str; 6] = ["config", "mods", "resourcepacks", "shaderpacks", "datapacks", "kubejs"];

/// CurseForge layout: mods installed from CurseForge go into manifest.json by
/// project and file id, everything else rides in overrides/ as files.
pub fn export_curseforge(profile: String, out_path: String, name: String, version: String, loader_build: Option<String>, author: AuthorMeta) -> Result<String, String> {
    use std::io::Write;
    refuse_protected(&profile)?;
    let pdir = profile_dir(&profile);
    let (mc, loader_id, build) = loader_for_export(&profile, loader_build)?;
    if loader_id == "quilt" {
        return Err("CurseForge не знает Quilt — выгрузи сборку в .mrpack".into());
    }
    let mut files = vec![];
    let mut known: std::collections::HashSet<String> = std::collections::HashSet::new();
    for e in load_content_manifest(&profile) {
        let Some(pid) = e.project_id.strip_prefix("cf:").and_then(|p| p.parse::<u64>().ok()) else { continue };
        let Ok(fid) = e.version_id.parse::<u64>() else { continue };
        if !pdir.join(content_dir(&e.kind)).join(&e.file_name).exists() { continue }
        known.insert(format!("{}/{}", content_dir(&e.kind), e.file_name));
        files.push(serde_json::json!({ "projectID": pid, "fileID": fid, "required": true }));
    }
    let loaders: Vec<Value> = build
        .map(|b| vec![serde_json::json!({ "id": format!("{}-{}", loader_id, b), "primary": true })])
        .unwrap_or_default();
    let mut minecraft = serde_json::json!({ "version": mc, "modLoaders": loaders });
    if author.ram_mb > 0 {
        minecraft["recommendedRam"] = serde_json::json!(author.ram_mb);
    }
    let manifest = serde_json::json!({
        "minecraft": minecraft,
        "manifestType": "minecraftModpack",
        "manifestVersion": 1,
        "name": if name.is_empty() { profile.clone() } else { name },
        "version": if version.is_empty() { "1.0.0".to_string() } else { version },
        "author": "",
        "files": files,
        "overrides": "overrides",
    });
    if let Some(p) = Path::new(&out_path).parent() { std::fs::create_dir_all(p).ok(); }
    let f = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if !author.is_empty() {
        zip.start_file(AUTHOR_META_FILE, opts).map_err(|e| e.to_string())?;
        zip.write_all(&serde_json::to_vec_pretty(&author).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    zip_add_overrides(&mut zip, &pdir, &EXPORT_DIRS, &known, opts)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(out_path)
}

fn mmc_components(mc: &str, loader_id: &str, build: Option<&str>) -> Vec<Value> {
    let mut out = vec![serde_json::json!({ "uid": "net.minecraft", "version": mc, "important": true })];
    let Some(b) = build else { return out };
    match loader_id {
        "fabric" => {
            out.push(serde_json::json!({ "uid": "net.fabricmc.intermediary", "version": mc }));
            out.push(serde_json::json!({ "uid": "net.fabricmc.fabric-loader", "version": b }));
        }
        "quilt" => {
            out.push(serde_json::json!({ "uid": "net.fabricmc.intermediary", "version": mc }));
            out.push(serde_json::json!({ "uid": "org.quiltmc.quilt-loader", "version": b }));
        }
        "forge" => out.push(serde_json::json!({ "uid": "net.minecraftforge", "version": b })),
        "neoforge" => out.push(serde_json::json!({ "uid": "net.neoforged", "version": b })),
        _ => {}
    }
    out
}

/// One-line values only: a newline in the name would write a second key into instance.cfg.
fn cfg_value(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).collect()
}

/// MultiMC and Prism instance: instance.cfg, mmc-pack.json and the game folder
/// as files, so it imports without any download.
pub fn export_multimc(profile: String, out_path: String, name: String, loader_build: Option<String>, author: AuthorMeta) -> Result<String, String> {
    use std::io::Write;
    refuse_protected(&profile)?;
    let pdir = profile_dir(&profile);
    let (mc, loader_id, build) = loader_for_export(&profile, loader_build)?;
    let title = if name.is_empty() { profile.clone() } else { name };
    let mut cfg = format!("InstanceType=OneSix\nname={}\n", cfg_value(&title));
    if author.ram_mb > 0 {
        cfg.push_str(&format!("OverrideMemory=true\nMaxMemAlloc={}\nMinMemAlloc=512\n", author.ram_mb));
    }
    let pack = serde_json::json!({ "formatVersion": 1, "components": mmc_components(&mc, &loader_id, build.as_deref()) });
    if let Some(p) = Path::new(&out_path).parent() { std::fs::create_dir_all(p).ok(); }
    let f = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("instance.cfg", opts).map_err(|e| e.to_string())?;
    zip.write_all(cfg.as_bytes()).map_err(|e| e.to_string())?;
    zip.start_file("mmc-pack.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(&serde_json::to_vec_pretty(&pack).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    for sub in EXPORT_DIRS.iter().chain(["options.txt"].iter()) {
        let root = pdir.join(sub);
        let entries = if root.is_file() { vec![root.clone()] } else { walk(&root) };
        for entry in entries {
            let fname = entry.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if fname.starts_with("millida-") { continue }
            let Ok(rel) = entry.strip_prefix(&pdir) else { continue };
            zip.start_file(format!(".minecraft/{}", rel.to_string_lossy().replace('\\', "/")), opts).map_err(|e| e.to_string())?;
            let data = std::fs::read(&entry).map_err(|e| e.to_string())?;
            zip.write_all(&data).map_err(|e| e.to_string())?;
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(out_path)
}

fn mrpack_loader_key(loader_id: &str) -> Option<&'static str> {
    match loader_id {
        "fabric" => Some("fabric-loader"),
        "quilt" => Some("quilt-loader"),
        "forge" => Some("forge"),
        "neoforge" => Some("neoforge"),
        _ => None,
    }
}

#[cfg(test)]
mod export_name_tests {
    use super::*;

    #[test]
    fn empty_title_never_lets_the_build_name_escape_exports() {
        assert_eq!(export_file_stem("", "../../../Library/LaunchAgents/x"), "LibraryLaunchAgentsx");
        assert_eq!(export_file_stem("!!!", "..\\..\\evil"), "evil");
        assert_eq!(export_file_stem("", "../.."), "modpack");
        assert_eq!(export_file_stem("  Моя сборка ", "p"), "Моя сборка");
        assert_eq!(export_file_stem("", "Survival_1"), "Survival_1");
    }

    /// (what an archive's millida.json says) -> what the launcher accepts.
    #[test]
    fn author_settings_from_an_archive_are_bounded() {
        let cases: [(AuthorMeta, AuthorMeta, &str); 3] = [
            (
                AuthorMeta { ram_mb: 6144, java_major: Some(17), lock_content: true },
                AuthorMeta { ram_mb: 6144, java_major: Some(17), lock_content: true },
                "a sane request is kept whole",
            ),
            (AuthorMeta { ram_mb: 999_999, java_major: None, lock_content: false }, AuthorMeta::default(), "absurd memory is dropped, not clamped to the cap"),
            (AuthorMeta { ram_mb: 0, java_major: Some(13), lock_content: false }, AuthorMeta::default(), "a Java the launcher does not install is ignored"),
        ];
        for (raw, want, why) in cases {
            assert_eq!(raw.checked(), want, "{}", why);
        }
    }

    /// (build settings, kind added) -> refused.
    #[test]
    fn the_authors_lock_stops_only_mods() {
        let locked = serde_json::json!({ "authorLocked": true });
        let copied = serde_json::json!({ "authorLocked": null });
        assert!(author_lock_blocks(&locked, "mod"), "a locked build takes no new mods from any path");
        assert!(!author_lock_blocks(&locked, "resourcepack"), "the lock is about mods; textures stay the player's choice");
        assert!(!author_lock_blocks(&copied, "mod"), "a copy clears the lock to null and is free again");
    }

    #[test]
    fn multimc_names_the_loader_component() {
        let uids = |l: &str| mmc_components("1.20.1", l, Some("1.0")).iter().map(|c| c["uid"].as_str().unwrap_or("").to_string()).collect::<Vec<_>>();
        assert_eq!(uids("fabric"), ["net.minecraft", "net.fabricmc.intermediary", "net.fabricmc.fabric-loader"], "Prism resolves Fabric only with intermediary listed");
        assert_eq!(uids("neoforge"), ["net.minecraft", "net.neoforged"], "NeoForge has its own uid");
        assert_eq!(mmc_components("1.20.1", "vanilla", None).len(), 1, "vanilla is just the game");
        assert_eq!(cfg_value("a\nInstanceType=x"), "aInstanceType=x", "a name cannot add keys to instance.cfg");
    }
}
