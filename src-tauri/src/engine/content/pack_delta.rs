use crate::engine::*;
use serde_json::Value;
use std::collections::HashSet;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use tauri::AppHandle;

const INDEX_VERSION: u64 = 1;
const LOCAL_HEADER: u32 = 0x04034b50;
const LOCAL_HEADER_LEN: u64 = 30;
const FLAG_ENCRYPTED: u16 = 0x0001;
const FLAG_STRONG_ENCRYPTION: u16 = 0x0040;
const METHOD_STORED: u16 = 0;
const METHOD_DEFLATED: u16 = 8;

/// Past this share of the archive one sequential download is cheaper than many ranges.
const DELTA_SHARE_LIMIT: f64 = 0.4;
const MAX_REQUESTS: usize = 2000;
/// Unchanged bytes between two changed entries are downloaded rather than paid for with another round trip.
const MERGE_GAP: u64 = 1 << 20;
const GROUP_CAP: u64 = 64 << 20;
const RANGE_TRIES: u32 = 3;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DeltaEntry {
    pub(crate) rel: String,
    pub(crate) raw_name: String,
    pub(crate) crc: u32,
    pub(crate) size: u64,
    pub(crate) csize: u64,
    pub(crate) offset: u64,
    pub(crate) end: u64,
    pub(crate) method: u16,
    pub(crate) dir: bool,
}

#[derive(Debug)]
pub(crate) struct DeltaIndex {
    pub(crate) size: u64,
    pub(crate) entries: Vec<DeltaEntry>,
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub(crate) enum Action {
    Reuse,
    Fetch,
    MakeDir,
}

#[derive(Debug, Default)]
pub(crate) struct Plan {
    pub(crate) reuse: Vec<usize>,
    pub(crate) fetch: Vec<usize>,
    pub(crate) dirs: Vec<usize>,
}

#[derive(Debug, PartialEq)]
pub(crate) struct Group {
    pub(crate) from: u64,
    pub(crate) to: u64,
    pub(crate) members: Vec<usize>,
}

pub(crate) struct DeltaReport {
    pub(crate) reused: usize,
    pub(crate) fetched: usize,
    pub(crate) fetched_bytes: u64,
    pub(crate) archive_bytes: u64,
}

fn num(v: &Value) -> Option<u64> {
    v.as_u64()
}

/// Only names that the whole-archive unzip writes under the very same path
/// are accepted, so both roads build one tree. Anything the unzip would
/// normalise or skip sends the update down the full download.
fn canonical_rel(name: &str) -> Option<(String, bool)> {
    let dir = name.ends_with('/');
    let rel = name.strip_suffix('/').unwrap_or(name);
    if rel.is_empty() || rel.starts_with('/') || rel.contains('\\') || rel.contains('\0') {
        return None;
    }
    if rel.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..") {
        return None;
    }
    rel_path_ok(rel).then(|| (rel.to_string(), dir))
}

pub(crate) fn parse_index(v: &Value, archive_size: u64) -> Result<DeltaIndex, String> {
    if num(&v["v"]) != Some(INDEX_VERSION) {
        return Err("сервер не знает такого оглавления".into());
    }
    let rows = v["entries"].as_array().ok_or("у архива нет оглавления для обновления по частям")?;
    let size = num(&v["size"]).ok_or("в оглавлении нет размера архива")?;
    let directory = num(&v["directoryOffset"]).ok_or("в оглавлении нет начала каталога")?;
    if archive_size > 0 && size != archive_size {
        return Err(format!("оглавление описывает архив {} байт, а ссылка ведёт на {}", size, archive_size));
    }
    if directory > size || rows.is_empty() {
        return Err("оглавление не сходится с архивом".into());
    }
    let mut entries = Vec::with_capacity(rows.len());
    let mut files = HashSet::new();
    let mut dirs = HashSet::new();
    let mut declared = 0u64;
    for row in rows {
        let r = row.as_array().filter(|r| r.len() == 6).ok_or("строка оглавления неполная")?;
        let name = r[0].as_str().ok_or("в оглавлении запись без имени")?;
        let (rel, dir) = canonical_rel(name).ok_or_else(|| format!("путь «{}» распаковка записала бы иначе", name))?;
        let crc = num(&r[1]).and_then(|c| u32::try_from(c).ok()).ok_or("битая контрольная сумма в оглавлении")?;
        let (Some(fsize), Some(csize), Some(offset)) = (num(&r[2]), num(&r[3]), num(&r[4])) else {
            return Err(format!("битые размеры записи «{}»", name));
        };
        let method = num(&r[5]).and_then(|m| u16::try_from(m).ok()).ok_or("битый метод сжатия в оглавлении")?;
        let folded = rel.to_lowercase();
        let fresh = if dir { dirs.insert(folded) } else { files.insert(folded) };
        if !fresh && !dir {
            return Err(format!("в архиве дважды лежит «{}»", rel));
        }
        declared = declared.saturating_add(fsize);
        entries.push(DeltaEntry { rel, raw_name: name.to_string(), crc, size: fsize, csize, offset, end: 0, method, dir });
    }
    if files.iter().any(|f| dirs.contains(f)) {
        return Err("в архиве одно имя служит и файлом, и папкой".into());
    }
    if declared > UNPACK_CEILING {
        return Err("архив распаковывается больше допустимого".into());
    }
    entries.sort_by_key(|e| e.offset);
    for i in 0..entries.len() {
        let end = entries.get(i + 1).map_or(directory, |n| n.offset);
        let e = &mut entries[i];
        if end <= e.offset || end - e.offset < LOCAL_HEADER_LEN + e.raw_name.len() as u64 + e.csize {
            return Err(format!("запись «{}» не помещается в своё место в архиве", e.rel));
        }
        e.end = end;
    }
    Ok(DeltaIndex { size, entries })
}

