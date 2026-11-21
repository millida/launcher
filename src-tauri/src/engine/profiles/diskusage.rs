// Settings → «Место на диске»: what each build takes, split by folder, and cleanup of old
// logs and crash reports. Files the shared store hard-links into several builds are counted
// once, so the sum matches the disk. Worlds and screenshots are only measured, never removed.
use crate::engine::*;
use std::collections::HashMap;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// Logs and crash reports older than this are offered for removal.
pub const OLD_LOG_DAYS: u32 = 14;
const LOG_DIRS: [&str; 2] = ["logs", "crash-reports"];
/// Top-level folders of the game root that hold the builds and the shared store: the rest
/// (versions, libraries, assets, Java) is the game itself.
const OWN_DIRS: [&str; 2] = ["profiles", "objects"];

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildUsage {
    pub name: String,
    /// Bytes this build alone holds (shared files are in `shared`).
    pub total: u64,
    pub mods: u64,
    pub saves: u64,
    pub screenshots: u64,
    pub logs: u64,
    pub crash_reports: u64,
    pub resourcepacks: u64,
    pub shaderpacks: u64,
    pub other: u64,
    /// Files of the shared store this build uses (counted once, under `DiskUsage.shared`).
    pub shared: u64,
    /// What «clean old logs» frees in this build.
    pub old_logs: u64,
}

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    /// Largest first.
    pub builds: Vec<BuildUsage>,
    /// Shared-store files used by the builds, each counted once.
    pub shared: u64,
    /// What the builds would take if every shared file were a separate copy, minus what they take.
    pub saved: u64,
    /// Versions, libraries, assets and the rest of the game root.
    pub game: u64,
}

/// Identity of a file with more than one name (a hard link of the shared store).
type FileKey = (u64, u64);

#[cfg(unix)]
fn linked_key(_path: &Path, meta: &std::fs::Metadata) -> Option<FileKey> {
    use std::os::unix::fs::MetadataExt;
    (meta.nlink() > 1).then(|| (meta.dev(), meta.ino()))
}

#[cfg(windows)]
fn linked_key(path: &Path, _meta: &std::fs::Metadata) -> Option<FileKey> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION};
    let file = std::fs::File::open(path).ok()?;
    // SAFETY: a zeroed BY_HANDLE_FILE_INFORMATION is a valid value of a plain C struct, and the
    // handle stays open for the call because `file` lives until the end of this function.
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, &mut info) };
    if ok == 0 || info.nNumberOfLinks < 2 {
        return None;
    }
    Some((info.dwVolumeSerialNumber as u64, ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64))
}

#[cfg(not(any(unix, windows)))]
fn linked_key(_path: &Path, _meta: &std::fs::Metadata) -> Option<FileKey> {
    None
}

fn old_enough(meta: &std::fs::Metadata, cutoff: SystemTime) -> bool {
    meta.modified().map(|t| t < cutoff).unwrap_or(false)
}

/// Shared-store files seen so far, and how many builds reference each.
#[derive(Default)]
struct Seen {
    links: HashMap<FileKey, (u64, u32)>,
}

impl Seen {
    fn shared(&self) -> u64 {
        self.links.values().map(|(size, _)| size).sum()
    }
    fn saved(&self) -> u64 {
        self.links.values().map(|(size, refs)| size * u64::from(refs.saturating_sub(1))).sum()
    }
}

fn add(u: &mut BuildUsage, top: &str, bytes: u64) {
    let slot = match top {
        "mods" => &mut u.mods,
        "saves" => &mut u.saves,
        "screenshots" => &mut u.screenshots,
        "logs" => &mut u.logs,
        "crash-reports" => &mut u.crash_reports,
        "resourcepacks" => &mut u.resourcepacks,
        "shaderpacks" => &mut u.shaderpacks,
        _ => &mut u.other,
    };
    *slot += bytes;
    u.total += bytes;
}

/// Walks `dir` (a top-level folder `top` of a build) without following links.
fn walk(dir: &Path, top: &str, u: &mut BuildUsage, seen: &mut Seen, cutoff: SystemTime) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let may_link = dedup_shared_dir(top);
    for e in rd.flatten() {
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        if meta.is_dir() {
            walk(&e.path(), top, u, seen, cutoff);
            continue;
        }
        if !meta.is_file() {
            continue;
        }
        let len = meta.len();
        if may_link {
            if let Some(key) = linked_key(&e.path(), &meta) {
                let entry = seen.links.entry(key).or_insert((len, 0));
                entry.1 += 1;
                u.shared += len;
                continue;
            }
        }
        if LOG_DIRS.contains(&top) && old_enough(&meta, cutoff) {
            u.old_logs += len;
        }
        add(u, top, len);
    }
}

fn dedup_shared_dir(top: &str) -> bool {
    SHARED_DIRS.contains(&top)
}

fn measure_build(name: &str, dir: &Path, seen: &mut Seen, cutoff: SystemTime) -> BuildUsage {
    let mut u = BuildUsage { name: name.to_string(), ..Default::default() };
    let Ok(rd) = std::fs::read_dir(dir) else { return u };
    for e in rd.flatten() {
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        let top = e.file_name().to_string_lossy().to_string();
        if meta.is_dir() {
            walk(&e.path(), &top, &mut u, seen, cutoff);
        } else if meta.is_file() {
            add(&mut u, "", meta.len());
        }
    }
    u
}

