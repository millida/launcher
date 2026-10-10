//! Milli's hands on the player's PC: text configs of a build, a diary, build
//! snapshots and the list of world backups.
//!
//! Paths and edits are produced by a language model on the server, so the
//! command surface is narrow: only `options.txt` and text files under `config/`
//! are readable or writable, never jars, worlds or anything outside the build.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::engine::*;

const MAX_TEXT_BYTES: u64 = 512 * 1024;
const MAX_PATHS_PER_CALL: usize = 32;
const MAX_LISTED_FILES: usize = 2000;
const MAX_LIST_DEPTH: usize = 8;
const MAX_NOTE_BYTES: usize = 2 * 1024 * 1024;
const MAX_LABEL_CHARS: usize = 60;
const KEEP_AUTO_SNAPSHOTS: usize = 10;
const KEEP_MANUAL_SNAPSHOTS: usize = 20;
const CONFIG_EXTS: [&str; 11] = ["toml", "json", "json5", "properties", "cfg", "txt", "yaml", "yml", "snbt", "conf", "ini"];
const SNAPSHOT_DIRS: [&str; 2] = ["mods", "config"];
const OPTIONS: &str = "options.txt";

// One lock for every mutating call: a restore racing a snapshot or a write
// would capture or overwrite a half-swapped build.
static LOCK: Mutex<()> = Mutex::new(());

fn locked() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalFileMeta {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Serialize, Clone, Debug)]
pub struct LocalFileText {
    pub path: String,
    pub size: u64,
    pub mtime: u64,
    pub text: Option<String>,
    pub exists: bool,
    pub sha1: String,
}

