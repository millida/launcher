// Moves a whole modpack from Prism, MultiMC or Modrinth App. The source folder is only read. The copy is built next to it
// and gets its name after a comparison with the source file list. Through sysinfo it checks if that launcher is running (process names).
use crate::engine::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum MoveSource {
    Prism,
    MultiMc,
    ModrinthApp,
}

impl MoveSource {
    pub(crate) fn label(self) -> &'static str {
        match self {
            MoveSource::Prism => "Prism Launcher",
            MoveSource::MultiMc => "MultiMC",
            MoveSource::ModrinthApp => "Modrinth App",
        }
    }

    fn process_names(self) -> &'static [&'static str] {
        match self {
            MoveSource::Prism => &["prismlauncher"],
            MoveSource::MultiMc => &["multimc"],
            MoveSource::ModrinthApp => &["modrinth app", "modrinth-app", "modrinthapp", "theseus_gui"],
        }
    }
}

/// Only launchers that keep every build in its own folder can give one away
/// whole. A version inside a shared .minecraft shares mods and saves with its
/// neighbours, so taking it would take theirs too.
pub(crate) fn move_source_kind(dir: &Path) -> Option<MoveSource> {
    let meta = std::fs::symlink_metadata(dir).ok()?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return None;
    }
    let lower = |p: Option<&Path>| p.and_then(|x| x.file_name()).map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if dir.join("mmc-pack.json").is_file() && dir.join("instance.cfg").is_file() {
        let multimc = dir.ancestors().skip(1).any(|a| lower(Some(a)).contains("multimc"));
        return Some(if multimc { MoveSource::MultiMc } else { MoveSource::Prism });
    }
    let parent = dir.parent();
    let grand = parent.and_then(Path::parent);
    if lower(parent) == "profiles" && matches!(lower(grand).as_str(), "modrinthapp" | "com.modrinth.theseus") {
        return Some(MoveSource::ModrinthApp);
    }
    None
}

/// Prism and MultiMC keep the game one level down, next to their own
/// instance.cfg; a Modrinth App profile folder is the game folder itself.
fn source_game_dir(dir: &Path, kind: MoveSource) -> Option<PathBuf> {
    match kind {
        MoveSource::ModrinthApp => Some(dir.to_path_buf()),
        MoveSource::Prism | MoveSource::MultiMc => instance_game_dir(dir),
    }
}

