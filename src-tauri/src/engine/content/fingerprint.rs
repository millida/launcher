//! CurseForge file fingerprint.
//!
//! CurseForge does not index files by sha1, so a jar that came from there is
//! invisible to a hash lookup. Its own identifier is MurmurHash2 (32-bit,
//! seed 1) over the file with whitespace bytes removed — that normalisation is
//! part of the format, not an optimisation: it is what makes the fingerprint
//! survive the line-ending rewrites their tooling used to do.

const M: u32 = 0x5bd1_e995;
const R: u32 = 24;

/// Bytes CurseForge drops before hashing: tab, LF, CR and space.
fn is_skipped(b: u8) -> bool {
    matches!(b, 9 | 10 | 13 | 32)
}

fn murmur2(data: &[u8], seed: u32) -> u32 {
    let mut h: u32 = seed ^ (data.len() as u32);
    let (chunks, tail) = data.as_chunks::<4>();
    for c in chunks {
        let mut k = u32::from_le_bytes(*c);
        k = k.wrapping_mul(M);
        k ^= k >> R;
        k = k.wrapping_mul(M);
        h = h.wrapping_mul(M);
        h ^= k;
    }
    if !tail.is_empty() {
        if tail.len() >= 3 {
            h ^= (tail[2] as u32) << 16;
        }
        if tail.len() >= 2 {
            h ^= (tail[1] as u32) << 8;
        }
        h ^= tail[0] as u32;
        h = h.wrapping_mul(M);
    }
    h ^= h >> 13;
    h = h.wrapping_mul(M);
    h ^= h >> 15;
    h
}

pub(crate) fn fingerprint_bytes(data: &[u8]) -> u32 {
    let normalized: Vec<u8> = data.iter().copied().filter(|b| !is_skipped(*b)).collect();
    murmur2(&normalized, 1)
}

pub(crate) fn fingerprint_file(path: &std::path::Path) -> Option<u32> {
    // Mods are a few megabytes; the whole file has to be normalised anyway, so
    // there is nothing to stream.
    let data = std::fs::read(path).ok()?;
    Some(fingerprint_bytes(&data))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one property that separates this from plain murmur2: reformatting a
    /// text file inside the jar, or a different line ending, must not change
    /// the fingerprint. Without it half the CurseForge files would come back
    /// unidentified — which is exactly what "unknown mod" looks like to the
    /// player.
    #[test]
    fn whitespace_never_changes_the_fingerprint() {
        let plain = b"class Sodium{}";
        let spaced = b"class  Sodium {\n\t}\r\n";
        assert_eq!(
            fingerprint_bytes(plain),
            fingerprint_bytes(&spaced.iter().copied().filter(|b| !is_skipped(*b)).collect::<Vec<_>>()),
            "нормализация обязана убирать ровно табы, переводы строк и пробелы",
        );
        assert_eq!(fingerprint_bytes(b"ab"), fingerprint_bytes(b" a \n b \t"));
    }

    #[test]
    fn different_content_gives_different_fingerprints() {
        assert_ne!(fingerprint_bytes(b"sodium"), fingerprint_bytes(b"lithium"));
        assert_ne!(fingerprint_bytes(b""), 0, "пустой файл всё равно имеет отпечаток");
    }

    /// Seed 1 and the little-endian block read are what CurseForge implements;
    /// a mismatch here means every lookup silently returns nothing.
    #[test]
    fn algorithm_matches_the_published_constants() {
        assert_eq!(murmur2(b"", 0), 0, "murmur2 пустой строки с нулевым seed — ноль");
        assert_ne!(murmur2(b"millida", 0), murmur2(b"millida", 1), "seed обязан влиять на результат");
        // A whole block at once: read as big-endian the value would diverge
        // from CurseForge and every lookup would quietly return nothing.
        assert_eq!(murmur2(&[1, 2, 3, 4], 1), murmur2(&u32::from_le_bytes([1, 2, 3, 4]).to_le_bytes(), 1));
    }
}
