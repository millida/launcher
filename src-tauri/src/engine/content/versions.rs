use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;

/// One file of a mod's project that this build can load.
#[derive(Clone, serde::Serialize)]
pub struct VersionChoice {
    pub id: String,
    pub number: String,
    /// release | beta | alpha
    pub channel: String,
    pub date: String,
    pub current: bool,
}

/// A candidate with the raw catalogue record it came from, so a pick installs
/// exactly the file that was listed.
struct Candidate {
    choice: VersionChoice,
    raw: Value,
}

fn cf_id(project_id: &str) -> Option<u32> {
    project_id.strip_prefix("cf:").and_then(|s| s.parse().ok())
}

/// Catalogue ids are short alphanumeric tokens (Modrinth) or numbers
/// (CurseForge). Anything else never reaches a URL.
fn version_id_ok(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_alphanumeric())
}

fn sourced_entry(profile: &str, kind: &str, file_name: &str) -> Result<ContentEntry, String> {
    let file_name = safe_file_name(file_name)?;
    load_content_manifest(profile)
        .into_iter()
        .find(|e| e.kind == kind && e.file_name == file_name && !e.project_id.is_empty())
        .ok_or_else(|| "У этого файла нет источника — версию меняют только у модов с Modrinth или CurseForge".to_string())
}

fn cf_channel(release_type: u64) -> &'static str {
    match release_type {
        2 => "beta",
        3 => "alpha",
        _ => "release",
    }
}

/// Files of `project_id` the build can load, newest first.
async fn candidates(ctx: &Ctx, project_id: &str, current: &str) -> Result<Vec<Candidate>, String> {
    if let Some(mod_id) = cf_id(project_id) {
        let lt = if ctx.kind == "mod" { cf_loader_type(&ctx.loader_id) } else { 0 };
        let files = cf_files_for(mod_id, &ctx.game_version, lt).await?;
        return Ok(files
            .into_iter()
            .filter(|f| cf_file_fits(f, &ctx.game_version, &ctx.loaders, &ctx.bridge))
            .map(|f| {
                let id = f["id"].as_u64().unwrap_or(0).to_string();
                Candidate {
                    choice: VersionChoice {
                        current: id == current,
                        number: f["displayName"].as_str().unwrap_or("").to_string(),
                        channel: cf_channel(f["releaseType"].as_u64().unwrap_or(1)).into(),
                        date: f["fileDate"].as_str().unwrap_or("").to_string(),
                        id,
                    },
                    raw: f,
                }
            })
            .collect());
    }
    let versions = project_versions(project_id).await?;
    Ok(versions
        .into_iter()
        .filter(|v| fits_build(v, &ctx.game_version, &ctx.loaders, &ctx.bridge))
        .map(|v| {
            let id = v["id"].as_str().unwrap_or("").to_string();
            Candidate {
                choice: VersionChoice {
                    current: id == current,
                    number: v["version_number"].as_str().unwrap_or("").to_string(),
                    channel: v["version_type"].as_str().unwrap_or("release").to_string(),
                    date: v["date_published"].as_str().unwrap_or("").to_string(),
                    id,
                },
                raw: v,
            }
        })
        .collect())
}

/// Every file of this mod's project built for the game version and loader of
/// the build, newest first, the installed one marked.
pub async fn content_versions(profile: String, kind: String, file_name: String) -> Result<Vec<VersionChoice>, String> {
    let entry = sourced_entry(&profile, &kind, &file_name)?;
    let ctx = ctx_of(&profile, &kind);
    let list = candidates(&ctx, &entry.project_id, &entry.version_id).await?;
    Ok(list.into_iter().map(|c| c.choice).collect())
}

/// The part of a catalogue version number that is the mod's own version:
/// «mc1.20.1-0.5.8-fabric» and «jei-1.20.1-forge-15.3.0.4» carry the game
/// version and loader next to it, and only one token is what a loader compares.
pub(crate) fn number_in_range(number: &str, range: &str, game_version: &str) -> bool {
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return true;
    }
    number
        .split(['-', '+', ' ', '_'])
        .map(|t| t.trim_start_matches(['v', 'V']))
        .filter(|t| t.starts_with(|c: char| c.is_ascii_digit()) && *t != game_version)
        .any(|t| version_satisfies(t, range))
}

/// Removes the staged download on every way out except a successful rename.
struct Staged(PathBuf);

impl Drop for Staged {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

struct NewFile<'a> {
    name: String,
    urls: Vec<String>,
    sum: Sum<'a>,
    sha1: &'a str,
    size: Option<u64>,
}

