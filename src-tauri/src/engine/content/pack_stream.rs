// Zip entries written to disk while their bytes are still arriving: the body of one ranged download goes through the
// state machine below, and every file of the range is inflated, hashed and checked on the way. No second pass over the
// archive, no span file, no separate unzip: the file is whole and verified the moment its last byte comes in.
// Pure: no network and no app state, so the whole thing is tested against archives built in memory.
use flate2::Crc;
use sha1::Digest as _;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

pub(crate) const LOCAL_HEADER_LEN: usize = 30;
const LOCAL_SIGNATURE: u32 = 0x04034b50;
const FLAG_ENCRYPTED: u16 = 0x0001;
const FLAG_STRONG_ENCRYPTION: u16 = 0x0040;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATED: u16 = 8;
/// Small files are the bulk of a pack by count: one write per chunk of the body would be one system call each.
const WRITE_BUFFER: usize = 256 * 1024;
/// A file under construction is never called by its real name: a launcher closed halfway through leaves a `.millida-part`,
/// not a mod that looks installed and is cut off.
pub(crate) const PART_SUFFIX: &str = ".millida-part";

/// One entry of the archive as the index describes it, plus where it must land and what to compute for it.
#[derive(Clone, Debug)]
pub(crate) struct Spec {
    pub(crate) rel: String,
    pub(crate) raw_name: String,
    pub(crate) method: u16,
    pub(crate) crc: u32,
    pub(crate) size: u64,
    pub(crate) csize: u64,
    pub(crate) offset: u64,
    pub(crate) end: u64,
    /// The hash the server recorded when the pack was uploaded. A file that does not hash to it is not written.
    pub(crate) sha256: Option<[u8; 32]>,
    /// The shared store names files by SHA-1: computed for the files that may join it.
    pub(crate) want_sha1: bool,
    pub(crate) dest: PathBuf,
}

#[derive(Debug)]
pub(crate) struct Finished {
    pub(crate) member: usize,
    pub(crate) sha1: Option<String>,
}

#[derive(Debug)]
pub(crate) enum Failure {
    /// The bytes are wrong: another header, a different name, a hash that does not match. Retrying the same
    /// range would bring the same bytes.
    Data(String),
    /// The disk refused: full, locked, no rights.
    Io(String),
}

impl Failure {
    #[cfg(test)]
    pub(crate) fn text(&self) -> &str {
        match self {
            Failure::Data(s) | Failure::Io(s) => s,
        }
    }
}

fn read_u16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

fn read_u32(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

fn part_of(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(PART_SUFFIX);
    dest.with_file_name(name)
}

/// The writer an entry's bytes end up in. It counts, hashes and refuses more than the index declared.
struct Sink {
    file: Option<BufWriter<std::fs::File>>,
    part: PathBuf,
    crc: Crc,
    sha1: Option<sha1::Sha1>,
    sha256: Option<sha2::Sha256>,
    written: u64,
    limit: u64,
    committed: bool,
}

impl Sink {
    fn create(spec: &Spec) -> Result<Sink, Failure> {
        let part = part_of(&spec.dest);
        if let Some(dir) = spec.dest.parent() {
            crate::engine::retry_locked(|| std::fs::create_dir_all(dir)).map_err(|e| io_fail(dir, &e))?;
        }
        let _ = std::fs::remove_file(&part);
        let file = crate::engine::retry_locked(|| std::fs::File::create(&part)).map_err(|e| io_fail(&part, &e))?;
        Ok(Sink {
            file: Some(BufWriter::with_capacity(WRITE_BUFFER, file)),
            part,
            crc: Crc::new(),
            sha1: spec.want_sha1.then(sha1::Sha1::new),
            sha256: spec.sha256.map(|_| sha2::Sha256::new()),
            written: 0,
            limit: spec.size,
            committed: false,
        })
    }

    /// The entry is complete: sizes and hashes are compared with the index, the file takes its real name.
    fn commit(mut self, spec: &Spec) -> Result<Option<String>, Failure> {
        let bad = |why: &str| Failure::Data(format!("entry '{}': {}", spec.rel, why));
        if self.written != spec.size {
            return Err(bad("size mismatch"));
        }
        if self.crc.sum() != spec.crc {
            return Err(bad("CRC mismatch"));
        }
        if let (Some(h), Some(want)) = (self.sha256.take(), spec.sha256) {
            let got: [u8; 32] = h.finalize().into();
            if got != want {
                return Err(bad("SHA-256 differs from the one recorded at upload"));
            }
        }
        let mut file = self.file.take().ok_or_else(|| bad("file already closed"))?;
        file.flush().map_err(|e| io_fail(&self.part, &e))?;
        drop(file);
        crate::engine::retry_locked(|| std::fs::rename(&self.part, &spec.dest)).map_err(|e| io_fail(&spec.dest, &e))?;
        self.committed = true;
        Ok(self.sha1.take().map(|h| hex(&h.finalize())))
    }
}

impl Write for Sink {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        if self.written + b.len() as u64 > self.limit {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "inflates past its declared size"));
        }
        let Some(file) = self.file.as_mut() else {
            return Err(io::Error::other("file already closed"));
        };
        file.write_all(b)?;
        self.crc.update(b);
        if let Some(h) = self.sha1.as_mut() {
            h.update(b);
        }
        if let Some(h) = self.sha256.as_mut() {
            h.update(b);
        }
        self.written += b.len() as u64;
        Ok(b.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        match self.file.as_mut() {
            Some(f) => f.flush(),
            None => Ok(()),
        }
    }
}

