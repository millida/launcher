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
        MoveSource::Prism | MoveSource::MultiMc => [".minecraft", "minecraft"]
            .iter()
            .map(|d| dir.join(d))
            .find(|p| std::fs::symlink_metadata(p).map(|m| m.is_dir() && !m.file_type().is_symlink()).unwrap_or(false)),
    }
}

/// Exact loader build the source pinned, so the moved build starts on the
/// same one instead of the recommended.
fn loader_version_of(dir: &Path) -> Option<String> {
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

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Strategy {
    Rename,
    Copy,
}

/// A rename is the whole move in one step and can not half-happen, but it
/// takes the files away from the source, so it is only for a real move on one
/// drive. Keeping the source, or another drive, means a verified copy.
pub(crate) fn pick_strategy(remove_source: bool, same_volume: bool) -> Strategy {
    if remove_source && same_volume {
        Strategy::Rename
    } else {
        Strategy::Copy
    }
}

#[cfg(windows)]
fn same_volume(a: &Path, b: &Path) -> bool {
    use std::path::Component;
    let prefix = |p: &Path| {
        let c = std::fs::canonicalize(p).ok()?;
        match c.components().next()? {
            Component::Prefix(x) => Some(x.as_os_str().to_string_lossy().to_ascii_lowercase()),
            _ => None,
        }
    };
    matches!((prefix(a), prefix(b)), (Some(x), Some(y)) if x == y)
}

#[cfg(unix)]
fn same_volume(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev(),
        _ => false,
    }
}

/// Whether a running process stops the move: the source launcher itself
/// (it rewrites its instance files on exit) or a game started from this build.
pub(crate) fn process_blocks(kind: MoveSource, process: &str, cmdline: &str, instance: &str) -> bool {
    let name = process.to_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    if kind.process_names().contains(&name) {
        return true;
    }
    let norm = |s: &str| s.replace('\\', "/").to_lowercase();
    let inst = norm(instance);
    !inst.is_empty() && norm(cmdline).contains(inst.trim_end_matches('/'))
}

fn running_blockers(kind: MoveSource, dir: &Path) -> Vec<String> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
    let mut sys = sysinfo::System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always));
    let inst = dir.to_string_lossy().to_string();
    let mut out: Vec<String> = vec![];
    for p in sys.processes().values() {
        let name = p.name().to_string_lossy().to_string();
        let cmd = p.cmd().iter().map(|a| a.to_string_lossy()).collect::<Vec<_>>().join(" ");
        if !process_blocks(kind, &name, &cmd, &inst) {
            continue;
        }
        let what = if kind.process_names().contains(&name.to_lowercase().trim_end_matches(".exe")) {
            kind.label().to_string()
        } else {
            "Minecraft из этой сборки".to_string()
        };
        if !out.contains(&what) {
            out.push(what);
        }
    }
    out
}

fn sibling(dir: &Path, tag: &str) -> PathBuf {
    let name = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    dir.with_file_name(format!(".{name}.millida-{tag}"))
}

/// Windows refuses to rename a folder while any file in it is open. Renaming
/// there and back before anything is copied tells whether the source can be
/// removed afterwards, so a locked build is never left in both launchers.
fn probe_unlocked(dir: &Path, kind: MoveSource) -> Result<(), String> {
    let probe = sibling(dir, "probe");
    std::fs::rename(dir, &probe).map_err(|e| {
        format!(
            "Файлы сборки заняты другой программой ({e}). Закрой {} и игру, потом повтори — сборка не тронута",
            kind.label()
        )
    })?;
    std::fs::rename(&probe, dir).map_err(|e| {
        format!(
            "Сборка осталась в папке {} — переименуй её обратно в «{}» ({e})",
            mask_home(&probe.to_string_lossy()),
            dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
        )
    })
}

/// A half-made copy is removed on every way out except success.
struct Staging {
    path: PathBuf,
    keep: bool,
}

