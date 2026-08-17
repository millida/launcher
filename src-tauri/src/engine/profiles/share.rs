//! Sharing a build by code or link, and the manifest both sharing and cloud
//! sync are built on.
//!
//! A manifest lists catalogue files only — project, version, digest, size. That
//! is a few kilobytes for a two-gigabyte pack, and it is also what makes the
//! result reproducible: the receiving launcher fetches each file from the
//! catalogue and verifies its digest, instead of trusting an archive somebody
//! uploaded.

use std::collections::HashSet;

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

fn url_allowed(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else { return false };
    if url.scheme() != "https" {
        return false;
    }
    url.host_str().map(|h| FILE_HOSTS.iter().any(|allowed| h == *allowed)).unwrap_or(false)
}

fn settings_of(profile: &str) -> Value {
    let s: Value = std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    // Only the knobs that describe the build travel. Java paths, covers and
    // anything naming this machine stay here.
    serde_json::json!({
        "jvmArgs": s["jvmArgs"].as_str().unwrap_or(""),
        "width": s["width"].as_u64().unwrap_or(0),
        "height": s["height"].as_u64().unwrap_or(0),
        "autoTune": s["autoTune"].as_bool().unwrap_or(true),
        "fpsBoost": s["fpsBoost"].as_bool().unwrap_or(false),
        "modpackSlug": s["modpackSlug"].as_str().unwrap_or(""),
        "modpackVersionId": s["modpackVersionId"].as_str().unwrap_or(""),
    })
}

/// Builds the manifest for a build on disk. `skipped` names the files that
/// cannot travel — hand-added jars and edited configs — so the player is told
/// what the receiving side will be missing instead of discovering it later.
pub fn build_manifest(profile: &str) -> Result<(PackManifest, Vec<String>), String> {
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
    let (mut manifest, skipped) = build_manifest(&profile)?;
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
    let manifest = parse_manifest(&res["manifest"])?;
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
    }))
}

/// Everything a manifest says is untrusted: it came over the network from
/// another player. Paths, addresses and digests are all re-checked here, in one
/// place, so no caller can skip a check.
pub(crate) fn parse_manifest(raw: &Value) -> Result<PackManifest, String> {
    let mut manifest: PackManifest =
        serde_json::from_value(raw.clone()).map_err(|_| "Сборка записана в неизвестном формате".to_string())?;
    if manifest.format_version > PACK_FORMAT {
        return Err("Сборку сделали в более новой версии лаунчера — обнови лаунчер".into());
    }
    if manifest.game.trim().is_empty() {
        return Err("В сборке не указана версия Minecraft".into());
    }
    manifest.files.truncate(MAX_FILES);
    manifest.files.retain(|f| {
        url_allowed(&f.url)
            && f.sha1.len() == 40
            && f.sha1.bytes().all(|b| b.is_ascii_hexdigit())
            && !f.path.contains("..")
    });
    manifest.name = manifest.name.chars().filter(|c| !c.is_control()).take(64).collect();
    manifest.summary = manifest.summary.chars().filter(|c| !c.is_control() || *c == '\n').take(MAX_SUMMARY).collect();
    Ok(manifest)
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
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let total = manifest.files.len().max(1);
    let mut entries: Vec<ContentEntry> = load_content_manifest(&name);
    for (i, f) in manifest.files.iter().enumerate() {
        let dest = safe_join(&pdir, &f.path).map_err(|e| format!("Сборка содержит небезопасный путь: {}", e))?;
        download_verify(&f.url, &dest, Some(&f.sha1), if f.size > 0 { Some(f.size) } else { None })
            .await
            .map_err(|e| format!("Не скачался файл {}: {}", f.path, e))?;
        let file_name = dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        entries.retain(|e| !(e.kind == f.kind && e.file_name == file_name));
        entries.push(ContentEntry {
            kind: f.kind.clone(),
            file_name,
            project_id: f.project_id.clone(),
            version_id: f.version_id.clone(),
            download_url: f.url.clone(),
            sha1: f.sha1.clone(),
            file_size: f.size,
            ..Default::default()
        });
        emit_share_progress(app, 10.0 + 80.0 * (i as f32 / total as f32), &format!("Файлы сборки {}/{}", i + 1, total));
    }
    save_content_manifest(&name, &entries);

    let (loader, loader_version) = {
        let id = manifest.loader.trim().to_lowercase();
        let id = if ["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&id.as_str()) { id } else { "vanilla".into() };
        let ver = manifest.loader_version.trim();
        let ver = (!ver.is_empty() && ver.starts_with(|c: char| c.is_ascii_digit())).then(|| ver.to_string());
        (id, ver)
    };
    if let Some(obj) = manifest.settings.as_object() {
        let mut patch = serde_json::Map::new();
        for key in ["jvmArgs", "width", "height", "autoTune", "fpsBoost", "modpackSlug", "modpackVersionId"] {
            if let Some(v) = obj.get(key) {
                patch.insert(key.to_string(), v.clone());
            }
        }
        // A shared build must not carry command-line flags into someone else's
        // JVM: the same filter as the settings screen decides what survives.
        if let Some(args) = patch.get("jvmArgs").and_then(Value::as_str) {
            let clean = sanitize_jvm_args(args).join(" ");
            patch.insert("jvmArgs".into(), Value::String(clean));
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
                {"path": "mods/nohash.jar", "kind": "mod", "sha1": "", "url": "https://cdn.modrinth.com/x.jar"}
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
    fn a_newer_format_is_refused_instead_of_half_installed() {
        let raw = serde_json::json!({"formatVersion": PACK_FORMAT + 1, "name": "X", "game": "1.21", "loader": "fabric", "files": []});
        assert!(parse_manifest(&raw).is_err());
    }
}