/// Exact loader build the source pinned, so the moved build starts on the
/// same one instead of the recommended.
pub(crate) fn loader_version_of(dir: &Path) -> Option<String> {
    if let Some(v) = std::fs::read_to_string(dir.join("mmc-pack.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
        for c in v["components"].as_array().into_iter().flatten() {
            let uid = c["uid"].as_str().unwrap_or("");
            if matches!(uid, "net.fabricmc.fabric-loader" | "org.quiltmc.quilt-loader" | "net.minecraftforge" | "net.neoforged") {
                return c["version"].as_str().filter(|s| !s.is_empty()).map(str::to_string);
            }
        }
    }
    let v = std::fs::read_to_string(dir.join("profile.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())?;
    v["metadata"]["loader_version"]["id"]
        .as_str()
        .or(v["loader_version"]["id"].as_str())
        .or(v["metadata"]["loader_version"].as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Every regular file of a game folder with its size, keyed by a `/` path.
/// Links are left out the same way `copy_dir_all` leaves them out, and so are
/// launcher service files the copy drops: both sides are counted alike.
#[derive(Default, Debug, PartialEq, Clone)]
pub(crate) struct Manifest {
    pub(crate) files: BTreeMap<String, u64>,
}

impl Manifest {
    pub(crate) fn bytes(&self) -> u64 {
        self.files.values().sum()
    }
}

pub(crate) fn manifest_of(root: &Path) -> std::io::Result<Manifest> {
    let mut m = Manifest::default();
    walk_manifest(root, "", &mut m)?;
    Ok(m)
}

fn walk_manifest(dir: &Path, prefix: &str, m: &mut Manifest) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if is_launcher_service_file(&name) {
            continue;
        }
        let meta = std::fs::symlink_metadata(entry.path())?;
        if meta.file_type().is_symlink() {
            continue;
        }
        let rel = format!("{prefix}{name}");
        if meta.is_dir() {
            walk_manifest(&entry.path(), &format!("{rel}/"), m)?;
        } else if meta.is_file() {
            m.files.insert(rel, meta.len());
        }
    }
    Ok(())
}

#[derive(Debug, PartialEq)]
pub(crate) enum Mismatch {
    Missing(String),
    Size { path: String, want: u64, got: u64 },
    Content(String),
}

impl Mismatch {
    fn text(&self) -> String {
        match self {
            Mismatch::Missing(p) => format!("в копии нет файла {p}"),
            Mismatch::Size { path, want, got } => format!("файл {path} скопировался не целиком ({got} из {want} байт)"),
            Mismatch::Content(p) => format!("файл {p} в копии отличается от оригинала"),
        }
    }
}

/// Everything the source had must be in the copy with the same size. Extra
/// files in the copy are impossible (it starts empty) and are not a loss.
pub(crate) fn compare_manifests(src: &Manifest, dst: &Manifest) -> Result<(), Mismatch> {
    for (path, want) in &src.files {
        match dst.files.get(path) {
            None => return Err(Mismatch::Missing(path.clone())),
            Some(got) if got != want => return Err(Mismatch::Size { path: path.clone(), want: *want, got: *got }),
            Some(_) => {}
        }
    }
    Ok(())
}

/// Worlds and mods are what a player can not get back: those are compared
/// byte for byte, the rest (configs, logs, caches) by size.
pub(crate) fn needs_hash(rel: &str) -> bool {
    let low = rel.to_ascii_lowercase();
    low.starts_with("saves/") || low.starts_with("mods/")
}

fn hash_file(p: &Path) -> std::io::Result<[u8; 32]> {
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().into())
}

fn compare_contents(src_root: &Path, dst_root: &Path, m: &Manifest) -> Result<(), Mismatch> {
    for rel in m.files.keys().filter(|r| needs_hash(r)) {
        let a = hash_file(&src_root.join(rel)).map_err(|_| Mismatch::Content(rel.clone()))?;
        let b = hash_file(&dst_root.join(rel)).map_err(|_| Mismatch::Content(rel.clone()))?;
        if a != b {
            return Err(Mismatch::Content(rel.clone()));
        }
    }
    Ok(())
}

/// Whether `process` is the source launcher itself, by its process name.
fn is_launcher_process(kind: MoveSource, process: &str) -> bool {
    let name = process.to_lowercase();
    kind.process_names().contains(&name.strip_suffix(".exe").unwrap_or(&name))
}

/// Whether a running process stops the move: the source launcher itself
/// (it rewrites its instance files on exit) or a game started from this build.
pub(crate) fn process_blocks(kind: MoveSource, process: &str, cmdline: &str, instance: &str) -> bool {
    if is_launcher_process(kind, process) {
        return true;
    }
    let norm = |s: &str| s.replace('\\', "/").to_lowercase();
    let inst = norm(instance);
    !inst.is_empty() && norm(cmdline).contains(inst.trim_end_matches('/'))
}

/// What keeps a build from moving right now. The launcher (`game: false`) can be asked to quit
/// for the player; a game started from the build never is, its world is open.
#[derive(Clone, serde::Serialize, PartialEq, Eq, Debug)]
pub struct MoveBlocker {
    pub label: String,
    pub game: bool,
}

pub(crate) fn blocker_for(kind: MoveSource, process: &str) -> MoveBlocker {
    if is_launcher_process(kind, process) {
        MoveBlocker { label: kind.label().to_string(), game: false }
    } else {
        MoveBlocker { label: "Minecraft из этой сборки".to_string(), game: true }
    }
}

fn process_list() -> sysinfo::System {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always));
    sys
}

