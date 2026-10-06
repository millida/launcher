use crate::engine::*;
use serde_json::Value;
use std::path::Path;
use tauri::AppHandle;

fn unique_name(base: &str) -> String {
    unique_profile_name(base)
}

fn commit(prof: Profile) -> Result<Profile, String> {
    let mut all = load_profiles();
    all.retain(|p| p.name != prof.name);
    all.insert(0, prof.clone());
    save_profiles(&all)?;
    Ok(prof)
}

/// Where an import reports. A catalogue install runs as a job: its card shows
/// only the job's own progress and its «Отменить» sets only the job's flag, so
/// an import reporting elsewhere looked frozen for the whole mod download and
/// could not be stopped.
pub(crate) struct ImportJob<'a> {
    pub job: &'a Job,
    pub from: f32,
    pub to: f32,
}

#[derive(Clone, Copy)]
struct Progress<'a> {
    app: &'a AppHandle,
    job: Option<&'a ImportJob<'a>>,
}

impl Progress<'_> {
    fn step(&self, pct: f32, msg: &str) {
        match self.job {
            Some(j) => j.job.emit(self.app, j.from + (j.to - j.from) * pct.clamp(0.0, 100.0) / 100.0, msg),
            None => emit(self.app, "mod", pct, msg),
        }
    }

    fn check(&self) -> Result<(), String> {
        self.job.map_or(Ok(()), |j| j.job.check())
    }

    fn cancel_flag(&self) -> Option<&Halt> {
        self.job.map(|j| j.job.cancel_flag())
    }
}

