// «Найти мод, из-за которого вылет»: when the log names no mod, the launcher switches
// half of the suspects off, the player launches, and the crash or its absence halves the
// suspects again. 40 mods take at most 6 launches. Libraries the remaining mods need are
// never switched off. The state lives in millida-bisect.json in the build folder, so the
// search survives a launcher restart, and «Вернуть как было» puts back exactly the mods
// that were enabled when it began.
use crate::engine::*;
use std::collections::{BTreeMap, HashSet};

const STATE_FILE: &str = "millida-bisect.json";
/// «A needs B, B needs C»: deeper chains do not occur in real builds; the cap guards a cycle.
const CHAIN_MAX: usize = 8;
const GAME_RUNNING: &str = "Закрой игру, чтобы продолжить поиск";

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Bisect {
    /// Enabled mod files when the search began.
    pub snapshot: Vec<String>,
    /// The smallest set of files known to crash the game; starts as the snapshot.
    pub crashing: Vec<String>,
    /// Files of `crashing` one of which the crash comes from.
    pub suspects: Vec<String>,
    /// Files switched off for the launch under test; empty when nothing is under test.
    pub testing: Vec<String>,
    /// Launches answered so far.
    pub step: u32,
    /// The last answer was «it started» with only the remaining suspect switched off.
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub titles: BTreeMap<String, String>,
}

/// What the search does next.
#[derive(Debug, PartialEq)]
pub(crate) enum Next {
    /// Switch these files off and launch.
    Test(Vec<String>),
    /// One suspect is left.
    Found(String),
    /// Every remaining suspect is needed by another: no half can be switched off.
    Stuck,
    /// With every suspect switched off the game still crashes: the cause is not a mod.
    NotMods,
}

/// Of `part`, the files that can be switched off while `crashing` stays otherwise on:
/// a library an enabled mod still needs stays on, and so does one that library needs.
pub(crate) fn removable(locals: &[LocalMeta], crashing: &[String], runs: &[String], part: &[String]) -> Vec<String> {
    let enabled: HashSet<String> = crashing.iter().cloned().collect();
    let mut keep: HashSet<String> = HashSet::new();
    for _ in 0..CHAIN_MAX {
        let leaving: Vec<String> = part.iter().filter(|f| !keep.contains(*f)).cloned().collect();
        if leaving.is_empty() {
            return leaving;
        }
        let needed = dependents_in(locals, &enabled, runs, &leaving);
        if needed.is_empty() {
            return leaving;
        }
        keep.extend(needed.into_iter().map(|d| d.name));
    }
    vec![]
}

pub(crate) fn plan(b: &Bisect, locals: &[LocalMeta], runs: &[String]) -> Next {
    match b.suspects.len() {
        0 => return Next::NotMods,
        1 => return Next::Found(b.suspects[0].clone()),
        _ => {}
    }
    let mid = b.suspects.len().div_ceil(2);
    let (first, second) = b.suspects.split_at(mid);
    for half in [first, second] {
        let off = removable(locals, &b.crashing, runs, half);
        if !off.is_empty() {
            return Next::Test(off);
        }
    }
    Next::Stuck
}

/// Applies the player's answer about the launch under test.
pub(crate) fn answer(b: &mut Bisect, crashed: bool) {
    let tested = std::mem::take(&mut b.testing);
    if tested.is_empty() {
        return;
    }
    b.step += 1;
    if crashed {
        // Without these files it still crashes: they are not the cause and stay off.
        b.crashing.retain(|f| !tested.contains(f));
        b.suspects.retain(|f| !tested.contains(f));
        b.verified = false;
    } else {
        // Without them it starts: the cause is among them.
        b.suspects.retain(|f| tested.contains(f));
        b.verified = b.suspects.len() == 1;
    }
}

