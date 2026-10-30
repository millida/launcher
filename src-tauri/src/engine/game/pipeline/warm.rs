// Prepared ahead of Play. While the lobby shows a build (and the player has left the window alone
// for two seconds), or when the tray menu is opened, the Prepare step of that build runs without
// the Start and without downloading anything: files are only looked at (there, of the right size),
// Java is found and asked its version, the version descriptions are read, and the lists a launch
// would ask the network for (our mod's kill switch and variants, the skin server's description,
// an account token about to end) are brought up to date. What it found is kept for ten minutes;
// Play then skips the Prepare of files altogether and goes straight to the start.
//
// Limits: at most once in ten minutes per build, never while a launch or a download runs, never on
// a battery below 20 %. A change in the build's mods or config folders, its settings or its version
// throws the prepared plan away; so does a missing file at Play.
use super::super::launch_guard::launch_underway;
use super::graph::{Graph, Node};
use crate::engine::*;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tauri::AppHandle;

/// How long a prepared plan stays good.
pub(crate) const KEEP: Duration = Duration::from_secs(10 * 60);
/// How often one build may be prepared.
pub(crate) const EVERY: Duration = Duration::from_secs(10 * 60);
/// An account token that ends within this is renewed ahead of Play.
const TOKEN_WINDOW: Duration = Duration::from_secs(10 * 60);

/// What one folder looked like: enough to notice a file added, removed or replaced.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DirStamp {
    pub changed: Option<SystemTime>,
    pub files: u64,
    pub bytes: u64,
    pub newest: Option<SystemTime>,
}

pub(crate) fn dir_stamp(dir: &Path) -> DirStamp {
    let mut st = DirStamp { changed: std::fs::metadata(dir).and_then(|m| m.modified()).ok(), ..DirStamp::default() };
    let Ok(rd) = std::fs::read_dir(dir) else { return st };
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        st.files += 1;
        st.bytes += m.len();
        let t = m.modified().ok();
        if t > st.newest {
            st.newest = t;
        }
    }
    st
}

fn file_stamp(path: &Path) -> Option<(u64, SystemTime)> {
    let m = std::fs::metadata(path).ok()?;
    Some((m.len(), m.modified().ok()?))
}

/// The build as far as its plan depends on it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Stamp {
    pub version: (String, String, Option<String>),
    pub settings: Option<(u64, SystemTime)>,
    pub mods: DirStamp,
    pub config: DirStamp,
}

pub(crate) fn stamp(profile: &str, version: (String, String, Option<String>)) -> Stamp {
    let dir = profile_dir(profile);
    Stamp {
        version,
        settings: file_stamp(&dir.join("millida-settings.json")),
        mods: dir_stamp(&dir.join("mods")),
        config: dir_stamp(&dir.join("config")),
    }
}

struct Prepared {
    stamp: Stamp,
    at: Instant,
    /// The Java the player chose (the build's own or the launcher-wide default) at the time.
    pick: Option<Option<PathBuf>>,
    version: Arc<InstalledVersion>,
}

fn prepared() -> &'static Mutex<HashMap<String, Prepared>> {
    static P: std::sync::OnceLock<Mutex<HashMap<String, Prepared>>> = std::sync::OnceLock::new();
    P.get_or_init(Default::default)
}

fn tried() -> &'static Mutex<HashMap<String, Instant>> {
    static T: std::sync::OnceLock<Mutex<HashMap<String, Instant>>> = std::sync::OnceLock::new();
    T.get_or_init(Default::default)
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Every file the start reads is still there: the classpath (with the client), Java, the natives.
fn in_place(v: &InstalledVersion) -> bool {
    v.merged.classpath.iter().all(|p| p.is_file()) && v.java.is_file() && v.natives_dir.is_dir()
}

/// Whether a plan made at `at` for `then` still holds now.
pub(crate) fn still_good(then: &Stamp, now: &Stamp, at: Instant, now_at: Instant) -> bool {
    then == now && now_at.saturating_duration_since(at) <= KEEP
}

/// The prepared version of this build, if there is one and it still holds. Play uses it instead of
/// fetching and checking the files again.
pub(crate) fn take(profile: &str, version_id: &str, loader: &str, loader_version: Option<&str>) -> Option<Arc<InstalledVersion>> {
    if deep_verify() {
        return None;
    }
    let mut all = locked(prepared());
    let p = all.get(profile)?;
    let now = stamp(profile, (version_id.to_string(), loader.to_string(), loader_version.map(String::from)));
    // The Java choice may also live outside the build (the launcher-wide default).
    if still_good(&p.stamp, &now, p.at, Instant::now()) && profile_java_present(profile).ok() == p.pick && in_place(&p.version) {
        return Some(p.version.clone());
    }
    all.remove(profile);
    None
}

/// What preparing a build came to.
#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WarmOutcome {
    /// `ready`: Play will start at once; `cold`: something must be downloaded first; `skipped`: not now.
    pub state: &'static str,
    pub why: String,
    pub ms: u64,
    /// Mods the build's mods require and it does not have (put in by Play).
    pub missing_deps: u32,
}

impl WarmOutcome {
    fn skipped(why: &str) -> WarmOutcome {
        WarmOutcome { state: "skipped", why: why.to_string(), ms: 0, missing_deps: 0 }
    }
}

/// The reason not to prepare now, if there is one.
fn hold_back(profile: &str) -> Option<&'static str> {
    if launch_underway() {
        return Some("launch");
    }
    if running_games().iter().any(|p| p == profile) {
        return Some("running");
    }
    if !active_jobs().is_empty() {
        return Some("download");
    }
    if low_battery() {
        return Some("battery");
    }
    None
}

