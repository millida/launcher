// Windows: turns paths with characters outside the system code page into short 8.3 names, so java does not fail on Cyrillic in the user name.
// It only reads file names through a system call and changes nothing.
//! java.exe on Windows reads its own location and its arguments through ANSI
//! APIs. A character outside the system code page (a Greek or CJK user name on
//! a cp1251 system) turns into `?`, and the JVM dies with «could not find
//! java.dll» before main, or cannot open a single jar. The 8.3 short name of
//! the same folder is plain ASCII and is accepted everywhere.

use super::pack_launch::{ansi_codepage, codepage_encoding};
use std::path::{Path, PathBuf};

fn fits_code_page(s: &str, codepage: Option<u32>) -> bool {
    let Some(enc) = codepage.and_then(codepage_encoding) else { return true };
    enc == encoding_rs::UTF_8 || !enc.encode(s).2
}

#[cfg(windows)]
fn short_path(p: &Path) -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut buf = vec![0u16; 512];
    loop {
        // SAFETY: `wide` is NUL-terminated and outlives the call; the buffer
        // length is passed together with the slice.
        // Windows system call: the short (8.3) name of a path, so java can read Cyrillic in the path.
        let n = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buf)) } as usize;
        if n == 0 {
            return None;
        }
        if n < buf.len() {
            buf.truncate(n);
            return Some(PathBuf::from(OsString::from_wide(&buf)));
        }
        buf.resize(n, 0);
    }
}

#[cfg(not(windows))]
fn short_path(_p: &Path) -> Option<PathBuf> {
    None
}

fn safe_path_in(p: &Path, codepage: Option<u32>) -> PathBuf {
    if fits_code_page(&p.to_string_lossy(), codepage) {
        return p.to_path_buf();
    }
    // Readable tail names stay long: Discord tells the game by the name
    // MillidaLauncher.exe, and MILLID~1.EXE would lose the label.
    if let (Some(parent), Some(name)) = (p.parent(), p.file_name()) {
        if fits_code_page(&name.to_string_lossy(), codepage) {
            let safe_parent = safe_path_in(parent, codepage);
            if fits_code_page(&safe_parent.to_string_lossy(), codepage) {
                return safe_parent.join(name);
            }
        }
    }
    short_path(p)
        .filter(|s| fits_code_page(&s.to_string_lossy(), codepage))
        .unwrap_or_else(|| p.to_path_buf())
}

/// The same file under a name java.exe can read back; unchanged when the path
/// already fits the code page or the volume keeps no short names.
pub(crate) fn ansi_safe_path(p: &Path) -> PathBuf {
    safe_path_in(p, ansi_codepage())
}

fn substitutions(roots: &[PathBuf], codepage: Option<u32>) -> Vec<(String, String)> {
    let mut roots: Vec<&PathBuf> = roots.iter().collect();
    // A build folder lies inside the game root: the longer prefix has to go
    // first, or its own unreadable tail would be left behind.
    roots.sort_by_key(|r| std::cmp::Reverse(r.as_os_str().len()));
    let mut out = vec![];
    for root in roots {
        let safe = safe_path_in(root, codepage);
        if safe == *root {
            continue;
        }
        let long = root.to_string_lossy().to_string();
        let short = safe.to_string_lossy().to_string();
        out.push((long.replace('\\', "/"), short.replace('\\', "/")));
        out.push((long, short));
    }
    out
}

fn rewrite_args(args: &mut [String], subs: &[(String, String)]) {
    for a in args.iter_mut() {
        for (long, short) in subs {
            if a.contains(long.as_str()) {
                *a = a.replace(long.as_str(), short);
            }
        }
    }
}

/// Rewrites every argument that points under one of `roots` to the short form
/// of that root, so classpath, natives and the game folder stay readable.
pub(crate) fn ansi_safe_args(args: &mut [String], roots: &[PathBuf]) {
    rewrite_args(args, &substitutions(roots, ansi_codepage()));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_page_verdicts() {
        let cases: [(&str, Option<u32>, bool, &str); 6] = [
            ("C:/Users/Ivan", Some(1251), true, "ASCII fits every code page"),
            ("C:/Users/Рустам", Some(1251), true, "Cyrillic is native to cp1251, the argfile already handles it"),
            ("C:/Users/Ωmega", Some(1251), false, "Greek is not in cp1251: java.exe sees `?mega`"),
            ("C:/Users/李", Some(1252), false, "CJK is not in cp1252"),
            ("C:/Users/李", Some(65001), true, "a UTF-8 system reads everything"),
            ("C:/Users/李", None, true, "no code page outside Windows, nothing to fix"),
        ];
        for (s, cp, want, why) in cases {
            assert_eq!(fits_code_page(s, cp), want, "{s} on {cp:?}: {why}");
        }
    }

    #[test]
    fn longer_root_is_replaced_first_and_both_slash_styles_are_covered() {
        let subs = vec![
            ("C:/U/Ω/mc/profiles/李".to_string(), "C:/U/OM~1/mc/profiles/F3B6~1".to_string()),
            ("C:\\U\\Ω\\mc\\profiles\\李".to_string(), "C:\\U\\OM~1\\mc\\profiles\\F3B6~1".to_string()),
            ("C:/U/Ω/mc".to_string(), "C:/U/OM~1/mc".to_string()),
            ("C:\\U\\Ω\\mc".to_string(), "C:\\U\\OM~1\\mc".to_string()),
        ];
        let mut args = vec![
            "--gameDir".to_string(),
            "C:\\U\\Ω\\mc\\profiles\\李".to_string(),
            "-cp".to_string(),
            "C:/U/Ω/mc/libraries/a.jar;C:\\U\\Ω\\mc\\libraries\\b.jar".to_string(),
            "--username".to_string(),
            "Ω_player".to_string(),
        ];
        rewrite_args(&mut args, &subs);
        assert_eq!(args[1], "C:\\U\\OM~1\\mc\\profiles\\F3B6~1", "the build folder must lose its own unreadable tail too");
        assert_eq!(args[3], "C:/U/OM~1/mc/libraries/a.jar;C:\\U\\OM~1\\mc\\libraries\\b.jar", "every classpath entry, whatever the slash");
        assert_eq!(args[5], "Ω_player", "only paths under a root change, never the nick");
    }

    #[cfg(windows)]
    #[test]
    fn real_folder_outside_the_code_page_gets_an_ascii_name() {
        let dir = std::env::temp_dir().join("millida-ansi-test").join("Ωmega").join("bin");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("MillidaLauncher.exe");
        std::fs::write(&exe, b"x").unwrap();
        let safe = safe_path_in(&exe, Some(1251));
        if safe == exe {
            eprintln!("short names are disabled on this volume, nothing to check");
            return;
        }
        assert!(fits_code_page(&safe.to_string_lossy(), Some(1251)), "java.exe would still see `?`: {}", safe.display());
        assert!(safe.is_file(), "the short name must lead to the same file");
        assert!(safe.ends_with("bin/MillidaLauncher.exe"), "readable tail names stay long for Discord: {}", safe.display());
        let _ = std::fs::remove_dir_all(std::env::temp_dir().join("millida-ansi-test"));
    }
}