impl Drop for Staging {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

/// A renamed game folder goes back where it came from on every way out
/// except success.
struct RenameBack {
    from: PathBuf,
    to: PathBuf,
    armed: bool,
}

impl Drop for RenameBack {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::rename(&self.from, &self.to);
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
    pub same_drive: bool,
}

#[derive(Clone, serde::Serialize)]
pub struct MoveOutcome {
    pub profile: Profile,
    pub instant: bool,
    pub source_removed: bool,
    pub note: Option<String>,
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
    let profiles = game_root().join("profiles");
    let _ = std::fs::create_dir_all(&profiles);
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
                same_drive: same_volume(&game, &profiles),
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

/// The game folder in its new place, taken back on drop unless committed.
enum Placed {
    Renamed(RenameBack),
    Copied(Staging),
}

impl Placed {
    /// Keeps the build where it now is; true when it got there by a rename.
    fn commit(self) -> bool {
        match self {
            Placed::Renamed(mut r) => {
                r.armed = false;
                true
            }
            Placed::Copied(mut s) => {
                s.keep = true;
                false
            }
        }
    }
}

/// Puts the game folder at `dst` and checks it against `src_manifest`. A
/// rename that fails (another drive behind a mount point, a busy folder) has
/// moved nothing, so it falls back to the copy. A copy is built beside `dst`
/// and takes its name only once it matches the source.
fn place_game(game: &Path, dst: &Path, strategy: Strategy, src_manifest: &Manifest, name: &str, kind: MoveSource) -> Result<Placed, String> {
    if strategy == Strategy::Rename && std::fs::rename(game, dst).is_ok() {
        let back = RenameBack { from: dst.to_path_buf(), to: game.to_path_buf(), armed: true };
        drop_launcher_service_files(dst, &[]).map_err(|e| format!("Не удалось подготовить сборку ({e}). Сборка возвращена на место"))?;
        let got = manifest_of(dst).map_err(|e| format!("Не удалось проверить перенос ({e}). Сборка возвращена на место"))?;
        compare_manifests(src_manifest, &got).map_err(|m| format!("Перенос не сошёлся: {}. Сборка возвращена на место", m.text()))?;
        return Ok(Placed::Renamed(back));
    }
    let stage = sibling(dst, "moving");
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| copy_failed(name, kind, &e))?;
    let _guard = Staging { path: stage.clone(), keep: false };
    copy_overrides(game, &stage).map_err(|e| copy_failed(name, kind, &e))?;
    let got = manifest_of(&stage).map_err(|e| copy_failed(name, kind, &e))?;
    compare_manifests(src_manifest, &got)
        .and_then(|_| compare_contents(game, &stage, src_manifest))
        .map_err(|m| format!("Копия «{name}» не сошлась с оригиналом: {}. Сборка в {} не тронута — повтори перенос", m.text(), kind.label()))?;
    std::fs::rename(&stage, dst).map_err(|e| copy_failed(name, kind, &e))?;
    Ok(Placed::Copied(Staging { path: dst.to_path_buf(), keep: false }))
}

/// Takes a build of Prism, MultiMC or Modrinth App into Millida. The copy is
/// made and checked first; the source goes only after that, and only when
/// `remove_source` asks for it. Any failure before that leaves the source as
/// it was.
pub fn move_instance(path: String, remove_source: bool) -> Result<MoveOutcome, String> {
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
    if remove_source {
        probe_unlocked(&dir, kind)?;
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
    let strategy = pick_strategy(remove_source, same_volume(&game, &parent));
    let placed = place_game(&game, &dst, strategy, &src_manifest, &found.name, kind)?;

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

    let instant = placed.commit();
    forget_scan();

    let mut source_removed = false;
    let mut note = None;
    if remove_source {
        match remove_source_dir(&dir) {
            Ok(()) => source_removed = true,
            Err(left) => {
                note = Some(format!(
                    "Сборка уже в Millida. Старую папку в {} убрать не вышло — удали её вручную: {}",
                    kind.label(),
                    mask_home(&left.to_string_lossy())
                ))
            }
        }
    }
    Ok(MoveOutcome { profile: prof, instant, source_removed, note })
}

/// The instance folder is renamed aside first, so it leaves the source
/// launcher's list at once and a failed delete does not leave half a build
/// behind under its old name. Returns the folder left on disk on failure.
fn remove_source_dir(dir: &Path) -> Result<(), PathBuf> {
    if !dir.exists() {
        return Ok(());
    }
    let trash = sibling(dir, "moved");
    let _ = std::fs::remove_dir_all(&trash);
    std::fs::rename(dir, &trash).map_err(|_| dir.to_path_buf())?;
    std::fs::remove_dir_all(&trash).map_err(|_| trash)
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

    /// remove_source, same drive -> strategy. A rename takes the files away
    /// from the source, so it may only happen when the player asked to move.
    #[test]
    fn rename_only_when_moving_on_one_drive() {
        let cases = [
            (true, true, Strategy::Rename, "move on one drive is instant"),
            (true, false, Strategy::Copy, "another drive can only be copied, then checked"),
            (false, true, Strategy::Copy, "keeping the source must never take its files"),
            (false, false, Strategy::Copy, "keeping the source on another drive is a plain copy"),
        ];
        for (remove, same, want, why) in cases {
            assert_eq!(pick_strategy(remove, same), want, "{why}");
        }
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

    /// strategy, commit -> where the build ends up. Without a commit (the
    /// profile list failed to save) the source must be exactly as before.
    #[test]
    fn a_placed_build_is_taken_back_unless_committed() {
        for (strategy, commit) in [(Strategy::Rename, false), (Strategy::Rename, true), (Strategy::Copy, false), (Strategy::Copy, true)] {
            let root = tmp(&format!("place-{strategy:?}-{commit}"));
            let game = sample_build(&root);
            let before = manifest_of(&game).unwrap();
            let dst = root.join("millida/profiles/Sky");
            std::fs::create_dir_all(dst.parent().unwrap()).unwrap();
            let placed = place_game(&game, &dst, strategy, &before, "Sky", MoveSource::Prism).unwrap();
            assert_eq!(manifest_of(&dst).unwrap(), before, "{strategy:?}: every file of the build is in Millida");
            assert!(!sibling(&dst, "moving").exists(), "{strategy:?}: no half-made copy is left beside the build");
            if commit {
                let instant = placed.commit();
                assert_eq!(instant, strategy == Strategy::Rename, "a rename is reported as instant, a copy is not");
                assert!(dst.join("saves/w/level.dat").is_file(), "{strategy:?}: a committed build stays in Millida");
                if strategy == Strategy::Copy {
                    assert_eq!(manifest_of(&game).unwrap(), before, "a copy never touches the source");
                }
            } else {
                drop(placed);
                assert!(!dst.exists(), "{strategy:?}: an uncommitted build leaves Millida");
                assert_eq!(manifest_of(&game).unwrap(), before, "{strategy:?}: an uncommitted move leaves the source exactly as it was");
            }
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
        let err = place_game(&game, &dst, Strategy::Copy, &wrong, "Sky", MoveSource::Prism).err().expect("a copy short of a world file must fail");
        assert!(err.contains("не тронута"), "the error must tell the player the source is safe: {err}");
        assert!(!dst.exists(), "a failed copy must not appear as a build");
        assert!(!sibling(&dst, "moving").exists(), "a failed copy is cleaned up");
        assert!(game.join("saves/w/level.dat").is_file(), "the source keeps its world");
    }

    #[test]
    fn removing_the_source_takes_only_that_folder() {
        let root = tmp("remove");
        let a = root.join("instances/A");
        let b = root.join("instances/B");
        put(&a, ".minecraft/saves/w/level.dat", b"a");
        put(&b, ".minecraft/saves/w/level.dat", b"b");
        remove_source_dir(&a).unwrap();
        assert!(!a.exists(), "the moved instance leaves its launcher");
        assert!(!sibling(&a, "moved").exists(), "nothing of it is left aside");
        assert!(b.join(".minecraft/saves/w/level.dat").is_file(), "a neighbour instance must stay untouched");
        assert!(root.join("instances").is_dir(), "the launcher's own folder stays");
    }
}