#[derive(Deserialize, Clone, Debug)]
pub struct LocalFileEdit {
    pub path: String,
    pub text: Option<String>,
    pub expect: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct MilliSnap {
    pub id: String,
    pub label: String,
    pub at: u64,
    pub bytes: u64,
    pub disk: u64,
    pub files: u32,
    pub mods: u32,
    pub auto: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorldBackup {
    pub file: String,
    pub world: String,
    pub at: u64,
    pub bytes: u64,
}

fn milli_dir(pdir: &Path) -> PathBuf {
    pdir.join(".milli")
}

fn snaps_dir(pdir: &Path) -> PathBuf {
    milli_dir(pdir).join("snapshots")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn mtime_secs(md: &std::fs::Metadata) -> u64 {
    md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
}

pub(super) fn sha1_hex(bytes: &[u8]) -> String {
    use sha1::Digest as _;
    sha1::Sha1::digest(bytes).iter().map(|b| format!("{:02x}", b)).collect()
}

fn existing_build(pdir: &Path) -> Result<(), String> {
    if pdir.is_dir() {
        return Ok(());
    }
    Err("Сборка не найдена на диске: выбери её в списке ещё раз".into())
}

/// The only gate for Milli's file paths: `options.txt` or a text config under
/// `config/`. Returns the normalized relative path and the resolved target.
pub(crate) fn milli_file_path(pdir: &Path, rel: &str) -> Result<(String, PathBuf), String> {
    let norm = rel.replace('\\', "/");
    let norm = norm.trim_start_matches("./").to_string();
    if norm == OPTIONS {
        return Ok((norm, safe_join(pdir, OPTIONS)?));
    }
    let Some(inner) = norm.strip_prefix("config/") else {
        return Err(format!("Милли правит только options.txt и папку config, а не «{}»", rel));
    };
    let ext = Path::new(inner).extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if !CONFIG_EXTS.contains(&ext.as_str()) {
        return Err(format!("«{}» — не текстовый конфиг, Милли его не трогает", rel));
    }
    let target = safe_join(&pdir.join("config"), inner)?;
    Ok((norm, target))
}

fn read_one(pdir: &Path, rel: &str) -> Result<LocalFileText, String> {
    let (path, target) = milli_file_path(pdir, rel)?;
    let Ok(md) = std::fs::metadata(&target) else {
        return Ok(LocalFileText { path, size: 0, mtime: 0, text: None, exists: false, sha1: String::new() });
    };
    if !md.is_file() {
        return Err(format!("«{}» — папка, а не файл", rel));
    }
    let size = md.len();
    let mtime = mtime_secs(&md);
    if size > MAX_TEXT_BYTES {
        return Ok(LocalFileText { path, size, mtime, text: None, exists: true, sha1: String::new() });
    }
    let bytes = std::fs::read(&target).map_err(|e| io_fail("Чтение конфига", &target, &e))?;
    let sha1 = sha1_hex(&bytes);
    let text = String::from_utf8(bytes).ok();
    Ok(LocalFileText { path, size, mtime, text, exists: true, sha1 })
}

pub fn milli_files_read(pdir: &Path, paths: &[String]) -> Result<Vec<LocalFileText>, String> {
    if paths.len() > MAX_PATHS_PER_CALL {
        return Err(format!("Слишком много файлов за раз: {} из {}", paths.len(), MAX_PATHS_PER_CALL));
    }
    paths.iter().map(|p| read_one(pdir, p)).collect()
}

pub fn milli_files_list(pdir: &Path) -> Vec<LocalFileMeta> {
    let mut out = Vec::new();
    if let Ok(md) = std::fs::metadata(pdir.join(OPTIONS)) {
        if md.is_file() {
            out.push(LocalFileMeta { path: OPTIONS.into(), size: md.len(), mtime: mtime_secs(&md) });
        }
    }
    let root = pdir.join("config");
    let mut stack = vec![(root.clone(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            if out.len() >= MAX_LISTED_FILES {
                return out;
            }
            let Ok(ft) = e.file_type() else { continue };
            let p = e.path();
            if ft.is_symlink() {
                continue;
            }
            if ft.is_dir() {
                if depth + 1 < MAX_LIST_DEPTH {
                    stack.push((p, depth + 1));
                }
                continue;
            }
            let Ok(rel) = p.strip_prefix(pdir) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            if milli_file_path(pdir, &rel).is_err() {
                continue;
            }
            let Ok(md) = e.metadata() else { continue };
            out.push(LocalFileMeta { path: rel, size: md.len(), mtime: mtime_secs(&md) });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// All edits are validated and checked against `expect` before the first byte
/// is written, so a stale edit never leaves the build half-changed.
pub fn milli_files_write(pdir: &Path, edits: &[LocalFileEdit]) -> Result<Vec<LocalFileText>, String> {
    existing_build(pdir)?;
    if edits.len() > MAX_PATHS_PER_CALL {
        return Err(format!("Слишком много файлов за раз: {} из {}", edits.len(), MAX_PATHS_PER_CALL));
    }
    let _g = locked();
    let mut plan = Vec::with_capacity(edits.len());
    for e in edits {
        let (_, target) = milli_file_path(pdir, &e.path)?;
        if let Some(t) = &e.text {
            if t.len() as u64 > MAX_TEXT_BYTES {
                return Err(format!("«{}» больше {} КБ — такой конфиг Милли не пишет", e.path, MAX_TEXT_BYTES / 1024));
            }
        }
        if let Some(want) = &e.expect {
            let now = read_one(pdir, &e.path)?;
            let same = if want.is_empty() { !now.exists } else { now.exists && now.sha1.eq_ignore_ascii_case(want) };
            if !same {
                return Err(format!("«{}» изменился, пока Милли его правила: попроси её ещё раз", e.path));
            }
        }
        plan.push((e, target));
    }
    for (e, target) in &plan {
        match &e.text {
            Some(t) => write_bytes_atomic(target, t.as_bytes())?,
            None => match std::fs::remove_file(target) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(io_fail("Удаление конфига", target, &err)),
            },
        }
    }
    plan.iter().map(|(e, _)| read_one(pdir, &e.path)).collect()
}

fn note_path(pdir: &Path, name: &str) -> Result<PathBuf, String> {
    let ok = !name.is_empty() && name.len() <= 32 && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
    if !ok {
        return Err(format!("Недопустимое имя заметки «{}»", name));
    }
    Ok(milli_dir(pdir).join("notes").join(format!("{}.json", name)))
}

pub fn milli_note_read(pdir: &Path, name: &str) -> Result<Option<String>, String> {
    let p = note_path(pdir, name)?;
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io_fail("Чтение дневника Милли", &p, &e)),
    }
}

pub fn milli_note_write(pdir: &Path, name: &str, text: &str) -> Result<(), String> {
    existing_build(pdir)?;
    let p = note_path(pdir, name)?;
    if text.len() > MAX_NOTE_BYTES {
        return Err("Дневник Милли слишком большой для записи".into());
    }
    let _g = locked();
    write_bytes_atomic(&p, text.as_bytes())
}

fn snap_id_ok(id: &str) -> bool {
    id.len() >= 2 && id.len() <= 32 && id.starts_with('s') && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn snap_dir(pdir: &Path, id: &str) -> Result<PathBuf, String> {
    if !snap_id_ok(id) {
        return Err(format!("Недопустимый снимок «{}»", id));
    }
    Ok(snaps_dir(pdir).join(id))
}

fn new_snap_id(pdir: &Path) -> String {
    let base = now_secs();
    let mut n = 0u32;
    loop {
        let id = format!("s{}{}", radix36(base), radix36(n as u64));
        if !snaps_dir(pdir).join(&id).exists() {
            return id;
        }
        n += 1;
    }
}

fn radix36(mut v: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if v == 0 {
        return "0".into();
    }
    let mut out = Vec::new();
    while v > 0 {
        out.push(DIGITS[(v % 36) as usize]);
        v /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

#[derive(Default)]
struct CopyStats {
    bytes: u64,
    disk: u64,
    files: u32,
}

/// Jars are hard-linked: the dedup store already shares them between builds
/// and the game never writes into a jar. Configs are copied, because the game
/// rewrites them in place and a link would carry that edit into the snapshot.
fn mirror_tree(src: &Path, dst: &Path, link_jars: bool, stats: &mut CopyStats) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| io_fail("Снимок сборки", dst, &e))?;
    let rd = std::fs::read_dir(src).map_err(|e| io_fail("Снимок сборки", src, &e))?;
    for e in rd.flatten() {
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let from = e.path();
        let to = dst.join(e.file_name());
        if ft.is_dir() {
            mirror_tree(&from, &to, link_jars, stats)?;
            continue;
        }
        let len = e.metadata().map(|m| m.len()).unwrap_or(0);
        let is_jar = from.extension().and_then(|x| x.to_str()).map(|x| x.eq_ignore_ascii_case("jar") || x.eq_ignore_ascii_case("disabled")).unwrap_or(false);
        if link_jars && is_jar && std::fs::hard_link(&from, &to).is_ok() {
            stats.bytes += len;
            stats.files += 1;
            continue;
        }
        std::fs::copy(&from, &to).map_err(|err| io_fail("Снимок сборки", &from, &err))?;
        stats.bytes += len;
        stats.disk += len;
        stats.files += 1;
    }
    Ok(())
}

fn count_mods(dir: &Path) -> u32 {
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(".jar")).count() as u32)
        .unwrap_or(0)
}

fn read_meta(dir: &Path) -> Option<MilliSnap> {
    let raw = std::fs::read(dir.join("meta.json")).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub fn milli_snapshots(pdir: &Path) -> Vec<MilliSnap> {
    let mut out: Vec<MilliSnap> = std::fs::read_dir(snaps_dir(pdir))
        .map(|rd| {
            rd.flatten()
                .filter(|e| snap_id_ok(&e.file_name().to_string_lossy()))
                .filter_map(|e| read_meta(&e.path()))
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
    out
}

fn take_snapshot(pdir: &Path, label: &str, auto: bool) -> Result<MilliSnap, String> {
    let id = new_snap_id(pdir);
    let dir = snaps_dir(pdir).join(&id);
    let staging = snaps_dir(pdir).join(format!(".{}-part", id));
    let _ = std::fs::remove_dir_all(&staging);
    let mut stats = CopyStats::default();
    let built = (|| -> Result<(), String> {
        for d in SNAPSHOT_DIRS {
            let src = pdir.join(d);
            if src.is_dir() {
                mirror_tree(&src, &staging.join(d), d == "mods", &mut stats)?;
            }
        }
        let opts = pdir.join(OPTIONS);
        if opts.is_file() {
            std::fs::create_dir_all(&staging).map_err(|e| io_fail("Снимок сборки", &staging, &e))?;
            let len = std::fs::copy(&opts, staging.join(OPTIONS)).map_err(|e| io_fail("Снимок сборки", &opts, &e))?;
            stats.bytes += len;
            stats.disk += len;
            stats.files += 1;
        }
        Ok(())
    })();
    if let Err(e) = built {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    let label: String = label.trim().chars().filter(|c| !c.is_control()).take(MAX_LABEL_CHARS).collect();
    let snap = MilliSnap {
        id: id.clone(),
        label: if label.is_empty() { "Снимок".into() } else { label },
        at: now_secs(),
        bytes: stats.bytes,
        disk: stats.disk,
        files: stats.files,
        mods: count_mods(&staging.join("mods")),
        auto,
    };
    let finished = write_json_atomic(&staging.join("meta.json"), &snap)
        .and_then(|_| std::fs::rename(&staging, &dir).map_err(|e| io_fail("Снимок сборки", &dir, &e)));
    if let Err(e) = finished {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    prune(pdir);
    Ok(snap)
}

fn prune(pdir: &Path) {
    let all = milli_snapshots(pdir);
    for (auto, keep) in [(true, KEEP_AUTO_SNAPSHOTS), (false, KEEP_MANUAL_SNAPSHOTS)] {
        for s in all.iter().filter(|s| s.auto == auto).skip(keep) {
            let _ = std::fs::remove_dir_all(snaps_dir(pdir).join(&s.id));
        }
    }
}

pub fn milli_snapshot(pdir: &Path, label: &str, auto: bool) -> Result<MilliSnap, String> {
    existing_build(pdir)?;
    let _g = locked();
    take_snapshot(pdir, label, auto)
}

/// Captures the current state first and returns it, so "undo the rollback" is
/// itself a restore. The live folders are swapped only after the snapshot's
/// copy is fully staged; a failed swap puts the old folder back.
pub fn milli_snapshot_restore(pdir: &Path, id: &str) -> Result<MilliSnap, String> {
    existing_build(pdir)?;
    let src = snap_dir(pdir, id)?;
    if read_meta(&src).is_none() {
        return Err("Этого снимка уже нет: обнови список".into());
    }
    let _g = locked();
    let before = take_snapshot(pdir, "Перед откатом", true)?;
    let work = milli_dir(pdir).join("restore");
    let _ = std::fs::remove_dir_all(&work);
    let staged = work.join("new");
    let trash = work.join("old");
    let mut stats = CopyStats::default();
    for d in SNAPSHOT_DIRS {
        let from = src.join(d);
        let to = staged.join(d);
        if from.is_dir() {
            mirror_tree(&from, &to, d == "mods", &mut stats)?;
        } else {
            std::fs::create_dir_all(&to).map_err(|e| io_fail("Откат сборки", &to, &e))?;
        }
    }
    std::fs::create_dir_all(&trash).map_err(|e| io_fail("Откат сборки", &trash, &e))?;
    let mut swapped: Vec<&str> = Vec::new();
    for d in SNAPSHOT_DIRS {
        let live = pdir.join(d);
        let had_live = live.exists();
        if had_live {
            if let Err(e) = std::fs::rename(&live, trash.join(d)) {
                undo_swap(pdir, &trash, &swapped);
                return Err(format!("{}. Закрой игру и попробуй ещё раз", io_fail("Откат сборки", &live, &e)));
            }
        }
        if let Err(e) = std::fs::rename(staged.join(d), &live) {
            if had_live {
                let _ = std::fs::rename(trash.join(d), &live);
            }
            undo_swap(pdir, &trash, &swapped);
            return Err(format!("{}. Закрой игру и попробуй ещё раз", io_fail("Откат сборки", &live, &e)));
        }
        swapped.push(d);
    }
    let opts = src.join(OPTIONS);
    if opts.is_file() {
        let bytes = std::fs::read(&opts).map_err(|e| io_fail("Откат сборки", &opts, &e))?;
        write_bytes_atomic(&pdir.join(OPTIONS), &bytes)?;
    }
    let _ = std::fs::remove_dir_all(&work);
    Ok(before)
}

fn undo_swap(pdir: &Path, trash: &Path, swapped: &[&str]) {
    for d in swapped {
        let live = pdir.join(d);
        let _ = std::fs::remove_dir_all(&live);
        let _ = std::fs::rename(trash.join(d), &live);
    }
}

pub fn milli_snapshot_delete(pdir: &Path, id: &str) -> Result<(), String> {
    let dir = snap_dir(pdir, id)?;
    let _g = locked();
    match std::fs::remove_dir_all(&dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(io_fail("Удаление снимка", &dir, &e)),
    }
}

/// Backups are written by `backup_world` as `<world>-<unix secs>.zip`.
pub fn milli_world_backups(pdir: &Path) -> Vec<WorldBackup> {
    let mut out: Vec<WorldBackup> = std::fs::read_dir(pdir.join("backups"))
        .map(|rd| {
            rd.flatten()
                .filter_map(|e| {
                    let file = e.file_name().to_string_lossy().to_string();
                    let stem = file.strip_suffix(".zip")?;
                    let (world, ts) = stem.rsplit_once('-')?;
                    let at = ts.parse::<u64>().ok()?;
                    let bytes = e.metadata().ok()?.len();
                    Some(WorldBackup { file: file.clone(), world: world.to_string(), at, bytes })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|b| std::cmp::Reverse(b.at));
    out
}

enum OptRule {
    Int(i64, i64),
    Num(f64, f64),
    Enum(&'static [&'static str]),
}

/// Same whitelist as `CONFIG_RULES` in the launcher's bench tabs: the server
/// may only suggest these keys, and the core re-checks them.
fn opt_rule(key: &str) -> Option<OptRule> {
    const BOOL: &[&str] = &["true", "false"];
    Some(match key {
        "renderDistance" => OptRule::Int(2, 32),
        "simulationDistance" => OptRule::Int(5, 32),
        "maxFps" => OptRule::Int(10, 260),
        "graphicsMode" => OptRule::Int(0, 2),
        "particles" => OptRule::Int(0, 2),
        "biomeBlendRadius" => OptRule::Int(0, 7),
        "mipmapLevels" => OptRule::Int(0, 4),
        "renderClouds" => OptRule::Enum(&["true", "fast", "false"]),
        "entityShadows" | "ao" | "enableVsync" => OptRule::Enum(BOOL),
        "entityDistanceScaling" => OptRule::Num(0.5, 5.0),
        "lang" => OptRule::Enum(&["ru_ru", "en_us", "uk_ua"]),
        _ => return None,
    })
}

fn opt_value(key: &str, raw: &str) -> Option<String> {
    let v = raw.trim().trim_matches('"').to_ascii_lowercase();
    match opt_rule(key)? {
        OptRule::Enum(values) => values.contains(&v.as_str()).then_some(v),
        OptRule::Int(lo, hi) => v.parse::<i64>().ok().filter(|n| (lo..=hi).contains(n)).map(|n| n.to_string()),
        OptRule::Num(lo, hi) => v.parse::<f64>().ok().filter(|n| n.is_finite() && *n >= lo && *n <= hi).map(|n| n.to_string()),
    }
}

#[derive(Deserialize, Clone, Debug)]
pub struct MilliShader {
    pub loader: String,
    pub file: String,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct MilliOptionsReport {
    pub written: Vec<String>,
    pub kept: Vec<String>,
    pub rejected: Vec<String>,
    pub shader: bool,
}

fn escape_property(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for c in v.chars() {
        if matches!(c, '\\' | ':' | '=' | '#' | '!') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn set_property(text: &str, key: &str, value: &str) -> String {
    let line = format!("{}={}", key, escape_property(value));
    let mut found = false;
    let mut out: Vec<String> = text
        .lines()
        .map(|l| {
            let k = l.split(['=', ':']).next().unwrap_or("").trim();
            if !found && k == key {
                found = true;
                line.clone()
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        out.push(line);
    }
    out.join("\n") + "\n"
}

/// Graphics of a freshly built pack. A key the player already has in
/// options.txt is kept: Milli suggests defaults, it does not override choices.
pub fn apply_milli_options(
    pdir: &Path,
    options: &std::collections::BTreeMap<String, String>,
    shader: Option<&MilliShader>,
) -> Result<MilliOptionsReport, String> {
    existing_build(pdir)?;
    let _g = locked();
    let mut report = MilliOptionsReport::default();
    let opts_path = pdir.join(OPTIONS);
    let current = match std::fs::read_to_string(&opts_path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(io_fail("Чтение options.txt", &opts_path, &e)),
    };
    let present: std::collections::HashSet<&str> = current.lines().filter_map(|l| l.split_once(':').map(|(k, _)| k)).collect();
    let mut add = String::new();
    for (k, raw) in options {
        let Some(v) = opt_value(k, raw) else {
            report.rejected.push(k.clone());
            continue;
        };
        if present.contains(k.as_str()) {
            report.kept.push(k.clone());
            continue;
        }
        let v = if k == "renderClouds" { format!("\"{}\"", v) } else { v };
        add.push_str(&format!("{}:{}\n", k, v));
        report.written.push(k.clone());
    }
    if !add.is_empty() {
        let mut text = current.clone();
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&add);
        write_bytes_atomic(&opts_path, text.as_bytes())?;
    }
    if let Some(sh) = shader {
        let name = match sh.loader.as_str() {
            "iris" => "iris.properties",
            "oculus" => "oculus.properties",
            other => return Err(format!("Неизвестный загрузчик шейдеров «{}»", other)),
        };
        let pack = safe_child(&pdir.join("shaderpacks"), &sh.file)?;
        if !pack.exists() {
            return Err(format!("Шейдер «{}» не скачался: включи его в настройках видео", sh.file));
        }
        let path = pdir.join("config").join(name);
        let text = std::fs::read_to_string(&path).unwrap_or_default();
        let text = set_property(&set_property(&text, "enableShaders", "true"), "shaderPack", &sh.file);
        write_bytes_atomic(&path, text.as_bytes())?;
        report.shader = true;
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// options from the model: (key, value, outcome). Unknown keys and
    /// out-of-range values are refused, never clamped into something else.
    #[test]
    fn milli_options_whitelist() {
        let cases: [(&str, &str, Option<&str>, &str); 9] = [
            ("renderDistance", "12", Some("12"), "plain int"),
            ("renderDistance", "64", None, "beyond the game's slider"),
            ("lang", "RU_RU", Some("ru_ru"), "case from the model"),
            ("renderClouds", "\"fast\"", Some("fast"), "quoted as newer versions write it"),
            ("entityDistanceScaling", "1.25", Some("1.25"), "float"),
            ("entityDistanceScaling", "NaN", None, "not a number"),
            ("resourcePacks", "[\"x\"]", None, "not in the whitelist"),
            ("fullscreen", "true", None, "not in the whitelist"),
            ("maxFps", "1e3", None, "exponent is not an int"),
        ];
        for (k, v, want, why) in cases {
            assert_eq!(opt_value(k, v).as_deref(), want, "{k}={v}: {why}");
        }
    }

    #[test]
    fn milli_options_keep_player_values_and_enable_shader() {
        let pdir = tmp("opts");
        std::fs::create_dir_all(pdir.join("shaderpacks")).unwrap();
        std::fs::write(pdir.join("shaderpacks/Comp=v5.zip"), "z").unwrap();
        std::fs::write(pdir.join(OPTIONS), "renderDistance:8\n").unwrap();
        let mut opts = std::collections::BTreeMap::new();
        opts.insert("renderDistance".to_string(), "16".to_string());
        opts.insert("lang".to_string(), "ru_ru".to_string());
        opts.insert("fullscreen".to_string(), "true".to_string());
        let r = apply_milli_options(&pdir, &opts, Some(&MilliShader { loader: "iris".into(), file: "Comp=v5.zip".into() })).unwrap();
        assert_eq!(
            (r.written, r.kept, r.rejected, r.shader),
            (vec!["lang".to_string()], vec!["renderDistance".to_string()], vec!["fullscreen".to_string()], true)
        );
        assert_eq!(std::fs::read_to_string(pdir.join(OPTIONS)).unwrap(), "renderDistance:8\nlang:ru_ru\n", "the player's render distance must survive");
        let props = std::fs::read_to_string(pdir.join("config/iris.properties")).unwrap();
        assert!(props.contains("enableShaders=true"), "shader must be switched on");
        assert!(props.contains("shaderPack=Comp\\=v5.zip"), "'=' in a shader name must be escaped for java properties");
        let bad = apply_milli_options(&pdir, &Default::default(), Some(&MilliShader { loader: "iris".into(), file: "../x.zip".into() }));
        assert!(bad.is_err(), "a shader name with a path must be refused");
    }

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-milli-local-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Path gate: (input, allowed, why the case is pinned). Every "false" here
    /// is a file a prompt-injected model must never be able to touch.
    #[test]
    fn only_options_and_text_configs_are_reachable() {
        let pdir = tmp("gate");
        let cases: [(&str, bool, &str); 14] = [
            ("options.txt", true, "graphics settings live here"),
            ("./options.txt", true, "a leading ./ is the same file"),
            ("config/sodium-options.json", true, "mod config"),
            ("config\\iris.properties", true, "Windows separators from the model"),
            ("config/sub/dir/a.toml", true, "nested mod config"),
            ("mods/sodium.jar", false, "jars are executable code"),
            ("config/evil.jar", false, "a jar dropped into config is still code"),
            ("config/../mods/x.toml", false, "climbing out of config"),
            ("../other/options.txt", false, "climbing out of the build"),
            ("/etc/passwd", false, "absolute path"),
            ("C:/Windows/win.ini", false, "drive path"),
            ("saves/world/level.dat", false, "worlds are not Milli's"),
            ("config/con.txt", false, "Windows reserved name"),
            ("config/", false, "empty file name"),
        ];
        for (input, allowed, why) in cases {
            assert_eq!(milli_file_path(&pdir, input).is_ok(), allowed, "{input}: {why}");
        }
    }

    /// A write against a file that changed since it was read must fail and
    /// leave every file as it was, including the ones earlier in the batch.
    #[test]
    fn stale_expect_rejects_the_whole_batch() {
        let pdir = tmp("stale");
        std::fs::write(pdir.join(OPTIONS), "fov:0.0\n").unwrap();
        let read = milli_files_read(&pdir, &["options.txt".into()]).unwrap();
        let sha = read[0].sha1.clone();
        std::fs::write(pdir.join(OPTIONS), "fov:0.5\n").unwrap();
        let edits = vec![
            LocalFileEdit { path: "config/a.toml".into(), text: Some("x=1".into()), expect: Some(String::new()) },
            LocalFileEdit { path: "options.txt".into(), text: Some("fov:1.0\n".into()), expect: Some(sha) },
        ];
        assert!(milli_files_write(&pdir, &edits).is_err(), "a stale sha1 must refuse the batch");
        assert!(!pdir.join("config/a.toml").exists(), "nothing from a refused batch may land on disk");
        assert_eq!(std::fs::read_to_string(pdir.join(OPTIONS)).unwrap(), "fov:0.5\n", "the player's newer edit must survive");
    }

    #[test]
    fn write_then_delete_round_trip() {
        let pdir = tmp("roundtrip");
        let put = milli_files_write(&pdir, &[LocalFileEdit { path: "config/b.json".into(), text: Some("{}".into()), expect: Some(String::new()) }]).unwrap();
        assert!(put[0].exists && put[0].sha1.len() == 40, "a written file must report its new sha1 for the undo step");
        let gone = milli_files_write(&pdir, &[LocalFileEdit { path: "config/b.json".into(), text: None, expect: Some(put[0].sha1.clone()) }]).unwrap();
        assert!(!gone[0].exists, "text null is the undo of a created file and must delete it");
    }

    #[test]
    fn listing_skips_binaries_and_other_folders() {
        let pdir = tmp("list");
        std::fs::create_dir_all(pdir.join("config/deep")).unwrap();
        std::fs::create_dir_all(pdir.join("mods")).unwrap();
        std::fs::write(pdir.join(OPTIONS), "a:b").unwrap();
        std::fs::write(pdir.join("config/deep/c.toml"), "").unwrap();
        std::fs::write(pdir.join("config/blob.bin"), "").unwrap();
        std::fs::write(pdir.join("mods/m.jar"), "").unwrap();
        let paths: Vec<String> = milli_files_list(&pdir).into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["config/deep/c.toml".to_string(), "options.txt".to_string()], "the list is what Milli may edit, nothing else");
    }

    #[test]
    fn note_names_cannot_escape() {
        let pdir = tmp("notes");
        for bad in ["", "../x", "a/b", "Diary", "a.b", &"x".repeat(33)] {
            assert!(note_path(&pdir, bad).is_err(), "note name {bad:?} must be refused");
        }
        milli_note_write(&pdir, "diary", "{\"v\":1}").unwrap();
        assert_eq!(milli_note_read(&pdir, "diary").unwrap().as_deref(), Some("{\"v\":1}"));
        assert_eq!(milli_note_read(&pdir, "missing").unwrap(), None, "a missing note is empty, not an error");
    }

    /// Snapshot, break the build, restore: mods, configs and options.txt come
    /// back, and the returned "before" snapshot holds the broken state so the
    /// rollback itself can be undone.
    #[test]
    fn restore_brings_the_build_back_and_is_undoable() {
        let pdir = tmp("restore");
        std::fs::create_dir_all(pdir.join("mods")).unwrap();
        std::fs::create_dir_all(pdir.join("config")).unwrap();
        std::fs::write(pdir.join("mods/good.jar"), "good").unwrap();
        std::fs::write(pdir.join("config/c.toml"), "v=1").unwrap();
        std::fs::write(pdir.join(OPTIONS), "fov:0.0").unwrap();
        let snap = milli_snapshot(&pdir, "До", false).unwrap();
        assert_eq!((snap.mods, snap.files), (1, 3), "snapshot must count what it captured");

        std::fs::remove_file(pdir.join("mods/good.jar")).unwrap();
        std::fs::write(pdir.join("mods/bad.jar"), "bad").unwrap();
        std::fs::write(pdir.join("config/c.toml"), "v=2").unwrap();
        std::fs::write(pdir.join(OPTIONS), "fov:1.0").unwrap();

        let before = milli_snapshot_restore(&pdir, &snap.id).unwrap();
        assert!(pdir.join("mods/good.jar").exists() && !pdir.join("mods/bad.jar").exists(), "mods must match the snapshot exactly");
        assert_eq!(std::fs::read_to_string(pdir.join("config/c.toml")).unwrap(), "v=1");
        assert_eq!(std::fs::read_to_string(pdir.join(OPTIONS)).unwrap(), "fov:0.0");
        assert!(before.auto, "the pre-restore capture is automatic");

        milli_snapshot_restore(&pdir, &before.id).unwrap();
        assert!(pdir.join("mods/bad.jar").exists(), "restoring the 'before' snapshot must undo the rollback");
        assert!(!milli_dir(&pdir).join("restore").exists(), "staging must be cleaned up");
    }

    #[test]
    fn snapshot_ids_are_validated() {
        let pdir = tmp("ids");
        for bad in ["", "s", "../s1", "S1", "s1/..", "x123"] {
            assert!(snap_dir(&pdir, bad).is_err(), "snapshot id {bad:?} must be refused");
        }
    }

    #[test]
    fn world_backups_parse_world_and_time() {
        let pdir = tmp("wb");
        std::fs::create_dir_all(pdir.join("backups")).unwrap();
        std::fs::write(pdir.join("backups/My-World-1700000000.zip"), "z").unwrap();
        std::fs::write(pdir.join("backups/junk.zip"), "z").unwrap();
        let list = milli_world_backups(&pdir);
        assert_eq!(list.len(), 1, "names without a timestamp are not backups");
        assert_eq!((list[0].world.as_str(), list[0].at), ("My-World", 1_700_000_000), "a dash inside the world name must stay in the name");
    }
}