/// `local_crc` is asked only when the sizes already agree: hashing a gigabyte
/// of files that differ by size would buy nothing.
pub(crate) fn decide(entry: &DeltaEntry, local_size: Option<u64>, local_crc: impl FnOnce() -> Option<u32>) -> Action {
    if entry.dir {
        return Action::MakeDir;
    }
    match local_size {
        Some(n) if n == entry.size && local_crc() == Some(entry.crc) => Action::Reuse,
        _ => Action::Fetch,
    }
}

fn crc_of_reader<R: Read>(mut r: R) -> std::io::Result<u32> {
    let mut crc = flate2::Crc::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            return Ok(crc.sum());
        }
        crc.update(&buf[..n]);
    }
}

fn local_size(path: &Path) -> Option<u64> {
    std::fs::symlink_metadata(path).ok().filter(|m| m.is_file()).map(|m| m.len())
}

pub(crate) fn make_plan(index: &DeltaIndex, installed: &Path) -> Result<Plan, String> {
    let mut plan = Plan::default();
    for (i, e) in index.entries.iter().enumerate() {
        let local = safe_join(installed, &e.rel)?;
        let action = decide(e, local_size(&local), || {
            std::fs::File::open(&local).ok().and_then(|f| crc_of_reader(f).ok())
        });
        match action {
            Action::Reuse => plan.reuse.push(i),
            Action::Fetch => plan.fetch.push(i),
            Action::MakeDir => plan.dirs.push(i),
        }
    }
    Ok(plan)
}

pub(crate) fn groups(index: &DeltaIndex, fetch: &[usize]) -> Vec<Group> {
    let mut sorted = fetch.to_vec();
    sorted.sort_by_key(|&i| index.entries[i].offset);
    let mut out: Vec<Group> = Vec::new();
    for i in sorted {
        let e = &index.entries[i];
        match out.last_mut() {
            Some(g) if e.offset - g.to <= MERGE_GAP && e.end - g.from <= GROUP_CAP => {
                g.to = e.end;
                g.members.push(i);
            }
            _ => out.push(Group { from: e.offset, to: e.end, members: vec![i] }),
        }
    }
    out
}

pub(crate) fn worth_it(index: &DeltaIndex, groups: &[Group]) -> Result<(), String> {
    let need = groups.iter().map(|g| g.to - g.from).sum::<u64>();
    if need as f64 > index.size as f64 * DELTA_SHARE_LIMIT {
        return Err(format!("изменилось {:.0}% архива", 100.0 * need as f64 / index.size.max(1) as f64));
    }
    if groups.len() > MAX_REQUESTS {
        return Err(format!("изменения разбросаны по {} кускам", groups.len()));
    }
    Ok(())
}

fn place_reused(from: &Path, to: &Path) -> std::io::Result<()> {
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if std::fs::hard_link(from, to).is_ok() {
        return Ok(());
    }
    std::fs::copy(from, to).map(|_| ())
}

pub(crate) fn assemble_reused(index: &DeltaIndex, plan: &Plan, installed: &Path, into: &Path) -> Result<(), String> {
    for &i in &plan.dirs {
        let dir = safe_join(into, &index.entries[i].rel)?;
        std::fs::create_dir_all(&dir).map_err(|e| io_fail("Сборка обновления", &dir, &e))?;
    }
    for &i in &plan.reuse {
        let e = &index.entries[i];
        let (src, dst) = (safe_join(installed, &e.rel)?, safe_join(into, &e.rel)?);
        place_reused(&src, &dst).map_err(|err| io_fail("Сборка обновления", &dst, &err))?;
    }
    Ok(())
}

fn read_u16(b: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([b[at], b[at + 1]])
}

