// Settings shared between builds: options.txt, the in-game server list, resource packs and shader packs, each by its own switch.
// The shared copy lives in the "common" folder of the game root; a build takes it before the game starts and gives its changes back after the game closes. No network.
use super::fpsboost::{decode_options, encode_options, settings_of, Options};
use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Default, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CommonShare {
    #[serde(default)]
    pub options: bool,
    #[serde(default)]
    pub servers: bool,
    #[serde(default)]
    pub resourcepacks: bool,
    #[serde(default)]
    pub shaderpacks: bool,
}

const KEY: &str = "commonShare";
const OPTIONS: &str = "options.txt";
const SERVERS: &str = "servers.dat";

/// Two builds closing at once would both write the shared copy.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn common_dir() -> PathBuf {
    game_root().join("common")
}

pub fn common_share_state(profile: &str) -> CommonShare {
    serde_json::from_value(settings_of(profile)[KEY].clone()).unwrap_or_default()
}

/// A catalogue pack whose author tuned options and packs keeps its own.
fn shares(profile: &str) -> Option<CommonShare> {
    let s = common_share_state(profile);
    (s != CommonShare::default() && fps_boost_applicable(profile)).then_some(s)
}

/// The shared options.txt this build takes before every start, when it shares
/// options at all. The graphics presets tune and restore it with the build's own
/// file: otherwise the shared copy would overwrite the preset on the next start.
pub(super) fn shared_options_path(profile: &str) -> Option<PathBuf> {
    shares(profile).filter(|s| s.options).map(|_| common_dir().join(OPTIONS))
}

/// Key bindings changed format in 1.13: numbers before, names after. A binding
/// in the other format would make the old game stop reading the file.
fn same_shape(a: &str, b: &str) -> bool {
    let numeric = |v: &str| v.trim_start_matches('-').chars().all(|c| c.is_ascii_digit());
    numeric(a) == numeric(b)
}

/// The build's own keys win where the game version disagrees on meaning; every
/// other key comes from the shared copy. `version` names the file format and
/// always stays the build's.
fn options_into_build(build: &mut Vec<(String, String)>, shared: &[(String, String)]) {
    for (k, v) in shared {
        if k == "version" {
            continue;
        }
        match build.iter_mut().find(|(bk, _)| bk == k) {
            Some(row) => {
                if !k.starts_with("key_") || same_shape(&row.1, v) {
                    row.1 = v.clone();
                }
            }
            None if !k.starts_with("key_") => build.push((k.clone(), v.clone())),
            None => {}
        }
    }
}

/// The shared copy keeps keys of every version it has seen, so a 1.12 build
/// closing does not erase what a 1.21 build set.
fn options_into_shared(shared: &mut Vec<(String, String)>, build: &[(String, String)]) {
    for (k, v) in build {
        if k == "version" {
            continue;
        }
        match shared.iter_mut().find(|(sk, _)| sk == k) {
            Some(row) => row.1 = v.clone(),
            None => shared.push((k.clone(), v.clone())),
        }
    }
}

fn read_opts(path: &Path) -> Option<Options> {
    std::fs::read(path).ok().map(|b| decode_options(&b))
}

fn sync_options(build: &Path, shared: &Path, into_build: bool) -> Result<(), String> {
    let (from, to) = if into_build { (shared, build) } else { (build, shared) };
    let Some(src) = read_opts(from) else { return Ok(()) };
    let mut dst = read_opts(to).unwrap_or(Options { rows: vec![], bytewise: src.bytewise });
    if into_build {
        options_into_build(&mut dst.rows, &src.rows);
    } else {
        options_into_shared(&mut dst.rows, &src.rows);
    }
    write_bytes_atomic(to, &encode_options(&dst))
}

fn mtime(p: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
}

/// Shared entries first, then the build's own that the shared list lacks.
fn union_servers(first: &[ServerRecord], then: &[ServerRecord]) -> Vec<ServerRecord> {
    let mut out = first.to_vec();
    for s in then {
        if !out.iter().any(|o| o.ip == s.ip) {
            out.push(s.clone());
        }
    }
    out
}