/// Puts the new file in place of the old one. The download goes to a hidden
/// file next to the mods, is checked against the catalogue digest, and only
/// then takes the name — the old jar is removed after that, never before, so a
/// failed download leaves the build exactly as it was.
async fn swap_file(profile: &str, kind: &str, old: &str, new: NewFile<'_>) -> Result<String, String> {
    let dir = profile_dir(profile).join(content_dir(kind));
    let old = safe_file_name(old)?;
    let name = safe_file_name(&new.name)?;
    let old_on = safe_child(&dir, &old)?;
    let old_off = safe_child(&dir, &format!("{}.disabled", old))?;
    let was_disabled = old_off.exists() && !old_on.exists();
    let target = safe_child(&dir, &if was_disabled { format!("{}.disabled", name) } else { name.clone() })?;
    let stage = Staged(safe_child(&dir, &format!(".{}.millida-new", name))?);
    let _ = std::fs::remove_file(&stage.0);
    let linked = !new.sha1.is_empty() && link_from_store(new.sha1, &stage.0, new.size);
    if !linked {
        let mut last = String::from("у файла нет ссылки на загрузку");
        let mut done = false;
        for u in &new.urls {
            match download_checked_cancellable(u, &stage.0, Some(new.sum), new.size, None).await {
                Ok(()) => {
                    done = true;
                    break;
                }
                Err(e) => last = e,
            }
        }
        if !done {
            return Err(format!("{} не скачался, сборка не тронута: {}", name, last));
        }
    }
    assert_not_running(profile, "смени версию ещё раз")?;
    std::fs::rename(&stage.0, &target).map_err(|e| format!("Не удалось поставить {} — закрой игру и повтори: {}", name, e))?;
    if !new.sha1.is_empty() {
        adopt_to_store(&target, new.sha1);
    }
    if name != old {
        for stale in [old_on, old_off] {
            if stale.exists() && stale != target {
                std::fs::remove_file(&stale)
                    .map_err(|e| format!("Новая версия {} встала, но старый файл {} не удалился — удали его вручную: {}", name, old, e))?;
            }
        }
    }
    Ok(name)
}

async fn install_candidate(profile: &str, kind: &str, entry: &ContentEntry, c: &Candidate) -> Result<String, String> {
    let v = &c.raw;
    if cf_id(&entry.project_id).is_some() {
        let name = safe_file_name(v["fileName"].as_str().ok_or("нет имени файла")?)?;
        let sha1 = cf_sha1(v);
        if sha1.is_empty() {
            return Err(format!("CurseForge не дал контрольную сумму {} — такой файл лаунчер не ставит", name));
        }
        let urls = cf_file_urls(v, &name);
        let size = v["fileLength"].as_u64();
        let installed = swap_file(profile, kind, &entry.file_name, NewFile { name, urls, sum: Sum::Sha1(&sha1), sha1: &sha1, size }).await?;
        record(profile, kind, entry, &installed, ContentEntry {
            version_id: c.choice.id.clone(),
            version_number: c.choice.number.clone(),
            download_url: cf_file_urls(v, &installed).into_iter().next().unwrap_or_default(),
            sha1: sha1.clone(),
            sha512: String::new(),
            file_size: size.unwrap_or(0),
            ..entry.clone()
        });
        return Ok(installed);
    }
    let file = v["files"]
        .as_array()
        .and_then(|fs| fs.iter().find(|f| f["primary"] == true).or_else(|| fs.first()))
        .ok_or("Файл не найден")?;
    let name = safe_file_name(file["filename"].as_str().ok_or("нет имени файла")?)?;
    let sha512 = file["hashes"]["sha512"].as_str().unwrap_or("");
    let sha1 = file["hashes"]["sha1"].as_str().unwrap_or("");
    let sum = if !sha512.is_empty() {
        Sum::Sha512(sha512)
    } else if !sha1.is_empty() {
        Sum::Sha1(sha1)
    } else {
        return Err(format!("Modrinth не дал контрольную сумму {} — такой файл лаунчер не ставит", name));
    };
    let url = file["url"].as_str().unwrap_or("").to_string();
    let size = file["size"].as_u64();
    let installed = swap_file(profile, kind, &entry.file_name, NewFile { name, urls: vec![url.clone()], sum, sha1, size }).await?;
    record(profile, kind, entry, &installed, ContentEntry {
        version_id: c.choice.id.clone(),
        version_number: c.choice.number.clone(),
        download_url: url,
        sha1: sha1.to_string(),
        sha512: sha512.to_string(),
        file_size: size.unwrap_or(0),
        ..entry.clone()
    });
    Ok(installed)
}

fn record(profile: &str, kind: &str, old: &ContentEntry, installed: &str, mut next: ContentEntry) {
    if installed != old.file_name {
        manifest_remove(profile, kind, &old.file_name);
    }
    next.kind = kind.to_string();
    next.file_name = installed.to_string();
    manifest_upsert(profile, next);
}

fn pinned_refusal(profile: &str, ctx: &Ctx, entry: &ContentEntry) -> Result<(), String> {
    if fabric_api_pinned(profile, &ctx.bridge, &entry.project_id) {
        return Err("Fabric API этой сборки закреплён под неё — его версию менять нельзя".into());
    }
    Ok(())
}

