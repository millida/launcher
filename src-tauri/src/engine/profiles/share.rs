//! Sharing a build by code or link, and the manifest both sharing and cloud
//! sync are built on.
//!
//! A manifest lists catalogue files only — project, version, digest, size. That
//! is a few kilobytes for a two-gigabyte pack, and it is also what makes the
//! result reproducible: the receiving launcher fetches each file from the
//! catalogue and verifies its digest, instead of trusting an archive somebody
//! uploaded.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::engine::*;

const PACKS_PATH: &str = "/launcher/packs";
pub const PACK_FORMAT: u32 = 1;
const MAX_SUMMARY: usize = 300;
const MAX_FILES: usize = 1000;
/// Codes are read aloud and typed by hand, so the alphabet drops the characters
/// that get confused: O/0, I/1, and lowercase entirely.
const CODE_ALPHABET: &str = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN: usize = 8;

/// Hosts a manifest may point at. The file is verified by digest anyway, but a
/// digest cannot stop the launcher from being aimed at an intranet address, so
/// the address itself is checked first.
const FILE_HOSTS: [&str; 6] = [
    "cdn.modrinth.com",
    "api.modrinth.com",
    "mediafilez.forgecdn.net",
    "edge.forgecdn.net",
    "media.forgecdn.net",
    "cdn.millida.net",
];

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackFile {
    pub path: String,
    pub kind: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default)]
    pub version_id: String,
    #[serde(default)]
    pub sha1: String,
    #[serde(default)]
    pub size: u64,
    pub url: String,
}

/// A small config file carried inline: the receiving launcher writes it only
/// after the decoded bytes match `sha1`.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackOverride {
    pub path: String,
    pub sha1: String,
    pub data: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PackManifest {
    pub format_version: u32,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    pub game: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: String,
    #[serde(default)]
    pub icon: String,
    pub files: Vec<PackFile>,
    #[serde(default)]
    pub settings: Value,
    #[serde(default)]
    pub servers: Vec<ServerEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<PackOverride>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SharedPack {
    pub code: String,
    pub url: String,
    pub files: u32,
    /// Files left behind because no catalogue serves them.
    pub skipped: Vec<String>,
    pub size_bytes: u64,
}

/// Shared with «Починить», which restores a mod only from these hosts too: the
/// record it reads sits in the game folder, where archives and imports can put
/// their own.
pub(crate) fn url_allowed(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else { return false };
    if url.scheme() != "https" {
        return false;
    }
    url.host_str().map(|h| FILE_HOSTS.contains(&h)).unwrap_or(false)
}

fn settings_of(profile: &str) -> Value {
    let s: Value = std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    // Only the knobs that describe the build travel. Java paths, covers and
    // anything naming this machine stay here. JVM flags never travel: they are
    // code execution in someone else's game. Neither does the Modrinth pack
    // link: "update the pack" wipes mods/ and reinstalls from that slug.
    serde_json::json!({
        "width": s["width"].as_u64().unwrap_or(0),
        "height": s["height"].as_u64().unwrap_or(0),
        "autoTune": s["autoTune"].as_bool().unwrap_or(true),
        "fpsBoost": s["fpsBoost"].as_bool().unwrap_or(false),
    })
}

/// Builds the manifest for a build on disk. `skipped` names the files that
/// cannot travel — hand-added jars and edited configs — so the player is told
/// what the receiving side will be missing instead of discovering it later.
/// `with_overrides` is off for cloud sync: its snapshot of every build has a
/// size cap the configs of two builds would already exceed.
pub fn build_manifest(profile: &str, with_overrides: bool) -> Result<(PackManifest, Vec<String>), String> {
    let prof = load_profiles()
        .into_iter()
        .find(|p| p.name == profile)
        .ok_or("Сборка не найдена")?;
    let pdir = profile_dir(profile);
    let manifest = load_content_manifest(profile);
    let mut files = vec![];
    let mut listed: HashSet<String> = HashSet::new();
    for e in manifest {
        if e.download_url.is_empty() || e.sha1.is_empty() || !url_allowed(&e.download_url) {
            continue;
        }
        let rel = format!("{}/{}", content_dir(&e.kind), e.file_name);
        if !pdir.join(&rel).exists() {
            continue;
        }
        listed.insert(rel.clone());
        files.push(PackFile {
            path: rel,
            kind: e.kind,
            project_id: e.project_id,
            version_id: e.version_id,
            sha1: e.sha1,
            size: e.file_size,
            url: e.download_url,
        });
    }
    if files.len() > MAX_FILES {
        return Err(format!("В сборке больше {} файлов из каталогов — такую пока не передать", MAX_FILES));
    }
    let mut skipped = vec![];
    for sub in SHARED_DIRS {
        let Ok(rd) = std::fs::read_dir(pdir.join(sub)) else { continue };
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !entry.path().is_file() || name.ends_with(".disabled") {
                continue;
            }
            let rel = format!("{}/{}", sub, name);
            if !listed.contains(&rel) {
                skipped.push(rel);
            }
        }
    }
    let overrides = if with_overrides {
        let (kept, left) = collect_overrides(&pdir);
        skipped.extend(left);
        kept
    } else {
        vec![]
    };
    skipped.sort();
    Ok((
        PackManifest {
            format_version: PACK_FORMAT,
            name: profile.to_string(),
            summary: String::new(),
            game: prof.version.clone(),
            loader: prof.loader_id(),
            loader_version: prof.loader_version.clone().unwrap_or_default(),
            icon: prof.icon.clone().filter(|i| i.starts_with("https://")).unwrap_or_default(),
            files,
            settings: settings_of(profile),
            servers: list_servers(profile),
            overrides,
        },
        skipped,
    ))
}

fn code_ok(code: &str) -> bool {
    let plain = normalize_code(code);
    plain.len() == CODE_LEN && plain.chars().all(|c| CODE_ALPHABET.contains(c))
}

/// Players paste the code with the dash, in lowercase, or as the whole link.
/// All three mean the same pack.
pub fn normalize_code(code: &str) -> String {
    let tail = code.rsplit('/').next().unwrap_or(code);
    tail.trim().to_uppercase().chars().filter(|c| c.is_ascii_alphanumeric()).collect()
}

pub fn pack_link(code: &str) -> String {
    format!("https://millida.net/p/{}", code)
}

