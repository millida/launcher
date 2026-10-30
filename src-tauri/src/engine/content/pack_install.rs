// Installs a catalogue pack file by file instead of as one archive. The server's index says where every file sits in
// the archive and what it hashes to; the launcher keeps the files the player already has in the shared store (a link, no
// download), fetches the rest as several ranged requests side by side, and writes each file as its bytes arrive,
// checked against the hash the server recorded when the pack was uploaded. There is no second pass over the archive.
// Anything this road cannot do (no hashes in the index, one huge file, a refusal) hands the install back to the whole-archive road.
use super::pack_delta::{self, DeltaEntry, DeltaIndex};
use super::pack_stream::{Extractor, Failure, Finished, Spec};
use crate::engine::*;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Unchanged bytes between two wanted entries are downloaded rather than paid for with another round trip.
const GROUP_GAP: u64 = 1 << 20;
/// Small enough that several run side by side and a cut connection costs a few megabytes, big enough to hide the round trip.
const GROUP_CAP: u64 = 32 << 20;
const MAX_GROUPS: usize = 4000;
/// A download of this size or more that is mostly one group would run on a single connection; the archive road uses four.
const SINGLE_STREAM_BYTES: u64 = 256 << 20;
const TRIES: u32 = 3;
/// The body of a range goes quiet for this long: the connection is cut and the range asked again.
const CHUNK_STALL: Duration = Duration::from_secs(20);
const CHUNKS_IN_FLIGHT: usize = 8;
/// An unfinished install nobody came back to is not kept longer than this.
const STALE_STAGING: Duration = Duration::from_secs(7 * 24 * 3600);
/// The part of the install bar the download takes (the archive road uses 12..70 and then unpacks).
const BAR_FROM: f32 = 12.0;
const BAR_SPAN: f32 = 74.0;

pub(crate) struct IndexSource<'a> {
    pub(crate) file_id: &'a str,
    pub(crate) url: &'a str,
    pub(crate) archive_size: u64,
    /// Names the archive version: leftovers of another version are never reused.
    pub(crate) archive_id: &'a str,
    pub(crate) staging: &'a Path,
    pub(crate) marker: &'a Path,
}

#[derive(Debug, Default)]
pub(crate) struct IndexReport {
    pub(crate) files: usize,
    pub(crate) linked: usize,
    pub(crate) resumed: usize,
    pub(crate) fetched: usize,
    pub(crate) net_bytes: u64,
    pub(crate) linked_bytes: u64,
    pub(crate) archive_bytes: u64,
}

#[derive(Debug)]
pub(crate) enum IndexError {
    Cancelled,
    /// This road cannot be used for this pack right now. The caller takes the whole archive.
    Unavailable(String),
    /// The install itself failed (the disk): the archive road would fail the same way.
    Failed(String),
    /// The connection kept breaking after part of the pack was already on disk. The staging folder is kept, so the
    /// next «Установить» goes on from where this stopped; the whole archive from zero would throw that away (second
    /// review, finding М4: a gigabyte pack cut at 80% was downloaded again in full).
    Interrupted(String),
}

/// What a group that gave up on the network means for the install: work already done is kept for the next try; a road
/// that never delivered anything (a server or a CDN that refuses ranges) is left to the archive road, which may work.
fn network_verdict(received: u64, resumed: usize, why: String) -> IndexError {
    if received > 0 || resumed > 0 {
        IndexError::Interrupted(why)
    } else {
        IndexError::Unavailable(why)
    }
}

/// A progress line for the window: bar position, text, seconds left when honest.
pub(crate) type Say<'a> = dyn Fn(f32, &str, Option<u64>) + Send + Sync + 'a;

/// Speed and time left, announced at most twice a second.
pub(crate) struct Meter {
    pulse: Mutex<Pulse>,
    last: Mutex<Instant>,
}

impl Meter {
    pub(crate) fn new() -> Meter {
        let now = Instant::now();
        Meter { pulse: Mutex::new(Pulse::new(now)), last: Mutex::new(now.checked_sub(Duration::from_secs(1)).unwrap_or(now)) }
    }

