// Remembers which mods a build had the last time the game started and closed normally. Reads and writes one file in the modpack folder, no network.
//! The mod set of the last launch that went well, so a crash with no named
//! cause can still be answered with «switch off what was added since then».

use serde::{Deserialize, Serialize};

use crate::engine::{content_dir, profile_dir, write_json_quiet};

const GOOD_RUN_FILE: &str = "millida-last-good.json";

/// More new mods than this is a rebuilt pack rather than «the mod I just
/// added»: switching all of them off is not one fix, so it is not offered.
pub(crate) const ADDED_OFFER_MAX: usize = 40;

#[derive(Serialize, Deserialize, Default)]
struct GoodRun {
    at: u64,
    mods: Vec<String>,
}

/// Enabled jars of the build's mods folder, sorted.
pub(crate) fn enabled_mod_files(profile: &str) -> Vec<String> {
    let dir = profile_dir(profile).join(content_dir("mod"));
    let mut out: Vec<String> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| e.path().is_file())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.to_ascii_lowercase().ends_with(".jar"))
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The launch with `mods` went well. Best effort: without the file the crash
/// dialog only loses one offer, the game itself is not affected.
pub(crate) fn record_good_run(profile: &str, mods: &[String]) {
    write_json_quiet(&profile_dir(profile).join(GOOD_RUN_FILE), &GoodRun { at: now_secs(), mods: mods.to_vec() });
}

fn read_good_run(profile: &str) -> Option<GoodRun> {
    let raw = std::fs::read(profile_dir(profile).join(GOOD_RUN_FILE)).ok()?;
    serde_json::from_slice(&raw).ok()
}

/// Files enabled now that the good launch did not have. An update of a mod
/// counts too: its new jar is a new file the build never started with.
pub(crate) fn added_since(before: &[String], now: &[String]) -> Vec<String> {
    now.iter().filter(|f| !before.contains(f)).cloned().collect()
}

/// Mods added after the last good launch, when there was one and the list is
/// small enough to be the change that broke the build.
pub(crate) fn mods_added_since_good_run(profile: &str) -> Option<Vec<String>> {
    let good = read_good_run(profile).filter(|g| g.at > 0)?;
    let added = added_since(&good.mods, &enabled_mod_files(profile));
    (!added.is_empty() && added.len() <= ADDED_OFFER_MAX).then_some(added)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    /// (mods of the good launch, mods now) -> what the crash dialog offers to switch off.
    #[test]
    fn only_files_the_good_launch_did_not_have_are_new() {
        type Case<'a> = (&'a [&'a str], &'a [&'a str], &'a [&'a str], &'a str);
        let cases: [Case; 4] = [
            (&["a.jar", "b.jar"], &["a.jar", "b.jar", "c.jar"], &["c.jar"], "one mod added after the good launch"),
            (&["a.jar", "b.jar"], &["a.jar"], &[], "a removed mod is no new mod"),
            (&["sodium-0.5.3.jar"], &["sodium-0.5.8.jar"], &["sodium-0.5.8.jar"], "an update brings a jar the build never started with"),
            (&[], &[], &[], "nothing in either"),
        ];
        for (before, now, want, why) in cases {
            assert_eq!(added_since(&v(before), &v(now)), v(want), "{why}");
        }
    }
}