/// mrpack: download every index entry from its mirrors, then apply overrides/.
async fn from_mrpack(progress: Progress<'_>, ex: &Path, name_hint: &str) -> Result<Profile, String> {
    let idx: Value = serde_json::from_slice(&std::fs::read(ex.join("modrinth.index.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let deps = &idx["dependencies"];
    let mc = deps["minecraft"].as_str().ok_or("В .mrpack нет версии Minecraft")?.to_string();
    check_version_id(&mc)?;
    let (lid, fabric, dep_key) = if deps.get("neoforge").is_some() { ("neoforge", false, "neoforge") }
        else if deps.get("forge").is_some() { ("forge", false, "forge") }
        else if deps.get("quilt-loader").is_some() { ("quilt", true, "quilt-loader") }
        else if deps.get("fabric-loader").is_some() { ("fabric", true, "fabric-loader") }
        else { ("vanilla", false, "") };
    let loader_version = deps[dep_key].as_str().filter(|v| !v.is_empty()).map(String::from);
    if let Some(lv) = &loader_version {
        check_loader_version(lv)?;
    }
    let pname = unique_name(idx["name"].as_str().unwrap_or(name_hint));
    let pdir = profile_dir(&pname);
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let files = idx["files"].as_array().cloned().unwrap_or_default();
    let fetched = match pack_entries(&files, &pdir) {
        Ok(entries) => download_pack_entries(entries, progress.cancel_flag(), &|n, total| {
            progress.step(20.0 + 60.0 * (n as f32 / total.max(1) as f32), &format!("Файлы сборки {}/{}", n, total));
        })
        .await,
        Err(e) => Err(e),
    };
    if let Err(e) = fetched.and_then(|()| progress.check()) {
        let _ = std::fs::remove_dir_all(&pdir);
        return Err(e);
    }
    for ov in ["overrides", "client-overrides"] {
        let src = ex.join(ov);
        if src.exists() { let _ = copy_overrides(&src, &pdir); }
    }
    commit(Profile { name: pname, version: mc, fabric, loader: Some(lid.into()), loader_version, icon: None })
}

/// CurseForge manifest: mods resolved by projectID/fileID through the CF API.
async fn from_cf_manifest(progress: Progress<'_>, ex: &Path, name_hint: &str) -> Result<Profile, String> {
    let man: Value = serde_json::from_slice(&std::fs::read(ex.join("manifest.json")).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let mc = man["minecraft"]["version"].as_str().ok_or("В manifest.json нет версии Minecraft")?.to_string();
    check_version_id(&mc)?;
    let loader_full = man["minecraft"]["modLoaders"].as_array()
        .and_then(|a| a.iter().find(|m| m["primary"] == true).or_else(|| a.first()))
        .and_then(|m| m["id"].as_str()).unwrap_or("").to_string();
    let (lid, loader_version) = split_loader_id(&loader_full);
    if let Some(lv) = &loader_version {
        check_loader_version(lv)?;
    }
    let pname = unique_name(man["name"].as_str().unwrap_or(name_hint));
    let pdir = profile_dir(&pname);
    std::fs::create_dir_all(pdir.join("mods")).map_err(|e| e.to_string())?;
    let list = man["files"].as_array().cloned().unwrap_or_default();
    let fetched = cf_fetch_manifest_files(&list, &pdir.join("mods"), progress.cancel_flag(), &|n, total| {
        progress.step(20.0 + 60.0 * (n as f32 / total.max(1) as f32), &format!("Моды {}/{}", n, total));
    })
    .await;
    let verdict = progress.check().and(fetched.map(|_| ()).map_err(|e| {
        if e == CANCELLED { e } else { format!("Не скачались файлы сборки: {}", e) }
    }));
    if let Err(e) = verdict {
        let _ = std::fs::remove_dir_all(&pdir);
        return Err(e);
    }
    for name in [man["overrides"].as_str().filter(|s| !s.is_empty()).unwrap_or("overrides"), "client-overrides"] {
        let ov = safe_join(ex, name)?;
        if ov.exists() { copy_overrides(&ov, &pdir).map_err(|e| e.to_string())?; }
    }
    let fabric = matches!(lid.as_str(), "fabric" | "quilt");
    commit(Profile { name: pname, version: mc, fabric, loader: Some(lid), loader_version, icon: None })
}

/// Что известно о сборке заранее, без её файлов: карточка каталога Millida
/// называет версию игры и загрузчик. Готовая сборка каталога — это просто папка
/// игры в zip, и по одним модам версию не всегда видно.
#[derive(Clone, Default)]
pub(crate) struct PackHint {
    pub version: String,
    pub loader: String,
    pub loader_version: Option<String>,
}

/// Plain client folder: version and loader are detected from the game files.
fn from_plain_dir(dir: &Path, name_hint: &str, hint: Option<&PackHint>) -> Result<Profile, String> {
    // a Prism / MultiMC export knows its version and loader from mmc-pack.json
    // and keeps memory and Java arguments in instance.cfg next to the game
    if dir.join("mmc-pack.json").is_file() {
        if let Some(found) = read_instance_dir(dir, "Prism Launcher") {
            vouch(dir);
            return import_instance(dir.to_string_lossy().to_string(), unique_name(name_hint), found.version, found.loader);
        }
    }
    let game = instance_game_dir(dir).unwrap_or(dir.to_path_buf());
    let (mut version, mut loader) = detect_from_game_dir(&game).unwrap_or_else(|| (String::new(), "vanilla".into()));
    // Карточка знает сборку лучше, чем догадка по модам: её версию ставил автор.
    let known = hint.filter(|h| !h.version.is_empty());
    if let Some(h) = known {
        version = h.version.clone();
        if !h.loader.is_empty() { loader = h.loader.clone(); }
    }
    if version.is_empty() {
        return Err("Не удалось определить версию Minecraft — импортируй .mrpack или zip с manifest.json".into());
    }
    let pname = unique_name(name_hint);
    vouch(&game);
    let prof = import_instance(game.to_string_lossy().to_string(), pname, version, loader)?;
    let Some(lv) = known.and_then(|h| h.loader_version.clone()).filter(|v| !v.is_empty()) else { return Ok(prof) };
    commit(Profile { loader_version: Some(lv), ..prof })
}

fn base_name(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Сборка".into())
}

pub async fn import_pack_file(app: AppHandle, path: Option<String>) -> Result<Profile, String> {
    // The path from the webview is ignored: only a native pick or a drop the OS
    // itself handed to the window may name a file, so a compromised webview
    // cannot aim the import at arbitrary files.
    let _ = path;
    let picked = pick_file(
        dialog()
            .add_filter("Сборка Minecraft", &["mrpack", "zip"])
            .set_title("Файл сборки (.mrpack или .zip)"),
    )
    .await
    .ok_or("Отменено")?;
    import_pack_path(app, picked).await
}

pub async fn import_pack_path(app: AppHandle, picked: std::path::PathBuf) -> Result<Profile, String> {
    if picked.is_dir() { return from_plain_dir(&picked, &base_name(&picked), None); }
    if !picked.exists() { return Err("Файл не найден".into()) }
    let hint = base_name(&picked);
    import_pack_archive(&app, None, &picked, &hint, None, "packfile").await
}

/// Архив сборки, уже лежащий на диске: выбранный в проводнике или скачанный
/// лаунчером из каталога Millida. `work` — имя папки распаковки: две установки
/// разных сборок не должны делить одну.
pub(crate) async fn import_pack_archive(
    app: &AppHandle,
    job: Option<&ImportJob<'_>>,
    archive: &Path,
    name_hint: &str,
    hint: Option<&PackHint>,
    work: &str,
) -> Result<Profile, String> {
    let progress = Progress { app, job };
    progress.step(10.0, "Распаковываем сборку…");
    let ex = data_dir().join("tmp").join(work);
    let _ = std::fs::remove_dir_all(&ex);
    std::fs::create_dir_all(&ex).map_err(|e| e.to_string())?;
    unzip_to(archive, &ex).map_err(|e| format!("Не удалось распаковать: {}", e))?;
    // the archive may be wrapped in a single top-level folder
    let root = {
        let mut r = ex.clone();
        for _ in 0..2 {
            if r.join("modrinth.index.json").exists() || r.join("manifest.json").exists() || r.join("mmc-pack.json").exists() { break }
            let mut dirs = std::fs::read_dir(&r).map_err(|e| e.to_string())?
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.path())
                .collect::<Vec<_>>();
            if dirs.len() == 1 { r = dirs.pop().unwrap() } else { break }
        }
        r
    };
    let res = if root.join("modrinth.index.json").exists() {
        from_mrpack(progress, &root, name_hint).await
    } else if root.join("manifest.json").exists() {
        from_cf_manifest(progress, &root, name_hint).await
    } else {
        from_plain_dir(&root, name_hint, hint)
    };
    let _ = std::fs::remove_dir_all(&ex);
    if res.is_ok() { progress.step(100.0, "Сборка импортирована") }
    res
}