    /// `Some(eta)` when it is time to tell the window (the eta itself may still be unknown), `None` between times.
    pub(crate) fn tick(&self, net_done: u64, net_left: u64) -> Option<Option<u64>> {
        let now = Instant::now();
        {
            let mut last = self.last.try_lock().ok()?;
            if now.duration_since(*last) < Duration::from_millis(500) {
                return None;
            }
            *last = now;
        }
        let mut pulse = self.pulse.lock().unwrap_or_else(|e| e.into_inner());
        pulse.push(now, net_done);
        Some(pulse.eta(now, net_left).map(round_eta))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Plan {
    pub(crate) linked: Vec<usize>,
    pub(crate) resumed: Vec<usize>,
    pub(crate) fetch: Vec<usize>,
}

/// CRC-32 and SHA-256 of a file in one read, or None when it is not a file of exactly this size.
fn local_digests(path: &Path, size: u64) -> Option<(u32, [u8; 32])> {
    use sha2::Digest as _;
    use std::io::Read as _;
    let meta = std::fs::symlink_metadata(path).ok()?;
    if !meta.is_file() || meta.len() != size {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let (mut crc, mut sha) = (flate2::Crc::new(), sha2::Sha256::new());
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        crc.update(&buf[..n]);
        sha.update(&buf[..n]);
    }
    Some((crc.sum(), sha.finalize().into()))
}

/// Everything under `root` that the index does not name goes: a half-written file of a cut install, or anything
/// that was never part of this pack. What stays is exactly what could belong.
fn prune_unknown(root: &Path, dir: &Path, known: &HashSet<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let path = e.path();
        let Ok(kind) = std::fs::symlink_metadata(&path).map(|m| m.file_type()) else { continue };
        if kind.is_dir() {
            prune_unknown(root, &path, known);
        } else {
            let rel = path.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            if !known.contains(&rel) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}

/// Sorts the files of the index into the ones already in place (left by a cut install), the ones the shared store has,
/// and the ones to download. Reads local files, so it runs off the async runtime.
pub(crate) fn plan_install(
    index: &DeltaIndex,
    staging: &Path,
    marker: &Path,
    archive_id: &str,
    halt: &Halt,
    store: &mut StoreIndex,
) -> Result<Plan, String> {
    let same = std::fs::read_to_string(marker).map(|s| s.trim() == archive_id).unwrap_or(false);
    if !same {
        let _ = std::fs::remove_dir_all(staging);
    }
    std::fs::create_dir_all(staging).map_err(|e| io_fail("Установка", staging, &e))?;
    std::fs::write(marker, archive_id).map_err(|e| io_fail("Установка", marker, &e))?;
    let known: HashSet<String> = index.entries.iter().filter(|e| !e.dir).map(|e| e.rel.clone()).collect();
    prune_unknown(staging, staging, &known);

    let mut plan = Plan::default();
    for (i, e) in index.entries.iter().enumerate() {
        if halt.cancelled() {
            return Err(CANCELLED.into());
        }
        let dest = safe_join(staging, &e.rel)?;
        if e.dir {
            std::fs::create_dir_all(&dest).map_err(|err| io_fail("Установка", &dest, &err))?;
            continue;
        }
        let want = e.sha256.ok_or("index has no hash for a file")?;
        if let Some((crc, sha)) = local_digests(&dest, e.size) {
            if crc == e.crc && sha == want {
                plan.resumed.push(i);
                continue;
            }
        }
        if dest.exists() {
            let _ = std::fs::remove_file(&dest);
        }
        if shareable(&e.rel, e.size) {
            if let Some(object) = store.find(e.size, e.crc, &hex(&want)) {
                if link_into(&object, &dest) {
                    plan.linked.push(i);
                    continue;
                }
            }
        }
        plan.fetch.push(i);
    }
    Ok(plan)
}

fn spec_of(e: &DeltaEntry, staging: &Path) -> Result<Spec, String> {
    Ok(Spec {
        rel: e.rel.clone(),
        raw_name: e.raw_name.clone(),
        method: e.method,
        crc: e.crc,
        size: e.size,
        csize: e.csize,
        offset: e.offset,
        end: e.end,
        sha256: e.sha256,
        want_sha1: shareable(&e.rel, e.size),
        dest: safe_join(staging, &e.rel)?,
    })
}

struct Member {
    entry: usize,
    spec: Spec,
}

/// Files that arrived whole: entry index and the SHA-1 computed on the way for the shared store.
type Arrived = Arc<Mutex<Vec<(usize, Option<String>)>>>;

struct Ctx<'a> {
    url: &'a str,
    archive_size: u64,
    job: &'a Job,
    say: &'a Say<'a>,
    allow: fn(&str) -> bool,
    done: Arc<Vec<AtomicBool>>,
    finished: Arrived,
    received: AtomicU64,
    pre_done: u64,
    net_total: u64,
    meter: Meter,
}

impl Ctx<'_> {
    fn announce(&self) {
        let received = self.received.load(Ordering::Relaxed);
        let Some(eta) = self.meter.tick(received, self.net_total.saturating_sub(received)) else { return };
        let total = self.pre_done + self.net_total;
        let done = (self.pre_done + received).min(total);
        let pct = BAR_FROM + BAR_SPAN * (done as f64 / total.max(1) as f64) as f32;
        (self.say)(pct.min(BAR_FROM + BAR_SPAN), &format!("Скачиваем сборку… {}", super::catalog_pack::fmt_bytes(done, total)), eta);
    }

    /// Bytes of a cut attempt that will come again are taken back, so the bar never runs ahead of the real thing.
    fn refund(&self, got: u64, kept: u64) {
        let wasted = got.saturating_sub(kept);
        if wasted > 0 {
            self.received.fetch_sub(wasted.min(self.received.load(Ordering::Relaxed)), Ordering::Relaxed);
        }
    }
}

#[derive(Debug)]
enum GroupErr {
    Cancelled,
    Data(String),
    Disk(String),
    Network(String),
}

enum Step {
    Done,
    Paused,
    Retry(String),
    Fatal(GroupErr),
}

struct Consumed {
    complete: bool,
    settled: u64,
}

enum Cut {
    Paused,
    Cancelled,
    Network(String),
}

async fn fetch_range(ctx: &Ctx<'_>, members: &[&Member]) -> Step {
    let (Some(first), Some(last)) = (members.first(), members.last()) else { return Step::Done };
    let (from, to) = (first.spec.offset, last.spec.end);
    let cancel = Some(ctx.job.cancel_flag());
    let req = client().get(ctx.url).header(reqwest::header::RANGE, format!("bytes={}-{}", from, to - 1));
    let mut resp = match or_pause(tokio::time::timeout(CHUNK_STALL, req.send()), cancel).await {
        Err(e) if e == PAUSED => return Step::Paused,
        Err(_) => return Step::Fatal(GroupErr::Cancelled),
        Ok(Err(_)) => {
            pressure();
            return Step::Retry("storage does not answer".into());
        }
        Ok(Ok(Err(e))) => {
            pressure();
            return Step::Retry(net_err(&e));
        }
        Ok(Ok(Ok(r))) => r,
    };
    if !(ctx.allow)(resp.url().as_str()) {
        return Step::Fatal(GroupErr::Data("storage redirected to a foreign address".into()));
    }
    let status = resp.status();
    if status != reqwest::StatusCode::PARTIAL_CONTENT {
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            pressure();
            return Step::Retry(format!("storage answered {}", status));
        }
        return Step::Fatal(GroupErr::Data(format!("storage answered {} instead of a range", status)));
    }
    let range = resp.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).map(String::from);
    if !pack_delta::content_range_ok(range.as_deref(), from, to, ctx.archive_size) {
        return Step::Fatal(GroupErr::Data(format!("storage sent another range ({})", range.unwrap_or_default())));
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(CHUNKS_IN_FLIGHT);
    let specs: Vec<Spec> = members.iter().map(|m| m.spec.clone()).collect();
    let ids: Vec<usize> = members.iter().map(|m| m.entry).collect();
    let (flags, results) = (ctx.done.clone(), ctx.finished.clone());
    let consumer = tokio::task::spawn_blocking(move || -> Result<Consumed, Failure> {
        let mut ex = Extractor::new(specs, from, |f: Finished| {
            let entry = ids[f.member];
            results.lock().unwrap_or_else(|e| e.into_inner()).push((entry, f.sha1));
            flags[entry].store(true, Ordering::SeqCst);
        });
        while let Some(chunk) = rx.blocking_recv() {
            ex.feed(&chunk)?;
        }
        Ok(Consumed { complete: ex.complete(), settled: ex.settled_to() })
    });

    let mut got = 0u64;
    let mut cut: Option<Cut> = None;
    loop {
        match or_pause(tokio::time::timeout(CHUNK_STALL, resp.chunk()), cancel).await {
            Err(e) => {
                cut = Some(if e == PAUSED { Cut::Paused } else { Cut::Cancelled });
                break;
            }
            Ok(Err(_)) => {
                cut = Some(Cut::Network("connection to storage went quiet".into()));
                break;
            }
            Ok(Ok(Err(e))) => {
                cut = Some(Cut::Network(format!("download cut ({})", net_err(&e))));
                break;
            }
            Ok(Ok(Ok(None))) => break,
            Ok(Ok(Ok(Some(chunk)))) => {
                let n = chunk.len() as u64;
                got += n;
                ctx.received.fetch_add(n, Ordering::Relaxed);
                count_downloaded(chunk.len());
                if tx.send(chunk.to_vec()).await.is_err() {
                    break;
                }
                ctx.announce();
            }
        }
    }
    drop(tx);
    let consumed = match consumer.await {
        Ok(r) => r,
        Err(e) => return Step::Fatal(GroupErr::Disk(format!("writer task died: {}", e))),
    };
    match consumed {
        Err(Failure::Data(s)) => Step::Fatal(GroupErr::Data(s)),
        Err(Failure::Io(s)) => Step::Fatal(GroupErr::Disk(s)),
        Ok(info) => {
            let kept = info.settled.saturating_sub(from);
            match cut {
                Some(Cut::Cancelled) => Step::Fatal(GroupErr::Cancelled),
                Some(Cut::Paused) => {
                    ctx.refund(got, kept);
                    Step::Paused
                }
                Some(Cut::Network(e)) => {
                    ctx.refund(got, kept);
                    pressure();
                    Step::Retry(e)
                }
                None if !info.complete => {
                    ctx.refund(got, kept);
                    Step::Retry("range ended before its files".into())
                }
                None => Step::Done,
            }
        }
    }
}