/// Replaces an installed mod with another file of the same project. Only a
/// file listed for this build is accepted: the id is looked up among the
/// project's own files, so neither another project nor a jar for another game
/// version can come in through it.
pub async fn set_content_version(profile: String, kind: String, file_name: String, version_id: String) -> Result<String, String> {
    if !version_id_ok(&version_id) {
        return Err("Некорректная версия".into());
    }
    assert_not_running(&profile, "смени версию ещё раз")?;
    let entry = sourced_entry(&profile, &kind, &file_name)?;
    if entry.version_id == version_id {
        return Ok(entry.file_name);
    }
    let ctx = ctx_of(&profile, &kind);
    pinned_refusal(&profile, &ctx, &entry)?;
    let list = candidates(&ctx, &entry.project_id, &entry.version_id).await?;
    let pick = list
        .iter()
        .find(|c| c.choice.id == version_id)
        .ok_or("Эта версия не подходит к сборке — выбери другую из списка")?;
    install_candidate(&profile, &kind, &entry, pick).await
}

/// Puts the newest file of this mod that fits the build and `range` — the
/// version a loader asked for. `*` means «any file for this build», which is
/// how a mod built for another game version is brought to this one.
pub(crate) async fn set_content_version_in_range(profile: &str, kind: &str, file_name: &str, range: &str) -> Result<String, String> {
    assert_not_running(profile, "повтори починку")?;
    let entry = sourced_entry(profile, kind, file_name)?;
    let ctx = ctx_of(profile, kind);
    pinned_refusal(profile, &ctx, &entry)?;
    let title = if entry.title.is_empty() { entry.file_name.clone() } else { entry.title.clone() };
    let list = candidates(&ctx, &entry.project_id, &entry.version_id).await?;
    let pick = list
        .iter()
        .find(|c| number_in_range(&c.choice.number, range, &ctx.game_version))
        .ok_or_else(|| format!("У «{}» нет версии под эту сборку, которая подошла бы ({}) — отключи мод", title, range))?;
    if pick.choice.current {
        return Err(format!("«{}» уже стоит в подходящей версии — новее под эту сборку нет, отключи мод", title));
    }
    install_candidate(profile, kind, &entry, pick).await
}

/// The newest file of a Modrinth project that fits the build and `range`, for
/// a dependency the loader said is missing.
pub(crate) async fn version_for_dependency(ctx: &Ctx, project: &str, range: &str) -> Result<String, String> {
    let list = candidates(ctx, project, "").await?;
    list.into_iter()
        .find(|c| number_in_range(&c.choice.number, range, &ctx.game_version))
        .map(|c| c.choice.id)
        .ok_or_else(|| format!("нет версии под эту сборку{}", if range == "*" { String::new() } else { format!(" в диапазоне {}", range) }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// catalogue version number, range -> fits. The number carries the game
    /// version and the loader next to the mod version; a wrong answer installs
    /// a file the loader refuses again, or refuses one that fits.
    #[test]
    fn the_mod_version_is_read_out_of_the_catalogue_number() {
        let cases: [(&str, &str, bool, &str); 9] = [
            ("mc1.20.1-0.5.8-fabric", ">=0.5.8", true, "Sodium на Modrinth: версия игры спереди"),
            ("mc1.20.1-0.5.3-fabric", ">=0.5.8", false, "та же запись, но версия ниже требования"),
            ("0.5.11+mc1.20.1", ">=0.5.8 <0.6", true, "версия с метаданными сборки"),
            ("jei-1.20.1-forge-15.3.0.4", ">=15.2", true, "имя файла CurseForge"),
            ("1.20.1-0.3", ">=1.20", false, "версия игры в номере не засчитывается за версию мода"),
            ("v2.3.0", "=2.3.0", true, "префикс v"),
            ("Beta 7", "*", true, "любая версия"),
            ("1.0.0-beta.3", ">=1.0", true, "пре-релиз читается по числовой части"),
            ("release", ">=1.0", false, "в номере нет версии — не угадываем"),
        ];
        for (number, range, want, why) in cases {
            assert_eq!(number_in_range(number, range, "1.20.1"), want, "{} / {}: {}", number, range, why);
        }
    }

    /// id -> accepted. The id goes into a catalogue URL; a path or a query
    /// string must never get there.
    #[test]
    fn only_catalogue_shaped_ids_reach_a_url() {
        let cases: [(&str, bool, &str); 6] = [
            ("AANobbMI", true, "Modrinth"),
            ("5012345", true, "CurseForge"),
            ("", false, "пусто"),
            ("../../v2/project", false, "путь"),
            ("abc?x=1", false, "запрос"),
            ("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", false, "слишком длинный"),
        ];
        for (id, want, why) in cases {
            assert_eq!(version_id_ok(id), want, "{}: {}", id, why);
        }
    }
}
