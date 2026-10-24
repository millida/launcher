// The player's own marks on a build's files: pinned versions, tags, changes waiting for the game to close, and which files came with the pack.
// Lives in millida-content-prefs.json inside the profile folder. No network.
use crate::engine::*;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const PREFS_FILE: &str = "millida-content-prefs.json";
pub const TAG_MAX_CHARS: usize = 24;
pub const TAGS_PER_FILE: usize = 5;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingOp {
    pub kind: String,
    pub name: String,
    /// "on" | "off" | "delete"
    pub op: String,
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContentPrefs {
    #[serde(default)]
    locked: BTreeSet<String>,
    #[serde(default)]
    tags: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pending: Vec<PendingOp>,
    /// Keys of the files the pack itself shipped. Absent: the build has no
    /// record, so no file is labelled either way.
    #[serde(default)]
    pack_origin: Option<BTreeSet<String>>,
}

static PREFS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn load_at(pdir: &Path) -> ContentPrefs {
    std::fs::read(pdir.join(PREFS_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn load(profile: &str) -> ContentPrefs {
    load_at(&profile_dir(profile))
}

fn edit_at<T>(pdir: &Path, f: impl FnOnce(&mut ContentPrefs) -> T) -> Result<T, String> {
    let _guard = PREFS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut prefs = load_at(pdir);
    let out = f(&mut prefs);
    write_json_atomic(&pdir.join(PREFS_FILE), &prefs)
        .map_err(|e| format!("Не удалось сохранить отметки сборки — проверь, что папка сборки доступна для записи: {}", e))?;
    Ok(out)
}

fn edit<T>(profile: &str, f: impl FnOnce(&mut ContentPrefs) -> T) -> Result<T, String> {
    edit_at(&profile_dir(profile), f)
}

/// A catalogue project keeps its marks across updates, which rename the file;
/// a file known to no catalogue is marked by its name.
pub(crate) fn content_key(kind: &str, project_id: &str, file_name: &str) -> String {
    if project_id.is_empty() {
        format!("{}:file:{}", kind, file_name)
    } else {
        format!("{}:{}", kind, project_id)
    }
}

fn key_of(profile: &str, kind: &str, file_name: &str) -> String {
    let pid = load_content_manifest(profile)
        .into_iter()
        .find(|e| e.kind == kind && e.file_name == file_name)
        .map(|e| e.project_id)
        .unwrap_or_default();
    content_key(kind, &pid, file_name)
}

fn profile_known(profile: &str) -> Result<(), String> {
    if load_profiles().iter().any(|p| p.name == profile) {
        Ok(())
    } else {
        Err("Сборка не найдена — открой список сборок заново".into())
    }
}

pub fn is_content_locked(profile: &str, kind: &str, project_id: &str, file_name: &str) -> bool {
    load(profile).locked.contains(&content_key(kind, project_id, file_name))
}

pub(crate) fn has_locked_content(profile: &str) -> bool {
    !load(profile).locked.is_empty()
}

pub fn set_content_locked(profile: &str, kind: &str, name: &str, on: bool) -> Result<bool, String> {
    profile_known(profile)?;
    let file = safe_file_name(name)?;
    let key = key_of(profile, kind, &file);
    edit(profile, |p| {
        if on {
            p.locked.insert(key);
        } else {
            p.locked.remove(&key);
        }
        on
    })
}

/// Tags are the player's free text shown back as chips: trimmed, single-line,
/// short, without duplicates, and only a handful per file.
pub(crate) fn clean_tags(raw: &[String]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for t in raw {
        let one: String = t
            .chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let one: String = one.chars().take(TAG_MAX_CHARS).collect::<String>().trim().to_string();
        if one.is_empty() || out.iter().any(|o| o.to_lowercase() == one.to_lowercase()) {
            continue;
        }
        out.push(one);
        if out.len() == TAGS_PER_FILE {
            break;
        }
    }
    out
}

pub fn set_content_tags(profile: &str, kind: &str, name: &str, tags: Vec<String>) -> Result<Vec<String>, String> {
    profile_known(profile)?;
    let file = safe_file_name(name)?;
    let key = key_of(profile, kind, &file);
    let tags = clean_tags(&tags);
    edit(profile, |p| {
        if tags.is_empty() {
            p.tags.remove(&key);
        } else {
            p.tags.insert(key, tags.clone());
        }
        tags
    })
}

/// Every tag used in the build, for the filter chips above the list.
pub fn content_tags(profile: &str, kind: &str) -> Vec<String> {
    let prefix = format!("{}:", kind);
    let mut all: BTreeSet<String> = BTreeSet::new();
    for (k, v) in load(profile).tags {
        if k.starts_with(&prefix) {
            all.extend(v);
        }
    }
    all.into_iter().collect()
}

/// Remembers the files a pack shipped right after it was placed, so the build
/// page can tell them from what the player added later.
pub(crate) fn record_pack_origin(profile: &str) {
    record_pack_origin_at(&profile_dir(profile));
}

/// Same, for a version unpacked beside the build before it takes its place.
pub(crate) fn record_pack_origin_at(pdir: &Path) {
    let manifest: Vec<ContentEntry> = std::fs::read(pdir.join("millida-content.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut keys: BTreeSet<String> = BTreeSet::new();
    for kind in ["mod", "resourcepack", "shader", "datapack"] {
        for f in content_files(pdir, kind) {
            let pid = manifest
                .iter()
                .find(|e| e.kind == kind && e.file_name == f)
                .map(|e| e.project_id.clone())
                .unwrap_or_default();
            keys.insert(content_key(kind, &pid, &f));
        }
    }
    let _ = edit_at(pdir, |p| p.pack_origin = Some(keys));
}

fn content_files(pdir: &Path, kind: &str) -> Vec<String> {
    let dir = pdir.join(content_dir(kind));
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    rd.flatten()
        .filter(|e| e.path().is_file())
        .map(|e| e.file_name().to_string_lossy().to_string())
        .map(|n| n.strip_suffix(".disabled").map(str::to_string).unwrap_or(n))
        .filter(|n| [".jar", ".zip", ".litemod"].iter().any(|x| n.to_ascii_lowercase().ends_with(x)))
        .collect()
}

/// Same op for the same file replaces the earlier one; asking for the state the
/// file is already in cancels the wait instead of queueing a no-op.
fn queue(pending: &mut Vec<PendingOp>, op: PendingOp, already: bool) {
    pending.retain(|p| !(p.kind == op.kind && p.name == op.name));
    if !already {
        pending.push(op);
    }
}

fn file_enabled(profile: &str, kind: &str, file: &str) -> Option<bool> {
    let dir = profile_dir(profile).join(content_dir(kind));
    if safe_child(&dir, file).ok()?.exists() {
        return Some(true);
    }
    if safe_child(&dir, &format!("{}.disabled", file)).ok()?.exists() {
        return Some(false);
    }
    None
}

pub(crate) fn queue_toggle(profile: &str, kind: &str, name: &str, enable: bool) -> Result<(), String> {
    let file = safe_file_name(name)?;
    let already = file_enabled(profile, kind, &file) == Some(enable);
    let op = PendingOp { kind: kind.into(), name: file, op: if enable { "on" } else { "off" }.into() };
    edit(profile, |p| queue(&mut p.pending, op, already))
}

pub(crate) fn queue_delete(profile: &str, kind: &str, name: &str) -> Result<(), String> {
    let file = safe_file_name(name)?;
    let op = PendingOp { kind: kind.into(), name: file, op: "delete".into() };
    edit(profile, |p| queue(&mut p.pending, op, false))
}

fn pending_ops(profile: &str) -> Vec<PendingOp> {
    load(profile).pending
}

/// Runs what waited for the game to close. An op that still fails (the file is
/// held by an antivirus) stays queued; an op whose file is gone is dropped.
pub fn apply_pending_content(profile: &str) {
    if running_games().iter().any(|p| p == profile) {
        return;
    }
    let ops = pending_ops(profile);
    if ops.is_empty() {
        return;
    }
    let mut kept = vec![];
    for op in ops {
        let present = file_enabled(profile, &op.kind, &op.name).is_some();
        if !present {
            continue;
        }
        let done = match op.op.as_str() {
            "on" => toggle_content(profile, &op.kind, &op.name, true),
            "off" => toggle_content(profile, &op.kind, &op.name, false),
            "delete" => delete_content(profile, &op.kind, &op.name),
            _ => Ok(()),
        };
        if done.is_err() {
            kept.push(op);
        }
    }
    let _ = edit(profile, |p| p.pending = kept);
}

/// Adds the player's marks to a listed folder.
pub(crate) fn annotate_content(profile: &str, kind: &str, list: &mut [ModFile]) {
    let prefs = load(profile);
    for m in list.iter_mut() {
        let key = content_key(kind, m.project_id.as_deref().unwrap_or(""), &m.name);
        m.locked = prefs.locked.contains(&key);
        m.tags = prefs.tags.get(&key).cloned().unwrap_or_default();
        m.origin = prefs
            .pack_origin
            .as_ref()
            .map(|o| if o.contains(&key) { "pack".to_string() } else { "manual".to_string() });
        m.pending = prefs
            .pending
            .iter()
            .find(|p| p.kind == kind && p.name == m.name)
            .map(|p| p.op.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (typed tags) -> what is stored.
    #[test]
    fn tags_are_short_unique_and_few() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let cases: [(Vec<String>, Vec<String>, &str); 5] = [
            (s(&["  Графика  ", "графика"]), s(&["Графика"]), "the same tag in another case is one tag"),
            (s(&["a\nb", "\t"]), s(&["a b"]), "a tag is one line; an empty one is dropped"),
            (s(&["абвгдеёжзийклмнопрстуфхцчш"]), s(&["абвгдеёжзийклмнопрстуфхц"]), "a tag is cut to the chip width"),
            (s(&["1", "2", "3", "4", "5", "6"]), s(&["1", "2", "3", "4", "5"]), "a file carries only a handful of tags"),
            (s(&[]), s(&[]), "no tags clears the file's tags"),
        ];
        for (raw, want, why) in cases {
            assert_eq!(clean_tags(&raw), want, "{}", why);
        }
    }

    /// A catalogue project keeps its pin and tags when an update renames the file.
    #[test]
    fn a_catalogue_file_is_marked_by_project() {
        assert_eq!(content_key("mod", "AANobbMI", "sodium-0.5.jar"), content_key("mod", "AANobbMI", "sodium-0.6.jar"), "an update renames the jar; the pin must survive it");
        assert_ne!(content_key("mod", "", "a.jar"), content_key("mod", "", "b.jar"), "unknown files are told apart by name");
        assert_ne!(content_key("mod", "x", "a.jar"), content_key("resourcepack", "x", "a.jar"), "a mod and a resource pack never share marks");
    }

    /// (queued, asked again, file already in that state) -> what waits for the game to close.
    #[test]
    fn a_change_waits_once_per_file() {
        let op = |name: &str, what: &str| PendingOp { kind: "mod".into(), name: name.into(), op: what.into() };
        let mut q = vec![op("a.jar", "off")];
        queue(&mut q, op("a.jar", "on"), true);
        assert!(q.is_empty(), "switching a file back to its current state cancels the wait");
        queue(&mut q, op("a.jar", "off"), false);
        queue(&mut q, op("a.jar", "delete"), false);
        assert_eq!(q, vec![op("a.jar", "delete")], "the last ask for a file replaces the earlier one");
        queue(&mut q, op("b.jar", "off"), false);
        assert_eq!(q.len(), 2, "other files keep their own waits");
    }
}