impl Drop for Sink {
    fn drop(&mut self) {
        if !self.committed {
            self.file = None;
            let _ = std::fs::remove_file(&self.part);
        }
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn io_fail(path: &Path, e: &io::Error) -> Failure {
    Failure::Io(crate::engine::io_fail("Установка", path, e))
}

/// An error that came out of the decoder's write: the disk (an operating-system code) or the data (anything else).
fn classify(spec: &Spec, e: io::Error, part: &Path) -> Failure {
    if e.raw_os_error().is_some() {
        return io_fail(part, &e);
    }
    Failure::Data(format!("entry '{}': data does not inflate ({})", spec.rel, e))
}

enum Out {
    Stored(Sink),
    Deflated(flate2::write::DeflateDecoder<Sink>),
}

enum State {
    Gap,
    Header { buf: Vec<u8>, need: usize, parsed: bool },
    Data { out: Box<Out>, left: u64 },
    Poisoned,
}

/// Feeds on the body of a range request. `members` are the entries expected in it, in archive order; bytes before
/// the first one and between two of them (entries the plan did not ask for) are skipped.
pub(crate) struct Extractor<F: FnMut(Finished)> {
    members: Vec<Spec>,
    cur: usize,
    pos: u64,
    settled: u64,
    st: State,
    done: F,
}

impl<F: FnMut(Finished)> Extractor<F> {
    /// `from` is the archive offset of the first byte that will be fed.
    pub(crate) fn new(members: Vec<Spec>, from: u64, done: F) -> Self {
        Extractor { members, cur: 0, pos: from, settled: from, st: State::Gap, done }
    }

    pub(crate) fn complete(&self) -> bool {
        self.cur >= self.members.len()
    }

    /// Archive offset up to which every byte belongs to a finished entry. Bytes received past it are lost by a cut
    /// connection and will come again.
    pub(crate) fn settled_to(&self) -> u64 {
        self.settled
    }

    pub(crate) fn feed(&mut self, mut data: &[u8]) -> Result<(), Failure> {
        while !data.is_empty() {
            if self.cur >= self.members.len() {
                self.pos += data.len() as u64;
                return Ok(());
            }
            match std::mem::replace(&mut self.st, State::Poisoned) {
                State::Poisoned => return Err(Failure::Data("stream already stopped after an error".into())),
                State::Gap => {
                    let target = self.members[self.cur].offset;
                    if self.pos > target {
                        return Err(Failure::Data(format!("entry '{}' starts before the previous one ends", self.members[self.cur].rel)));
                    }
                    let skip = (target - self.pos).min(data.len() as u64) as usize;
                    data = &data[skip..];
                    self.pos += skip as u64;
                    self.st = if self.pos == target {
                        State::Header { buf: Vec::with_capacity(96), need: LOCAL_HEADER_LEN, parsed: false }
                    } else {
                        State::Gap
                    };
                }
                State::Header { mut buf, mut need, mut parsed } => {
                    let take = (need - buf.len()).min(data.len());
                    buf.extend_from_slice(&data[..take]);
                    data = &data[take..];
                    self.pos += take as u64;
                    if !parsed && buf.len() == LOCAL_HEADER_LEN {
                        need = self.header_len(&buf)?;
                        parsed = true;
                    }
                    if parsed && buf.len() == need {
                        let out = self.open(&buf)?;
                        if self.members[self.cur].csize == 0 {
                            self.finish_member(out)?;
                        } else {
                            let left = self.members[self.cur].csize;
                            self.st = State::Data { out: Box::new(out), left };
                        }
                    } else {
                        self.st = State::Header { buf, need, parsed };
                    }
                }
                State::Data { mut out, mut left } => {
                    let take = left.min(data.len() as u64) as usize;
                    let spec = &self.members[self.cur];
                    let part = part_of(&spec.dest);
                    match &mut *out {
                        Out::Stored(sink) => sink.write_all(&data[..take]).map_err(|e| classify(spec, e, &part))?,
                        Out::Deflated(dec) => dec.write_all(&data[..take]).map_err(|e| classify(spec, e, &part))?,
                    }
                    data = &data[take..];
                    self.pos += take as u64;
                    left -= take as u64;
                    if left == 0 {
                        self.finish_member(*out)?;
                    } else {
                        self.st = State::Data { out, left };
                    }
                }
            }
        }
        Ok(())
    }

    /// The local header must agree with the index on everything the index promises; nothing else of it is trusted.
    fn header_len(&self, head: &[u8]) -> Result<usize, Failure> {
        let e = &self.members[self.cur];
        let bad = |why: &str| Failure::Data(format!("entry '{}': {}", e.rel, why));
        if read_u32(head, 0) != LOCAL_SIGNATURE {
            return Err(bad("no local header at the indexed offset"));
        }
        if read_u16(head, 6) & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION) != 0 {
            return Err(bad("entry is encrypted"));
        }
        if read_u16(head, 8) != e.method {
            return Err(bad("compression method differs from the index"));
        }
        let (name_len, extra_len) = (read_u16(head, 26) as usize, read_u16(head, 28) as usize);
        if name_len != e.raw_name.len() {
            return Err(bad("name in the header differs from the index"));
        }
        let total = LOCAL_HEADER_LEN + name_len + extra_len;
        if total as u64 + e.csize > e.end - e.offset {
            return Err(bad("data runs past the entry"));
        }
        Ok(total)
    }

    fn open(&self, head: &[u8]) -> Result<Out, Failure> {
        let e = &self.members[self.cur];
        let name_len = read_u16(head, 26) as usize;
        if &head[LOCAL_HEADER_LEN..LOCAL_HEADER_LEN + name_len] != e.raw_name.as_bytes() {
            return Err(Failure::Data(format!("entry '{}': name in the header differs from the index", e.rel)));
        }
        match e.method {
            METHOD_STORED if e.csize == e.size => Ok(Out::Stored(Sink::create(e)?)),
            METHOD_STORED => Err(Failure::Data(format!("entry '{}': stored entry sizes differ", e.rel))),
            METHOD_DEFLATED => Ok(Out::Deflated(flate2::write::DeflateDecoder::new(Sink::create(e)?))),
            _ => Err(Failure::Data(format!("entry '{}': compression method not supported", e.rel))),
        }
    }

    fn finish_member(&mut self, out: Out) -> Result<(), Failure> {
        let spec = &self.members[self.cur];
        let sink = match out {
            Out::Stored(s) => s,
            Out::Deflated(d) => d.finish().map_err(|e| classify(spec, e, &part_of(&spec.dest)))?,
        };
        let sha1 = sink.commit(spec)?;
        (self.done)(Finished { member: self.cur, sha1 });
        self.cur += 1;
        self.settled = self.pos;
        self.st = State::Gap;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::Cursor;
    use std::rc::Rc;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("millida-pack-stream-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn zip_of(files: &[(&str, Vec<u8>, zip::CompressionMethod)]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body, method) in files {
            let opts = zip::write::SimpleFileOptions::default().compression_method(*method);
            z.start_file(*name, opts).unwrap();
            z.write_all(body).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    /// The rows the API builds from the archive's central directory, with a hash per file as the index carries them.
    fn specs_of(bytes: &[u8], into: &Path, with_sha256: bool) -> Vec<Spec> {
        let eocd = bytes.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        let directory = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap()) as u64;
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        let mut rows = Vec::new();
        for i in 0..zip.len() {
            let (name, crc, size, csize, offset, method) = {
                let f = zip.by_index_raw(i).unwrap();
                let method = if f.compression() == zip::CompressionMethod::Stored { 0 } else { 8 };
                (f.name().to_string(), f.crc32(), f.size(), f.compressed_size(), f.header_start(), method)
            };
            let body = {
                let mut f = zip.by_index(i).unwrap();
                let mut v = Vec::new();
                io::Read::read_to_end(&mut f, &mut v).unwrap();
                v
            };
            let sha256 = with_sha256.then(|| sha2::Sha256::digest(&body).into());
            rows.push(Spec {
                dest: into.join(&name),
                rel: name.clone(),
                raw_name: name,
                method,
                crc,
                size,
                csize,
                offset,
                end: 0,
                sha256,
                want_sha1: true,
            });
        }
        rows.sort_by_key(|r| r.offset);
        for i in 0..rows.len() {
            rows[i].end = rows.get(i + 1).map_or(directory, |n| n.offset);
        }
        rows
    }

    fn sample() -> Vec<(&'static str, Vec<u8>, zip::CompressionMethod)> {
        let text = b"max_players=12\n".repeat(900);
        let jar: Vec<u8> = (0..70_000u32).map(|i| (i * 31 % 251) as u8).collect();
        vec![
            ("config/a.cfg", text, zip::CompressionMethod::Deflated),
            ("mods/sodium.jar", jar, zip::CompressionMethod::Stored),
            ("empty.txt", Vec::new(), zip::CompressionMethod::Stored),
            ("kubejs/empty-deflated.js", Vec::new(), zip::CompressionMethod::Deflated),
            ("resourcepacks/pack.zip", vec![9u8; 300_000], zip::CompressionMethod::Deflated),
        ]
    }

    fn run(bytes: &[u8], from: u64, to: u64, members: Vec<Spec>, chunk: usize) -> (Result<(), Failure>, Vec<Finished>, u64) {
        let finished = Rc::new(RefCell::new(Vec::new()));
        let sink = finished.clone();
        let mut ex = Extractor::new(members, from, move |f| sink.borrow_mut().push(f));
        let mut res = Ok(());
        for part in bytes[from as usize..to as usize].chunks(chunk) {
            res = ex.feed(part);
            if res.is_err() {
                break;
            }
        }
        let settled = ex.settled_to();
        drop(ex);
        let out = Rc::try_unwrap(finished).unwrap().into_inner();
        (res, out, settled)
    }

    /// archive bytes in chunks of any size -> every file, byte for byte, with its SHA-1 for the store. The chunk
    /// sizes cover a header cut in the middle (1, 7), a typical body read and one larger than the archive.
    #[test]
    fn every_entry_lands_whole_whatever_the_chunking() {
        let files = sample();
        let bytes = zip_of(&files);
        for chunk in [1usize, 7, 4096, 64 * 1024, 10 << 20] {
            let dir = scratch(&format!("whole-{chunk}"));
            let specs = specs_of(&bytes, &dir, true);
            let n = specs.len();
            let (res, done, _) = run(&bytes, 0, bytes.len() as u64, specs, chunk);
            res.unwrap_or_else(|e| panic!("chunk {chunk}: {}", e.text()));
            assert_eq!(done.len(), n, "chunk {chunk}: not every entry reported");
            for (name, body, _) in &files {
                assert_eq!(&std::fs::read(dir.join(name)).unwrap(), body, "chunk {chunk}: «{name}» differs");
            }
            let jar = done.iter().find_map(|f| f.sha1.clone()).unwrap();
            assert_eq!(jar.len(), 40);
            let leftovers: Vec<_> = walk(&dir).into_iter().filter(|p| p.to_string_lossy().ends_with(PART_SUFFIX)).collect();
            assert!(leftovers.is_empty(), "chunk {chunk}: unfinished files left behind: {leftovers:?}");
        }
    }

    fn walk(dir: &Path) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            if e.path().is_dir() {
                out.extend(walk(&e.path()));
            } else {
                out.push(e.path());
            }
        }
        out
    }