/// Every running process that holds the build in `dir`.
fn holders(sys: &sysinfo::System, kind: MoveSource, dir: &Path) -> Vec<(sysinfo::Pid, MoveBlocker)> {
    let inst = dir.to_string_lossy().to_string();
    let mut out = vec![];
    for (pid, p) in sys.processes() {
        let name = p.name().to_string_lossy().to_string();
        let cmd = p.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ");
        if process_blocks(kind, &name, &cmd, &inst) {
            out.push((*pid, blocker_for(kind, &name)));
        }
    }
    out
}

fn running_blockers(kind: MoveSource, dir: &Path) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for (_, b) in holders(&process_list(), kind, dir) {
        if !out.contains(&b.label) {
            out.push(b.label);
        }
    }
    out
}

/// Builds from the list of found ones, with their launcher; anything else is skipped.
fn move_sources(paths: &[String]) -> Vec<(MoveSource, PathBuf)> {
    paths
        .iter()
        .map(PathBuf::from)
        .filter(|d| is_vouched(d))
        .filter_map(|d| move_source_kind(&d).map(|k| (k, d)))
        .collect()
}

/// What holds the picked builds right now, each blocker once. The move panel polls it to keep
/// its button off while a source launcher or a game from one of the builds is open.
pub fn move_blockers(paths: Vec<String>) -> Vec<MoveBlocker> {
    let sys = process_list();
    let mut out: Vec<MoveBlocker> = vec![];
    for (kind, dir) in move_sources(&paths) {
        for (_, b) in holders(&sys, kind, &dir) {
            if !out.contains(&b) {
                out.push(b);
            }
        }
    }
    out
}

const CLOSE_WAIT: std::time::Duration = std::time::Duration::from_secs(10);
const CLOSE_POLL: std::time::Duration = std::time::Duration::from_millis(500);

/// Asks the launchers that hold the picked builds to quit, the way their own close button does,
/// and waits for them. Never kills a process: Prism writes its files on the way out. A game
/// started from a build is left alone. Returns the launchers still running, empty when all quit.
pub fn close_move_sources(paths: Vec<String>) -> Vec<String> {
    let sources = move_sources(&paths);
    let launchers = |sys: &sysinfo::System| {
        let mut out: Vec<(sysinfo::Pid, String)> = vec![];
        for (kind, dir) in &sources {
            for (pid, b) in holders(sys, *kind, dir) {
                if !b.game && !out.iter().any(|(p, _)| *p == pid) {
                    out.push((pid, b.label));
                }
            }
        }
        out
    };
    let sys = process_list();
    for (pid, _) in launchers(&sys) {
        quit::ask(&sys, pid);
    }
    let deadline = std::time::Instant::now() + CLOSE_WAIT;
    loop {
        let left = launchers(&process_list());
        if left.is_empty() || std::time::Instant::now() >= deadline {
            let mut labels: Vec<String> = vec![];
            for (_, l) in left {
                if !labels.contains(&l) {
                    labels.push(l);
                }
            }
            return labels;
        }
        std::thread::sleep(CLOSE_POLL);
    }
}