/// The shared list is the truth, so a server removed in one build stays
/// removed. The one exception is a build file newer than the shared one: a
/// server was pinned to it just now for a quick join, and it must survive.
fn servers_into_build(build: &Path, shared: &Path) -> Result<(), String> {
    let Ok(raw) = std::fs::read(shared) else { return Ok(()) };
    let shared_list = read_servers(&raw);
    if shared_list.is_empty() && !raw.is_empty() {
        return Ok(());
    }
    let own = std::fs::read(build).map(|b| read_servers(&b)).unwrap_or_default();
    let fresher = matches!((mtime(build), mtime(shared)), (Some(b), Some(s)) if b > s);
    let list = if fresher { union_servers(&own, &shared_list) } else { shared_list };
    write_bytes_atomic(build, &write_servers(&list))
}

fn servers_into_shared(build: &Path, shared: &Path) -> Result<(), String> {
    let Ok(raw) = std::fs::read(build) else { return Ok(()) };
    if read_servers(&raw).is_empty() && !raw.is_empty() {
        return Ok(());
    }
    write_bytes_atomic(shared, &raw)
}

/// Packs only ever join: one the player deletes in a build is not deleted from
/// the others, because a missing pack in one build is not a wish to lose it everywhere.
fn link_missing(from: &Path, to: &Path) -> Result<(), String> {
    let Ok(rd) = std::fs::read_dir(from) else { return Ok(()) };
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for e in rd.flatten() {
        let src = e.path();
        let name = e.file_name();
        let dst = to.join(&name);
        if dst.exists() || std::fs::symlink_metadata(&src).is_ok_and(|m| m.file_type().is_symlink()) {
            continue;
        }
        if src.is_dir() {
            link_missing(&src, &dst)?;
        } else if std::fs::hard_link(&src, &dst).is_err() {
            std::fs::copy(&src, &dst).map_err(|e| format!("{}: {}", name.to_string_lossy(), e))?;
        }
    }
    Ok(())
}

fn sync(profile: &str, s: CommonShare, into_build: bool) -> Result<(), String> {
    let build = profile_dir(profile);
    let shared = common_dir();
    std::fs::create_dir_all(&shared).map_err(|e| e.to_string())?;
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if s.options {
        sync_options(&build.join(OPTIONS), &shared.join(OPTIONS), into_build)?;
    }
    if s.servers {
        if into_build {
            servers_into_build(&build.join(SERVERS), &shared.join(SERVERS))?;
        } else {
            servers_into_shared(&build.join(SERVERS), &shared.join(SERVERS))?;
        }
    }
    for (on, dir) in [(s.resourcepacks, "resourcepacks"), (s.shaderpacks, "shaderpacks")] {
        if !on {
            continue;
        }
        if into_build {
            link_missing(&shared.join(dir), &build.join(dir))?;
        } else {
            link_missing(&build.join(dir), &shared.join(dir))?;
        }
    }
    Ok(())
}

/// Before the game starts: the build takes what other builds shared. A failure
/// costs only the shared settings, never the launch.
pub(crate) fn share_common_before_launch(profile: &str) {
    if let Some(s) = shares(profile) {
        if let Err(e) = sync(profile, s, true) {
            eprintln!("[common] {}: {}", profile, e);
        }
    }
}

pub(crate) fn share_common_after_exit(profile: &str) {
    if let Some(s) = shares(profile) {
        if let Err(e) = sync(profile, s, false) {
            eprintln!("[common] {}: {}", profile, e);
        }
    }
}