/// Inflates one entry from a downloaded span into `out`. The span is trusted
/// no further than its CRC: a local header that disagrees with the index or
/// data that does not inflate to the declared bytes refuses the entry.
pub(crate) fn extract_entry<R: Read + Seek, W: Write>(src: &mut R, base: u64, e: &DeltaEntry, out: &mut W) -> Result<(), String> {
    let bad = |why: &str| format!("запись «{}»: {}", e.rel, why);
    src.seek(SeekFrom::Start(e.offset - base)).map_err(|err| bad(&err.to_string()))?;
    let mut head = [0u8; LOCAL_HEADER_LEN as usize];
    src.read_exact(&mut head).map_err(|_| bad("кусок архива короче заголовка"))?;
    if u32::from_le_bytes([head[0], head[1], head[2], head[3]]) != LOCAL_HEADER {
        return Err(bad("по смещению из оглавления нет заголовка записи"));
    }
    if read_u16(&head, 6) & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION) != 0 {
        return Err(bad("запись зашифрована"));
    }
    if read_u16(&head, 8) != e.method {
        return Err(bad("метод сжатия не совпал с оглавлением"));
    }
    let (name_len, extra_len) = (read_u16(&head, 26) as u64, read_u16(&head, 28) as u64);
    if LOCAL_HEADER_LEN + name_len + extra_len + e.csize > e.end - e.offset {
        return Err(bad("данные выходят за границу записи"));
    }
    let mut name = vec![0u8; name_len as usize];
    src.read_exact(&mut name).map_err(|_| bad("кусок архива оборван"))?;
    if name != e.raw_name.as_bytes() {
        return Err(bad("имя в заголовке не совпало с оглавлением"));
    }
    src.seek(SeekFrom::Current(extra_len as i64)).map_err(|err| bad(&err.to_string()))?;
    let data = Read::take(&mut *src, e.csize);
    let mut reader: Box<dyn Read + '_> = match e.method {
        METHOD_STORED => Box::new(data),
        METHOD_DEFLATED => Box::new(flate2::read::DeflateDecoder::new(data)),
        _ => return Err(bad("метод сжатия не поддерживается при обновлении по частям")),
    };
    let mut crc = flate2::Crc::new();
    let mut written = 0u64;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|_| bad("данные не распаковываются"))?;
        if n == 0 {
            break;
        }
        written += n as u64;
        if written > e.size {
            return Err(bad("распаковывается больше, чем заявлено"));
        }
        crc.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|err| bad(&err.to_string()))?;
    }
    if written != e.size || crc.sum() != e.crc {
        return Err(bad("контрольная сумма не сошлась"));
    }
    Ok(())
}

pub(crate) fn extract_group(span: &Path, group: &Group, index: &DeltaIndex, into: &Path) -> Result<(), String> {
    let mut src = std::io::BufReader::new(std::fs::File::open(span).map_err(|e| io_fail("Обновление", span, &e))?);
    for &i in &group.members {
        let e = &index.entries[i];
        let dst = safe_join(into, &e.rel)?;
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent).map_err(|err| io_fail("Обновление", parent, &err))?;
        }
        let mut out = std::fs::File::create(&dst).map_err(|err| io_fail("Обновление", &dst, &err))?;
        if let Err(err) = extract_entry(&mut src, group.from, e, &mut out) {
            drop(out);
            let _ = std::fs::remove_file(&dst);
            return Err(err);
        }
    }
    Ok(())
}

fn count_files(dir: &Path) -> std::io::Result<usize> {
    let mut n = 0;
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            n += count_files(&entry.path())?;
        } else {
            n += 1;
        }
    }
    Ok(n)
}

/// The assembled tree against the index as a whole: every file present with
/// its declared size and nothing beyond them.
pub(crate) fn verify_tree(index: &DeltaIndex, into: &Path) -> Result<(), String> {
    let mut files = 0usize;
    for e in index.entries.iter().filter(|e| !e.dir) {
        let path = safe_join(into, &e.rel)?;
        if local_size(&path) != Some(e.size) {
            return Err(format!("после сборки «{}» не того размера", e.rel));
        }
        files += 1;
    }
    let found = count_files(into).map_err(|e| io_fail("Проверка обновления", into, &e))?;
    if found != files {
        return Err(format!("в собранной версии {} файлов вместо {}", found, files));
    }
    Ok(())
}

/// `bytes a-b/total` exactly as asked; a server that answers another span or
/// the whole file is not a server this update can trust byte offsets from.
pub(crate) fn content_range_ok(header: Option<&str>, from: u64, to_exclusive: u64, total: u64) -> bool {
    let Some(rest) = header.and_then(|h| h.trim().strip_prefix("bytes ")) else { return false };
    let Some((span, whole)) = rest.split_once('/') else { return false };
    let Some((a, b)) = span.split_once('-') else { return false };
    a.parse::<u64>().ok() == Some(from) && b.parse::<u64>().ok() == Some(to_exclusive - 1) && whole.parse::<u64>().ok() == Some(total)
}