    /// a range that starts and ends inside the archive, with an entry nobody asked for in the middle -> only the
    /// asked ones are written, the gap is skipped.
    #[test]
    fn a_range_with_a_gap_writes_only_the_asked_entries() {
        let files = sample();
        let bytes = zip_of(&files);
        let dir = scratch("gap");
        let all = specs_of(&bytes, &dir, true);
        let asked = vec![all[0].clone(), all[2].clone(), all[4].clone()];
        let (from, to) = (asked[0].offset, asked[2].end);
        let (res, done, _) = run(&bytes, from, to, asked, 5000);
        res.unwrap_or_else(|e| panic!("{}", e.text()));
        assert_eq!(done.len(), 3);
        assert!(dir.join("config/a.cfg").exists() && dir.join("empty.txt").exists());
        assert!(!dir.join("mods/sodium.jar").exists(), "the gap entry must not be written");
    }

    /// a connection cut in the middle of the second entry -> the first stays whole, the second leaves no file,
    /// and `settled_to` says where to ask again.
    #[test]
    fn a_cut_range_keeps_the_finished_entries_and_names_the_restart_point() {
        let files = sample();
        let bytes = zip_of(&files);
        let dir = scratch("cut");
        let specs = specs_of(&bytes, &dir, true);
        let cut = specs[1].offset + 40_000;
        let (res, done, settled) = run(&bytes, 0, cut, specs.clone(), 3000);
        res.unwrap();
        assert_eq!(done.len(), 1, "only the first entry was complete");
        assert_eq!(settled, specs[0].end, "restart at the first byte of the unfinished entry");
        assert!(dir.join("config/a.cfg").exists());
        assert!(!dir.join("mods/sodium.jar").exists() && !dir.join(format!("mods/sodium.jar{PART_SUFFIX}")).exists(), "no half file after the stream is dropped");

        let rest: Vec<Spec> = specs[1..].to_vec();
        let (res, done, _) = run(&bytes, settled, bytes.len() as u64, rest, 9000);
        res.unwrap();
        assert_eq!(done.len(), specs.len() - 1);
        assert_eq!(std::fs::read(dir.join("mods/sodium.jar")).unwrap(), files[1].1);
    }