/// The polite quit of another program, per system: what its own close button would do.
mod quit {
    pub(super) fn ask(sys: &sysinfo::System, pid: sysinfo::Pid) {
        if os::ask(pid.as_u32()) {
            return;
        }
        #[cfg(unix)]
        {
            if let Some(p) = sys.process(pid) {
                let _ = p.kill_with(sysinfo::Signal::Term);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = sys;
        }
    }

    /// WM_CLOSE to every visible top-level window of the process, as if its title bar X was
    /// pressed. Nothing is killed when the program has no window or ignores the request.
    #[cfg(windows)]
    mod os {
        use windows_sys::Win32::Foundation::{HWND, LPARAM};
        use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, WM_CLOSE};

        struct Search {
            pid: u32,
            closed: bool,
        }

        // Called by the system for every top-level window; never stops early.
        unsafe extern "system" fn each(hwnd: HWND, param: LPARAM) -> i32 {
            // SAFETY: `param` is the address of the `Search` on the stack of `ask`, which outlives
            // the EnumWindows call that runs this callback on the same thread.
            let search = unsafe { &mut *(param as *mut Search) };
            let mut owner: u32 = 0;
            // SAFETY: plain query on a window handle the system just gave us.
            unsafe { GetWindowThreadProcessId(hwnd, &mut owner) };
            // SAFETY: same handle; posting WM_CLOSE only queues a message for its owner.
            if owner == search.pid && unsafe { IsWindowVisible(hwnd) } != 0 && unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) } != 0 {
                search.closed = true;
            }
            1
        }

        pub(super) fn ask(pid: u32) -> bool {
            let mut search = Search { pid, closed: false };
            // SAFETY: the callback only touches `search`, which lives until this call returns.
            unsafe { EnumWindows(Some(each), &mut search as *mut Search as LPARAM) };
            search.closed
        }
    }

    /// The same request the Dock's Quit sends: the app saves and exits on its own.
    #[cfg(target_os = "macos")]
    mod os {
        use objc2_app_kit::NSRunningApplication;

        pub(super) fn ask(pid: u32) -> bool {
            NSRunningApplication::runningApplicationWithProcessIdentifier(pid as libc::pid_t).is_some_and(|app| app.terminate())
        }
    }

    /// SIGTERM is the polite quit on Linux; the caller sends it.
    #[cfg(not(any(windows, target_os = "macos")))]
    mod os {
        pub(super) fn ask(_pid: u32) -> bool {
            false
        }
    }
}

fn sibling(dir: &Path, tag: &str) -> PathBuf {
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    dir.with_file_name(format!(".{name}.millida-{tag}"))
}

/// A half-made copy is removed on every way out except success.
struct Staging {
    path: PathBuf,
    keep: bool,
}

impl Drop for Staging {
    fn drop(&mut self) {
        if !self.keep {
            // The draft copy is deleted if the move did not finish.
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

#[derive(Clone, serde::Serialize)]
pub struct MoveCandidate {
    pub path: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    pub launcher: String,
    pub bytes: u64,
    pub files: u64,
    pub worlds: u32,
    pub mods: u32,
}

#[derive(Clone, serde::Serialize)]
pub struct MoveOutcome {
    pub profile: Profile,
}

fn count_worlds(game: &Path) -> u32 {
    std::fs::read_dir(game.join("saves"))
        .map(|rd| rd.flatten().filter(|e| e.path().join("level.dat").is_file()).count() as u32)
        .unwrap_or(0)
}

fn count_mods(game: &Path) -> u32 {
    std::fs::read_dir(game.join("mods"))
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("jar")))
                .count() as u32
        })
        .unwrap_or(0)
}

/// Builds of Prism, MultiMC and Modrinth App that can move into Millida whole,
/// with what each one weighs: the disk scan plus folders the player pointed at.
pub fn plan_moves() -> Vec<MoveCandidate> {
    let mut found: Vec<FoundInstance> = scan_imports().into_iter().filter(|f| f.movable).collect();
    for dir in vouched_paths() {
        let path = dir.to_string_lossy().to_string();
        if found.iter().any(|f| f.path == path) || move_source_kind(&dir).is_none() {
            continue;
        }
        if let Some(f) = read_instance_dir(&dir, "Папка") {
            found.push(f);
        }
    }
    found
        .into_iter()
        .filter_map(|f| {
            let dir = PathBuf::from(&f.path);
            let kind = move_source_kind(&dir)?;
            let game = source_game_dir(&dir, kind)?;
            let m = manifest_of(&game).ok()?;
            Some(MoveCandidate {
                bytes: m.bytes(),
                files: m.files.len() as u64,
                worlds: count_worlds(&game),
                mods: count_mods(&game),
                launcher: kind.label().to_string(),
                path: f.path,
                name: f.name,
                version: f.version,
                loader: f.loader,
            })
        })
        .collect()
}

