//! Checking the jars in a build before they run.
//!
//! After fractureiser this is basic hygiene, not paranoia: a mod is arbitrary
//! Java running with the player's account. Three questions get asked about
//! every file — does a catalogue know this exact byte sequence, is it on the
//! block list, and does the jar itself do things a mod has no business doing.
//!
//! The verdicts are deliberately blunt about what they mean. "Unknown" is not
//! an accusation: hand-built and private jars are legitimately unknown, and
//! saying otherwise would train players to ignore the report.

use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::engine::*;

const BLOCKLIST_PATH: &str = "/launcher/mod-blocklist";
const BLOCKLIST_TTL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);
/// Bigger jars exist (kitchen-sink packs, shader libraries), they are simply
/// not read entry by entry: the heuristics are a cheap first pass, not an
/// antivirus.
const MAX_SCAN_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 4000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModVerdict {
    pub file: String,
    pub title: String,
    /// "ok" | "unknown" | "suspicious" | "blocked"
    pub verdict: String,
    pub reasons: Vec<String>,
    pub sha1: String,
    /// Where the file was recognised: "modrinth" | "curseforge" | "" .
    pub source: String,
    pub enabled: bool,
    pub size: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SafetyReport {
    pub profile: String,
    pub checked: u32,
    pub ok: u32,
    pub unknown: u32,
    pub suspicious: u32,
    pub blocked: u32,
    pub items: Vec<ModVerdict>,
    pub checked_at: u64,
    /// Set when the block list could not be fetched: the report is then based
    /// on catalogues and heuristics only, and says so.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub note: String,
}

/// Findings from reading one jar: the reasons to show, and how many of them
/// were strong enough to matter on their own.
type Inspection = (Vec<String>, u32);

/// Byte patterns inside class files. Each one is normal on its own — the
/// verdict needs two independent ones, because a mod that downloads its own
/// assets or spawns a helper process is ordinary.
struct Marker {
    needle: &'static [u8],
    reason: &'static str,
    /// Strong markers are the ones no ordinary client mod needs at all.
    strong: bool,
}

const MARKERS: &[Marker] = &[
    Marker { needle: b"defineClass", reason: "грузит классы в обход загрузчика модов", strong: true },
    Marker { needle: b"java/lang/Runtime", reason: "запускает сторонние процессы", strong: false },
    Marker { needle: b"ProcessBuilder", reason: "запускает сторонние процессы", strong: false },
    Marker { needle: b"pastebin.com", reason: "тянет код с pastebin", strong: true },
    Marker { needle: b"raw.githubusercontent.com", reason: "тянет файлы напрямую с GitHub", strong: false },
    Marker { needle: b"discord.com/api/webhooks", reason: "шлёт данные в Discord-вебхук", strong: true },
    Marker { needle: b"AppData\\Roaming\\.minecraft\\launcher_profiles.json", reason: "читает файл сессии лаунчера", strong: true },
    Marker { needle: b"user.home", reason: "лезет в домашнюю папку", strong: false },
    Marker { needle: b"javax/crypto/Cipher", reason: "расшифровывает вложенные данные", strong: false },
    Marker { needle: b"Robot", reason: "управляет мышью и клавиатурой", strong: false },
];

/// A class file hidden under another extension: the loader would never read it,
/// so the only reason to ship one is to load it at runtime.
fn disguised_class(name: &str, head: &[u8]) -> bool {
    let low = name.to_ascii_lowercase();
    let looks_harmless = [".png", ".txt", ".json", ".lang", ".dat", ".bin"]
        .iter()
        .any(|ext| low.ends_with(ext));
    looks_harmless && head.starts_with(&[0xCA, 0xFE, 0xBA, 0xBE])
}

fn has_metadata(names: &[String]) -> bool {
    names.iter().any(|n| {
        matches!(
            n.as_str(),
            "fabric.mod.json" | "quilt.mod.json" | "META-INF/mods.toml" | "META-INF/neoforge.mods.toml" | "mcmod.info"
        )
    })
}

/// Reads the jar and returns the reasons to look closer, plus how many of them
/// were strong.
fn inspect_jar(path: &Path) -> Inspection {
    let mut reasons: Vec<String> = vec![];
    let mut strong = 0u32;
    let Ok(meta) = std::fs::metadata(path) else { return (reasons, strong) };
    if meta.len() > MAX_SCAN_BYTES {
        return (reasons, strong);
    }
    let Ok(file) = std::fs::File::open(path) else { return (reasons, strong) };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        reasons.push("Файл не открывается как jar".into());
        return (reasons, 1);
    };
    let mut names: Vec<String> = vec![];
    let mut hits: Vec<(&'static str, bool)> = vec![];
    let mut has_code = false;
    for i in 0..zip.len().min(MAX_ENTRIES) {
        let Ok(mut entry) = zip.by_index(i) else { continue };
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        names.push(name.clone());
        let mut buf = Vec::new();
        // Only the beginning of an entry is read: constants live in the class
        // constant pool, and reading whole resource packs would make the scan
        // as slow as unpacking the build.
        let _ = entry.by_ref().take(512 * 1024).read_to_end(&mut buf);
        if name.ends_with(".class") {
            has_code = true;
            for m in MARKERS {
                if buf.windows(m.needle.len()).any(|w| w == m.needle) && !hits.iter().any(|(r, _)| *r == m.reason) {
                    hits.push((m.reason, m.strong));
                }
            }
        } else if disguised_class(&name, &buf) {
            hits.push(("В архиве лежит класс под видом ресурса", true));
        } else if name.ends_with(".jar") && buf.starts_with(b"PK") {
            hits.push(("Внутри лежит ещё один jar", false));
        }
    }
    for (reason, is_strong) in hits {
        reasons.push(reason.to_string());
        if is_strong {
            strong += 1;
        }
    }
    if has_code && !has_metadata(&names) {
        reasons.push("Код есть, а описания мода нет — загрузчик такой файл не признаёт".into());
        strong += 1;
    }
    (reasons, strong)
}

fn blocklist_cache() -> std::path::PathBuf {
    data_dir().join("cache").join("mod-blocklist.json")
}

/// Hashes the launcher refuses to vouch for, published by the API. A failure to
/// fetch is reported, never silently treated as "nothing is blocked".
async fn blocklist() -> Result<HashMap<String, String>, String> {
    let cache = blocklist_cache();
    let path = format!("{}{}", MILLIDA_API, BLOCKLIST_PATH);
    let v = get_json_fresh(&path, &cache, BLOCKLIST_TTL).await?;
    let mut out = HashMap::new();
    for item in v["items"].as_array().into_iter().flatten() {
        let Some(sha1) = item["sha1"].as_str() else { continue };
        let why = item["reason"].as_str().unwrap_or("Файл в списке вредоносных").to_string();
        out.insert(sha1.to_ascii_lowercase(), why);
    }
    Ok(out)
}

struct Jar {
    file: String,
    path: std::path::PathBuf,
    enabled: bool,
    size: u64,
}

fn jars_of(profile: &str) -> Vec<Jar> {
    let dir = profile_dir(profile).join("mods");
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        let raw = e.file_name().to_string_lossy().to_string();
        let (name, enabled) = match raw.strip_suffix(".disabled") {
            Some(base) => (base.to_string(), false),
            None => (raw.clone(), true),
        };
        if !name.ends_with(".jar") {
            continue;
        }
        let Ok(meta) = e.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        out.push(Jar { file: name, path: e.path(), enabled, size: meta.len() });
    }
    out
}