async fn run_group(ctx: &Ctx<'_>, members: &[Member], pace: &Arc<Pace>) -> Result<(), GroupErr> {
    let mut place = Some(pace.enter().await);
    let mut tries = 0u32;
    loop {
        if ctx.job.cancelled() {
            return Err(GroupErr::Cancelled);
        }
        let left: Vec<&Member> = members.iter().filter(|m| !ctx.done[m.entry].load(Ordering::SeqCst)).collect();
        if left.is_empty() {
            if let Some(p) = place.take() {
                p.good();
            }
            return Ok(());
        }
        let step = match fetch_range(ctx, &left).await {
            Step::Done => Step::Retry("range entries did not settle".into()),
            other => other,
        };
        match step {
            Step::Done => {}
            Step::Paused => {
                ctx.job.cancel_flag().gate().await.map_err(|_| GroupErr::Cancelled)?;
            }
            Step::Fatal(e) => return Err(e),
            Step::Retry(why) => {
                // an attempt that finished some files is not a failed attempt: the range moved on
                let moved = members.iter().filter(|m| !ctx.done[m.entry].load(Ordering::SeqCst)).count() < left.len();
                tries = if moved { 1 } else { tries + 1 };
                if tries >= TRIES {
                    if let Some(p) = place.take() {
                        p.bad();
                    }
                    return Err(GroupErr::Network(why));
                }
                tokio::time::sleep(Duration::from_millis(600 * tries as u64)).await;
            }
        }
    }
}