fn copy_failed(name: &str, kind: MoveSource, e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::StorageFull {
        return format!(
            "Не хватило места на диске, чтобы перенести «{name}». Освободи место и повтори — в {} сборка не тронута",
            kind.label()
        );
    }
    format!("Не удалось скопировать «{name}» ({e}). В {} сборка не тронута — закрой его и повтори", kind.label())
}

/// Copies the game folder to `dst` and checks the copy against
/// `src_manifest`. The copy is built beside `dst` and takes its name only once
/// it matches the source; the returned guard removes it again unless kept.
/// The source is only ever read.
fn copy_game(game: &Path, dst: &Path, src_manifest: &Manifest, name: &str, kind: MoveSource) -> Result<Staging, String> {
    let stage = sibling(dst, "moving");
    // Deletes leftovers of the previous failed try: the "moving" folder next to the target, not the source.
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| copy_failed(name, kind, &e))?;
    let _guard = Staging { path: stage.clone(), keep: false };
    copy_overrides(game, &stage).map_err(|e| copy_failed(name, kind, &e))?;
    let got = manifest_of(&stage).map_err(|e| copy_failed(name, kind, &e))?;
    compare_manifests(src_manifest, &got)
        .and_then(|_| compare_contents(game, &stage, src_manifest))
        .map_err(|m| format!("Копия «{name}» не сошлась с оригиналом: {}. Сборка в {} не тронута — повтори перенос", m.text(), kind.label()))?;
    std::fs::rename(&stage, dst).map_err(|e| copy_failed(name, kind, &e))?;
    Ok(Staging { path: dst.to_path_buf(), keep: false })
}