/// Takes the build's slot for the next ten minutes; false when it was prepared within them.
pub(crate) fn claim_slot(last: &mut HashMap<String, Instant>, profile: &str, now: Instant) -> bool {
    if last.get(profile).is_some_and(|t| now.saturating_duration_since(*t) < EVERY) {
        return false;
    }
    last.insert(profile.to_string(), now);
    true
}

/// Prepares `profile` for Play (see the top of this file). `auth`: the account the lobby would
/// play with, so its skin server and token are warmed too.
pub async fn warm_launch(app: AppHandle, profile: String, auth: Option<AuthArgs>) -> WarmOutcome {
    if let Some(why) = hold_back(&profile) {
        return WarmOutcome::skipped(why);
    }
    // First, so that a pointer resting on the tray icon costs nothing after the first time.
    if !claim_slot(&mut locked(tried()), &profile, Instant::now()) {
        return WarmOutcome::skipped("recent");
    }
    let Some(prof) = load_profiles().into_iter().find(|p| p.name == profile) else {
        return WarmOutcome::skipped("no-build");
    };
    if trusted_native_launch(&profile).is_some() || trusted_pack_launch_spec(&profile).is_some() {
        return WarmOutcome::skipped("pack");
    }
    let started = Instant::now();
    let loader = prof.loader_id();
    let key = (prof.version.clone(), loader.clone(), prof.loader_version.clone());
    let before = stamp(&profile, key.clone());
    let modded = matches!(loader.as_str(), "fabric" | "quilt" | "forge" | "neoforge");
    let millida = auth.as_ref().and_then(|a| a.kind.as_deref()) == Some("millida");

    // The lists a launch would ask the network for, next to the look at the files.
    let lists = {
        let profile = profile.clone();
        async move {
            if modded && millida_mod_wanted(&profile) {
                warm_mod_lists().await;
            }
            if millida {
                let _ = yggdrasil_meta(&millida_yggdrasil()).await;
                refresh_millida_if_expiring(TOKEN_WINDOW).await;
            }
            if modded { missing_launch_deps(&profile).await } else { 0 }
        }
    };
    let chosen = profile_java_present(&profile).ok();
    let files = async {
        let pick = match profile_java_present(&profile) {
            Ok(p) => Node::ready(p),
            Err(e) => return Err(e),
        };
        let mut g = Graph::silent();
        let ask = VersionAsk { version_id: prof.version.clone(), loader: loader.clone(), loader_version: prof.loader_version.clone(), mode: Mode::Check };
        prepare_version(&mut g, &app, ask, pick).get().await
    };
    let (version, missing_deps) = futures::join!(files, lists);
    let ms = started.elapsed().as_millis() as u64;
    let after = stamp(&profile, key);
    match version {
        // The build changed while it was looked at: whatever was found is already old.
        Ok(_) if after != before => WarmOutcome { state: "cold", why: "changed".into(), ms, missing_deps },
        Ok(v) => {
            locked(prepared()).insert(profile, Prepared { stamp: after, at: started, pick: chosen, version: v });
            WarmOutcome { state: "ready", why: String::new(), ms, missing_deps }
        }
        Err(e) if e == NOT_READY => WarmOutcome { state: "cold", why: "files".into(), ms, missing_deps },
        Err(_) => WarmOutcome { state: "cold", why: "error".into(), ms, missing_deps },
    }
}

/// The tray menu is about to offer «Играть» for this build: prepare it in the background.
pub fn warm_in_background(app: &AppHandle, profile: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = warm_launch(app, profile, None).await;
    });
}

/// The folder a prepared plan was made for, for the tests below.
#[cfg(test)]
fn temp_build(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("millida-warm-{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("mods")).unwrap();
    std::fs::create_dir_all(dir.join("config")).unwrap();
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_build_is_prepared_at_most_once_in_ten_minutes() {
        let mut last = HashMap::new();
        let t0 = Instant::now();
        assert!(claim_slot(&mut last, "a", t0));
        assert!(!claim_slot(&mut last, "a", t0 + Duration::from_secs(60)), "a minute later: not again");
        assert!(claim_slot(&mut last, "b", t0 + Duration::from_secs(60)), "another build has its own slot");
        assert!(claim_slot(&mut last, "a", t0 + EVERY), "ten minutes later: again");
    }

    #[test]
    fn a_new_mod_or_config_file_throws_the_plan_away() {
        let dir = temp_build("stamp");
        let look = || Stamp {
            version: ("1.20.1".into(), "fabric".into(), Some("0.16.10".into())),
            settings: file_stamp(&dir.join("millida-settings.json")),
            mods: dir_stamp(&dir.join("mods")),
            config: dir_stamp(&dir.join("config")),
        };
        let t0 = Instant::now();
        let first = look();
        assert!(still_good(&first, &look(), t0, t0 + Duration::from_secs(30)), "nothing changed");
        assert!(!still_good(&first, &look(), t0, t0 + KEEP + Duration::from_secs(1)), "older than ten minutes");
        std::fs::write(dir.join("mods").join("sodium.jar"), b"x").unwrap();
        let with_mod = look();
        assert!(!still_good(&first, &with_mod, t0, t0), "a mod was added");
        std::fs::write(dir.join("config").join("sodium-options.json"), b"{}").unwrap();
        assert!(!still_good(&with_mod, &look(), t0, t0), "a config was added");
        let other = Stamp { version: ("1.21.1".into(), "fabric".into(), None), ..look() };
        assert!(!still_good(&look(), &other, t0, t0), "another version is another plan");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