/// An unfinished install nobody came back to: its folder and its marker go after a week.
fn drop_stale_staging(dir: &Path) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if !name.starts_with("pack-") || !(name.ends_with(".idx") || name.ends_with(".idx-id")) {
            continue;
        }
        let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > STALE_STAGING);
        if old {
            let _ = if e.path().is_dir() { std::fs::remove_dir_all(e.path()) } else { std::fs::remove_file(e.path()) };
        }
    }
}

/// The road from the server's index to a finished tree, for a first install of a catalogue pack.
pub(crate) async fn install_by_index(app: &AppHandle, job: &Job, s: IndexSource<'_>) -> Result<IndexReport, IndexError> {
    if let Some(dir) = s.staging.parent() {
        drop_stale_staging(dir);
    }
    let answer = millida_api_auth(format!("/catalog/packs/files/{}/index", s.file_id), "GET".into(), None)
        .await
        .map_err(|e| if e == CANCELLED { IndexError::Cancelled } else { IndexError::Unavailable(e) })?;
    let index = pack_delta::parse_index(&answer, s.archive_size).map_err(IndexError::Unavailable)?;
    let say = |pct: f32, msg: &str, eta: Option<u64>| job.emit_eta(app, pct, msg, eta);
    install_with_index(job, &say, s, Arc::new(index), StoreIndex::open(), super::catalog_pack::pack_url_allowed).await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn install_with_index(
    job: &Job,
    say: &Say<'_>,
    s: IndexSource<'_>,
    index: Arc<DeltaIndex>,
    store: StoreIndex,
    allow: fn(&str) -> bool,
) -> Result<IndexReport, IndexError> {
    use IndexError::*;
    if !index.fully_hashed() {
        return Err(Unavailable("index has no file hashes".into()));
    }
    say(10.0, "Сверяем файлы сборки…", None);
    let (idx, staging, marker, id, halt) = (index.clone(), s.staging.to_path_buf(), s.marker.to_path_buf(), s.archive_id.to_string(), job.halt());
    let (planned, store) = blocking(move || {
        let mut store = store;
        let plan = plan_install(&idx, &staging, &marker, &id, &halt, &mut store)?;
        store.save();
        Ok((plan, store))
    })
    .await
    .map_err(|e| if e == CANCELLED { Cancelled } else { Failed(e) })?;
    job.check().map_err(|_| Cancelled)?;

    let spans = pack_delta::groups_with(&index, &planned.fetch, GROUP_GAP, GROUP_CAP);
    let net_total: u64 = spans.iter().map(|g| g.to - g.from).sum();
    let biggest = spans.iter().map(|g| g.to - g.from).max().unwrap_or(0);
    if spans.len() > MAX_GROUPS {
        return Err(Unavailable(format!("files are scattered over {} ranges", spans.len())));
    }
    if net_total >= SINGLE_STREAM_BYTES && biggest * 2 > net_total {
        return Err(Unavailable("one range is over half of the download: the archive road with several streams is faster".into()));
    }
    let pre_done: u64 = planned.linked.iter().chain(&planned.resumed).map(|&i| index.entries[i].csize).sum();
    let linked_bytes: u64 = planned.linked.iter().map(|&i| index.entries[i].csize).sum();

    let mut groups: Vec<Vec<Member>> = Vec::with_capacity(spans.len());
    for g in &spans {
        let mut members = Vec::with_capacity(g.members.len());
        for &i in &g.members {
            members.push(Member { entry: i, spec: spec_of(&index.entries[i], s.staging).map_err(Failed)? });
        }
        groups.push(members);
    }

    let ctx = Ctx {
        url: s.url,
        archive_size: s.archive_size,
        job,
        say,
        allow,
        done: Arc::new((0..index.entries.len()).map(|_| AtomicBool::new(false)).collect()),
        finished: Arc::new(Mutex::new(Vec::new())),
        received: AtomicU64::new(0),
        pre_done,
        net_total,
        meter: Meter::new(),
    };
    say(BAR_FROM, &format!("Скачиваем сборку… {}", super::catalog_pack::fmt_bytes(pre_done, pre_done + net_total)), None);
    let pace = Pace::tuned(4, 8, 6, 2);
    let ran = futures::future::try_join_all(groups.iter().map(|members| run_group(&ctx, members, &pace))).await;
    if let Err(e) = ran {
        return Err(match e {
            GroupErr::Cancelled => Cancelled,
            GroupErr::Disk(why) => Failed(why),
            GroupErr::Data(why) => {
                // bytes that do not match what the server recorded are not worth resuming from
                let _ = std::fs::remove_dir_all(s.staging);
                let _ = std::fs::remove_file(s.marker);
                Unavailable(why)
            }
            GroupErr::Network(why) => network_verdict(ctx.received.load(Ordering::SeqCst), planned.resumed.len(), why),
        });
    }
    job.check().map_err(|_| Cancelled)?;

    say(BAR_FROM + BAR_SPAN, "Сверяем файлы сборки…", None);
    let (idx, staging, marker) = (index.clone(), s.staging.to_path_buf(), s.marker.to_path_buf());
    let finished: Vec<(usize, Option<String>)> = std::mem::take(&mut *ctx.finished.lock().unwrap_or_else(|e| e.into_inner()));
    blocking(move || {
        pack_delta::verify_tree(&idx, &staging)?;
        let mut store = store;
        for (i, sha1) in finished {
            let (Some(sha1), e) = (sha1, &idx.entries[i]) else { continue };
            if let Some(sha) = e.sha256 {
                store.adopt(&safe_join(&staging, &e.rel)?, &sha1, e.crc, &hex(&sha));
            }
        }
        store.save();
        let _ = std::fs::remove_file(&marker);
        Ok(())
    })
    .await
    .map_err(Failed)?;

    Ok(IndexReport {
        files: planned.linked.len() + planned.resumed.len() + planned.fetch.len(),
        linked: planned.linked.len(),
        resumed: planned.resumed.len(),
        fetched: planned.fetch.len(),
        net_bytes: ctx.received.load(Ordering::Relaxed),
        linked_bytes,
        archive_bytes: index.size,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read as _, Write as _};
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("millida-pack-install-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn zip_of(files: &[(String, Vec<u8>, zip::CompressionMethod)]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, body, method) in files {
            let opts = zip::write::SimpleFileOptions::default().compression_method(*method);
            z.start_file(name.as_str(), opts).unwrap();
            z.write_all(body).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    /// The v2 index the server would build for these bytes.
    fn index_of(bytes: &[u8]) -> DeltaIndex {
        use sha2::Digest as _;
        let eocd = bytes.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        let directory = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap());
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.to_vec())).unwrap();
        let mut rows = Vec::new();
        for i in 0..zip.len() {
            let (name, crc, size, csize, offset, method) = {
                let f = zip.by_index_raw(i).unwrap();
                let method = if f.compression() == zip::CompressionMethod::Stored { 0 } else { 8 };
                (f.name().to_string(), f.crc32(), f.size(), f.compressed_size(), f.header_start(), method)
            };
            let mut body = Vec::new();
            zip.by_index(i).unwrap().read_to_end(&mut body).unwrap();
            let sha: String = hex(&sha2::Sha256::digest(&body));
            rows.push(serde_json::json!([name, crc, size, csize, offset, method, sha]));
        }
        let doc = serde_json::json!({ "v": 1, "size": bytes.len(), "directoryOffset": directory, "entries": rows });
        pack_delta::parse_index(&doc, bytes.len() as u64).unwrap()
    }

    fn sample(n_mods: usize) -> Vec<(String, Vec<u8>, zip::CompressionMethod)> {
        let mut files = vec![
            ("config/a.cfg".to_string(), b"max_players=12\n".repeat(500), zip::CompressionMethod::Deflated),
            ("kubejs/script.js".to_string(), b"console.log(1);\n".repeat(3000), zip::CompressionMethod::Deflated),
            ("options.txt".to_string(), Vec::new(), zip::CompressionMethod::Stored),
        ];
        for i in 0..n_mods {
            let body: Vec<u8> = (0..150_000u32).map(|j| ((j * 7 + i as u32 * 13) % 251) as u8).collect();
            files.push((format!("mods/mod-{i}.jar"), body, zip::CompressionMethod::Stored));
        }
        files
    }

    /// A range server on a local socket. `cut_first` closes the first answer of every range after that many body bytes.
    struct Server {
        addr: std::net::SocketAddr,
        asked: Arc<Mutex<Vec<(u64, u64)>>>,
    }

    async fn serve(bytes: Vec<u8>, cut_first: Option<usize>) -> Server {
        serve_until(bytes, cut_first, None).await
    }

    /// Same, and after `die_after` requests every connection is closed unanswered: the network is gone.
    async fn serve_until(bytes: Vec<u8>, cut_first: Option<usize>, die_after: Option<usize>) -> Server {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let asked = Arc::new(Mutex::new(Vec::new()));
        let (log, seen_cut) = (asked.clone(), Arc::new(Mutex::new(HashSet::new())));
        let bytes = Arc::new(bytes);
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { return };
                let (bytes, log, seen_cut, count) = (bytes.clone(), log.clone(), seen_cut.clone(), count.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    if die_after.is_some_and(|limit| count.fetch_add(1, Ordering::SeqCst) >= limit) {
                        return;
                    }
                    let head = String::from_utf8_lossy(&buf[..n]).to_string();
                    let Some(range) = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("range: bytes=").map(String::from)) else { return };
                    let (a, b) = range.trim().split_once('-').unwrap();
                    let (a, b): (u64, u64) = (a.parse().unwrap(), b.parse().unwrap());
                    log.lock().unwrap().push((a, b));
                    let body = &bytes[a as usize..=b as usize];
                    let resp = format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        a, b, bytes.len(), body.len()
                    );
                    let _ = sock.write_all(resp.as_bytes()).await;
                    let first_time = seen_cut.lock().unwrap().insert(a);
                    match cut_first {
                        Some(limit) if first_time && body.len() > limit => {
                            let _ = sock.write_all(&body[..limit]).await;
                            let _ = sock.flush().await;
                        }
                        _ => {
                            let _ = sock.write_all(body).await;
                        }
                    }
                });
            }
        });
        Server { addr, asked }
    }

    fn quiet(_: f32, _: &str, _: Option<u64>) {}

    fn allow_any(_: &str) -> bool {
        true
    }

    async fn install(name: &str, bytes: &[u8], cut_first: Option<usize>, store: StoreIndex) -> (Result<IndexReport, IndexError>, PathBuf, Server) {
        let dir = scratch(name);
        let server = serve(bytes.to_vec(), cut_first).await;
        let index = Arc::new(index_of(bytes));
        let job = Job::start(format!("test-pack-install-{name}"), name).unwrap();
        let (staging, marker) = (dir.join("pack.idx"), dir.join("pack.idx-id"));
        let url = format!("http://{}/pack.zip", server.addr);
        let src = IndexSource { file_id: "f", url: &url, archive_size: bytes.len() as u64, archive_id: "v1", staging: &staging, marker: &marker };
        let res = install_with_index(&job, &quiet, src, index, store, allow_any).await;
        (res, staging, server)
    }

    /// An index with hashes and a server that serves ranges -> the tree equals the archive, file for file, with no
    /// unfinished leftovers, the bar's bytes add up, and the files that joined the store are found next time.
    #[tokio::test]
    async fn a_pack_is_built_from_ranges_and_the_next_install_finds_its_mods_in_the_store() {
        let files = sample(40);
        let bytes = zip_of(&files);
        let store_dir = scratch("store-a");
        let (res, staging, server) = install("a", &bytes, None, StoreIndex::open_at(store_dir.clone())).await;
        let report = res.unwrap_or_else(|e| panic!("{e:?}"));
        for (name, body, _) in &files {
            assert_eq!(&std::fs::read(staging.join(name)).unwrap(), body, "{name}");
        }
        assert_eq!(report.fetched, files.len());
        assert!(report.net_bytes > 0 && report.net_bytes <= bytes.len() as u64);
        assert!(!server.asked.lock().unwrap().is_empty());
        assert!(!staging.join("mods/mod-0.jar.millida-part").exists());

        // the same pack again: every mod now comes from the store, only the small files travel
        let (res, staging, server) = install("a2", &bytes, None, StoreIndex::open_at(store_dir)).await;
        let again = res.unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(again.linked, 40, "all forty mods were adopted by the first install");
        assert_eq!(again.fetched, 3);
        assert!(again.net_bytes < report.net_bytes / 4, "{} vs {}", again.net_bytes, report.net_bytes);
        for (name, body, _) in &files {
            assert_eq!(&std::fs::read(staging.join(name)).unwrap(), body, "{name}");
        }
        assert!(server.asked.lock().unwrap().iter().all(|&(a, b)| b - a < 100_000), "no request may reach for a mod");
    }

    /// A mod that is already in the store is linked, not downloaded: the request list has no range that covers it.
    #[tokio::test]
    async fn files_the_store_has_are_linked_not_downloaded() {
        let mut files = sample(0);
        for i in 0..6u32 {
            let body: Vec<u8> = (0..1_300_000u32).map(|j| ((j.wrapping_mul(2654435761) >> 7) as u8) ^ (i as u8)).collect();
            files.push((format!("mods/big-{i}.jar"), body, zip::CompressionMethod::Stored));
        }
        let bytes = zip_of(&files);
        let index = index_of(&bytes);
        let store_dir = scratch("store-b");
        // put two of the mods into the store under their SHA-1 names
        let mut have = Vec::new();
        for name in ["mods/big-1.jar", "mods/big-4.jar"] {
            let body = &files.iter().find(|f| f.0 == name).unwrap().1;
            let tmp = store_dir.join("tmp.bin");
            std::fs::write(&tmp, body).unwrap();
            let sha1 = crate::engine::file_sha1(&tmp).unwrap();
            let object = store_dir.join(&sha1[..2]).join(&sha1);
            std::fs::create_dir_all(object.parent().unwrap()).unwrap();
            std::fs::rename(&tmp, &object).unwrap();
            have.push(name);
        }
        let (res, staging, server) = install("b", &bytes, None, StoreIndex::open_at(store_dir)).await;
        let report = res.unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(report.linked, 2, "both mods the store has are linked");
        assert_eq!(report.fetched, files.len() - 2);
        for (name, body, _) in &files {
            assert_eq!(&std::fs::read(staging.join(name)).unwrap(), body, "{name}");
        }
        for name in have {
            let e = index.entries.iter().find(|e| e.rel == name).unwrap();
            let asked = server.asked.lock().unwrap().clone();
            assert!(
                !asked.iter().any(|&(a, b)| a <= e.offset && b >= e.end - 1),
                "«{name}» came from the store, so no request may cover it: {asked:?}"
            );
        }
        assert!(report.net_bytes < bytes.len() as u64 - 2 * 1_300_000 + 4096, "the linked mods did not travel: {}", report.net_bytes);
    }

    /// Every first answer is cut in the middle -> the finished files stay, the rest is asked again from the first
    /// unfinished file, and the tree still comes out whole.
    #[tokio::test]
    async fn cut_connections_are_resumed_at_the_unfinished_file() {
        let files = sample(12);
        let bytes = zip_of(&files);
        let (res, staging, server) = install("c", &bytes, Some(200_000), StoreIndex::open_at(scratch("store-c"))).await;
        let report = res.unwrap_or_else(|e| panic!("{e:?}"));
        for (name, body, _) in &files {
            assert_eq!(&std::fs::read(staging.join(name)).unwrap(), body, "{name}");
        }
        assert!(server.asked.lock().unwrap().len() > 1, "a cut answer must be followed by another request");
        assert!(report.net_bytes >= 1);
    }

    /// Finding М4 of the second review: the network went away for good after part of the pack had arrived. The install
    /// stops with what came kept (the answer is `Interrupted`, not "take the archive"), and the next try, with the
    /// network back, goes on from the files already on disk instead of from zero.
    #[tokio::test]
    async fn a_dead_network_keeps_what_came_and_the_next_try_continues_from_it() {
        let files = sample(12);
        let bytes = zip_of(&files);
        let dir = scratch("interrupted");
        let (staging, marker) = (dir.join("pack.idx"), dir.join("pack.idx-id"));
        let attempt = |addr: std::net::SocketAddr, store: &str| {
            let (index, bytes_len, staging, marker, store) = (Arc::new(index_of(&bytes)), bytes.len() as u64, staging.clone(), marker.clone(), StoreIndex::open_at(scratch(store)));
            async move {
                let job = Job::start(format!("test-pack-interrupted-{}", addr.port()), "interrupted").unwrap();
                let url = format!("http://{addr}/pack.zip");
                let src = IndexSource { file_id: "f", url: &url, archive_size: bytes_len, archive_id: "v1", staging: &staging, marker: &marker };
                install_with_index(&job, &quiet, src, index, store, allow_any).await
            }
        };
        // the first answer is cut after 200 kB (a few files are finished), then the network is gone
        let dying = serve_until(bytes.clone(), Some(200_000), Some(1)).await;
        let first = attempt(dying.addr, "store-i1").await;
        assert!(matches!(first, Err(IndexError::Interrupted(_))), "a network that dies with part of the pack on disk is an interruption: {first:?}");
        let kept = files.iter().filter(|(name, body, _)| std::fs::read(staging.join(name)).is_ok_and(|b| &b == body)).count();
        assert!(kept >= 1, "the files that arrived stay in the staging folder");
        assert!(marker.exists(), "the marker that names this archive stays, or the next try would not trust the folder");

        let healthy = serve(bytes.clone(), None).await;
        let report = attempt(healthy.addr, "store-i2").await.unwrap_or_else(|e| panic!("{e:?}"));
        assert!(report.resumed >= 1, "the second try takes the finished files as they are: {report:?}");
        assert!(report.net_bytes < bytes.len() as u64, "and does not fetch them again");
        for (name, body, _) in &files {
            assert_eq!(&std::fs::read(staging.join(name)).unwrap(), body, "{name}");
        }
    }

    /// A road that delivered nothing at all (a server that refuses ranges, a CDN in the way) is not an interruption:
    /// the whole archive may still work.
    #[test]
    fn a_network_that_never_delivered_leaves_the_archive_road_open() {
        assert!(matches!(network_verdict(0, 0, "no".into()), IndexError::Unavailable(_)));
        assert!(matches!(network_verdict(1, 0, "cut".into()), IndexError::Interrupted(_)));
        assert!(matches!(network_verdict(0, 3, "cut".into()), IndexError::Interrupted(_)), "files left by an earlier try count too");
    }

    /// A leftover tree from a cut install is taken as it is: complete files stay (no request covers them), a half
    /// file and a stranger are removed.
    #[test]
    fn plan_reuses_complete_leftovers_and_drops_the_rest() {
        let files = sample(3);
        let bytes = zip_of(&files);
        let index = index_of(&bytes);
        let dir = scratch("plan");
        let (staging, marker) = (dir.join("s"), dir.join("m"));
        std::fs::create_dir_all(staging.join("mods")).unwrap();
        std::fs::write(&marker, "v1").unwrap();
        std::fs::write(staging.join("config/").parent().unwrap().join("x"), b"").ok();
        let keep = &files[3];
        std::fs::write(staging.join(&keep.0), &keep.1).unwrap();
        std::fs::write(staging.join("mods/mod-1.jar"), &files[4].1[..1000]).unwrap();
        std::fs::write(staging.join("mods/stranger.jar"), b"x").unwrap();
        std::fs::write(staging.join("mods/mod-2.jar.millida-part"), b"half").unwrap();

        let mut store = StoreIndex::open_at(scratch("plan-store"));
        let plan = plan_install(&index, &staging, &marker, "v1", &Halt::default(), &mut store).unwrap();
        let rels = |ids: &[usize]| ids.iter().map(|&i| index.entries[i].rel.clone()).collect::<Vec<_>>();
        assert_eq!(rels(&plan.resumed), vec![keep.0.clone()]);
        assert!(rels(&plan.fetch).contains(&"mods/mod-1.jar".to_string()), "a cut file is fetched again");
        assert!(!staging.join("mods/stranger.jar").exists() && !staging.join("mods/mod-2.jar.millida-part").exists());

        let again = plan_install(&index, &staging, &marker, "v2", &Halt::default(), &mut store).unwrap();
        assert!(again.resumed.is_empty(), "leftovers of another archive version are never reused");
    }

    /// no hashes in the index -> this road is not used (the archive's own hash is the only thing that vouches for the bytes)
    #[tokio::test]
    async fn an_index_without_hashes_is_refused() {
        let files = sample(2);
        let bytes = zip_of(&files);
        let eocd = bytes.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        let directory = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap());
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes.clone())).unwrap();
        let rows: Vec<_> = (0..zip.len())
            .map(|i| {
                let f = zip.by_index_raw(i).unwrap();
                serde_json::json!([f.name(), f.crc32(), f.size(), f.compressed_size(), f.header_start(), if f.compression() == zip::CompressionMethod::Stored { 0 } else { 8 }])
            })
            .collect();
        let doc = serde_json::json!({ "v": 1, "size": bytes.len(), "directoryOffset": directory, "entries": rows });
        let index = Arc::new(pack_delta::parse_index(&doc, bytes.len() as u64).unwrap());
        let dir = scratch("nohash");
        let job = Job::start("test-pack-install-nohash", "t").unwrap();
        let (staging, marker) = (dir.join("s"), dir.join("m"));
        let src = IndexSource { file_id: "f", url: "http://127.0.0.1:1/x", archive_size: bytes.len() as u64, archive_id: "v1", staging: &staging, marker: &marker };
        let res = install_with_index(&job, &quiet, src, index, StoreIndex::open_at(scratch("nohash-store")), allow_any).await;
        assert!(matches!(res, Err(IndexError::Unavailable(_))), "{res:?}");
        assert!(!staging.exists(), "nothing is created before the index is accepted");
    }
}