/// Turning a switch on: the first build seeds the shared copy with its own
/// settings; a build joining later takes the shared ones, and its servers and
/// packs are added to the shared copy rather than lost.
pub fn set_common_share(profile: &str, next: CommonShare) -> Result<CommonShare, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    if !fps_boost_applicable(profile) {
        return Err("Настройки этой сборки подобрал автор — делить их с другими нельзя".into());
    }
    let before = common_share_state(profile);
    let fresh = CommonShare {
        options: next.options && !before.options,
        servers: next.servers && !before.servers,
        resourcepacks: next.resourcepacks && !before.resourcepacks,
        shaderpacks: next.shaderpacks && !before.shaderpacks,
    };
    if fresh != CommonShare::default() {
        let shared = common_dir();
        let build = profile_dir(profile);
        let seeded = |f: &str| shared.join(f).exists();
        if fresh.servers && seeded(SERVERS) {
            let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mine = std::fs::read(build.join(SERVERS)).map(|b| read_servers(&b)).unwrap_or_default();
            let theirs = std::fs::read(shared.join(SERVERS)).map(|b| read_servers(&b)).unwrap_or_default();
            write_bytes_atomic(&shared.join(SERVERS), &write_servers(&union_servers(&theirs, &mine)))?;
        }
        let first_out = CommonShare { options: fresh.options && !seeded(OPTIONS), servers: fresh.servers && !seeded(SERVERS), ..fresh };
        sync(profile, first_out, false)?;
        sync(profile, fresh, true)?;
    }
    let mut patch = serde_json::Map::new();
    patch.insert(KEY.into(), serde_json::to_value(next).unwrap_or(Value::Null));
    merge_settings(profile, patch);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn get<'a>(r: &'a [(String, String)], k: &str) -> Option<&'a str> {
        r.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
    }

    /// shared options -> what a 1.12 build takes. A binding in the other
    /// format or the file's own version would break the old game.
    #[test]
    fn an_old_build_takes_only_what_it_can_read() {
        let mut build = rows(&[("version", "1343"), ("key_key.jump", "57"), ("fov", "0.0")]);
        let shared = rows(&[("version", "3955"), ("key_key.jump", "key.keyboard.space"), ("fov", "0.5"), ("lang", "ru_ru"), ("key_key.new", "key.keyboard.x")]);
        options_into_build(&mut build, &shared);
        assert_eq!(get(&build, "version"), Some("1343"), "the file format stays the build's");
        assert_eq!(get(&build, "key_key.jump"), Some("57"), "a named binding must not land in a numeric-binding game");
        assert_eq!(get(&build, "fov"), Some("0.5"), "a plain setting is shared");
        assert_eq!(get(&build, "lang"), Some("ru_ru"), "a key the build lacked is added");
        assert_eq!(get(&build, "key_key.new"), None, "a binding the build never had is left to the game");
    }

    /// The shared copy keeps every version's keys and the newest value.
    #[test]
    fn the_shared_copy_collects_from_every_build() {
        let mut shared = rows(&[("version", "3955"), ("key_key.jump", "key.keyboard.space"), ("fov", "0.5")]);
        options_into_shared(&mut shared, &rows(&[("version", "1343"), ("key_key.jump", "57"), ("fov", "0.9")]));
        assert_eq!(get(&shared, "version"), Some("3955"), "version is never copied");
        assert_eq!(get(&shared, "fov"), Some("0.9"), "the last closed build wins");
        assert_eq!(get(&shared, "key_key.jump"), Some("57"), "bindings are kept as written; builds filter them on the way in");
    }

    #[test]
    fn a_shared_server_list_keeps_its_order_and_adds_only_new_addresses() {
        let s = |n: &str, ip: &str| ServerRecord::new(n, ip);
        let out = union_servers(&[s("A", "a.net"), s("B", "b.net")], &[s("B2", "b.net"), s("C", "c.net")]);
        let ips: Vec<&str> = out.iter().map(|x| x.ip.as_str()).collect();
        assert_eq!(ips, vec!["a.net", "b.net", "c.net"], "one entry per address, the first list first");
        assert_eq!(out[1].name, "B", "the first list's name for a shared address wins");
    }
}