async fn fetch_span_once(url: &str, group: &Group, total: u64, dest: &Path, job: &Job, on: &(dyn Fn(u64) + Send + Sync)) -> Result<(), String> {
    let cancel = Some(job.cancel_flag());
    let req = client().get(url).header(reqwest::header::RANGE, format!("bytes={}-{}", group.from, group.to - 1));
    let resp = or_pause(req.send(), cancel).await?.map_err(|e| net_err(&e))?;
    if !super::catalog_pack::pack_url_allowed(resp.url().as_str()) {
        return Err("хранилище перенаправило на чужой адрес".into());
    }
    if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!("хранилище ответило {} вместо куска архива", resp.status()));
    }
    let range = resp.headers().get(reqwest::header::CONTENT_RANGE).and_then(|v| v.to_str().ok()).map(String::from);
    if !content_range_ok(range.as_deref(), group.from, group.to, total) {
        return Err(format!("хранилище прислало не тот кусок ({})", range.unwrap_or_default()));
    }
    let want = group.to - group.from;
    let mut file = std::fs::File::create(dest).map_err(|e| io_fail("Обновление", dest, &e))?;
    let mut got = 0u64;
    let mut resp = resp;
    while let Some(chunk) = or_pause(resp.chunk(), cancel).await?.map_err(|e| format!("обрыв загрузки ({})", net_err(&e)))? {
        got += chunk.len() as u64;
        if got > want {
            return Err("хранилище прислало больше, чем просили".into());
        }
        file.write_all(&chunk).map_err(|e| io_fail("Обновление", dest, &e))?;
        on(chunk.len() as u64);
    }
    file.flush().map_err(|e| io_fail("Обновление", dest, &e))?;
    if got != want {
        return Err(format!("кусок архива оборвался: {} из {} байт", got, want));
    }
    Ok(())
}

async fn fetch_span(url: &str, group: &Group, total: u64, dest: &Path, job: &Job, on: &(dyn Fn(u64) + Send + Sync)) -> Result<(), String> {
    let mut last = String::new();
    let mut attempt = 1;
    let best = std::sync::atomic::AtomicU64::new(0);
    while attempt <= RANGE_TRIES {
        // Each try rewrites the group from its start: only bytes past the best
        // mark are new, or a resumed group would push the bar past real bytes.
        let mine = std::sync::atomic::AtomicU64::new(0);
        let counted = |n: u64| {
            let now = mine.fetch_add(n, Ordering::Relaxed) + n;
            let grown = now.saturating_sub(best.fetch_max(now, Ordering::Relaxed));
            if grown > 0 {
                on(grown);
            }
        };
        match fetch_span_once(url, group, total, dest, job, &counted).await {
            Ok(()) => return Ok(()),
            Err(e) if e == CANCELLED || job.cancelled() => return Err(CANCELLED.into()),
            // A group is rewritten from its start, so a pause costs at most one
            // group and never an attempt.
            Err(e) if e == PAUSED => {
                job.cancel_flag().gate().await?;
                continue;
            }
            Err(e) if e.contains("вместо куска") || e.contains("не тот кусок") || e.contains("чужой адрес") => return Err(e),
            Err(e) => last = e,
        }
        if attempt < RANGE_TRIES {
            tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
        }
        attempt += 1;
    }
    Err(last)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

pub(crate) struct DeltaSource<'a> {
    pub(crate) file_id: &'a str,
    pub(crate) url: &'a str,
    pub(crate) archive_size: u64,
    pub(crate) installed: &'a Path,
    pub(crate) into: &'a Path,
    pub(crate) span_file: &'a Path,
}

/// Builds the next version of an installed pack from the files it already has
/// plus the changed entries of the new archive. Any error leaves the caller to
/// download the archive whole; a cancel is passed through as is.
pub(crate) async fn build_by_delta(app: &AppHandle, job: &Job, s: DeltaSource<'_>) -> Result<DeltaReport, String> {
    let answer = millida_api_auth(format!("/catalog/packs/files/{}/index", s.file_id), "GET".into(), None).await?;
    let index = std::sync::Arc::new(parse_index(&answer, s.archive_size)?);
    job.emit(app, 10.0, "Сверяем файлы сборки…");
    let (idx, installed) = (index.clone(), s.installed.to_path_buf());
    let plan = std::sync::Arc::new(blocking(move || make_plan(&idx, &installed)).await?);
    job.check()?;
    let spans = groups(&index, &plan.fetch);
    worth_it(&index, &spans)?;

    let (idx, pl, installed, into) = (index.clone(), plan.clone(), s.installed.to_path_buf(), s.into.to_path_buf());
    blocking(move || {
        let _ = std::fs::remove_dir_all(&into);
        std::fs::create_dir_all(&into).map_err(|e| io_fail("Сборка обновления", &into, &e))?;
        assemble_reused(&idx, &pl, &installed, &into)
    })
    .await?;
    job.check()?;

    let total: u64 = spans.iter().map(|g| g.to - g.from).sum();
    let done = std::sync::atomic::AtomicU64::new(0);
    let seen = std::sync::atomic::AtomicU64::new(u64::MAX);
    let report = |n: u64| {
        let now = done.fetch_add(n, Ordering::Relaxed) + n;
        let pct = 12.0 + 58.0 * (now as f64 / total.max(1) as f64) as f32;
        let step = (pct * 2.0) as u64;
        if seen.swap(step, Ordering::Relaxed) != step {
            job.emit(app, pct.min(70.0), &format!("Скачиваем изменения… {}", super::catalog_pack::fmt_bytes(now, total)));
        }
    };
    job.emit(app, 12.0, "Скачиваем изменения…");
    for group in spans {
        fetch_span(s.url, &group, index.size, s.span_file, job, &report).await?;
        let (idx, span, into) = (index.clone(), s.span_file.to_path_buf(), s.into.to_path_buf());
        blocking(move || extract_group(&span, &group, &idx, &into)).await?;
        job.check()?;
    }
    let _ = std::fs::remove_file(s.span_file);

    let (idx, into) = (index.clone(), s.into.to_path_buf());
    blocking(move || verify_tree(&idx, &into)).await?;
    Ok(DeltaReport { reused: plan.reuse.len(), fetched: plan.fetch.len(), fetched_bytes: total, archive_bytes: index.size })
}