/// Launches still needed in the worst case for `n` suspects.
pub(crate) fn runs_left(n: usize) -> u32 {
    if n <= 1 { 0 } else { usize::BITS - (n - 1).leading_zeros() }
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectView {
    pub profile: String,
    /// "test" | "found" | "stuck" | "notMods"
    pub phase: String,
    pub step: u32,
    pub suspects: u32,
    pub runs_left: u32,
    /// Mods switched off right now.
    pub off: u32,
    pub culprit: Option<DependentMod>,
    /// The culprit was confirmed by a launch without it alone.
    pub verified: bool,
    /// The remaining suspects when the search is stuck.
    pub left: Vec<DependentMod>,
}

fn state_path(profile: &str) -> std::path::PathBuf {
    profile_dir(profile).join(STATE_FILE)
}

fn load(profile: &str) -> Option<Bisect> {
    std::fs::read(state_path(profile)).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

fn save(profile: &str, b: &Bisect) -> Result<(), String> {
    write_json_atomic(&state_path(profile), b).map_err(|e| format!("Не удалось сохранить ход поиска: {}", e))
}

fn not_running(profile: &str) -> Result<(), String> {
    if running_games().iter().any(|p| p == profile) { Err(GAME_RUNNING.into()) } else { Ok(()) }
}

fn mod_of(b: &Bisect, file: &str) -> DependentMod {
    DependentMod { name: file.to_string(), title: b.titles.get(file).cloned().unwrap_or_else(|| file.to_string()) }
}

fn view(profile: &str, b: &Bisect, next: &Next) -> BisectView {
    let on = b.crashing.len().saturating_sub(b.testing.len());
    let (phase, culprit) = match next {
        Next::Test(_) => ("test", None),
        Next::Found(f) => ("found", Some(mod_of(b, f))),
        Next::Stuck => ("stuck", None),
        Next::NotMods => ("notMods", None),
    };
    BisectView {
        profile: profile.to_string(),
        phase: phase.into(),
        step: b.step,
        suspects: b.suspects.len() as u32,
        runs_left: runs_left(b.suspects.len()),
        off: b.snapshot.len().saturating_sub(on) as u32,
        culprit,
        verified: b.verified,
        left: if matches!(next, Next::Stuck) { b.suspects.iter().map(|f| mod_of(b, f)).collect() } else { vec![] },
    }
}

fn mod_locals(profile: &str) -> Vec<LocalMeta> {
    scan_local_meta(profile, "mod", false)
}

/// Switches the snapshot's files so that exactly `on` of them are enabled.
fn apply(profile: &str, snapshot: &[String], on: &HashSet<&str>) -> Result<(), String> {
    for f in snapshot {
        toggle_content(profile, "mod", f, on.contains(f.as_str()))?;
    }
    Ok(())
}

/// Plans the next launch, switches the mods for it and saves the state.
fn advance(profile: &str, b: &mut Bisect) -> Result<BisectView, String> {
    let locals = mod_locals(profile);
    let runs = build_runs(&ctx_of(profile, "mod"));
    let next = plan(b, &locals, &runs);
    b.testing = match &next {
        Next::Test(off) => off.clone(),
        _ => vec![],
    };
    let on: HashSet<&str> = b.crashing.iter().filter(|f| !b.testing.contains(f)).map(String::as_str).collect();
    apply(profile, &b.snapshot, &on)?;
    save(profile, b)?;
    Ok(view(profile, b, &next))
}

pub fn bisect_status(profile: &str) -> Option<BisectView> {
    let b = load(profile)?;
    let next = if b.testing.is_empty() {
        let locals = mod_locals(profile);
        plan(&b, &locals, &build_runs(&ctx_of(profile, "mod")))
    } else {
        Next::Test(b.testing.clone())
    };
    Some(view(profile, &b, &next))
}

pub fn bisect_start(profile: &str) -> Result<BisectView, String> {
    if let Some(v) = bisect_status(profile) {
        return Ok(v);
    }
    not_running(profile)?;
    let enabled = enabled_mod_files(profile);
    let locals = mod_locals(profile);
    let mut snapshot: Vec<String> = locals.iter().filter(|m| enabled.contains(&m.file_name)).map(|m| m.file_name.clone()).collect();
    snapshot.sort();
    snapshot.dedup();
    // The launch puts Millida's own mod back by itself: switching it off would test nothing.
    let suspects: Vec<String> = snapshot.iter().filter(|f| !is_injected_skin_mod(f)).cloned().collect();
    if suspects.len() < 2 {
        return Err("В сборке меньше двух включённых модов — искать не из чего".into());
    }
    let titles = locals.iter().filter(|m| !m.title.is_empty()).map(|m| (m.file_name.clone(), m.title.clone())).collect();
    let mut b = Bisect { crashing: snapshot.clone(), snapshot, suspects, titles, ..Default::default() };
    advance(profile, &mut b)
}

/// Answers are taken one at a time: two arriving together would both read the same step.
static ANSWERING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `step` is the step the answer is about. A second answer to the same launch (the crash was
/// caught by itself and the player also pressed «Вылетело») would otherwise count for the next
/// launch, which nobody ran yet: it gets the current state back instead.
pub fn bisect_answer(profile: &str, crashed: bool, step: Option<u32>) -> Result<BisectView, String> {
    let _one = ANSWERING.lock().unwrap_or_else(|e| e.into_inner());
    not_running(profile)?;
    let mut b = load(profile).ok_or("Поиск уже закончен")?;
    if step.is_some_and(|s| s != b.step) {
        return bisect_status(profile).ok_or_else(|| "Поиск уже закончен".into());
    }
    answer(&mut b, crashed);
    advance(profile, &mut b)
}

/// One more launch with only the remaining suspect switched off.
pub fn bisect_verify(profile: &str) -> Result<BisectView, String> {
    not_running(profile)?;
    let mut b = load(profile).ok_or("Поиск уже закончен")?;
    if b.suspects.len() != 1 {
        return bisect_status(profile).ok_or_else(|| "Поиск уже закончен".into());
    }
    let locals = mod_locals(profile);
    let runs = build_runs(&ctx_of(profile, "mod"));
    b.testing = removable(&locals, &b.crashing, &runs, &b.suspects);
    if b.testing.is_empty() {
        return Err("Этот мод нужен другим включённым модам — без них его не проверить".into());
    }
    let on: HashSet<&str> = b.crashing.iter().filter(|f| !b.testing.contains(f)).map(String::as_str).collect();
    apply(profile, &b.snapshot, &on)?;
    save(profile, &b)?;
    Ok(view(profile, &b, &Next::Test(b.testing.clone())))
}

/// Ends the search: every mod enabled at its start is enabled again, then `disable`
/// (the culprit, when the player chose to switch it off) goes off.
pub fn bisect_finish(profile: &str, disable: Option<String>) -> Result<(), String> {
    not_running(profile)?;
    if let Some(b) = load(profile) {
        let on: HashSet<&str> = b.snapshot.iter().map(String::as_str).collect();
        apply(profile, &b.snapshot, &on)?;
    }
    if let Some(file) = disable.filter(|f| !f.is_empty()) {
        toggle_content(profile, "mod", &file, false)?;
    }
    let _ = std::fs::remove_file(state_path(profile));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jar(i: usize) -> String {
        format!("mod{:02}.jar", i)
    }

    fn meta(file: &str, requires: &[&str]) -> LocalMeta {
        LocalMeta {
            file_name: file.into(),
            title: file.into(),
            mod_id: file.trim_end_matches(".jar").into(),
            requires: requires.iter().map(|s| s.to_string()).collect(),
            ..Default::default()
        }
    }

    fn start(files: &[String]) -> Bisect {
        Bisect { snapshot: files.to_vec(), crashing: files.to_vec(), suspects: files.to_vec(), ..Default::default() }
    }

    /// Plays the search against `crashes` (the enabled files → does the game crash).
    fn run(locals: &[LocalMeta], files: &[String], crashes: impl Fn(&HashSet<&str>) -> bool) -> (Next, u32, Bisect) {
        let runs = ["fabric".to_string()];
        let mut b = start(files);
        for _ in 0..64 {
            match plan(&b, locals, &runs) {
                Next::Test(off) => {
                    b.testing = off;
                    let on: HashSet<&str> = b.crashing.iter().filter(|f| !b.testing.contains(f)).map(String::as_str).collect();
                    let crashed = crashes(&on);
                    answer(&mut b, crashed);
                }
                other => return (other, b.step, b),
            }
        }
        panic!("the search never ended");
    }

    #[test]
    fn one_culprit_among_forty_takes_at_most_six_launches() {
        let files: Vec<String> = (0..40).map(jar).collect();
        let locals: Vec<LocalMeta> = files.iter().map(|f| meta(f, &[])).collect();
        for culprit in &files {
            let (next, steps, _) = run(&locals, &files, |on| on.contains(culprit.as_str()));
            assert_eq!(next, Next::Found(culprit.clone()), "culprit {culprit}");
            assert!(steps <= 6, "{culprit} took {steps} launches");
        }
    }

    /// Two mods crash only together: switching off either one is the fix, and the search names one of them.
    #[test]
    fn a_conflicting_pair_names_one_of_the_two() {
        let files: Vec<String> = (0..40).map(jar).collect();
        let locals: Vec<LocalMeta> = files.iter().map(|f| meta(f, &[])).collect();
        for (a, b) in [(3, 31), (0, 1), (19, 20), (38, 39), (7, 22)] {
            let (pa, pb) = (jar(a), jar(b));
            let (next, steps, _) = run(&locals, &files, |on| on.contains(pa.as_str()) && on.contains(pb.as_str()));
            let Next::Found(found) = next else { panic!("pair {a}+{b}: {next:?}") };
            assert!(found == pa || found == pb, "pair {a}+{b} named {found}");
            assert!(steps <= 6, "pair {a}+{b} took {steps} launches");
        }
    }

    #[test]
    fn a_library_the_others_need_is_never_switched_off() {
        let files: Vec<String> = (0..12).map(jar).chain(["fabric-api.jar".to_string()]).collect();
        let mut locals: Vec<LocalMeta> = (0..12).map(|i| meta(&jar(i), &["fabric-api"])).collect();
        locals.push(meta("fabric-api.jar", &[]));
        let culprit = jar(9);
        let (next, _, _) = run(&locals, &files, |on| {
            let users = on.iter().any(|f| f.starts_with("mod"));
            assert!(!users || on.contains("fabric-api.jar"), "a mod was launched without the library it needs: {on:?}");
            on.contains(culprit.as_str())
        });
        assert_eq!(next, Next::Found(culprit));
    }

    #[test]
    fn a_crash_that_stays_without_any_mod_is_not_blamed_on_one_after_the_check() {
        let files: Vec<String> = (0..8).map(jar).collect();
        let locals: Vec<LocalMeta> = files.iter().map(|f| meta(f, &[])).collect();
        let (next, _, mut b) = run(&locals, &files, |_| true);
        let Next::Found(f) = next else { panic!("{next:?}") };
        assert!(!b.verified, "every launch crashed, so {f} is only a guess");
        b.testing = vec![f];
        answer(&mut b, true);
        assert_eq!(plan(&b, &locals, &["fabric".into()]), Next::NotMods);
    }

    #[test]
    fn the_last_suspect_confirmed_by_a_launch_is_verified() {
        let files: Vec<String> = (0..2).map(jar).collect();
        let mut b = start(&files);
        b.testing = vec![jar(0)];
        answer(&mut b, false);
        assert!(b.verified && b.suspects == vec![jar(0)]);
    }

    #[test]
    fn runs_left_is_the_ceiling_of_log2() {
        assert_eq!([1, 2, 3, 4, 5, 40, 64, 65].map(runs_left), [0, 1, 2, 2, 3, 6, 6, 7]);
    }
}