/// Publishes the build and returns the code to pass on. Re-publishing the same
/// build keeps the code: the link a player already sent to friends must not go
/// stale because they added a mod.
pub async fn share_profile(profile: String, summary: Option<String>) -> Result<SharedPack, String> {
    refuse_protected(&profile)?;
    let (mut manifest, skipped) = build_manifest(&profile, true)?;
    if manifest.files.is_empty() {
        return Err("В сборке нет файлов из Modrinth или CurseForge — передавать нечего".into());
    }
    manifest.summary = summary
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(MAX_SUMMARY)
        .collect::<String>()
        .trim()
        .to_string();
    let body = serde_json::to_value(&manifest).map_err(|e| e.to_string())?;
    let size_bytes = serde_json::to_vec(&body).map(|v| v.len() as u64).unwrap_or(0);
    let res = millida_api_auth(PACKS_PATH.to_string(), "POST".into(), Some(body)).await?;
    let code = res["code"].as_str().filter(|c| code_ok(c)).ok_or("Сервер не выдал код сборки")?.to_string();
    Ok(SharedPack {
        url: pack_link(&code),
        code,
        files: manifest.files.len() as u32,
        skipped,
        size_bytes,
    })
}


pub async fn unshare_profile(code: String) -> Result<(), String> {
    let code = normalize_code(&code);
    if !code_ok(&code) {
        return Err("Некорректный код сборки".into());
    }
    millida_api_auth(format!("{}/{}", PACKS_PATH, code), "DELETE".into(), None).await?;
    Ok(())
}

/// The manifest as published, before anything is downloaded: the player sees
/// what they are about to install.
pub async fn pack_preview(code: String) -> Result<Value, String> {
    let code = normalize_code(&code);
    if !code_ok(&code) {
        return Err("Такого кода не бывает — проверь, что ввёл".into());
    }
    let res = millida_api(format!("{}/{}", PACKS_PATH, code), "GET".into(), None, None).await?;
    let (manifest, dropped) = parse_manifest_report(&res["manifest"])?;
    let mods: Vec<Value> = manifest
        .files
        .iter()
        .map(|f| {
            serde_json::json!({
                "name": f.path.rsplit('/').next().unwrap_or(&f.path),
                "kind": f.kind,
                "source": file_source(&f.url),
                "size": f.size,
            })
        })
        .collect();
    let overrides: Vec<&str> = manifest.overrides.iter().map(|o| o.path.as_str()).collect();
    Ok(serde_json::json!({
        "code": code,
        "name": manifest.name,
        "summary": manifest.summary,
        "game": manifest.game,
        "loader": manifest.loader,
        "files": manifest.files.len(),
        "author": res["author"].as_str().unwrap_or(""),
        "installs": res["installs"].as_u64().unwrap_or(0),
        "updatedAt": res["updatedAt"].as_str().unwrap_or(""),
        "sizeBytes": manifest.files.iter().map(|f| f.size).sum::<u64>(),
        "mods": mods,
        "overrides": overrides,
        "dropped": dropped,
    }))
}

/// Where a manifest says a file comes from. Only a label for the confirmation
/// list: what is actually downloaded is decided by the catalogue lookup.
fn file_source(url: &str) -> &'static str {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase)).unwrap_or_default();
    match host.as_str() {
        "cdn.modrinth.com" | "api.modrinth.com" => "modrinth",
        "edge.forgecdn.net" | "mediafilez.forgecdn.net" | "media.forgecdn.net" => "curseforge",
        "cdn.millida.net" => "millida",
        _ => "unknown",
    }
}

/// Everything a manifest says is untrusted: it came over the network from
/// another player. Paths, addresses and digests are all re-checked here, in one
/// place, so no caller can skip a check.
pub(crate) fn parse_manifest(raw: &Value) -> Result<PackManifest, String> {
    parse_manifest_report(raw).map(|(manifest, _)| manifest)
}

/// Same as `parse_manifest`, plus the paths of the entries it refused, so the
/// player sees what the pack will arrive without.
pub(crate) fn parse_manifest_report(raw: &Value) -> Result<(PackManifest, Vec<String>), String> {
    let mut manifest: PackManifest =
        serde_json::from_value(raw.clone()).map_err(|_| "Сборка записана в неизвестном формате".to_string())?;
    if manifest.format_version > PACK_FORMAT {
        return Err("Сборку сделали в более новой версии лаунчера — обнови лаунчер".into());
    }
    manifest.game = manifest.game.trim().to_string();
    if manifest.game.is_empty() {
        return Err("В сборке не указана версия Minecraft".into());
    }
    // the version names a folder and a file under versions/
    check_version_id(&manifest.game)?;
    manifest.loader_version = manifest.loader_version.trim().to_string();
    if !manifest.loader_version.is_empty() {
        check_loader_version(&manifest.loader_version)?;
    }
    if !manifest.icon.starts_with("https://") {
        manifest.icon.clear();
    }
    let mut dropped: Vec<String> = manifest.files.iter().skip(MAX_FILES).map(|f| shown_path(&f.path)).collect();
    manifest.files.truncate(MAX_FILES);
    manifest.files.retain_mut(|f| {
        let kept = match shared_entry_path(&f.kind, &f.path) {
            Ok(path) if url_allowed(&f.url) && sha1_ok(&f.sha1) => {
                f.path = path;
                f.sha1 = f.sha1.to_ascii_lowercase();
                true
            }
            _ => false,
        };
        if !kept {
            dropped.push(shown_path(&f.path));
        }
        kept
    });
    let (overrides, refused) = accept_overrides(std::mem::take(&mut manifest.overrides));
    manifest.overrides = overrides;
    dropped.extend(refused);
    dropped.truncate(MAX_DROPPED_SHOWN);
    manifest.name = manifest.name.chars().filter(|c| !c.is_control()).take(64).collect();
    manifest.summary = manifest.summary.chars().filter(|c| !c.is_control() || *c == '\n').take(MAX_SUMMARY).collect();
    Ok((manifest, dropped))
}

fn sha1_ok(sha1: &str) -> bool {
    sha1.len() == 40 && sha1.bytes().all(|b| b.is_ascii_hexdigit())
}

fn shown_path(path: &str) -> String {
    path.chars().filter(|c| !c.is_control()).take(160).collect()
}

/// Overrides that survive every check, in manifest order, and the paths of
/// those that did not. The caps are counted over what is kept, so a pack
/// padded with junk entries cannot push its real configs out.
fn accept_overrides(raw: Vec<PackOverride>) -> (Vec<PackOverride>, Vec<String>) {
    let mut kept: Vec<PackOverride> = vec![];
    let mut refused = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    let mut total = 0usize;
    for o in raw {
        let accepted = (kept.len() < MAX_OVERRIDES)
            .then(|| decode_override(&o).ok())
            .flatten()
            .filter(|(path, bytes)| total + bytes.len() <= MAX_OVERRIDES_TOTAL && seen.insert(path.to_lowercase()));
        match accepted {
            Some((path, bytes)) => {
                total += bytes.len();
                kept.push(PackOverride { path, sha1: o.sha1.to_ascii_lowercase(), data: o.data });
            }
            None => refused.push(shown_path(&o.path)),
        }
    }
    (kept, refused)
}