pub(crate) enum AfterDelta {
    Built(DeltaReport),
    Cancelled,
    Full(String),
}

/// A cancel stops the update; every other failure of the partial road, a CRC
/// that did not match included, falls back to the whole archive, which carries
/// its own sha512.
pub(crate) fn after_delta(result: Result<DeltaReport, String>) -> AfterDelta {
    match result {
        Ok(report) => AfterDelta::Built(report),
        Err(e) if e == CANCELLED => AfterDelta::Cancelled,
        Err(e) => AfterDelta::Full(e),
    }
}

pub(crate) fn delta_dir(pdir: &Path) -> Result<PathBuf, String> {
    let name = pdir.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty());
    match (name, pdir.parent()) {
        (Some(name), Some(root)) => Ok(root.join(format!(".millida-delta-{}", name))),
        _ => Err("Некорректная папка сборки".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("millida-pack-delta-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn zip_of(files: &[(&str, &[u8], zip::CompressionMethod)]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body, method) in files {
            let opts = zip::write::SimpleFileOptions::default().compression_method(*method);
            if name.ends_with('/') {
                z.add_directory(name.trim_end_matches('/'), opts).unwrap();
            } else {
                z.start_file(*name, opts).unwrap();
                z.write_all(body).unwrap();
            }
        }
        z.finish().unwrap().into_inner()
    }

    /// The answer the API gives for these bytes: the same rows pack-delta-index
    /// builds from the central directory.
    fn index_json(bytes: &[u8]) -> Value {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes.to_vec())).unwrap();
        let eocd = bytes.windows(4).rposition(|w| w == b"PK\x05\x06").unwrap();
        let directory = u32::from_le_bytes(bytes[eocd + 16..eocd + 20].try_into().unwrap());
        let rows: Vec<Value> = (0..zip.len())
            .map(|i| {
                let f = zip.by_index_raw(i).unwrap();
                let method = match f.compression() {
                    zip::CompressionMethod::Stored => 0,
                    _ => 8,
                };
                serde_json::json!([f.name(), f.crc32(), f.size(), f.compressed_size(), f.header_start(), method])
            })
            .collect();
        serde_json::json!({ "v": 1, "size": bytes.len(), "directoryOffset": directory, "entries": rows })
    }

    fn entry(rel: &str, size: u64, crc: u32) -> DeltaEntry {
        DeltaEntry { rel: rel.into(), raw_name: rel.into(), crc, size, csize: size, offset: 0, end: 0, method: 0, dir: false }
    }

    /// entry vs the installed file -> action. Reusing a file that differs
    /// ships the old bytes under the new version; fetching one that matches
    /// is the whole-pack download this change exists to avoid.
    #[test]
    fn installed_file_against_the_index_decides_reuse_or_fetch() {
        let e = entry("config/MetaLib.cfg", 4456, 0xDEAD_BEEF);
        let mut dir = e.clone();
        dir.dir = true;
        type Case<'a> = (&'a DeltaEntry, Option<u64>, Option<u32>, Action, &'a str);
        let cases: &[Case] = &[
            (&e, None, None, Action::Fetch, "новый файл: в установленной версии его нет"),
            (&e, Some(4455), None, Action::Fetch, "размер другой: файл изменился, считать CRC незачем"),
            (&e, Some(4456), Some(0x1234_5678), Action::Fetch, "размер тот же, содержимое другое: подмена того же размера"),
            (&e, Some(4456), None, Action::Fetch, "файл не читается: доверять нечему"),
            (&e, Some(4456), Some(0xDEAD_BEEF), Action::Reuse, "без изменений: берётся с диска"),
            (&dir, None, None, Action::MakeDir, "папка создаётся, качать нечего"),
        ];
        for (e, size, crc, want, why) in cases {
            let asked = std::cell::Cell::new(false);
            let got = decide(e, *size, || {
                asked.set(true);
                *crc
            });
            assert_eq!(got, *want, "{why}");
            if size.is_some_and(|s| s != e.size) {
                assert!(!asked.get(), "{why}: CRC файлов другого размера — лишнее чтение гигабайта с диска");
            }
        }
    }

    /// index -> accepted. A path the whole-archive unzip would normalise or
    /// skip must send the update to the full download, otherwise the two roads
    /// build different trees; a path out of the folder must never be written.
    #[test]
    fn index_paths_and_layout_are_checked_before_anything_is_written() {
        let ok = |rows: Value| serde_json::json!({ "v": 1, "size": 1000, "directoryOffset": 900, "entries": rows });
        let row = |p: &str, off: u64| serde_json::json!([p, 1, 10, 10, off, 0]);
        let cases: &[(Value, u64, bool, &str)] = &[
            (ok(serde_json::json!([row("mods/a.jar", 0), row("config/", 100)])), 1000, true, "обычное оглавление"),
            (ok(serde_json::json!([row("../evil.jar", 0)])), 1000, false, "выход из папки сборки"),
            (ok(serde_json::json!([row("/etc/passwd", 0)])), 1000, false, "абсолютный путь"),
            (ok(serde_json::json!([row("C:/Windows/x.dll", 0)])), 1000, false, "буква диска"),
            (ok(serde_json::json!([row("mods\\a.jar", 0)])), 1000, false, "обратная косая: распаковка записала бы иначе"),
            (ok(serde_json::json!([row("mods/./a.jar", 0)])), 1000, false, "точка в пути: распаковка нормализует"),
            (ok(serde_json::json!([row("mods/con.jar", 0)])), 1000, false, "имя устройства Windows"),
            (ok(serde_json::json!([row("A.txt", 0), row("a.txt", 100)])), 1000, false, "два файла, которые Windows считает одним"),
            (ok(serde_json::json!([row("a.jar", 0), row("b.jar", 20)])), 1000, false, "записи налезают друг на друга"),
            (ok(serde_json::json!([row("a.jar", 0)])), 999, false, "ссылка ведёт на другой архив"),
            (serde_json::json!({ "v": 1, "entries": null }), 1000, false, "сервер не дал оглавления"),
            (serde_json::json!({ "v": 2, "size": 1000, "directoryOffset": 900, "entries": [] }), 1000, false, "незнакомая версия оглавления"),
        ];
        for (v, size, accepted, why) in cases {
            assert_eq!(parse_index(v, *size).is_ok(), *accepted, "{why}: {:?}", parse_index(v, *size).err());
        }
    }

    /// Range chunk -> file bytes, for both methods pack archives use. The CRC
    /// is the only thing between a corrupted range and a broken mod on disk.
    #[test]
    fn an_entry_inflates_from_its_range_and_is_checked_by_crc() {
        let text = b"max_players=12\n".repeat(300);
        let jar = vec![7u8; 5000];
        let bytes = zip_of(&[
            ("config/a.cfg", &text, zip::CompressionMethod::Deflated),
            ("mods/a.jar", &jar, zip::CompressionMethod::Stored),
        ]);
        let index = parse_index(&index_json(&bytes), bytes.len() as u64).unwrap();
        let methods: Vec<u16> = index.entries.iter().map(|e| e.method).collect();
        assert_eq!(methods, vec![METHOD_DEFLATED, METHOD_STORED], "проверяются оба метода, которыми пакуют сборки");
        for (e, want) in index.entries.iter().zip([&text[..], &jar[..]]) {
            let span = bytes[e.offset as usize..e.end as usize].to_vec();
            let mut out = Vec::new();
            extract_entry(&mut Cursor::new(span.clone()), e.offset, e, &mut out).unwrap_or_else(|err| panic!("{}: {err}", e.rel));
            assert_eq!(out, want, "«{}» (метод {}) распаковался не в те байты", e.rel, e.method);

            let mut lying = e.clone();
            lying.crc ^= 1;
            let err = extract_entry(&mut Cursor::new(span.clone()), e.offset, &lying, &mut Vec::new()).expect_err("чужой CRC обязан отклоняться");
            assert!(err.contains("контрольная сумма"), "{err}");

            let mut shifted = span.clone();
            shifted.insert(0, 0);
            let err = extract_entry(&mut Cursor::new(shifted), e.offset, e, &mut Vec::new()).expect_err("кусок не с того места");
            assert!(err.contains("заголовка записи"), "{err}");
        }
    }

    /// A failed entry leaves no file behind: a half-written jar must not look
    /// like a present one.
    #[test]
    fn a_bad_entry_leaves_no_file_and_fails_the_group() {
        let body = b"hello".repeat(100);
        let bytes = zip_of(&[("config/a.cfg", &body, zip::CompressionMethod::Deflated)]);
        let mut index = parse_index(&index_json(&bytes), bytes.len() as u64).unwrap();
        index.entries[0].crc ^= 1;
        let base = scratch("bad");
        let span = base.join("span");
        std::fs::write(&span, &bytes[..index.entries[0].end as usize]).unwrap();
        let into = base.join("into");
        let group = Group { from: 0, to: index.entries[0].end, members: vec![0] };
        assert!(extract_group(&span, &group, &index, &into).is_err(), "несовпавший CRC обязан остановить сборку версии");
        assert!(!into.join("config/a.cfg").exists(), "недописанный файл убран");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Installed version + next archive -> assembled tree, compared with the
    /// plain unzip of the same archive: both roads must end in the very same
    /// folder, byte for byte.
    #[test]
    fn delta_build_equals_the_full_unzip() {
        let base = scratch("e2e");
        let installed = base.join("installed");
        let old: &[(&str, &[u8])] = &[
            ("mods/AE2-client.jar", b"ae2 old"),
            ("mods/jei.jar", b"jei same"),
            ("config/MetaLib.cfg", b"lib old"),
            ("config/metacomposite/title.json5", b"removed in the next version"),
            ("options.txt", b"player options"),
        ];
        for (rel, body) in old {
            let p = installed.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
        let big = vec![3u8; 3 << 20];
        let bytes = zip_of(&[
            ("mods/", b"", zip::CompressionMethod::Stored),
            ("mods/AE2-client.jar", b"ae2 new", zip::CompressionMethod::Stored),
            ("mods/jei.jar", b"jei same", zip::CompressionMethod::Stored),
            ("mods/big.jar", &big, zip::CompressionMethod::Stored),
            ("config/MetaLib.cfg", b"lib new", zip::CompressionMethod::Deflated),
            ("config/new.json", b"{}", zip::CompressionMethod::Deflated),
            ("options.txt", b"pack options", zip::CompressionMethod::Deflated),
            ("empty/", b"", zip::CompressionMethod::Stored),
        ]);
        let index = parse_index(&index_json(&bytes), bytes.len() as u64).unwrap();
        let plan = make_plan(&index, &installed).unwrap();
        let fetched: Vec<&str> = plan.fetch.iter().map(|&i| index.entries[i].rel.as_str()).collect();
        let reused: Vec<&str> = plan.reuse.iter().map(|&i| index.entries[i].rel.as_str()).collect();
        assert_eq!(reused, vec!["mods/jei.jar"], "взять с диска можно только совпавшее по CRC");
        for want in ["mods/AE2-client.jar", "config/MetaLib.cfg", "config/new.json", "options.txt", "mods/big.jar"] {
            assert!(fetched.contains(&want), "«{want}» изменён или новый — качается");
        }
        let spans = groups(&index, &plan.fetch);
        assert!(spans.len() < plan.fetch.len(), "соседние изменённые записи идут одним запросом");

        let into = base.join("delta");
        std::fs::create_dir_all(&into).unwrap();
        assemble_reused(&index, &plan, &installed, &into).unwrap();
        for (n, g) in spans.iter().enumerate() {
            let span = base.join(format!("span{n}"));
            std::fs::write(&span, &bytes[g.from as usize..g.to as usize]).unwrap();
            extract_group(&span, g, &index, &into).unwrap();
        }
        verify_tree(&index, &into).expect("собранная версия сходится с оглавлением");

        let archive = base.join("full.zip");
        std::fs::write(&archive, &bytes).unwrap();
        let full = base.join("full");
        unzip_to(&archive, &full).unwrap();
        assert_eq!(snapshot(&into), snapshot(&full), "обновление по частям обязано дать ту же папку, что и полная распаковка");
        assert!(!into.join("config/metacomposite/title.json5").exists(), "удалённый в новой версии файл в неё не попадает");
        assert_eq!(std::fs::read(installed.join("config/MetaLib.cfg")).unwrap(), b"lib old", "до подмены установленная версия не трогается");

        std::fs::write(into.join("stray.txt"), b"x").unwrap();
        assert!(verify_tree(&index, &into).is_err(), "лишний файл в собранной версии — несовпадение с оглавлением");
        let _ = std::fs::remove_dir_all(&base);
    }

    fn snapshot(root: &Path) -> Vec<(String, Option<Vec<u8>>)> {
        fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Option<Vec<u8>>)>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                if p.is_dir() {
                    out.push((rel, None));
                    walk(root, &p, out);
                } else {
                    out.push((rel, Some(std::fs::read(&p).unwrap())));
                }
            }
        }
        let mut out = Vec::new();
        walk(root, root, &mut out);
        out.sort();
        out
    }

    /// Share of the archive -> delta or whole download. OneBlock 1.0.10 needs
    /// 3.9% of its archive; a release that rewrote half the pack is cheaper as
    /// one sequential download.
    #[test]
    fn a_large_change_goes_to_the_full_download() {
        let index = DeltaIndex { size: 1000, entries: Vec::new() };
        let span = |from: u64, to: u64| Group { from, to, members: vec![0] };
        assert!(worth_it(&index, &[span(0, 39)]).is_ok(), "мелкая правка качается по частям");
        assert!(worth_it(&index, &[span(0, 300), span(500, 600)]).is_ok(), "40% ровно ещё по частям");
        assert!(worth_it(&index, &[span(0, 401)]).is_err(), "больше 40% — целиком");
        let many: Vec<Group> = (0..=MAX_REQUESTS as u64).map(|i| span(i, i + 1)).collect();
        let index = DeltaIndex { size: u64::MAX / 2, entries: Vec::new() };
        assert!(worth_it(&index, &many).is_err(), "тысячи мелких запросов дороже одного архива");
    }

    /// Changed entries close together go in one request; far apart or past
    /// the size cap they split, so no single span grows without bound.
    #[test]
    fn neighbouring_changes_share_a_request() {
        let at = |offset: u64, end: u64| DeltaEntry { offset, end, ..entry("x", 1, 0) };
        let index = DeltaIndex {
            size: 1 << 40,
            entries: vec![at(0, 100), at(100, 200), at(200, 300), at(300 + MERGE_GAP + 1, 400 + MERGE_GAP), at(1 << 30, (1 << 30) + GROUP_CAP)],
        };
        let got = groups(&index, &[0, 2, 3, 4]);
        assert_eq!(got[0], Group { from: 0, to: 300, members: vec![0, 2] }, "неизменённая запись между двумя изменёнными качается заодно");
        assert_eq!(got[1].members, vec![3], "за мегабайтом разрыва — новый запрос");
        assert_eq!(got[2].members, vec![4], "далёкая запись — своим запросом");
        assert_eq!(got.len(), 3);
    }

    /// Content-Range -> accepted. A 200 with the whole file, or another span,
    /// would put foreign bytes at the offsets the index names.
    #[test]
    fn only_the_exact_range_asked_for_is_accepted() {
        let cases: &[(Option<&str>, bool, &str)] = &[
            (Some("bytes 100-199/1000"), true, "ровно запрошенный кусок"),
            (Some("bytes 100-198/1000"), false, "кусок короче"),
            (Some("bytes 0-999/1000"), false, "весь файл вместо куска"),
            (Some("bytes 100-199/1001"), false, "другой архив под той же ссылкой"),
            (Some("bytes 100-199/*"), false, "размер неизвестен"),
            (None, false, "нет заголовка"),
        ];
        for (h, ok, why) in cases {
            assert_eq!(content_range_ok(*h, 100, 200, 1000), *ok, "{why}");
        }
    }

    /// Outcome of the partial road -> what the update does next. A partial
    /// failure never costs the player the update: the whole archive follows.
    #[test]
    fn any_partial_failure_falls_back_to_the_whole_archive() {
        let report = || DeltaReport { reused: 1, fetched: 1, fetched_bytes: 1, archive_bytes: 10 };
        let cases: &[(Result<(), &str>, &str, &str)] = &[
            (Ok(()), "built", "собралось по частям — архив не качается"),
            (Err(CANCELLED), "cancelled", "отмену игрок нажал сам, архив качать нельзя"),
            (Err("запись «config/a.cfg»: контрольная сумма не сошлась"), "full", "битый кусок — целый архив со своим sha512"),
            (Err("хранилище ответило 200 OK вместо куска архива"), "full", "щит не отдал Range"),
            (Err("хранилище ответило 416 Range Not Satisfiable вместо куска архива"), "full", "запрошенный кусок вне файла"),
            (Err("404 от /catalog/packs/files/x/index"), "full", "старый trade-api без оглавления"),
            (Err("изменилось 63% архива"), "full", "большая правка дешевле целиком"),
        ];
        for (input, want, why) in cases {
            let got = match after_delta((*input).map(|_| report()).map_err(String::from)) {
                AfterDelta::Built(_) => "built",
                AfterDelta::Cancelled => "cancelled",
                AfterDelta::Full(_) => "full",
            };
            assert_eq!(got, *want, "{why}");
        }
    }

    #[test]
    fn delta_folder_sits_beside_the_build_and_stays_out_of_the_list() {
        let pdir = std::env::temp_dir().join("profiles").join("OneBlock");
        let d = delta_dir(&pdir).unwrap();
        assert_eq!(d.parent(), pdir.parent(), "рядом со сборкой: жёсткие ссылки и переименование работают только на одном диске");
        assert!(d.file_name().unwrap().to_string_lossy().starts_with('.'), "папку без точки список сборок подхватит как сборку");
    }
}
