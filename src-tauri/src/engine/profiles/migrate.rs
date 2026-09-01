use crate::engine::*;
use futures::StreamExt;
use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

/// Files carried over as they are: worlds, settings and packs do not depend on
/// the game version the way a mod jar does.
const CARRY: &[&str] = &[
    "config",
    "saves",
    "resourcepacks",
    "shaderpacks",
    "datapacks",
    "schematics",
    "options.txt",
    "servers.dat",
];

#[derive(Clone, serde::Serialize)]
pub struct MigrateItem {
    pub file_name: String,
    pub title: String,
    pub project_id: String,
    pub version_number: String,
    pub ok: bool,
    pub note: String,
}

#[derive(serde::Serialize)]
pub struct MigratePlan {
    pub items: Vec<MigrateItem>,
    pub ready: usize,
    pub missing: usize,
    /// Jars with no catalogue link: nothing can be looked up for another game
    /// version, so they stay behind instead of being copied into a build they
    /// would crash.
    pub unlinked: Vec<String>,
    pub suggested_name: String,
}

#[derive(serde::Serialize)]
pub struct MigrateResult {
    pub profile: Profile,
    pub moved: usize,
    pub failed: Vec<String>,
}

fn linked_mods(profile: &str) -> (Vec<ContentEntry>, Vec<String>) {
    let mut linked = vec![];
    let mut unlinked = vec![];
    for e in load_content_manifest(profile) {
        if e.kind != "mod" {
            continue;
        }
        if e.project_id.is_empty() {
            unlinked.push(e.file_name);
        } else {
            linked.push(e);
        }
    }
    (linked, unlinked)
}

/// Mods left on disk that the manifest never recorded — added by hand or by an
/// older launcher — are as unmovable as the ones without a project id.
fn unlisted_mods(profile: &str, known: &[String]) -> Vec<String> {
    let dir = profile_dir(profile).join("mods");
    let Ok(rd) = std::fs::read_dir(&dir) else { return vec![] };
    let mut out = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let base = name.trim_end_matches(".disabled").to_string();
        if !base.to_lowercase().ends_with(".jar") {
            continue;
        }
        if known.contains(&base) {
            continue;
        }
        out.push(base);
    }
    out
}

fn title_of(e: &ContentEntry) -> String {
    if e.title.is_empty() { e.file_name.clone() } else { e.title.clone() }
}

async fn resolve_all(
    entries: Vec<ContentEntry>,
    version: &str,
    loader: &str,
) -> Vec<(ContentEntry, Result<Value, String>)> {
    let loaders = modrinth_loaders(loader, "mod");
    let ids: Vec<String> = entries.iter().map(|e| e.project_id.clone()).collect();
    warm_projects_meta(&ids).await;
    futures::stream::iter(entries.into_iter().map(|e| {
        let gv = version.to_string();
        let ld = loaders.clone();
        async move {
            let r = best_version(&e.project_id, &gv, &ld).await;
            (e, r)
        }
    }))
    .buffer_unordered(8)
    .collect()
    .await
}

fn plan_of(
    resolved: &[(ContentEntry, Result<Value, String>)],
    unlinked: Vec<String>,
    suggested_name: String,
) -> MigratePlan {
    let mut items: Vec<MigrateItem> = resolved
        .iter()
        .map(|(e, r)| match r {
            Ok(v) => MigrateItem {
                file_name: e.file_name.clone(),
                title: title_of(e),
                project_id: e.project_id.clone(),
                version_number: v["version_number"].as_str().unwrap_or("").to_string(),
                ok: true,
                note: String::new(),
            },
            Err(err) => MigrateItem {
                file_name: e.file_name.clone(),
                title: title_of(e),
                project_id: e.project_id.clone(),
                version_number: String::new(),
                ok: false,
                note: err.clone(),
            },
        })
        .collect();
    items.sort_by(|a, b| b.ok.cmp(&a.ok).then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    let ready = items.iter().filter(|i| i.ok).count();
    MigratePlan { missing: items.len() - ready, ready, items, unlinked, suggested_name }
}

pub(crate) fn migrated_name(profile: &str, version: &str) -> String {
    unique_profile_name(&format!("{} {}", profile.trim(), version.trim()))
}

pub async fn migrate_plan(profile: String, version: String, loader: String) -> Result<MigratePlan, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let (linked, mut unlinked) = linked_mods(&profile);
    let known: Vec<String> = linked.iter().map(|e| e.file_name.clone()).collect();
    unlinked.extend(unlisted_mods(&profile, &known));
    unlinked.sort();
    unlinked.dedup();
    let resolved = resolve_all(linked, &version, &loader).await;
    Ok(plan_of(&resolved, unlinked, migrated_name(&profile, &version)))
}

fn copy_carried(from: &Path, to: &Path) -> Result<(), String> {
    for sub in CARRY {
        let src = from.join(sub);
        if !src.exists() {
            continue;
        }
        let dst = to.join(sub);
        let r = if src.is_dir() {
            std::fs::create_dir_all(&dst).and_then(|_| copy_dir_all(&src, &dst))
        } else {
            std::fs::copy(&src, &dst).map(|_| ())
        };
        r.map_err(|e| format!("Не удалось скопировать {}: {}", sub, e))?;
    }
    Ok(())
}

