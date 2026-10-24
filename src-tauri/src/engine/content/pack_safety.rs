// Resource packs, shader packs, data packs and maps checked like mods: none of them needs a program inside, so an executable file there is a finding.
// Reads the build's own folders only; nothing goes to the network.
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::engine::*;

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ENTRIES: usize = 20_000;
const HEAD_BYTES: u64 = 4;
const QUARANTINE_DIR: &str = "quarantine";

/// Extensions of things that run. A pack or a map is textures, sounds, JSON and
/// NBT; any of these inside one is either a mistake or a payload.
const RUNNABLE_EXT: &[&str] = &[
    "jar", "class", "exe", "dll", "so", "dylib", "bat", "cmd", "ps1", "vbs", "vbe", "wsf", "scr", "msi", "com", "lnk", "sh", "jse", "hta", "cpl",
];

fn ext_of(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

/// What a file is by its first bytes, whatever its name says.
fn runnable_magic(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(&[0xCA, 0xFE, 0xBA, 0xBE]) {
        Some("класс Java")
    } else if head.starts_with(b"MZ") {
        Some("программа Windows")
    } else if head.starts_with(&[0x7F, b'E', b'L', b'F']) {
        Some("программа Linux")
    } else {
        None
    }
}

/// One finding per entry: the file name and why it does not belong in a pack.
pub(crate) fn entry_finding(name: &str, head: &[u8]) -> Option<String> {
    let ext = ext_of(name);
    if RUNNABLE_EXT.contains(&ext.as_str()) {
        return Some(format!("{} — исполняемый файл", name));
    }
    runnable_magic(head).map(|what| format!("{} — внутри {}", name, what))
}

fn scan_zip(path: &Path) -> Vec<String> {
    let mut out = vec![];
    let Ok(meta) = std::fs::metadata(path) else { return out };
    if meta.len() > MAX_ARCHIVE_BYTES {
        return out;
    }
    let Ok(file) = std::fs::File::open(path) else { return out };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        out.push("Архив не открывается".into());
        return out;
    };
    for i in 0..zip.len().min(MAX_ENTRIES) {
        let Ok(mut entry) = zip.by_index(i) else { continue };
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        let mut head = Vec::new();
        let _ = entry.by_ref().take(HEAD_BYTES).read_to_end(&mut head);
        if let Some(f) = entry_finding(&name, &head) {
            out.push(f);
        }
    }
    out
}

fn scan_dir(root: &Path) -> Vec<String> {
    let mut out = vec![];
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                return out;
            }
            let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
            if meta.is_dir() {
                stack.push(e.path());
                continue;
            }
            if !meta.is_file() {
                continue;
            }
            let rel = e.path().strip_prefix(root).map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            let mut head = vec![];
            if let Ok(f) = std::fs::File::open(e.path()) {
                let _ = f.take(HEAD_BYTES).read_to_end(&mut head);
            }
            if let Some(f) = entry_finding(&rel, &head) {
                out.push(f);
            } else if ext_of(&rel) == "zip" {
                out.extend(scan_zip(&e.path()).into_iter().map(|f| format!("{}: {}", rel, f)));
            }
        }
    }
    out
}

struct Target {
    key: String,
    title: String,
    path: PathBuf,
    enabled: bool,
}

fn targets(profile: &str) -> Vec<Target> {
    let pdir = profile_dir(profile);
    let mut out = vec![];
    for kind in ["resourcepack", "shader", "datapack"] {
        let Ok(rd) = std::fs::read_dir(pdir.join(content_dir(kind))) else { continue };
        for e in rd.flatten() {
            let raw = e.file_name().to_string_lossy().to_string();
            let (name, enabled) = match raw.strip_suffix(".disabled") {
                Some(b) => (b.to_string(), false),
                None => (raw.clone(), true),
            };
            if e.path().is_file() && ext_of(&name) == "zip" {
                out.push(Target { key: format!("{}:{}", kind, name), title: name, path: e.path(), enabled });
            }
        }
    }
    if let Ok(rd) = std::fs::read_dir(pdir.join("saves")) {
        for e in rd.flatten() {
            if e.path().is_dir() {
                let name = e.file_name().to_string_lossy().to_string();
                out.push(Target { key: format!("world:{}", name), title: name, path: e.path(), enabled: true });
            }
        }
    }
    out
}