fn cutoff_for(days: u32) -> SystemTime {
    SystemTime::now().checked_sub(Duration::from_secs(u64::from(days) * 86_400)).unwrap_or(SystemTime::UNIX_EPOCH)
}

/// Measures every build of the launcher. Slow on a big disk: call it off the UI thread.
pub fn disk_usage() -> DiskUsage {
    let cutoff = cutoff_for(OLD_LOG_DAYS);
    let mut seen = Seen::default();
    let mut builds: Vec<BuildUsage> =
        load_profiles().iter().map(|p| measure_build(&p.name, &profile_dir(&p.name), &mut seen, cutoff)).collect();
    builds.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.name.cmp(&b.name)));
    let root = game_root();
    let game = std::fs::read_dir(&root)
        .map(|rd| {
            rd.flatten()
                .filter(|e| !OWN_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
                .map(|e| match std::fs::symlink_metadata(e.path()) {
                    Ok(m) if m.is_dir() => dir_size(&e.path()),
                    Ok(m) => m.len(),
                    Err(_) => 0,
                })
                .sum()
        })
        .unwrap_or(0);
    DiskUsage { builds, shared: seen.shared(), saved: seen.saved(), game }
}

/// Removes logs and crash reports older than `days` from one build (`profile`) or from every
/// build that is not running. Worlds, configs and screenshots are never touched. Returns the
/// bytes freed.
pub fn clean_old_logs(profile: Option<String>, days: u32) -> Result<u64, String> {
    let running = running_games();
    let names: Vec<String> = match profile {
        Some(p) => {
            if running.contains(&p) {
                return Err("Закрой игру этой сборки, чтобы удалить её логи".into());
            }
            vec![p]
        }
        None => load_profiles().into_iter().map(|p| p.name).filter(|n| !running.contains(n)).collect(),
    };
    let cutoff = cutoff_for(days.max(1));
    let mut freed = 0;
    for name in names {
        let dir = profile_dir(&name);
        for sub in LOG_DIRS {
            freed += remove_old(&dir.join(sub), cutoff);
        }
    }
    Ok(freed)
}

fn remove_old(dir: &Path, cutoff: SystemTime) -> u64 {
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    let mut freed = 0;
    for e in rd.flatten() {
        let Ok(meta) = std::fs::symlink_metadata(e.path()) else { continue };
        if meta.is_dir() {
            freed += remove_old(&e.path(), cutoff);
            let _ = std::fs::remove_dir(e.path());
        } else if meta.is_file() && old_enough(&meta, cutoff) && std::fs::remove_file(e.path()).is_ok() {
            freed += meta.len();
        }
    }
    freed
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder per test, removed when dropped.
    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            let dir = std::env::temp_dir().join(format!("millida-disk-{tag}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn write(path: &Path, bytes: usize) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, vec![7u8; bytes]).unwrap();
    }

    fn age(path: &Path, days: u64) {
        let t = SystemTime::now() - Duration::from_secs(days * 86_400);
        std::fs::File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
    }

    #[test]
    fn a_build_is_split_by_folder_and_a_shared_file_counts_once() {
        let tmp = Scratch::new("split");
        let (a, b) = (tmp.path().join("A"), tmp.path().join("B"));
        write(&a.join("mods/own.jar"), 100);
        write(&a.join("saves/World/level.dat"), 50);
        write(&a.join("logs/latest.log"), 10);
        write(&a.join("logs/2026-10-01-1.log.gz"), 20);
        age(&a.join("logs/2026-10-01-1.log.gz"), 30);
        write(&a.join("options.txt"), 5);
        write(&tmp.path().join("store/sodium.jar"), 1000);
        std::fs::create_dir_all(b.join("mods")).unwrap();
        std::fs::hard_link(tmp.path().join("store/sodium.jar"), a.join("mods/sodium.jar")).unwrap();
        std::fs::hard_link(tmp.path().join("store/sodium.jar"), b.join("mods/sodium.jar")).unwrap();

        let cutoff = cutoff_for(OLD_LOG_DAYS);
        let mut seen = Seen::default();
        let ua = measure_build("A", &a, &mut seen, cutoff);
        let ub = measure_build("B", &b, &mut seen, cutoff);
        assert_eq!((ua.mods, ua.saves, ua.logs, ua.other, ua.total), (100, 50, 30, 5, 185), "the shared jar is not the build's own");
        assert_eq!(ua.old_logs, 20, "only the log older than two weeks is offered");
        assert_eq!((ua.shared, ub.shared, ub.total), (1000, 1000, 0));
        assert_eq!((seen.shared(), seen.saved()), (1000, 1000), "one copy on disk, one copy saved by the second build");
    }

    #[test]
    fn cleaning_takes_only_old_logs_and_reports() {
        let tmp = Scratch::new("clean");
        let old_log = tmp.path().join("logs/old.log.gz");
        let new_log = tmp.path().join("logs/latest.log");
        let old_crash = tmp.path().join("crash-reports/crash-2026-09-01.txt");
        write(&old_log, 40);
        write(&new_log, 7);
        write(&old_crash, 60);
        age(&old_log, 20);
        age(&old_crash, 40);
        let cutoff = cutoff_for(OLD_LOG_DAYS);
        let freed: u64 = LOG_DIRS.iter().map(|d| remove_old(&tmp.path().join(d), cutoff)).sum();
        assert_eq!(freed, 100);
        assert!(!old_log.exists() && !old_crash.exists());
        assert!(new_log.exists(), "a fresh log stays");
    }
}