/// The new build gets the old build's non-mod catalogue records so its packs and
/// shaders keep their update button; mod records are written by the installs.
fn carry_manifest(from: &str, to: &str) {
    let kept: Vec<ContentEntry> = load_content_manifest(from).into_iter().filter(|e| e.kind != "mod").collect();
    if !kept.is_empty() {
        save_content_manifest(to, &kept);
    }
}

pub async fn migrate_profile(
    app: AppHandle,
    profile: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
    name: Option<String>,
) -> Result<MigrateResult, String> {
    let job = Job::start(format!("migrate:{}", profile), profile.clone())?;
    let res = migrate_job(&app, &job, profile, version, loader, loader_version, name).await;
    job.finish(&app, res)
}

async fn migrate_job(
    app: &AppHandle,
    job: &Job,
    profile: String,
    version: String,
    loader: String,
    loader_version: Option<String>,
    name: Option<String>,
) -> Result<MigrateResult, String> {
    let src = load_profiles().into_iter().find(|p| p.name == profile).ok_or("Сборка не найдена")?;
    let loader = if ["vanilla", "fabric", "quilt", "forge", "neoforge"].contains(&loader.as_str()) {
        loader
    } else {
        return Err("Неизвестный загрузчик".into());
    };
    job.emit(app, 5.0, "Ищем моды под новую версию…");
    let (linked, _) = linked_mods(&profile);
    let resolved = resolve_all(linked, &version, &loader).await;
    job.check()?;

    let wanted = name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    let newname = match wanted {
        Some(n) => unique_profile_name(&n),
        None => migrated_name(&profile, &version),
    };
    let from = profile_dir(&profile);
    let to = profile_dir(&newname);
    job.rename(&newname);
    job.emit(app, 15.0, "Копируем миры и настройки…");
    if let Err(e) = std::fs::create_dir_all(&to).map_err(|e| e.to_string()).and_then(|_| copy_carried(&from, &to)) {
        let _ = std::fs::remove_dir_all(&to);
        return Err(e);
    }
    if let Err(e) = std::fs::create_dir_all(to.join("mods")).map_err(|e| e.to_string()) {
        let _ = std::fs::remove_dir_all(&to);
        return Err(e);
    }
    carry_manifest(&profile, &newname);

    let total = resolved.len().max(1);
    let mut moved = 0;
    let mut failed: Vec<String> = vec![];
    for (i, (entry, ver)) in resolved.iter().enumerate() {
        if job.cancelled() {
            let _ = std::fs::remove_dir_all(&to);
            return Err(CANCELLED.into());
        }
        let label = title_of(entry);
        match ver {
            Ok(v) => match install_project_version(&newname, "mod", &entry.project_id, v).await {
                Ok(_) => moved += 1,
                Err(e) => failed.push(format!("{} — {}", label, e)),
            },
            Err(e) => failed.push(format!("{} — {}", label, e)),
        }
        job.emit(app, 20.0 + 70.0 * (i as f32 / total as f32), &format!("Моды {}/{}", i + 1, total));
    }

    let pinned = loader_version
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .filter(|_| loader != "vanilla");
    let prof = Profile {
        name: newname,
        version,
        fabric: loader == "fabric",
        loader: Some(loader),
        loader_version: pinned,
        icon: src.icon.clone(),
    };
    let mut all = load_profiles();
    if let Some(p) = all.iter_mut().find(|p| p.name == prof.name) {
        *p = prof.clone();
    } else {
        all.insert(0, prof.clone());
    }
    save_profiles(&all)?;
    job.emit(app, 100.0, "Сборка перенесена");
    Ok(MigrateResult { profile: prof, moved, failed })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(file: &str, title: &str, project: &str) -> ContentEntry {
        ContentEntry {
            kind: "mod".into(),
            file_name: file.into(),
            project_id: project.into(),
            title: title.into(),
            ..Default::default()
        }
    }

    /// resolution -> verdict. A mod without a build for the target version must
    /// be named in the plan, not quietly dropped: the whole point of the screen
    /// is telling the player what will NOT come along.
    #[test]
    fn plan_separates_what_moves_from_what_stays() {
        let resolved = vec![
            (entry("sodium.jar", "Sodium", "AANobbMI"), Ok(serde_json::json!({ "version_number": "0.6.0" }))),
            (entry("old.jar", "Старый мод", "zzz"), Err("нет файла под 1.20.1".to_string())),
        ];
        let plan = plan_of(&resolved, vec!["ручной.jar".into()], "Сборка 1.20.1".into());
        assert_eq!(plan.ready, 1, "Sodium has a build for the target version and must count as movable");
        assert_eq!(plan.missing, 1, "a mod with no build for the target version must be listed as staying behind");
        assert!(plan.items[0].ok, "movable mods come first, otherwise the list reads backwards");
        assert_eq!(plan.items[1].note, "нет файла под 1.20.1", "the refusal reason is shown to the player as it is");
        assert_eq!(plan.unlinked, vec!["ручной.jar".to_string()], "a hand-added jar has no catalogue link and cannot move");
    }

    /// A migration that lands on the source build's own folder would wipe the
    /// original: the new name has to be free of both the list and the disk.
    #[test]
    fn migrated_name_carries_the_target_version() {
        let name = migrated_name("Моя сборка", "1.20.1");
        assert!(name.starts_with("Моя сборка 1.20.1"), "the new build is named after the target version, not \"(копия)\": {}", name);
        assert_ne!(profile_dir(&name), profile_dir("Моя сборка"), "the new build must land in a folder of its own");
    }
}
