// Formats of identifiers that arrive from outside the core (the webview, share
// codes, API answers, pack indexes) and end up in paths, URLs or a command line.
// A value that does not match is refused, never "cleaned": a cleaned value can
// collide with another folder, a refused one cannot do anything.

use sha2::{Digest, Sha256};

/// Modrinth project address: a slug `^[a-z0-9_-]{1,64}$`, or a base62 project
/// id (`^[A-Za-z0-9]{8}$`), which the catalogue sometimes passes instead.
pub(crate) fn modpack_slug_ok(slug: &str) -> bool {
    let is_slug = (1..=64).contains(&slug.len())
        && slug.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-');
    let is_id = slug.len() == 8 && slug.bytes().all(|c| c.is_ascii_alphanumeric());
    is_slug || is_id
}

pub(crate) fn check_modpack_slug(slug: &str) -> Result<(), String> {
    if modpack_slug_ok(slug) {
        Ok(())
    } else {
        Err("Некорректный адрес сборки".into())
    }
}

/// Millida catalogue pack slug: `^[a-z0-9-]{1,80}$`. It names a keep folder
/// and a pack-launch descriptor on disk, and arrives from `millida://` links.
pub(crate) fn catalog_slug_ok(slug: &str) -> bool {
    (1..=80).contains(&slug.len()) && slug.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}

/// Modrinth version id: alphanumeric, 1..=64.
pub(crate) fn modrinth_id_ok(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_alphanumeric())
}

/// Minecraft version id / loader build: `^[A-Za-z0-9._+-]{1,64}$` without `..`
/// and not starting with a dot or a dash. Covers "1.20.1", "24w14a",
/// "1.20.1-forge-47.2.0", "fabric-loader-0.15.11-1.20.1", "1.7.10-10.13.4.1614-1.7.10".
pub(crate) fn version_id_ok(v: &str) -> bool {
    (1..=64).contains(&v.len())
        && v.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'+' | b'-'))
        && !v.contains("..")
        && !v.starts_with('.')
        && !v.starts_with('-')
}

pub(crate) fn check_version_id(v: &str) -> Result<(), String> {
    if version_id_ok(v) {
        Ok(())
    } else {
        Err(format!("Некорректная версия игры «{}»", v.chars().take(64).collect::<String>()))
    }
}

pub(crate) fn check_loader_version(v: &str) -> Result<(), String> {
    if version_id_ok(v) {
        Ok(())
    } else {
        Err(format!("Некорректная версия загрузчика «{}»", v.chars().take(64).collect::<String>()))
    }
}

/// Minecraft player name: `^[A-Za-z0-9_]{1,16}$`.
pub(crate) fn player_name_ok(n: &str) -> bool {
    (1..=16).contains(&n.len()) && n.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}

/// The nick the game is started with. A valid Minecraft name passes as is;
/// anything else (a site display name in Cyrillic, a value from a tampered
/// webview) is reduced to the allowed characters instead of failing the launch
/// — the point is that it never reaches the command line as something else.
pub(crate) fn launch_nick(n: &str) -> String {
    if player_name_ok(n) {
        return n.to_string();
    }
    let kept: String = n.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(16).collect();
    if kept.is_empty() { "Player".into() } else { kept }
}

/// Free text that goes onto the game's command line (world name, server
/// address): no control characters, bounded length.
pub(crate) fn cmdline_text_ok(s: &str, max: usize) -> bool {
    !s.is_empty() && s.chars().count() <= max && !s.chars().any(|c| c.is_control())
}

/// One line of a Java `@argfile`. Every argument is quoted: unquoted, a space
/// splits it in two and a leading `#` turns the rest of the line into a
/// comment, so a nickname or a path with a space would inject arguments.
/// Backslashes become `/` (Java reads `\` as an escape; Windows accepts `/`),
/// a quote is escaped, and control characters, which would end the line, are
/// dropped.
pub(crate) fn argfile_line(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len() + 3);
    out.push('"');
    for c in arg.chars() {
        match c {
            '\\' => out.push('/'),
            '"' => out.push_str("\\\""),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out.push('\n');
    out
}

/// Short stable name for temp files derived from untrusted parts.
pub(crate) fn hashed_name(parts: &[&str]) -> String {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p.as_bytes());
        h.update([0u8]);
    }
    let d = h.finalize();
    d.iter().take(12).map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modpack_slug_format() {
        for good in ["fabulously-optimized", "sodium", "a_b", "abc123", "AANobbMI"] {
            assert!(modpack_slug_ok(good), "{good}");
        }
        for bad in ["", "..", "../x", "a/b", "a\\b", "A", "Fabulous-Pack", "a b", "a.b", &"x".repeat(65), "C:"] {
            assert!(!modpack_slug_ok(bad), "{bad}");
        }
    }

    #[test]
    fn version_id_format() {
        for good in ["1.20.1", "24w14a", "1.20.1-forge-47.2.0", "fabric-loader-0.15.11-1.20.1", "1.7.10-10.13.4.1614-1.7.10", "0.15.11+build.1", "b1.7.3", "rd-132211"] {
            assert!(version_id_ok(good), "{good}");
        }
        for bad in ["", "..", "../../x", "1.20/../x", "a/b", "a\\b", ".hidden", "-x", "1..2", "C:x", "a b", &"1".repeat(65)] {
            assert!(!version_id_ok(bad), "{bad}");
        }
    }

    #[test]
    fn player_name_format() {
        assert!(player_name_ok("Steve_01"));
        for bad in ["", "a b", "a\"b", "-x", "ник", &"a".repeat(17), "a\nb"] {
            assert!(!player_name_ok(bad), "{bad}");
        }
    }

    #[test]
    fn launch_nick_never_carries_foreign_characters() {
        assert_eq!(launch_nick("Steve_01"), "Steve_01");
        assert_eq!(launch_nick("Ник"), "Player");
        assert_eq!(launch_nick("a b\n--server evil"), "abserverevil");
        assert_eq!(launch_nick(&"a".repeat(30)), "a".repeat(16));
    }

    #[test]
    fn cmdline_text() {
        assert!(cmdline_text_ok("Мой мир 2", 128));
        assert!(!cmdline_text_ok("a\nb", 128));
        assert!(!cmdline_text_ok("", 128));
        assert!(!cmdline_text_ok("a\u{0}", 128));
    }

    #[test]
    fn argfile_lines_are_quoted_and_escaped() {
        assert_eq!(argfile_line("-Xmx4G"), "\"-Xmx4G\"\n");
        assert_eq!(argfile_line("C:\\Users\\A B\\x.jar"), "\"C:/Users/A B/x.jar\"\n");
        assert_eq!(argfile_line("a\"b"), "\"a\\\"b\"\n");
        assert_eq!(argfile_line("nick\n-javaagent:x"), "\"nick-javaagent:x\"\n");
        assert_eq!(argfile_line("#x").lines().count(), 1);
    }

    #[test]
    fn hashed_name_is_stable_and_separated() {
        assert_eq!(hashed_name(&["a", "b"]), hashed_name(&["a", "b"]));
        assert_ne!(hashed_name(&["ab", ""]), hashed_name(&["a", "b"]));
        assert_eq!(hashed_name(&["../x"]).len(), 24);
    }
}