/// Takes a copy of a Prism, MultiMC or Modrinth App build into Millida. The
/// build in the other launcher is never renamed, changed or removed: it is
/// the player's data in a program Millida does not own.
pub fn move_instance(path: String) -> Result<MoveOutcome, String> {
    let dir = PathBuf::from(&path);
    if !is_vouched(&dir) {
        return Err("Перенести можно только сборку из списка найденных".into());
    }
    let kind = move_source_kind(&dir).ok_or("Эту сборку можно только скопировать — перенос умеет Prism, MultiMC и Modrinth App")?;
    let found = read_instance_dir(&dir, kind.label()).ok_or("Не удалось понять версию Minecraft этой сборки — добавь её через «Импорт»")?;
    check_version_id(&found.version)?;
    let game = source_game_dir(&dir, kind).ok_or("В сборке нет папки с игрой — переносить нечего")?;

    let blockers = running_blockers(kind, &dir);
    if !blockers.is_empty() {
        return Err(format!("Закрой {} и повтори — пока они открыты, перенос может потерять файлы. Сборка не тронута", blockers.join(" и ")));
    }

    let src_manifest = manifest_of(&game).map_err(|e| format!("Не удалось прочитать сборку «{}» ({e}). Сборка не тронута", found.name))?;
    if src_manifest.files.is_empty() {
        return Err("В сборке нет файлов игры — переносить нечего".into());
    }

    let nm = unique_profile_name(&found.name);
    let dst = profile_dir(&nm);
    let parent = dst.parent().map(Path::to_path_buf).ok_or("Папка сборок недоступна")?;
    std::fs::create_dir_all(&parent).map_err(|e| format!("Папка сборок недоступна ({e}). Проверь диск в настройках"))?;

    let loader_version = loader_version_of(&dir);
    let mut copied = copy_game(&game, &dst, &src_manifest, &found.name, kind)?;

    let loader = if found.loader == "vanilla" { loader_from_mods_dir(&dst).unwrap_or(found.loader.clone()) } else { found.loader.clone() };
    let prof = Profile {
        name: nm,
        version: found.version.clone(),
        fabric: loader == "fabric",
        loader: Some(loader),
        loader_version,
        icon: None,
    };
    let mut all = load_profiles();
    all.insert(0, prof.clone());
    save_profiles(&all).map_err(|e| format!("{e}. Сборка в {} не тронута", kind.label()))?;
    apply_instance_cfg(&dir, &prof.name);

    copied.keep = true;
    forget_scan();
    Ok(MoveOutcome { profile: prof })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-moves-test").join(name);
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn put(root: &Path, rel: &str, body: &[u8]) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    /// source, copy -> verdict. The source is deleted only on Ok, so every
    /// way a copy can be short must come back as a mismatch.
    #[test]
    fn a_short_copy_never_passes() {
        let src = Manifest {
            files: [("saves/w/level.dat".to_string(), 10), ("mods/a.jar".to_string(), 5), ("options.txt".to_string(), 3)].into(),
        };
        let mut missing = src.clone();
        missing.files.remove("mods/a.jar");
        let mut short = src.clone();
        short.files.insert("saves/w/level.dat".into(), 9);
        let mut extra = src.clone();
        extra.files.insert("logs/latest.log".into(), 1);
        let cases: [(&Manifest, Result<(), Mismatch>, &str); 4] = [
            (&src, Ok(()), "identical copy passes"),
            (&missing, Err(Mismatch::Missing("mods/a.jar".into())), "a lost mod stops the move"),
            (&short, Err(Mismatch::Size { path: "saves/w/level.dat".into(), want: 10, got: 9 }), "a cut world file stops the move"),
            (&extra, Ok(()), "a file only in the copy loses nothing"),
        ];
        for (dst, want, why) in cases {
            assert_eq!(compare_manifests(&src, dst), want, "{why}");
        }
    }

    /// path -> hashed. Worlds and mods can not be downloaded again.
    #[test]
    fn worlds_and_mods_are_checked_byte_for_byte() {
        let cases = [
            ("saves/New World/region/r.0.0.mca", true, "world region"),
            ("Saves/w/level.dat", true, "case of the folder does not matter on Windows"),
            ("mods/sodium.jar", true, "mod"),
            ("config/sodium.json", false, "config is checked by size"),
            ("savesbackup/x", false, "only the saves folder itself"),
        ];
        for (rel, want, why) in cases {
            assert_eq!(needs_hash(rel), want, "{rel}: {why}");
        }
    }

    #[test]
    fn same_size_different_bytes_is_caught() {
        let a = tmp("hash-a");
        let b = tmp("hash-b");
        put(&a, "saves/w/level.dat", b"aaaa");
        put(&b, "saves/w/level.dat", b"aaab");
        let m = manifest_of(&a).unwrap();
        assert_eq!(compare_manifests(&m, &manifest_of(&b).unwrap()), Ok(()), "sizes match, so only the hash can tell");
        assert_eq!(compare_contents(&a, &b, &m), Err(Mismatch::Content("saves/w/level.dat".into())), "a changed world byte must stop the move");
    }

    /// process, command line -> blocks. Prism rewrites instance.cfg on exit,
    /// and a running game holds the world open.
    #[test]
    fn open_launcher_or_game_blocks_the_move() {
        let inst = r"C:\Users\u\AppData\Roaming\PrismLauncher\instances\Sky";
        let cases = [
            (MoveSource::Prism, "prismlauncher.exe", "", true, "Prism itself on Windows"),
            (MoveSource::Prism, "PrismLauncher", "", true, "Prism on Linux"),
            (MoveSource::ModrinthApp, "Modrinth App.exe", "", true, "Modrinth App"),
            (MoveSource::ModrinthApp, "prismlauncher.exe", "", false, "another launcher does not hold this build"),
            (MoveSource::Prism, "javaw.exe", r"-Djava.library.path=C:/Users/u/AppData/Roaming/PrismLauncher/instances/Sky/natives", true, "game started from this build"),
            (MoveSource::Prism, "javaw.exe", r"C:\Users\u\AppData\Roaming\PrismLauncher\instances\Other\natives", false, "game of another build"),
            (MoveSource::Prism, "explorer.exe", "", false, "unrelated program"),
        ];
        for (kind, name, cmd, want, why) in cases {
            assert_eq!(process_blocks(kind, name, cmd, inst), want, "{why}");
        }
    }

    /// The launcher is what Millida may ask to quit; anything else that holds the build is the game.
    #[test]
    fn blocker_tells_launcher_from_game() {
        let cases = [
            (MoveSource::Prism, "prismlauncher.exe", false, "Prism Launcher", "Prism on Windows"),
            (MoveSource::Prism, "PrismLauncher", false, "Prism Launcher", "Prism on Linux"),
            (MoveSource::ModrinthApp, "Modrinth App", false, "Modrinth App", "Modrinth App on macOS"),
            (MoveSource::MultiMc, "MultiMC.exe", false, "MultiMC", "MultiMC"),
            (MoveSource::Prism, "javaw.exe", true, "Minecraft из этой сборки", "the game is never closed"),
        ];
        for (kind, name, game, label, why) in cases {
            assert_eq!(blocker_for(kind, name), MoveBlocker { label: label.to_string(), game }, "{why}");
        }
    }

    #[test]
    fn only_own_folder_launchers_are_movable() {
        let root = tmp("kinds");
        let prism = root.join("PrismLauncher/instances/Sky");
        put(&prism, "instance.cfg", b"");
        put(&prism, "mmc-pack.json", b"{}");
        let multimc = root.join("MultiMC/instances/Old");
        put(&multimc, "instance.cfg", b"");
        put(&multimc, "mmc-pack.json", b"{}");
        let modrinth = root.join("ModrinthApp/profiles/Fabulous");
        put(&modrinth, "options.txt", b"");
        let theseus = root.join("com.modrinth.theseus/profiles/Old");
        put(&theseus, "options.txt", b"");
        let curse = root.join("curseforge/minecraft/Instances/All");
        put(&curse, "minecraftinstance.json", b"{}");
        let shared = root.join(".minecraft");
        put(&shared, "options.txt", b"");
        let cases = [
            (&prism, Some(MoveSource::Prism), "Prism instance"),
            (&multimc, Some(MoveSource::MultiMc), "MultiMC instance"),
            (&modrinth, Some(MoveSource::ModrinthApp), "Modrinth App profile"),
            (&theseus, Some(MoveSource::ModrinthApp), "old Modrinth App profile"),
            (&curse, None, "CurseForge is not offered for a move"),
            (&shared, None, "a shared .minecraft can never be taken whole"),
        ];
        for (dir, want, why) in cases {
            assert_eq!(move_source_kind(dir), want, "{why}");
        }
    }

    /// Service files are neither copied nor expected in the copy; links are
    /// never followed, so a link can not drag outside files in.
    #[test]
    fn manifest_counts_what_the_copy_carries() {
        let src = tmp("manifest-src");
        put(&src, "saves/w/level.dat", b"world");
        put(&src, "mods/a.jar", b"jar");
        put(&src, "servers.dat", b"s");
        put(&src, "screenshots/1.png", b"png");
        put(&src, "millida-args.txt", b"-Xmx");
        let dst = tmp("manifest-dst");
        copy_overrides(&src, &dst).unwrap();
        let a = manifest_of(&src).unwrap();
        assert!(!a.files.contains_key("millida-args.txt"), "a service file must not be expected in the copy");
        assert_eq!(a.files.len(), 4, "worlds, mods, servers and screenshots all count");
        assert_eq!(compare_manifests(&a, &manifest_of(&dst).unwrap()), Ok(()), "a full copy passes its own check");
        assert_eq!(compare_contents(&src, &dst, &a), Ok(()));
    }

    #[test]
    fn loader_build_comes_from_the_source() {
        let prism = tmp("lv-prism");
        put(
            &prism,
            "mmc-pack.json",
            br#"{"components":[{"uid":"net.minecraft","version":"1.20.1"},{"uid":"net.minecraftforge","version":"47.3.0"}]}"#,
        );
        assert_eq!(loader_version_of(&prism).as_deref(), Some("47.3.0"));
        let modrinth = tmp("lv-modrinth");
        put(&modrinth, "profile.json", br#"{"metadata":{"loader":"fabric","loader_version":{"id":"0.16.9"}}}"#);
        assert_eq!(loader_version_of(&modrinth).as_deref(), Some("0.16.9"));
        let vanilla = tmp("lv-vanilla");
        put(&vanilla, "mmc-pack.json", br#"{"components":[{"uid":"net.minecraft","version":"1.21.1"}]}"#);
        assert_eq!(loader_version_of(&vanilla), None, "vanilla has no loader build to pin");
    }

    fn sample_build(root: &Path) -> PathBuf {
        let game = root.join("instances/Sky/.minecraft");
        put(&game, "saves/w/level.dat", b"world");
        put(&game, "mods/a.jar", b"jar");
        put(&game, "screenshots/1.png", b"png");
        put(&game, "servers.dat", b"servers");
        put(&game, "options.txt", b"fov:90");
        game
    }

    /// kept -> where the build ends up. The build in the other launcher is
    /// the player's own: whether the copy is kept or dropped (the profile list
    /// failed to save), every file of the source stays byte for byte, and the
    /// instance folder with its launcher files stays where it was.
    #[test]
    fn a_copy_never_touches_the_source() {
        for keep in [false, true] {
            let root = tmp(&format!("copy-{keep}"));
            let game = sample_build(&root);
            let instance = game.parent().unwrap().to_path_buf();
            put(&instance, "instance.cfg", b"name=Sky");
            put(&instance, "mmc-pack.json", b"{}");
            let before = manifest_of(&instance).unwrap();
            let dst = root.join("millida/profiles/Sky");
            std::fs::create_dir_all(dst.parent().unwrap()).unwrap();
            let mut copied = copy_game(&game, &dst, &manifest_of(&game).unwrap(), "Sky", MoveSource::Prism).unwrap();
            assert_eq!(manifest_of(&dst).unwrap(), manifest_of(&game).unwrap(), "keep={keep}: every file of the build is in Millida");
            assert!(!sibling(&dst, "moving").exists(), "keep={keep}: no half-made copy is left beside the build");
            copied.keep = keep;
            drop(copied);
            assert_eq!(dst.join("saves/w/level.dat").is_file(), keep, "keep={keep}: only a kept copy stays in Millida");
            assert_eq!(manifest_of(&instance).unwrap(), before, "keep={keep}: the source instance must be exactly as before");
            assert_eq!(std::fs::read(game.join("saves/w/level.dat")).unwrap(), b"world", "keep={keep}: the source world must not change");
        }
    }

    #[test]
    fn a_copy_that_does_not_match_never_takes_the_name() {
        let root = tmp("place-mismatch");
        let game = sample_build(&root);
        let mut wrong = manifest_of(&game).unwrap();
        wrong.files.insert("saves/w/region/r.0.0.mca".into(), 4096);
        let dst = root.join("millida/profiles/Sky");
        std::fs::create_dir_all(dst.parent().unwrap()).unwrap();
        let err = copy_game(&game, &dst, &wrong, "Sky", MoveSource::Prism).err().expect("a copy short of a world file must fail");
        assert!(err.contains("не тронута"), "the error must tell the player the source is safe: {err}");
        assert!(!dst.exists(), "a failed copy must not appear as a build");
        assert!(!sibling(&dst, "moving").exists(), "a failed copy is cleaned up");
        assert!(game.join("saves/w/level.dat").is_file(), "the source keeps its world");
    }
}