/// The decoded bytes of an override and where they may land, or why not.
fn decode_override(o: &PackOverride) -> Result<(String, Vec<u8>), &'static str> {
    let path = shared_entry_path(OVERRIDE_KIND, &o.path)?;
    if !sha1_ok(&o.sha1) {
        return Err("нет контрольной суммы");
    }
    if o.data.len() > MAX_OVERRIDE_BYTES.div_ceil(3) * 4 {
        return Err("файл больше 64 КиБ");
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(o.data.as_bytes())
        .map_err(|_| "данные файла повреждены")?;
    if bytes.len() > MAX_OVERRIDE_BYTES {
        return Err("файл больше 64 КиБ");
    }
    if !super::milli_local::sha1_hex(&bytes).eq_ignore_ascii_case(&o.sha1) {
        return Err("контрольная сумма не совпала");
    }
    Ok((path, bytes))
}

/// Kinds a manifest may carry, and the only place each may land:
/// `<content dir of the kind>/<plain file name>`. Anything else (a config, a
/// launcher service file, a nested path) is not catalogue content.
const SHARED_KINDS: [&str; 4] = ["mod", "resourcepack", "shader", "datapack"];

/// Config files a pack may carry inline. Only data the game reads: anything a
/// loader or a scripting mod would execute stays out, whatever folder it sits in.
const OVERRIDE_KIND: &str = "override";
const OVERRIDE_ROOTS: [&str; 2] = ["config", "defaultconfigs"];
const OVERRIDE_EXTS: [&str; 14] = [
    "json", "json5", "toml", "cfg", "conf", "properties", "txt", "yml", "yaml", "png", "ogg", "mcmeta", "lang", "snbt",
];
const OVERRIDE_CODE_EXTS: [&str; 19] = [
    "jar", "class", "zip", "js", "mjs", "kubejs", "scripts", "exe", "dll", "bat", "cmd", "ps1", "sh", "vbs", "py", "lua",
    "so", "dylib", "zs",
];
const OVERRIDE_CODE_DIRS: [&str; 2] = ["kubejs", "scripts"];
const MAX_OVERRIDE_PATH: usize = 240;
const MAX_OVERRIDE_SEGMENT: usize = 96;
const MAX_OVERRIDE_DEPTH: usize = 8;
const MAX_OVERRIDE_BYTES: usize = 64 * 1024;
const MAX_OVERRIDES_TOTAL: usize = 512 * 1024;
const MAX_OVERRIDES: usize = 200;
const MAX_OVERRIDE_WALK: usize = 5000;
const MAX_DROPPED_SHOWN: usize = 200;

/// The one place that decides where a shared manifest may write: catalogue
/// files and inline overrides alike. Returns the normalised relative path the
/// installer joins with `safe_join`, or why the entry is refused.
pub(crate) fn shared_entry_path(kind: &str, path: &str) -> Result<String, &'static str> {
    if kind == OVERRIDE_KIND {
        return override_path(path);
    }
    if !SHARED_KINDS.contains(&kind) {
        return Err("неизвестный тип файла");
    }
    let (dir, name) = path.split_once('/').ok_or("файл не в папке материалов")?;
    if dir != content_dir(kind) {
        return Err("папка не совпадает с типом файла");
    }
    let plain = safe_file_name(name).map_err(|_| "небезопасное имя файла")?;
    if plain != name {
        return Err("небезопасное имя файла");
    }
    if is_launcher_service_file(&plain) {
        return Err("служебный файл лаунчера");
    }
    Ok(format!("{}/{}", dir, plain))
}

fn override_path(path: &str) -> Result<String, &'static str> {
    if path.is_empty() || path.len() > MAX_OVERRIDE_PATH {
        return Err("пустой или слишком длинный путь");
    }
    if path.contains('\\') {
        return Err("обратная косая черта в пути");
    }
    if path.chars().any(char::is_control) {
        return Err("управляющий символ в пути");
    }
    if path.starts_with('/') || path.contains(':') {
        return Err("абсолютный путь");
    }
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() < 2 || parts.len() > MAX_OVERRIDE_DEPTH {
        return Err("слишком глубокий путь");
    }
    for part in &parts {
        if part.is_empty() || *part == "." || *part == ".." {
            return Err("пустой сегмент или переход по дереву");
        }
        if part.starts_with('.') {
            return Err("скрытый файл или папка");
        }
        if part.chars().count() > MAX_OVERRIDE_SEGMENT {
            return Err("слишком длинное имя");
        }
        if OVERRIDE_CODE_DIRS.contains(&part.to_lowercase().as_str()) {
            return Err("папка скриптов");
        }
    }
    let root = parts[0].to_ascii_lowercase();
    if !OVERRIDE_ROOTS.contains(&root.as_str()) {
        return Err("настройки кладутся только в config/ и defaultconfigs/");
    }
    let name = parts[parts.len() - 1];
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).ok_or("файл без расширения")?;
    if OVERRIDE_CODE_EXTS.contains(&ext.as_str()) {
        return Err("исполняемый файл или архив");
    }
    if !OVERRIDE_EXTS.contains(&ext.as_str()) {
        return Err("такой тип файла настройкой не считается");
    }
    if is_launcher_service_file(name) {
        return Err("служебный файл лаунчера");
    }
    let normalised = std::iter::once(root.as_str()).chain(parts[1..].iter().copied()).collect::<Vec<_>>().join("/");
    if !rel_path_ok(&normalised) {
        return Err("имя, которое система прочтёт иначе");
    }
    Ok(normalised)
}

/// Every config under `config/` and `defaultconfigs/`, sorted, without
/// following links: a link inside a build may point anywhere on the disk.
fn override_candidates(pdir: &Path) -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    let mut visited = 0usize;
    let mut stack: Vec<(String, PathBuf, usize)> =
        OVERRIDE_ROOTS.iter().map(|r| (r.to_string(), pdir.join(r), 1)).collect();
    while let Some((rel, dir, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for entry in rd.flatten() {
            visited += 1;
            if visited > MAX_OVERRIDE_WALK {
                out.sort();
                return out;
            }
            let child = format!("{}/{}", rel, entry.file_name().to_string_lossy());
            let Ok(ft) = entry.file_type() else { continue };
            if ft.is_dir() && depth + 1 < MAX_OVERRIDE_DEPTH {
                stack.push((child, entry.path(), depth + 1));
            } else if ft.is_file() {
                out.push((child, entry.path()));
            }
        }
    }
    out.sort();
    out
}

