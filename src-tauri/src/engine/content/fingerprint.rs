// File fingerprint for CurseForge (MurmurHash2). Computed locally, CurseForge uses it to recognize a mod. The file itself is not sent anywhere.
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

/// Whole-slice version: the oracle the streaming one is tested against.
#[cfg(test)]
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

#[cfg(test)]
pub(crate) fn fingerprint_bytes(data: &[u8]) -> u32 {
    let normalized: Vec<u8> = data.iter().copied().filter(|b| !is_skipped(*b)).collect();
    murmur2(&normalized, 1)
}

/// Read buffer of a file pass. A mod can be hundreds of megabytes (a big modpack's jar), the
/// whole file must not sit in memory: peak is this buffer, not the largest mod.
const PASS_BUF: usize = 256 * 1024;

/// MurmurHash2 fed one byte at a time, same result as `murmur2` over the whole slice. The length
/// goes into the seed first, which is why the file is read twice: once to count the bytes that
/// survive the normalisation, once to hash them.
struct Murmur2 {
    h: u32,
    chunk: [u8; 4],
    filled: usize,
}

impl Murmur2 {
    fn new(len: u32, seed: u32) -> Murmur2 {
        Murmur2 { h: seed ^ len, chunk: [0; 4], filled: 0 }
    }

    fn feed(&mut self, byte: u8) {
        self.chunk[self.filled] = byte;
        self.filled += 1;
        if self.filled == 4 {
            let mut k = u32::from_le_bytes(self.chunk);
            k = k.wrapping_mul(M);
            k ^= k >> R;
            k = k.wrapping_mul(M);
            self.h = self.h.wrapping_mul(M);
            self.h ^= k;
            self.filled = 0;
        }
    }

    fn finish(mut self) -> u32 {
        if self.filled > 0 {
            if self.filled >= 3 {
                self.h ^= (self.chunk[2] as u32) << 16;
            }
            if self.filled >= 2 {
                self.h ^= (self.chunk[1] as u32) << 8;
            }
            self.h ^= self.chunk[0] as u32;
            self.h = self.h.wrapping_mul(M);
        }
        self.h ^= self.h >> 13;
        self.h = self.h.wrapping_mul(M);
        self.h ^= self.h >> 15;
        self.h
    }
}

/// Fingerprint of a stream that can be read twice (`open` is called once per pass).
fn fingerprint_passes<R: std::io::Read>(mut open: impl FnMut() -> std::io::Result<R>, buf_len: usize) -> std::io::Result<u32> {
    let mut buf = vec![0u8; buf_len.max(1)];
    let mut kept: u64 = 0;
    let mut r = open()?;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        kept += buf[..n].iter().filter(|b| !is_skipped(**b)).count() as u64;
    }
    let mut state = Murmur2::new(kept as u32, 1);
    let mut r = open()?;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        buf[..n].iter().filter(|b| !is_skipped(**b)).for_each(|b| state.feed(*b));
    }
    Ok(state.finish())
}

pub(crate) fn fingerprint_file(path: &std::path::Path) -> Option<u32> {
    match fingerprint_passes(|| std::fs::File::open(path), PASS_BUF) {
        Ok(print) => Some(print),
        Err(e) => {
            eprintln!("[scan] fingerprint of {} was not computed: {e}", path.display());
            None
        }
    }
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

    /// The two-pass stream must give exactly the value of the one-shot version for any buffer size,
    /// including a buffer that cuts a 4-byte block and a run of whitespace in the middle.
    #[test]
    fn streaming_gives_the_same_fingerprint_as_the_whole_file() {
        let mut data: Vec<u8> = Vec::new();
        let mut x: u32 = 12345;
        for i in 0..5000u32 {
            x = x.wrapping_mul(1664525).wrapping_add(1013904223);
            // A good share of whitespace, and every length remainder modulo 4.
            data.push(if x.is_multiple_of(5) { b' ' } else if x.is_multiple_of(11) { b'\n' } else { (x >> 24) as u8 });
            if i % 97 == 0 {
                data.extend_from_slice(b"\r\n\t");
            }
        }
        for len in [0usize, 1, 2, 3, 4, 5, 6, 7, 1000, 4999, 5000, 5003] {
            let part = &data[..len.min(data.len())];
            let whole = fingerprint_bytes(part);
            for buf in [1usize, 3, 4, 7, 64, 4096, PASS_BUF] {
                let got = fingerprint_passes(|| Ok(std::io::Cursor::new(part)), buf).unwrap();
                assert_eq!(got, whole, "len {len}, буфер {buf}: поток и целый файл разошлись");
            }
        }
    }

    #[test]
    fn an_unreadable_file_has_no_fingerprint_instead_of_a_wrong_one() {
        assert_eq!(fingerprint_file(std::path::Path::new("/definitely/not/here.jar")), None);
    }
}
