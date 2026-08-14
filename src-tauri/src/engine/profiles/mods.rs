use crate::engine::*;

#[derive(Clone, serde::Serialize)]
pub struct ModFile {
    pub name: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub version_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub icon_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub mc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub loader: Option<String>,
    pub size: u64,
    pub scanned: bool,
}

pub fn list_content(profile: &str, kind: &str) -> Vec<ModFile> {
    let dir = profile_dir(profile).join(content_dir(kind));
    let manifest = load_content_manifest(profile);
    let local = local_meta_map(profile, kind);
    let mut out = vec![];
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            if !e.path().is_file() { continue }
            let raw = e.file_name().to_string_lossy().to_string();
            let (name, enabled) = match raw.strip_suffix(".disabled") {
                Some(base) => (base.to_string(), false),
                None => (raw.clone(), true),
            };
            if !(name.ends_with(".jar") || name.ends_with(".zip") || name.ends_with(".litemod")) { continue }
            let meta = manifest.iter().find(|m| m.kind == kind && m.file_name == name);
            let emb = local.get(&name);
            // catalog metadata wins over what the jar declares
            let pick = |from_manifest: Option<String>, from_file: Option<String>| {
                from_manifest
                    .filter(|x: &String| !x.is_empty())
                    .or_else(|| from_file.filter(|x: &String| !x.is_empty()))
            };
            out.push(ModFile {
                name: name.clone(),
                enabled,
                project_id: pick(meta.map(|m| m.project_id.clone()), None),
                version_number: pick(meta.map(|m| m.version_number.clone()), emb.map(|m| m.version.clone())),
                title: pick(meta.map(|m| m.title.clone()), emb.map(|m| m.title.clone())),
                icon_url: pick(meta.map(|m| m.icon_url.clone()), emb.map(|m| m.icon.clone())),
                author: pick(meta.map(|m| m.author.clone()), emb.map(|m| m.authors.clone())),
                description: pick(meta.map(|m| m.description.clone()), emb.map(|m| m.description.clone())),
                mc: emb.map(|m| m.mc.clone()).filter(|x| !x.is_empty()),
                loader: emb.map(|m| m.loader.clone()).filter(|x| !x.is_empty()),
                size: e.metadata().map(|m| m.len()).unwrap_or(0),
                scanned: emb.is_some(),
            });
        }
    }
    out.sort_by_key(|a| a.title.clone().unwrap_or_else(|| a.name.clone()).to_lowercase());
    out
}
pub fn list_mods(profile: &str) -> Vec<ModFile> { list_content(profile, "mod") }

/// A running JVM keeps every loaded jar open, and Windows refuses to rename or
/// delete an open file. Refusing up front says what to do; the raw OS text did
/// not — and it arrived as an unhandled rejection, so nothing said it at all.
fn assert_not_running(profile: &str, then: &str) -> Result<(), String> {
    if running_games().iter().any(|p| p == profile) {
        return Err(format!("Сборка сейчас запущена — закрой игру и {}", then));
    }
    Ok(())
}

/// One wording for every file conflict here. While there were two, one path
/// explained the cause and the other handed the player Windows' own sentence.
fn file_busy(e: std::io::Error) -> String {
    format!("Файл занят другой программой — закрой игру и папку сборки, затем повтори: {}", e)
}

pub fn toggle_content(profile: &str, kind: &str, name: &str, enable: bool) -> Result<(), String> {
    // name arrives over IPC: reject anything but a plain file name
    let file = safe_file_name(name)?;
    assert_not_running(profile, "переключи мод ещё раз")?;
    let dir = profile_dir(profile).join(content_dir(kind));
    let on = safe_child(&dir, &file)?;
    let off = safe_child(&dir, &format!("{}.disabled", file))?;
    let (from, to) = if enable { (off, on) } else { (on, off) };
    if from.exists() { std::fs::rename(&from, &to).map_err(file_busy)?; }
    if kind == "mod" && is_injected_skin_mod(&file) {
        set_skin_mod(profile, enable)?;
    }
    Ok(())
}
pub fn toggle_mod(profile: &str, name: &str, enable: bool) -> Result<(), String> { toggle_content(profile, "mod", name, enable) }

pub fn delete_content(profile: &str, kind: &str, name: &str) -> Result<(), String> {
    let file = safe_file_name(name)?;
    assert_not_running(profile, "удали файл ещё раз")?;
    let dir = profile_dir(profile).join(content_dir(kind));
    for cand in [safe_child(&dir, &file)?, safe_child(&dir, &format!("{}.disabled", file))?] {
        if cand.exists() {
            std::fs::remove_file(&cand).map_err(file_busy)?;
        }
    }
    manifest_remove(profile, kind, &file);
    if kind == "mod" && is_injected_skin_mod(&file) {
        note_skin_mod_removed(profile);
    }
    Ok(())
}
pub fn delete_mod(profile: &str, name: &str) -> Result<(), String> { delete_content(profile, "mod", name) }

/// Files first, list second: a build that vanished from the list while its
/// folder survived came back — worlds, mods and playtime included — as soon as
/// the name was reused.
pub fn delete_profile(name: &str) -> Result<Vec<Profile>, String> {
    assert_not_running(name, "удали ещё раз")?;
    let dir = profile_dir(name);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!(
            "Не удалось удалить файлы сборки: {}. Закрой игру и папку сборки в проводнике, затем повтори", e
        ))?;
    }
    let mut all = load_profiles();
    all.retain(|p| p.name != name);
    save_profiles(&all)?;
    forget_profile_side_data(name);
    Ok(all)
}

/// Playtime and groups live outside the profile folder and are keyed by name, so
/// a rebuilt profile with the same name inherited them.
fn forget_profile_side_data(name: &str) {
    set_profile_group(name, "");
    forget_playtime(name);
}

pub fn open_profile_folder(name: &str) {
    let p = profile_dir(name);
    std::fs::create_dir_all(&p).ok();
    open_path(&p.to_string_lossy());
}