pub async fn scan_pack_safety(profile: String) -> Result<SafetyReport, String> {
    let list = targets(&profile);
    let found: Vec<(Target, Vec<String>, u64)> = tauri::async_runtime::spawn_blocking(move || {
        list.into_iter()
            .map(|t| {
                let (reasons, size) = if t.path.is_dir() {
                    (scan_dir(&t.path), dir_size(&t.path))
                } else {
                    (scan_zip(&t.path), std::fs::metadata(&t.path).map(|m| m.len()).unwrap_or(0))
                };
                (t, reasons, size)
            })
            .collect()
    })
    .await
    .map_err(|e| format!("фоновая задача прервалась: {e}"))?;
    let mut report = SafetyReport { profile, checked_at: now_secs(), ..Default::default() };
    for (t, reasons, size) in found {
        let verdict = if reasons.is_empty() { "clean" } else { "suspicious" };
        if reasons.is_empty() {
            report.ok += 1;
        } else {
            report.suspicious += 1;
        }
        report.checked += 1;
        report.items.push(ModVerdict {
            file: t.key,
            title: t.title,
            verdict: verdict.into(),
            reasons: reasons.into_iter().take(8).collect(),
            sha1: String::new(),
            source: String::new(),
            enabled: t.enabled,
            size,
        });
    }
    report.items.sort_by_key(|i| (i.verdict != "suspicious", i.title.to_lowercase()));
    Ok(report)
}

/// A pack is switched off the way the content tab does it; a world leaves
/// saves/ for the build's quarantine folder, where the game never looks.
pub fn quarantine_packs(profile: &str, keys: Vec<String>) -> Result<u32, String> {
    assert_not_running(profile, "повтори ещё раз")?;
    let mut done = 0;
    for key in keys {
        let (kind, name) = key.split_once(':').ok_or("Неизвестный файл")?;
        let file = safe_file_name(name)?;
        match kind {
            "resourcepack" | "shader" | "datapack" => toggle_content(profile, kind, &file, false)?,
            "world" => {
                let pdir = profile_dir(profile);
                let from = safe_child(&pdir.join("saves"), &file)?;
                if !from.is_dir() {
                    continue;
                }
                let stamp = now_secs();
                let to = safe_child(&pdir.join(QUARANTINE_DIR), &format!("{}-{}", file, stamp))?;
                std::fs::create_dir_all(pdir.join(QUARANTINE_DIR)).map_err(|e| e.to_string())?;
                std::fs::rename(&from, &to).map_err(|e| format!("Мир занят другой программой — закрой игру и повтори: {}", e))?;
            }
            _ => return Err("Неизвестный файл".into()),
        }
        done += 1;
    }
    Ok(done)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (entry inside a pack or map, its first bytes) -> is it a finding.
    #[test]
    fn only_runnable_content_is_flagged() {
        let cases: [(&str, &[u8], bool, &str); 6] = [
            ("assets/minecraft/textures/block/stone.png", b"\x89PNG", false, "a texture is what a pack is made of"),
            ("data/x/functions/tick.mcfunction", b"say", false, "a data pack function is commands, not a program"),
            ("payload.jar", b"PK\x03\x04", true, "a jar has no business in a resource pack"),
            ("readme.bat", b"@ech", true, "a script that runs on double click"),
            ("assets/icon.png", &[0xCA, 0xFE, 0xBA, 0xBE], true, "a class file hidden under a picture name"),
            ("region/r.0.0.mca", &[0x00, 0x00, 0x02, 0x01], false, "world region data is ordinary binary"),
        ];
        for (name, head, want, why) in cases {
            assert_eq!(entry_finding(name, head).is_some(), want, "{}: {}", name, why);
        }
    }
}