/// Configs that fit the limits travel; the rest are named in `skipped`.
fn collect_overrides(pdir: &Path) -> (Vec<PackOverride>, Vec<String>) {
    let mut kept = vec![];
    let mut skipped = vec![];
    let mut total = 0usize;
    for (rel, path) in override_candidates(pdir) {
        let read = shared_entry_path(OVERRIDE_KIND, &rel).ok().filter(|_| kept.len() < MAX_OVERRIDES).and_then(|norm| {
            let len = std::fs::metadata(&path).ok()?.len();
            let fits = len <= MAX_OVERRIDE_BYTES as u64 && total as u64 + len <= MAX_OVERRIDES_TOTAL as u64;
            let bytes = std::fs::read(&path).ok().filter(|_| fits)?;
            (bytes.len() <= MAX_OVERRIDE_BYTES && total + bytes.len() <= MAX_OVERRIDES_TOTAL).then_some((norm, bytes))
        });
        match read {
            Some((norm, bytes)) => {
                total += bytes.len();
                kept.push(PackOverride {
                    path: norm,
                    sha1: super::milli_local::sha1_hex(&bytes),
                    data: base64::engine::general_purpose::STANDARD.encode(&bytes),
                });
            }
            None => skipped.push(rel),
        }
    }
    (kept, skipped)
}

/// What a catalogue file must still prove once it is on disk.
#[derive(Clone)]
enum Proof {
    Sha512(String),
    Fingerprint(u32),
}

/// A manifest line the catalogue vouched for: the address, digests and ids are
/// the catalogue's own, never the manifest's.
struct Vouched {
    rel: String,
    kind: String,
    name: String,
    urls: Vec<String>,
    sha1: String,
    size: Option<u64>,
    proof: Proof,
    project_id: String,
    version_id: String,
}