    /// a flipped byte inside a stored entry, a wrong hash and a name that differs -> refused, nothing written.
    #[test]
    fn corrupt_or_foreign_data_is_refused_and_leaves_no_file() {
        let files = sample();
        let good = zip_of(&files);
        let dir = scratch("bad");
        let specs = specs_of(&good, &dir, true);

        let mut flipped = good.clone();
        let at = specs[1].offset as usize + 30 + specs[1].raw_name.len() + 100;
        flipped[at] ^= 0xff;
        let (res, _, _) = run(&flipped, 0, flipped.len() as u64, specs.clone(), 8192);
        let err = res.expect_err("a flipped byte must not pass");
        assert!(matches!(err, Failure::Data(_)) && err.text().contains("CRC"), "{}", err.text());
        assert!(!dir.join("mods/sodium.jar").exists());

        let mut lying = specs.clone();
        lying[1].sha256 = Some([7u8; 32]);
        let (res, _, _) = run(&good, 0, good.len() as u64, lying, 8192);
        assert!(res.expect_err("a hash from another file").text().contains("SHA-256"));
        assert!(!dir.join("mods/sodium.jar").exists());

        let mut renamed = specs.clone();
        renamed[0].raw_name = "config/b.cfg".into();
        let (res, _, _) = run(&good, 0, good.len() as u64, renamed, 8192);
        assert!(res.expect_err("another name").text().contains("name"));

        let mut wrong_method = specs.clone();
        wrong_method[0].method = 0;
        let (res, _, _) = run(&good, 0, good.len() as u64, wrong_method, 8192);
        assert!(res.expect_err("another method").text().contains("method"));
    }

    /// an entry that inflates to more than the index says -> stopped at the limit, not at the disk.
    #[test]
    fn an_entry_that_inflates_past_its_declared_size_is_stopped() {
        let bytes = zip_of(&[("big.bin", vec![0u8; 5_000_000], zip::CompressionMethod::Deflated)]);
        let dir = scratch("bomb");
        let mut specs = specs_of(&bytes, &dir, false);
        specs[0].size = 1000;
        let (res, _, _) = run(&bytes, 0, bytes.len() as u64, specs, 4096);
        let err = res.expect_err("must stop");
        assert!(err.text().contains("past"), "{}", err.text());
        assert!(walk(&dir).is_empty(), "nothing may stay on disk");
    }
}
