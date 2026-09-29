use crate::engine::*;
use std::collections::BTreeSet;
use std::path::Path;
use std::time::{Duration, SystemTime};

/// The player's own answer to «update this build by itself». Absent means the
/// launcher decides: an untouched build follows the catalogue, a changed one
/// is left alone, since an update brings the author's mods folder whole.
pub const PACK_AUTO_UPDATE_KEY: &str = "catalogPackAutoUpdate";
const SHIPPED_MODS_FILE: &str = "millida-pack-mods.json";
const MOD_EXTENSIONS: [&str; 3] = ["jar", "zip", "litemod"];
const CLOCK_SLACK: Duration = Duration::from_secs(2);

#[derive(serde::Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackAutoUpdate {
    pub catalog: bool,
    pub on: bool,
    pub modified: bool,
    pub chosen: Option<bool>,
}

fn mod_file(name: &str) -> bool {
    let low = name.to_ascii_lowercase();
    low.rsplit_once('.').is_some_and(|(_, ext)| MOD_EXTENSIONS.contains(&ext))
}

/// Jars the launcher itself puts into every build at launch: their coming and
/// going is not the player's edit.
fn launcher_placed(name: &str) -> bool {
    is_millida_mod_file(name) || is_skin_mod_file(name)
}

/// Enabled mod files of a build, `mods/` and one level below it (1.7.10 packs
/// keep `mods/1.7.10`). A disabled jar ends in `.disabled` and is not a mod
/// file, so switching a shipped mod off reads as it being gone.
fn enabled_mods(pdir: &Path) -> Vec<(String, std::fs::Metadata)> {
    let mut out = vec![];
    collect_mods(&pdir.join(content_dir("mod")), "", 0, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn collect_mods(dir: &Path, prefix: &str, depth: u32, out: &mut Vec<(String, std::fs::Metadata)>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Ok(meta) = std::fs::symlink_metadata(entry.path()) else { continue };
        let rel = format!("{}{}", prefix, name);
        if meta.is_dir() && depth == 0 {
            collect_mods(&entry.path(), &format!("{}/", rel), depth + 1, out);
        } else if meta.is_file() && mod_file(&name) && !launcher_placed(&name) {
            out.push((rel, meta));
        }
    }
}

fn names(mods: &[(String, std::fs::Metadata)]) -> BTreeSet<String> {
    mods.iter().map(|(n, _)| n.clone()).collect()
}

/// What the pack put into `mods/`, written right after it was placed, before
/// the launcher or the player touched anything.
pub(crate) fn record_shipped_mods(pdir: &Path) -> Result<(), String> {
    let shipped: Vec<String> = names(&enabled_mods(pdir)).into_iter().collect();
    write_json_atomic(&pdir.join(SHIPPED_MODS_FILE), &shipped).map_err(|e| format!("Не удалось записать список модов сборки: {}", e))
}

fn read_shipped_mods(pdir: &Path) -> Option<BTreeSet<String>> {
    let raw = std::fs::read(pdir.join(SHIPPED_MODS_FILE)).ok()?;
    serde_json::from_slice::<Vec<String>>(&raw).ok().map(|v| v.into_iter().collect())
}

fn arrived_at(meta: &std::fs::Metadata) -> Option<SystemTime> {
    meta.created().or_else(|_| meta.modified()).ok()
}

/// Builds installed before the list of shipped mods existed only have the time
/// the pack was placed: a mod file that arrived later was added. Without even
/// that there is nothing to compare with, and a build that may hold the
/// player's mods is not the one to overwrite.
fn added_since_install(recorded: Option<SystemTime>, mods: &[(String, std::fs::Metadata)]) -> bool {
    let Some(recorded) = recorded else { return true };
    let limit = recorded + CLOCK_SLACK;
    mods.iter().any(|(_, meta)| arrived_at(meta).is_some_and(|t| t > limit))
}

pub(crate) fn mods_modified(pdir: &Path) -> bool {
    let mods = enabled_mods(pdir);
    match read_shipped_mods(pdir) {
        Some(shipped) => shipped != names(&mods),
        None => added_since_install(shipped_recorded_at(pdir), &mods),
    }
}

pub fn auto_update_on(chosen: Option<bool>, modified: bool) -> bool {
    chosen.unwrap_or(!modified)
}

fn catalog_build(settings: &serde_json::Value) -> bool {
    settings["catalogPackSlug"].as_str().map(str::trim).is_some_and(catalog_slug_ok)
}

pub fn pack_auto_update(profile: &str) -> PackAutoUpdate {
    let settings = profile_settings(profile);
    if !catalog_build(&settings) {
        return PackAutoUpdate { catalog: false, on: false, modified: false, chosen: None };
    }
    let chosen = settings[PACK_AUTO_UPDATE_KEY].as_bool();
    let modified = mods_modified(&profile_dir(profile));
    PackAutoUpdate { catalog: true, on: auto_update_on(chosen, modified), modified, chosen }
}

pub fn set_pack_auto_update(profile: &str, on: bool) -> Result<PackAutoUpdate, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена — открой список сборок заново".into());
    }
    if !catalog_build(&profile_settings(profile)) {
        return Err("Эта сборка поставлена не из каталога Millida — обновлять её неоткуда".into());
    }
    let mut patch = serde_json::Map::new();
    patch.insert(PACK_AUTO_UPDATE_KEY.into(), serde_json::Value::Bool(on));
    merge_settings(profile, patch);
    let state = pack_auto_update(profile);
    if state.chosen != Some(on) {
        return Err("Не удалось сохранить настройку — проверь, что папка сборки доступна для записи".into());
    }
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("millida-pack-edits-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(p.join("mods/1.7.10")).unwrap();
        p
    }

    fn put(dir: &Path, rel: &str) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    fn shipped_pack(name: &str) -> std::path::PathBuf {
        let dir = scratch(name);
        for rel in ["mods/angelica.jar", "mods/unimixins.jar", "mods/1.7.10/legacy.zip"] {
            put(&dir, rel);
        }
        record_shipped_mods(&dir).unwrap();
        dir
    }

    /// (what happened to the installed pack) -> does it still count as the author's build.
    #[test]
    fn a_player_edit_of_the_mods_folder_is_seen() {
        type Edit = fn(&Path);
        let cases: [(&str, Edit, bool, &str); 9] = [
            ("untouched", |_| {}, false, "a build as shipped keeps following the catalogue"),
            ("added", |d| put(d, "mods/jei.jar"), true, "29.09: a mod the player added was wiped by the next update"),
            ("removed", |d| std::fs::remove_file(d.join("mods/angelica.jar")).unwrap(), true, "a removed mod would come back with the update"),
            (
                "disabled",
                |d| std::fs::rename(d.join("mods/angelica.jar"), d.join("mods/angelica.jar.disabled")).unwrap(),
                true,
                "a switched-off mod would be switched back on",
            ),
            ("nested", |d| put(d, "mods/1.7.10/extra.jar"), true, "1.7.10 packs keep mods one folder down"),
            ("own-mod", |d| put(d, "mods/millida-mod-forge-1.7.10-0.1.15.jar"), false, "our mod goes into every build at launch, it is not the player's edit"),
            ("skin-mod", |d| put(d, "mods/CustomSkinLoader.jar"), false, "the skin mod is placed by the launcher too"),
            ("runtime", |d| put(d, "mods/.connector/cache.jar"), false, "a mod's own cache folder is not a mod"),
            ("config", |d| put(d, "mods/notes.txt"), false, "only mod files count"),
        ];
        for (name, edit, want, why) in cases {
            let dir = shipped_pack(name);
            edit(&dir);
            assert_eq!(mods_modified(&dir), want, "{}: {}", name, why);
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    #[test]
    fn a_build_installed_before_the_list_is_judged_by_its_install_time() {
        let dir = scratch("legacy");
        put(&dir, "mods/angelica.jar");
        let mods = enabled_mods(&dir);
        let now = SystemTime::now();
        assert!(!added_since_install(Some(now + Duration::from_secs(60)), &mods), "mods placed with the pack are the author's");
        assert!(added_since_install(Some(now - Duration::from_secs(60)), &mods), "a mod that arrived after the install is the player's");
        assert!(added_since_install(None, &mods), "with no record at all the build may hold the player's mods and is not overwritten");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// (player's choice, build edited) -> the build updates by itself.
    #[test]
    fn the_players_choice_wins_over_the_default() {
        let cases: [(Option<bool>, bool, bool, &str); 4] = [
            (None, false, true, "an untouched catalogue build follows the published version"),
            (None, true, false, "an edited build is never overwritten behind the player's back"),
            (Some(true), true, true, "the player asked for updates knowing the mods folder is replaced"),
            (Some(false), false, false, "the player turned updates off for an untouched build"),
        ];
        for (chosen, modified, want, why) in cases {
            assert_eq!(auto_update_on(chosen, modified), want, "{}", why);
        }
    }
}