/// Verdict for one file, from the three sources in order of authority: the
/// block list decides, then the catalogues vouch, then the jar itself is read.
fn verdict_for(
    jar: &Jar,
    sha1: String,
    blocked: Option<&String>,
    catalog: Option<&str>,
    title: String,
    inspected: Inspection,
) -> ModVerdict {
    let (reasons, strong) = inspected;
    if let Some(why) = blocked {
        return ModVerdict {
            file: jar.file.clone(),
            title,
            verdict: "blocked".into(),
            reasons: vec![why.clone()],
            sha1,
            source: String::new(),
            enabled: jar.enabled,
            size: jar.size,
        };
    }
    // A catalogue match proves the bytes are the ones thousands of players got
    // from the same page — it does not prove the mod is harmless, so strong
    // findings still surface.
    let known = catalog.unwrap_or("");
    let verdict = if strong >= 2 || (strong >= 1 && known.is_empty() && reasons.len() >= 2) {
        "suspicious"
    } else if known.is_empty() {
        "unknown"
    } else {
        "ok"
    };
    let mut reasons = reasons;
    if verdict == "unknown" {
        reasons.insert(0, "Этого файла нет ни в Modrinth, ни в CurseForge — проверь, откуда он".into());
    }
    ModVerdict {
        file: jar.file.clone(),
        title,
        verdict: verdict.into(),
        reasons,
        sha1,
        source: known.to_string(),
        enabled: jar.enabled,
        size: jar.size,
    }
}