fn file_name_of(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

/// Modrinth's answer for the file's sha1, accepted only when the version really
/// holds a file with that sha1 and gives a sha512 to check it by.
fn modrinth_vouch(version: &Value, f: &PackFile) -> Option<Vouched> {
    let file = version["files"]
        .as_array()?
        .iter()
        .find(|x| x["hashes"]["sha1"].as_str().is_some_and(|h| h.eq_ignore_ascii_case(&f.sha1)))?;
    let url = file["url"].as_str().filter(|u| url_allowed(u))?;
    let sha512 = file["hashes"]["sha512"]
        .as_str()
        .filter(|h| h.len() == 128 && h.bytes().all(|b| b.is_ascii_hexdigit()))?;
    let project_id = version["project_id"].as_str().filter(|s| !s.is_empty())?;
    Some(Vouched {
        rel: f.path.clone(),
        kind: f.kind.clone(),
        name: file_name_of(&f.path),
        urls: vec![url.to_string()],
        sha1: f.sha1.to_ascii_lowercase(),
        size: file["size"].as_u64().filter(|s| *s > 0),
        proof: Proof::Sha512(sha512.to_ascii_lowercase()),
        project_id: project_id.to_string(),
        version_id: version["id"].as_str().unwrap_or("").to_string(),
    })
}

/// CurseForge ids a manifest line names: project `cf:<mod>` and the file id.
fn cf_ids(f: &PackFile) -> Option<(u64, u64)> {
    let project = f.project_id.strip_prefix("cf:").unwrap_or(&f.project_id).parse::<u64>().ok().filter(|v| *v > 0)?;
    let file = f.version_id.parse::<u64>().ok().filter(|v| *v > 0)?;
    Some((project, file))
}

/// CurseForge's record of the file, accepted only when it belongs to the named
/// project, carries the same sha1 and a fingerprint to check the bytes by.
fn cf_vouch(file: &Value, mod_id: u64, f: &PackFile) -> Option<Vouched> {
    if file["modId"].as_u64() != Some(mod_id) {
        return None;
    }
    let sha1 = cf_sha1(file);
    if !sha1.eq_ignore_ascii_case(&f.sha1) {
        return None;
    }
    let print = file["fileFingerprint"].as_u64().and_then(|v| u32::try_from(v).ok()).filter(|v| *v > 0)?;
    let cf_name = safe_file_name(file["fileName"].as_str()?).ok()?;
    let urls: Vec<String> = cf_file_urls(file, &cf_name).into_iter().filter(|u| url_allowed(u)).collect();
    if urls.is_empty() {
        return None;
    }
    Some(Vouched {
        rel: f.path.clone(),
        kind: f.kind.clone(),
        name: file_name_of(&f.path),
        urls,
        sha1: sha1.to_ascii_lowercase(),
        size: file["fileLength"].as_u64().filter(|s| *s > 0),
        proof: Proof::Fingerprint(print),
        project_id: format!("cf:{}", mod_id),
        version_id: file["id"].as_u64().unwrap_or(0).to_string(),
    })
}

fn refused_text(names: &[String]) -> String {
    format!(
        "Сборка не установлена: эти файлы не нашлись в Modrinth и CurseForge или не совпали с ними, а непроверенные файлы лаунчер не ставит: {}",
        names.join(", ")
    )
}

/// The sha1 a manifest claims proves nothing on its own: the manifest came from
/// another player. Every file is looked up in the catalogue first, and the pack
/// is refused as a whole when any file is unknown there, so nothing is fetched
/// and no partial build is left behind.
async fn vouch_files(files: &[PackFile]) -> Result<Vec<Vouched>, String> {
    let hashes: Vec<String> =
        files.iter().map(|f| f.sha1.to_ascii_lowercase()).collect::<HashSet<_>>().into_iter().collect();
    let modrinth = if hashes.is_empty() {
        HashMap::new()
    } else {
        versions_by_hash_checked(&hashes)
            .await
            .map_err(|e| format!("Не удалось сверить файлы сборки с Modrinth, попробуй ещё раз: {}", e))?
    };
    let mr_vouched: Vec<Option<Vouched>> =
        files.iter().map(|f| modrinth.get(&f.sha1.to_ascii_lowercase()).and_then(|v| modrinth_vouch(v, f))).collect();
    let cf_wanted: Vec<u64> = files
        .iter()
        .zip(&mr_vouched)
        .filter(|(_, v)| v.is_none())
        .filter_map(|(f, _)| cf_ids(f).map(|(_, file)| file))
        .collect();
    let mut cf = if cf_wanted.is_empty() { HashMap::new() } else { cf_files_bulk(&cf_wanted).await };
    let mut vouched = vec![];
    let mut refused = vec![];
    for (f, mr) in files.iter().zip(mr_vouched) {
        if let Some(v) = mr {
            vouched.push(v);
            continue;
        }
        let from_cf = match cf_ids(f) {
            Some((mod_id, file_id)) => {
                if let std::collections::hash_map::Entry::Vacant(slot) = cf.entry(file_id) {
                    let j = cf_get(&format!("v1/mods/{}/files/{}", mod_id, file_id), &[])
                        .await
                        .map_err(|e| format!("Не удалось сверить {} с CurseForge: {}", file_name_of(&f.path), e))?;
                    if j["data"].is_object() {
                        slot.insert(j["data"].clone());
                    }
                }
                cf.get(&file_id).and_then(|file| cf_vouch(file, mod_id, f))
            }
            None => None,
        };
        match from_cf {
            Some(v) => vouched.push(v),
            None => refused.push(file_name_of(&f.path)),
        }
    }
    if !refused.is_empty() {
        return Err(refused_text(&refused));
    }
    Ok(vouched)
}

fn file_sha512(path: &Path) -> Option<String> {
    use sha2::Digest as _;
    let mut file = std::fs::File::open(path).ok()?;
    let mut h = sha2::Sha512::new();
    let mut buf = vec![0u8; 128 * 1024];
    loop {
        match std::io::Read::read(&mut file, &mut buf) {
            Ok(0) => break,
            Ok(n) => h.update(&buf[..n]),
            Err(_) => return None,
        }
    }
    Some(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

/// Re-hashes the file as it lies on disk. The downloader may have accepted an
/// existing file by size alone, or linked one from the shared store.
fn proof_holds(path: &Path, sha1: &str, proof: &Proof) -> bool {
    if !file_sha1(path).is_some_and(|h| h.eq_ignore_ascii_case(sha1)) {
        return false;
    }
    match proof {
        Proof::Sha512(want) => file_sha512(path).is_some_and(|h| h.eq_ignore_ascii_case(want)),
        Proof::Fingerprint(want) => fingerprint_file(path) == Some(*want),
    }
}

/// Downloads a vouched file and checks it against the catalogue's digests.
/// Returns the address it came from.
async fn fetch_vouched(pdir: &Path, v: &Vouched) -> Result<String, String> {
    let dest = safe_join(pdir, &v.rel).map_err(|e| format!("Сборка содержит небезопасный путь: {}", e))?;
    let mut last = String::new();
    let mut used = None;
    for url in &v.urls {
        match download_verify(url, &dest, Some(&v.sha1), v.size).await {
            Ok(()) => {
                used = Some(url.clone());
                break;
            }
            Err(e) => last = e,
        }
    }
    let url = used.ok_or_else(|| format!("Не скачался файл {}: {}", v.name, last))?;
    let (path, sha1, proof) = (dest.clone(), v.sha1.clone(), v.proof.clone());
    let holds = tokio::task::spawn_blocking(move || proof_holds(&path, &sha1, &proof))
        .await
        .map_err(|e| format!("Не удалось проверить файл {}: {}", v.name, e))?;
    if !holds {
        let removal = std::fs::remove_file(&dest);
        return Err(match removal {
            Ok(()) => format!("Файл {} не совпал с каталогом — установка остановлена", v.name),
            Err(e) => format!("Файл {} не совпал с каталогом и не удалился ({}) — удали его из сборки вручную", v.name, e),
        });
    }
    Ok(url)
}

/// Installs a manifest as a build. Shared by the code flow and by cloud sync,
/// so a pack from a friend and a pack from another of your own machines land
/// through exactly the same checks.
pub(crate) async fn install_manifest(
    app: &AppHandle,
    manifest: &PackManifest,
    target: Option<String>,
) -> Result<Profile, String> {
    let name = match target {
        Some(n) => n,
        None => unique_profile_name(if manifest.name.trim().is_empty() { "Сборка друга" } else { &manifest.name }),
    };
    let pdir = profile_dir(&name);
    // parse_manifest already normalised every path; re-derived here so a
    // caller that builds a manifest by hand cannot skip the check
    let mut files = Vec::with_capacity(manifest.files.len());
    for f in &manifest.files {
        let rel = shared_entry_path(&f.kind, &f.path)
            .map_err(|why| format!("Сборка содержит небезопасный путь {}: {}", shown_path(&f.path), why))?;
        if !sha1_ok(&f.sha1) {
            return Err(format!("У файла {} нет контрольной суммы — сборку не поставить", shown_path(&f.path)));
        }
        files.push(PackFile { path: rel, ..f.clone() });
    }
    let mut overrides = Vec::with_capacity(manifest.overrides.len());
    for o in &manifest.overrides {
        let (rel, bytes) =
            decode_override(o).map_err(|why| format!("Настройка {} не принята: {}", shown_path(&o.path), why))?;
        overrides.push((rel, bytes));
    }
    emit_share_progress(app, 8.0, "Сверяем файлы с Modrinth и CurseForge…");
    let vouched = vouch_files(&files).await?;

    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let total = vouched.len().max(1);
    let mut entries: Vec<ContentEntry> = load_content_manifest(&name);
    for (i, v) in vouched.iter().enumerate() {
        let url = fetch_vouched(&pdir, v).await?;
        entries.retain(|e| !(e.kind == v.kind && e.file_name == v.name));
        entries.push(ContentEntry {
            kind: v.kind.clone(),
            file_name: v.name.clone(),
            project_id: v.project_id.clone(),
            version_id: v.version_id.clone(),
            download_url: url,
            sha1: v.sha1.clone(),
            sha512: match &v.proof {
                Proof::Sha512(h) => h.clone(),
                Proof::Fingerprint(_) => String::new(),
            },
            file_size: v.size.unwrap_or(0),
            ..Default::default()
        });
        emit_share_progress(app, 10.0 + 80.0 * (i as f32 / total as f32), &format!("Файлы сборки {}/{}", i + 1, total));
    }
    save_content_manifest(&name, &entries);
    for (rel, bytes) in &overrides {
        let dest = safe_join(&pdir, rel).map_err(|e| format!("Сборка содержит небезопасный путь: {}", e))?;
        write_bytes_atomic(&dest, bytes).map_err(|e| format!("Не записалась настройка {}: {}", rel, e))?;
    }

    let (loader, loader_version) = {
        let id = manifest.loader.trim().to_lowercase();
        let id = if ["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&id.as_str()) { id } else { "vanilla".into() };
        let ver = manifest.loader_version.trim();
        let ver = (!ver.is_empty() && ver.starts_with(|c: char| c.is_ascii_digit())).then(|| ver.to_string());
        (id, ver)
    };
    if let Some(obj) = manifest.settings.as_object() {
        let mut patch = serde_json::Map::new();
        // JVM flags and the Modrinth pack link are not accepted from a shared
        // build at all: flags run code, and the pack link decides what "update"
        // deletes and downloads. Values are type-checked, not copied as is.
        for key in ["width", "height"] {
            if let Some(v) = obj.get(key).and_then(Value::as_u64).filter(|v| *v <= 16384) {
                patch.insert(key.to_string(), Value::from(v));
            }
        }
        for key in ["autoTune", "fpsBoost"] {
            if let Some(v) = obj.get(key).and_then(Value::as_bool) {
                patch.insert(key.to_string(), Value::Bool(v));
            }
        }
        merge_settings(&name, patch);
    }
    for s in manifest.servers.iter().take(32) {
        add_server(&name, s.name.clone(), s.ip.clone());
    }

    let profile = Profile {
        name: name.clone(),
        version: manifest.game.clone(),
        fabric: loader == "fabric",
        loader: Some(loader),
        loader_version,
        icon: (!manifest.icon.is_empty()).then(|| manifest.icon.clone()),
    };
    let mut all = load_profiles();
    all.retain(|p| p.name != profile.name);
    all.insert(0, profile.clone());
    save_profiles(&all)?;
    Ok(profile)
}

fn emit_share_progress(app: &AppHandle, pct: f32, msg: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "launch-progress",
        serde_json::json!({ "stage": "mod", "pct": pct, "msg": msg }),
    );
}

/// Installs a shared build by its code.
pub async fn install_shared_pack(app: AppHandle, code: String) -> Result<Profile, String> {
    let code = normalize_code(&code);
    if !code_ok(&code) {
        return Err("Такого кода не бывает — проверь, что ввёл".into());
    }
    let res = millida_api(format!("{}/{}", PACKS_PATH, code), "GET".into(), None, None).await?;
    let manifest = parse_manifest(&res["manifest"])?;
    if manifest.files.is_empty() {
        return Err("В этой сборке не осталось файлов, которые можно скачать".into());
    }
    emit_share_progress(&app, 5.0, "Читаем сборку…");
    let profile = install_manifest(&app, &manifest, None).await?;
    // Reported after the files land, so a cancelled install does not inflate
    // anyone's counter.
    let _ = millida_api(format!("{}/{}/installed", PACKS_PATH, code), "POST".into(), None, None).await;
    emit_share_progress(&app, 100.0, "Сборка установлена");
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// url -> verdict. A manifest arrives from another player; its addresses are
    /// what the launcher would otherwise connect to.
    #[test]
    fn only_catalogue_hosts_may_serve_a_shared_file() {
        for good in [
            "https://cdn.modrinth.com/data/AAA/versions/1/sodium.jar",
            "https://mediafilez.forgecdn.net/files/1/2/jei.jar",
        ] {
            assert!(url_allowed(good), "«{good}» — обычный адрес каталога");
        }
        for bad in [
            "http://cdn.modrinth.com/x.jar",
            "https://evil.example/cdn.modrinth.com/x.jar",
            "https://127.0.0.1/x.jar",
            "https://cdn.modrinth.com.evil.example/x.jar",
            "file:///C:/Windows/System32/x.dll",
            "",
        ] {
            assert!(
                !url_allowed(bad),
                "«{bad}» обязан отклоняться: лаунчер скачает по этому адресу файл и положит его в сборку",
            );
        }
    }

    /// code -> normalised. The code is typed by hand, pasted with the link, and
    /// read aloud in voice chat.
    #[test]
    fn codes_survive_being_typed_by_hand() {
        assert_eq!(normalize_code("ab23-cd45"), "AB23CD45");
        assert_eq!(normalize_code("https://millida.net/p/AB23CD45"), "AB23CD45");
        assert_eq!(normalize_code("  AB23CD45  "), "AB23CD45");
        assert!(code_ok("AB23-CD45"));
        assert!(!code_ok("AB23CD4"), "короткий код не должен уходить в запрос");
        assert!(!code_ok("AB23CD4O"), "O и 0 путают, поэтому O в алфавит не входит");
        assert!(!code_ok("../secrets"), "код становится сегментом пути запроса");
    }

    /// A manifest with hostile entries must come back stripped, not rejected in
    /// full: one bad line should not cost the player the whole pack.
    #[test]
    fn manifest_parsing_drops_what_it_cannot_trust() {
        let raw = serde_json::json!({
            "formatVersion": 1,
            "name": "Сборка\u{0007}",
            "game": "1.21.4",
            "loader": "fabric",
            "files": [
                {"path": "mods/ok.jar", "kind": "mod", "sha1": "a".repeat(40), "url": "https://cdn.modrinth.com/ok.jar"},
                {"path": "../../evil.jar", "kind": "mod", "sha1": "b".repeat(40), "url": "https://cdn.modrinth.com/evil.jar"},
                {"path": "mods/evil.jar", "kind": "mod", "sha1": "c".repeat(40), "url": "https://evil.example/x.jar"},
                {"path": "mods/nohash.jar", "kind": "mod", "sha1": "", "url": "https://cdn.modrinth.com/x.jar"},
                {"path": "millida-args.txt", "kind": "mod", "sha1": "d".repeat(40), "url": "https://cdn.modrinth.com/a.txt"},
                {"path": "mods/millida-pack-launch.json", "kind": "mod", "sha1": "d".repeat(40), "url": "https://cdn.modrinth.com/a.json"},
                {"path": "config/x.toml", "kind": "config", "sha1": "d".repeat(40), "url": "https://cdn.modrinth.com/a.toml"},
                {"path": "resourcepacks/x.jar", "kind": "mod", "sha1": "d".repeat(40), "url": "https://cdn.modrinth.com/b.jar"},
                {"path": "mods/sub/x.jar", "kind": "mod", "sha1": "d".repeat(40), "url": "https://cdn.modrinth.com/c.jar"}
            ]
        });
        let m = parse_manifest(&raw).expect("манифест должен разобраться");
        assert_eq!(
            m.files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(),
            vec!["mods/ok.jar"],
            "остаться должен только файл с проверяемым хешем и адресом каталога",
        );
        assert_eq!(m.name, "Сборка", "управляющие символы в имени станут именем папки");
    }

    #[test]
    fn manifest_versions_must_look_like_versions() {
        let base = |game: &str, lv: &str| serde_json::json!({"formatVersion": 1, "name": "X", "game": game, "loader": "fabric", "loaderVersion": lv, "files": []});
        assert!(parse_manifest(&base("1.21.4", "0.16.10")).is_ok());
        assert!(parse_manifest(&base("../../../x", "")).is_err());
        assert!(parse_manifest(&base("1.21", "../../x")).is_err());
        assert!(parse_manifest(&base("1.21/x", "")).is_err());
    }

    #[test]
    fn shared_settings_carry_no_jvm_args_or_pack_link() {
        let v = settings_of("профиль-которого-нет-3f9");
        assert!(v.get("jvmArgs").is_none());
        assert!(v.get("modpackSlug").is_none());
        assert!(v.get("modpackVersionId").is_none());
    }

    #[test]
    fn a_newer_format_is_refused_instead_of_half_installed() {
        let raw = serde_json::json!({"formatVersion": PACK_FORMAT + 1, "name": "X", "game": "1.21", "loader": "fabric", "files": []});
        assert!(parse_manifest(&raw).is_err());
    }

    /// (kind, path) -> where it lands, or None for refused. Every path a shared
    /// manifest may write goes through this one function, so each rule it
    /// enforces is pinned here.
    #[test]
    fn shared_entry_paths_follow_one_rulebook() {
        let cases: &[(&str, &str, Option<&str>, &str)] = &[
            ("mod", "mods/sodium.jar", Some("mods/sodium.jar"), "a plain catalogue mod lands in mods/"),
            ("shader", "shaderpacks/bsl.zip", Some("shaderpacks/bsl.zip"), "each kind has its own folder"),
            ("mod", "resourcepacks/x.jar", None, "a mod outside mods/ would dodge the folder the kind implies"),
            ("mod", "mods/sub/x.jar", None, "catalogue files are flat; a nested name is a crafted path"),
            ("mod", "../../evil.jar", None, "climbing out of the build"),
            ("mod", "mods/millida-pack-launch.json", None, "launcher service files steer the launch"),
            ("config", "config/x.toml", None, "unknown kinds are refused"),
            ("override", "config/sodium-options.json", Some("config/sodium-options.json"), "an ordinary config"),
            ("override", "config/jei/jei-client.ini.toml", Some("config/jei/jei-client.ini.toml"), "nested configs are allowed"),
            ("override", "defaultconfigs/ftbchunks-world.snbt", Some("defaultconfigs/ftbchunks-world.snbt"), "Forge default configs"),
            ("override", "Config/Mod.TOML", Some("config/Mod.TOML"), "root and extension are compared case-insensitively"),
            ("override", "config/a/b/c/d/e/f/g.json", Some("config/a/b/c/d/e/f/g.json"), "eight segments fit the depth cap"),
            ("override", "config/a/b/c/d/e/f/g/h.json", None, "depth cap"),
            ("override", "options.txt", None, "only config/ and defaultconfigs/ may be written"),
            ("override", "mods/config.json", None, "configs never land among mods"),
            ("override", "config", None, "a bare root is not a file"),
            ("override", "config/../mods/x.json", None, "climbing out of config/"),
            ("override", "config/./x.json", None, "dot segments hide the real path"),
            ("override", "config//x.json", None, "empty segment"),
            ("override", "/config/x.json", None, "absolute path"),
            ("override", "C:/config/x.json", None, "drive letter"),
            ("override", "config/x.json:evil.jar", None, "NTFS alternate data stream"),
            ("override", "config\\x.json", None, "backslash is a separator on Windows"),
            ("override", "config/x\u{0}.json", None, "NUL truncates the name in native calls"),
            ("override", "config/x\n.json", None, "control characters"),
            ("override", "config/.hidden.json", None, "hidden files are not configs anyone edits by hand"),
            ("override", "config/.git/config.json", None, "hidden folders"),
            ("override", "config/x.json ", None, "Windows drops a trailing space, so the extension check would lie"),
            ("override", "config/x.jar.", None, "Windows drops a trailing dot: this is a jar"),
            ("override", "config/con.json", None, "reserved Windows name"),
            ("override", "config/x.jar", None, "jar is code"),
            ("override", "config/x.JAR", None, "jar in capitals is still code"),
            ("override", "config/x.class", None, "class is code"),
            ("override", "config/x.zip", None, "archives may unpack code"),
            ("override", "config/x.js", None, "scripting mods run js"),
            ("override", "config/x.mjs", None, "scripting mods run mjs"),
            ("override", "config/x.zs", None, "CraftTweaker scripts"),
            ("override", "config/x.exe", None, "native executable"),
            ("override", "config/x.dll", None, "native library"),
            ("override", "config/x.so", None, "native library"),
            ("override", "config/x.dylib", None, "native library"),
            ("override", "config/x.bat", None, "shell script"),
            ("override", "config/x.ps1", None, "shell script"),
            ("override", "config/x.sh", None, "shell script"),
            ("override", "config/x.py", None, "script"),
            ("override", "config/x.lua", None, "script"),
            ("override", "config/x.vbs", None, "script"),
            ("override", "config/x", None, "no extension"),
            ("override", "config/x.dat", None, "anything outside the whitelist"),
            ("override", "config/kubejs/x.json", None, "KubeJS folders hold scripts"),
            ("override", "config/KubeJS/x.json", None, "folder names are compared case-insensitively"),
            ("override", "defaultconfigs/scripts/x.txt", None, "script folders anywhere"),
            ("override", "config/millida-args.json", None, "launcher service file names"),
            ("override", &format!("config/{}.json", "a".repeat(100)), None, "segment length cap"),
            ("override", &format!("config/{}/x.json", ["b".repeat(80), "c".repeat(80), "d".repeat(80)].join("/")), None, "path length cap"),
        ];
        for (kind, path, want, why) in cases {
            let got = shared_entry_path(kind, path).ok();
            assert_eq!(got.as_deref(), *want, "{kind} «{}»: {why}", path.escape_debug());
        }
    }

    fn override_of(path: &str, bytes: &[u8]) -> PackOverride {
        PackOverride {
            path: path.to_string(),
            sha1: super::super::milli_local::sha1_hex(bytes),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        }
    }

    /// override -> kept or dropped. The bytes are written to disk on the other
    /// player's machine, so the digest, the size and the caps are all checked.
    #[test]
    fn overrides_are_checked_before_they_are_kept() {
        let mut forged = override_of("config/b.toml", b"b = 1");
        forged.sha1 = "0".repeat(40);
        let mut garbled = override_of("config/c.toml", b"c = 1");
        garbled.data = "!!!".into();
        let big = vec![b'x'; MAX_OVERRIDE_BYTES + 1];
        let (kept, dropped) = accept_overrides(vec![
            override_of("config/a.toml", b"a = 1"),
            forged,
            garbled,
            override_of("config/big.json", &big),
            override_of("config/x.jar", b"PK"),
            override_of("Config/A.toml", b"dup"),
        ]);
        assert_eq!(
            kept.iter().map(|o| o.path.as_str()).collect::<Vec<_>>(),
            vec!["config/a.toml"],
            "only the override with a matching digest, a safe path and a sane size may be written",
        );
        assert_eq!(dropped.len(), 5, "every refused override is reported so the player sees what is missing");

        let many: Vec<PackOverride> = (0..MAX_OVERRIDES + 5).map(|i| override_of(&format!("config/{i}.txt"), b"x")).collect();
        let (kept, dropped) = accept_overrides(many);
        assert_eq!(kept.len(), MAX_OVERRIDES, "the count cap bounds what one pack can write");
        assert_eq!(dropped.len(), 5);

        let chunk = vec![b'y'; MAX_OVERRIDE_BYTES];
        let heavy: Vec<PackOverride> = (0..10).map(|i| override_of(&format!("config/{i}.txt"), &chunk)).collect();
        let (kept, _) = accept_overrides(heavy);
        assert_eq!(kept.len(), MAX_OVERRIDES_TOTAL / MAX_OVERRIDE_BYTES, "the total cap bounds how much one pack can write");
    }

    #[test]
    fn overrides_travel_from_disk_and_back() {
        let pdir = std::env::temp_dir().join(format!("millida-share-overrides-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pdir);
        let write = |rel: &str, bytes: &[u8]| {
            let p = pdir.join(rel);
            std::fs::create_dir_all(p.parent().expect("test path has a parent")).expect("test dir");
            std::fs::write(p, bytes).expect("test file");
        };
        write("config/sodium.json", b"{\"a\":1}");
        write("config/nested/deep.toml", b"x = 1");
        write("defaultconfigs/server.toml", b"y = 2");
        write("config/evil.jar", b"PK");
        write("config/huge.json", &vec![b'z'; MAX_OVERRIDE_BYTES + 1]);
        write("kubejs/server_scripts/x.js", b"evil()");
        write("options.txt", b"fov:1");

        let (kept, skipped) = collect_overrides(&pdir);
        let _ = std::fs::remove_dir_all(&pdir);
        assert_eq!(
            kept.iter().map(|o| o.path.as_str()).collect::<Vec<_>>(),
            vec!["config/nested/deep.toml", "config/sodium.json", "defaultconfigs/server.toml"],
            "configs that pass the validator and the caps travel",
        );
        assert_eq!(skipped, vec!["config/evil.jar", "config/huge.json"], "what cannot travel is named, not silently lost");

        let raw = serde_json::json!({
            "formatVersion": 1, "name": "X", "game": "1.21.4", "loader": "fabric", "files": [],
            "overrides": serde_json::to_value(&kept).expect("overrides serialize"),
        });
        let (m, dropped) = parse_manifest_report(&raw).expect("manifest parses");
        assert!(dropped.is_empty(), "what the launcher built itself must pass its own checks");
        let (path, bytes) = decode_override(&m.overrides[1]).expect("override decodes");
        assert_eq!((path.as_str(), bytes.as_slice()), ("config/sodium.json", b"{\"a\":1}".as_slice()));
        let wire = serde_json::to_value(&m.overrides[0]).expect("override serializes");
        assert!(
            wire.get("path").is_some() && wire.get("sha1").is_some() && wire.get("data").is_some(),
            "the backend keeps exactly path, sha1 and data",
        );
    }

    fn pack_file(path: &str, sha1: &str, project: &str, version: &str) -> PackFile {
        PackFile {
            path: path.into(),
            kind: "mod".into(),
            project_id: project.into(),
            version_id: version.into(),
            sha1: sha1.into(),
            size: 10,
            url: "https://cdn.modrinth.com/data/x/versions/y/x.jar".into(),
        }
    }

    /// Modrinth answer -> vouched or not. The manifest's own url and ids are
    /// never used: only what Modrinth returns for the digest.
    #[test]
    fn modrinth_vouches_only_for_the_exact_file() {
        let sha1 = "a".repeat(40);
        let f = pack_file("mods/x.jar", &sha1, "FAKEID", "FAKEVER");
        let version = |file_sha1: &str, url: &str, sha512: &str| {
            serde_json::json!({"id": "VER", "project_id": "PROJ", "files": [
                {"url": url, "size": 99, "hashes": {"sha1": file_sha1, "sha512": sha512}}
            ]})
        };
        let good_url = "https://cdn.modrinth.com/data/PROJ/versions/VER/x.jar";
        let sha512 = "b".repeat(128);
        let v = modrinth_vouch(&version(&sha1, good_url, &sha512), &f).expect("the exact file is vouched for");
        assert_eq!(v.urls, vec![good_url.to_string()], "the address comes from Modrinth, not from the manifest");
        assert_eq!((v.project_id.as_str(), v.version_id.as_str()), ("PROJ", "VER"), "ids come from Modrinth");
        assert!(matches!(v.proof, Proof::Sha512(ref h) if *h == sha512), "sha512 is checked after download");
        let cases = [
            (version(&"c".repeat(40), good_url, &sha512), "the version holds a different file"),
            (version(&sha1, "https://evil.example/x.jar", &sha512), "Modrinth's address must still pass the host list"),
            (version(&sha1, good_url, ""), "without sha512 there is nothing to check the bytes by"),
            (serde_json::json!({"id": "VER", "project_id": "PROJ"}), "no files at all"),
        ];
        for (answer, why) in cases {
            assert!(modrinth_vouch(&answer, &f).is_none(), "{why}");
        }
    }

    /// CurseForge record -> vouched or not.
    #[test]
    fn curseforge_vouches_only_for_the_named_file() {
        let sha1 = "d".repeat(40);
        let f = pack_file("mods/jei.jar", &sha1, "cf:238222", "5000001");
        let record = |mod_id: u64, file_sha1: &str, print: u64| {
            serde_json::json!({"id": 5000001, "modId": mod_id, "fileName": "jei-1.21.jar", "fileLength": 1234,
                "fileFingerprint": print, "hashes": [{"algo": 1, "value": file_sha1}]})
        };
        let v = cf_vouch(&record(238222, &sha1, 77), 238222, &f).expect("the named file is vouched for");
        assert!(matches!(v.proof, Proof::Fingerprint(77)), "the fingerprint is checked after download");
        assert!(v.urls.iter().all(|u| url_allowed(u)) && !v.urls.is_empty(), "downloads only from the host list");
        assert_eq!(v.project_id, "cf:238222");
        let cases = [
            (record(1, &sha1, 77), "the file belongs to another project"),
            (record(238222, &"e".repeat(40), 77), "CurseForge has a different sha1"),
            (record(238222, &sha1, 0), "no fingerprint to check the bytes by"),
        ];
        for (answer, why) in cases {
            assert!(cf_vouch(&answer, 238222, &f).is_none(), "{why}");
        }
        assert_eq!(cf_ids(&f), Some((238222, 5000001)));
        assert_eq!(cf_ids(&pack_file("mods/x.jar", &sha1, "AANobbMI", "abc")), None, "Modrinth ids are not CurseForge ids");
    }

    #[test]
    fn refusal_names_every_refused_file() {
        let text = refused_text(&["a.jar".into(), "b.jar".into()]);
        assert!(text.contains("a.jar") && text.contains("b.jar"), "the player must see which files blocked the pack");
    }

    #[test]
    fn preview_labels_the_declared_source() {
        for (url, want) in [
            ("https://cdn.modrinth.com/data/x.jar", "modrinth"),
            ("https://edge.forgecdn.net/files/1/2/x.jar", "curseforge"),
            ("https://cdn.millida.net/x.jar", "millida"),
            ("https://evil.example/x.jar", "unknown"),
        ] {
            assert_eq!(file_source(url), want, "{url}");
        }
    }
}
