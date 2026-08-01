use std::path::{Path, PathBuf};

// Single validation point for untrusted paths (mrpack and CurseForge manifest
// entries, file names arriving over IPC). Substring checks are not enough:
// PathBuf::join silently discards the base when the argument is absolute.

const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

fn reject(what: &str, why: &str) -> String {
    format!("Небезопасный путь «{}»: {}", what, why)
}

fn segment_ok(seg: &str, whole: &str) -> Result<(), String> {
    if seg.len() > 255 {
        return Err(reject(whole, "слишком длинное имя"));
    }
    if seg.chars().any(|c| (c as u32) < 0x20 || matches!(c, ':' | '<' | '>' | '"' | '|' | '?' | '*')) {
        return Err(reject(whole, "запрещённый символ в имени"));
    }
    if seg.ends_with('.') || seg.ends_with(' ') {
        return Err(reject(whole, "имя заканчивается точкой или пробелом"));
    }
    let stem = seg.split('.').next().unwrap_or(seg).to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        return Err(reject(whole, "зарезервированное системное имя"));
    }
    Ok(())
}

/// Strips the Windows `\\?\` prefix so canonicalized paths compare with plain ones.
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

fn real_or_self(p: &Path) -> PathBuf {
    plain(&p.canonicalize().unwrap_or_else(|_| p.to_path_buf()))
}

/// Canonicalizes the nearest existing ancestor and keeps the missing tail as is.
/// Otherwise base and target normalize differently (Windows canonicalize expands
/// 8.3 short names) and the prefix check misfires on not-yet-created directories.
fn resolved(p: &Path) -> PathBuf {
    let mut probe = p.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if probe.exists() {
            let mut out = real_or_self(&probe);
            out.extend(tail.iter().rev());
            return out;
        }
        match probe.file_name() {
            Some(name) => tail.push(name.to_os_string()),
            None => return p.to_path_buf(),
        }
        if !probe.pop() {
            return p.to_path_buf();
        }
    }
}

/// Compares resolved paths rather than strings, which also catches a symlink or
/// junction pointing outside the base.
fn ensure_inside(base: &Path, target: &Path, whole: &str) -> Result<(), String> {
    if resolved(target).starts_with(resolved(base)) {
        return Ok(());
    }
    Err(reject(whole, "ведёт за пределы папки"))
}

/// Joins an untrusted relative path onto a base, rejecting absolute paths, `..`,
/// drive letters, UNC prefixes and Windows-reserved names.
pub(crate) fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let cleaned = rel.replace('\\', "/");
    if cleaned.trim().is_empty() {
        return Err(reject(rel, "пустой путь"));
    }
    if cleaned.starts_with('/') {
        return Err(reject(rel, "абсолютный путь"));
    }
    // Segments are checked untrimmed: on Windows "mod.jar " and "mod.jar" resolve
    // to the same file, so a trailing space is a known bypass.
    let mut out = base.to_path_buf();
    let mut depth = 0usize;
    for seg in cleaned.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err(reject(rel, "выход вверх по дереву"));
        }
        segment_ok(seg, rel)?;
        out.push(seg);
        depth += 1;
    }
    if depth == 0 {
        return Err(reject(rel, "пустой путь"));
    }
    ensure_inside(base, &out, rel)?;
    Ok(out)
}

/// Same as safe_join for a single file name: separators are rejected outright.
pub(crate) fn safe_child(base: &Path, name: &str) -> Result<PathBuf, String> {
    if name.contains('/') || name.contains('\\') {
        return Err(reject(name, "имя файла не может содержать путь"));
    }
    safe_join(base, name)
}

pub(crate) fn safe_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(reject(name, "пустое имя файла"));
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err(reject(name, "имя файла не может содержать путь"));
    }
    segment_ok(trimmed, name)?;
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PathBuf {
        std::env::temp_dir().join("millida-safepath-test")
    }

    #[test]
    fn allows_plain_relative_paths() {
        let b = base();
        assert_eq!(safe_join(&b, "mods/sodium.jar").unwrap(), b.join("mods").join("sodium.jar"));
        assert_eq!(safe_join(&b, "./config/a.toml").unwrap(), b.join("config").join("a.toml"));
    }

    #[test]
    fn rejects_traversal() {
        let b = base();
        assert!(safe_join(&b, "../evil.jar").is_err());
        assert!(safe_join(&b, "mods/../../evil.jar").is_err());
        assert!(safe_join(&b, "mods/..").is_err());
    }

    #[test]
    fn rejects_absolute_and_drives() {
        let b = base();
        assert!(safe_join(&b, "/etc/passwd").is_err());
        assert!(safe_join(&b, "C:/Windows/System32/x.dll").is_err());
        assert!(safe_join(&b, r"C:\Windows\System32\x.dll").is_err());
        assert!(safe_join(&b, r"\\server\share\x.dll").is_err());
        assert!(safe_join(&b, r"\Users\Public\x.dll").is_err());
        assert!(safe_join(&b, r"\\?\C:\Windows\System32\x.dll").is_err());
        assert!(safe_join(&b, r"\\.\PhysicalDrive0").is_err());
        assert!(safe_join(&b, "mods/C:/x.jar").is_err());
    }

    #[test]
    fn rejects_windows_traps() {
        let b = base();
        assert!(safe_join(&b, "nul.jar").is_err());
        assert!(safe_join(&b, "COM1").is_err());
        assert!(safe_join(&b, "mod.jar.").is_err());
        assert!(safe_join(&b, "mod.jar ").is_err());
        assert!(safe_join(&b, "mod.jar:stream").is_err());
    }

    #[test]
    fn rejects_empty() {
        let b = base();
        assert!(safe_join(&b, "").is_err());
        assert!(safe_join(&b, "   ").is_err());
        assert!(safe_join(&b, ".").is_err());
        assert!(safe_join(&b, "././").is_err());
    }

    #[test]
    fn child_rejects_separators() {
        let b = base();
        assert!(safe_child(&b, "logs/latest.log").is_err());
        assert!(safe_child(&b, r"..\latest.log").is_err());
        assert!(safe_child(&b, "..").is_err());
        assert!(safe_child(&b, "latest.log").is_ok());
    }

    #[test]
    fn file_name_is_validated() {
        assert_eq!(safe_file_name(" sodium.jar ").unwrap(), "sodium.jar");
        assert!(safe_file_name("../sodium.jar").is_err());
        assert!(safe_file_name("nul").is_err());
        assert!(safe_file_name("").is_err());
    }

    #[test]
    fn stays_inside_when_target_exists() {
        let b = base();
        std::fs::create_dir_all(b.join("mods")).ok();
        assert!(safe_join(&b, "mods/ok.jar").is_ok());
    }

    #[test]
    fn works_when_base_does_not_exist_yet() {
        let b = base().join("profiles").join("не-создан");
        assert_eq!(safe_join(&b, "mods/ok.jar").unwrap(), b.join("mods").join("ok.jar"));
        assert!(safe_join(&b, "../evil.jar").is_err());
    }
}