pub async fn scan_safety(profile: String) -> Result<SafetyReport, String> {
    let jars = jars_of(&profile);
    if jars.is_empty() {
        return Ok(SafetyReport { profile, checked_at: now_secs(), ..Default::default() });
    }
    let manifest = load_content_manifest(&profile);
    let metas = local_meta_map(&profile, "mod");

    let paths: Vec<std::path::PathBuf> = jars.iter().map(|j| j.path.clone()).collect();
    let scanned: Vec<(Option<String>, Inspection)> =
        tauri::async_runtime::spawn_blocking(move || {
            paths.iter().map(|p| (file_sha1(p), inspect_jar(p))).collect()
        })
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))?;

    let hashes: Vec<String> = scanned.iter().filter_map(|(h, _)| h.clone()).collect();
    let known_remote = versions_by_hash(&hashes).await;
    let (blocked, note) = match blocklist().await {
        Ok(map) => (map, String::new()),
        Err(e) => (HashMap::new(), format!("Список вредоносных файлов недоступен ({}) — проверка шла по каталогам и содержимому", e)),
    };

    let mut report = SafetyReport { profile: profile.clone(), checked_at: now_secs(), note, ..Default::default() };
    for (jar, (sha1, inspected)) in jars.iter().zip(scanned) {
        let sha1 = sha1.unwrap_or_default().to_ascii_lowercase();
        let entry = manifest.iter().find(|e| e.kind == "mod" && e.file_name == jar.file);
        let catalog = if known_remote.contains_key(&sha1) {
            Some("modrinth")
        } else if entry.map(|e| !e.sha1.is_empty() && e.sha1.eq_ignore_ascii_case(&sha1)).unwrap_or(false) {
            Some(if entry.map(|e| e.project_id.starts_with("cf:")).unwrap_or(false) { "curseforge" } else { "modrinth" })
        } else {
            None
        };
        let title = entry
            .map(|e| e.title.clone())
            .filter(|t| !t.is_empty())
            .or_else(|| metas.get(&jar.file).map(|m| m.title.clone()).filter(|t| !t.is_empty()))
            .unwrap_or_else(|| jar.file.clone());
        let v = verdict_for(jar, sha1.clone(), blocked.get(&sha1), catalog, title, inspected);
        match v.verdict.as_str() {
            "blocked" => report.blocked += 1,
            "suspicious" => report.suspicious += 1,
            "unknown" => report.unknown += 1,
            _ => report.ok += 1,
        }
        report.checked += 1;
        report.items.push(v);
    }
    // Worst first: a report opens on what needs a decision.
    let rank = |v: &str| match v {
        "blocked" => 0,
        "suspicious" => 1,
        "unknown" => 2,
        _ => 3,
    };
    report.items.sort_by_key(|i| (rank(&i.verdict), i.title.to_lowercase()));
    Ok(report)
}

/// Turns off every file the scan refused to vouch for. Blocked and suspicious
/// only: "unknown" is most of a hand-assembled build.
pub fn quarantine(profile: &str, files: Vec<String>) -> Result<u32, String> {
    let mut done = 0;
    for name in files {
        let file = safe_file_name(&name)?;
        toggle_content(profile, "mod", &file, false)?;
        done += 1;
    }
    Ok(done)
}

pub(crate) fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jar(file: &str) -> Jar {
        Jar { file: file.into(), path: std::path::PathBuf::from(file), enabled: true, size: 1024 }
    }

    /// input -> verdict. The whole point of the report is that a player can act
    /// on it, which only works while "opasno" is rare and means something.
    #[test]
    fn verdicts_separate_a_finding_from_an_unknown_file() {
        struct Case {
            file: &'static str,
            catalog: Option<&'static str>,
            reasons: Vec<String>,
            strong: u32,
            want: &'static str,
            why: &'static str,
        }
        let cases: [Case; 5] = [
            Case {
                file: "sodium.jar",
                catalog: Some("modrinth"),
                reasons: vec![],
                strong: 0,
                want: "ok",
                why: "файл из каталога без находок",
            },
            Case {
                file: "custom.jar",
                catalog: None,
                reasons: vec![],
                strong: 0,
                want: "unknown",
                why: "самосбор — не обвинение, просто неизвестен",
            },
            Case {
                file: "loader.jar",
                catalog: None,
                reasons: vec!["грузит классы в обход загрузчика модов".into(), "тянет код с pastebin".into()],
                strong: 2,
                want: "suspicious",
                why: "два сильных признака — это уже находка",
            },
            Case {
                file: "helper.jar",
                catalog: Some("modrinth"),
                reasons: vec!["запускает сторонние процессы".into()],
                strong: 0,
                want: "ok",
                why: "один слабый признак у файла из каталога — обычный мод",
            },
            Case {
                file: "weird.jar",
                catalog: None,
                reasons: vec!["В архиве лежит класс под видом ресурса".into(), "Внутри лежит ещё один jar".into()],
                strong: 1,
                want: "suspicious",
                why: "сильный признак у файла вне каталогов",
            },
        ];
        for case in cases {
            let v = verdict_for(
                &jar(case.file),
                "a".repeat(40),
                None,
                case.catalog,
                case.file.into(),
                (case.reasons, case.strong),
            );
            assert_eq!(
                v.verdict, case.want,
                "{} должен получить «{}», получил «{}». Зачем случай закреплён: {}",
                case.file, case.want, v.verdict, case.why,
            );
        }
    }

    /// The block list is the only source that can condemn a file outright, and
    /// it must win over a catalogue match: a compromised release is exactly the
    /// case where the catalogue still serves the file.
    #[test]
    fn block_list_beats_a_catalogue_match() {
        let why = "Заражён fractureiser".to_string();
        let v = verdict_for(&jar("sodium.jar"), "b".repeat(40), Some(&why), Some("modrinth"), "Sodium".into(), (vec![], 0));
        assert_eq!(v.verdict, "blocked");
        assert_eq!(v.reasons, vec![why]);
    }

    #[test]
    fn a_class_under_a_png_name_is_a_finding() {
        assert!(disguised_class("assets/mod/logo.png", &[0xCA, 0xFE, 0xBA, 0xBE, 0, 0]));
        assert!(!disguised_class("assets/mod/logo.png", b"\x89PNG\r\n\x1a\n"), "настоящая картинка находкой не является");
        assert!(!disguised_class("mod/Main.class", &[0xCA, 0xFE, 0xBA, 0xBE]), "обычный класс лежит под своим именем");
    }
}
