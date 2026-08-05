use crate::engine::*;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

/// A quick launch runs under this name without ever being written to
/// profiles.json, so a repair started from its crash dialog must not look it up.
pub const DEFAULT_PROFILE: &str = "default";

static REPAIRING: AtomicBool = AtomicBool::new(false);

struct RepairLock;

impl RepairLock {
    fn take() -> Result<RepairLock, String> {
        if REPAIRING.swap(true, Ordering::SeqCst) {
            return Err("Починка уже идёт — дождись её".into());
        }
        Ok(RepairLock)
    }
}

impl Drop for RepairLock {
    fn drop(&mut self) {
        REPAIRING.store(false, Ordering::SeqCst);
    }
}

/// What the repair actually did. A blank "готово" was indistinguishable from a
/// repair that checked nothing, which is how the button earned its reputation.
#[derive(Default, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairReport {
    pub checked: u32,
    pub restored: u32,
    /// Files that are damaged but carry no catalog record to restore them from.
    pub broken: Vec<String>,
}

const CONTENT_KINDS: [&str; 4] = ["mod", "resourcepack", "shader", "datapack"];

fn content_file_path(profile: &str, kind: &str, file_name: &str) -> Option<(PathBuf, bool)> {
    let dir = profile_dir(profile).join(content_dir(kind));
    let file = safe_file_name(file_name).ok()?;
    let on = safe_child(&dir, &file).ok()?;
    let off = safe_child(&dir, &format!("{}.disabled", file)).ok()?;
    match (on.exists(), off.exists()) {
        (true, _) => Some((on, true)),
        (false, true) => Some((off, false)),
        _ => Some((on, true)),
    }
}

/// Size and hash come from the catalog record; the archive check catches the
/// files that pass both and are still unreadable.
fn content_file_intact(path: &Path, entry: &ContentEntry) -> bool {
    let Ok(md) = std::fs::metadata(path) else { return false };
    if entry.file_size > 0 && md.len() != entry.file_size {
        return false;
    }
    if md.len() == 0 {
        return false;
    }
    zip_readable(path)
}

fn drop_partials(dir: &Path) -> u32 {
    let mut n = 0;
    let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_file() && p.extension().is_some_and(|x| x == "part") && std::fs::remove_file(&p).is_ok() {
            n += 1;
        }
    }
    n
}

async fn repair_content(app: &AppHandle, profile: &str, report: &mut RepairReport) {
    let manifest = load_content_manifest(profile);
    for kind in CONTENT_KINDS {
        drop_partials(&profile_dir(profile).join(content_dir(kind)));
    }
    let tracked: Vec<ContentEntry> =
        manifest.into_iter().filter(|e| CONTENT_KINDS.contains(&e.kind.as_str())).collect();

    let mut damaged: Vec<(ContentEntry, PathBuf, bool)> = vec![];
    for entry in &tracked {
        report.checked += 1;
        let Some((path, enabled)) = content_file_path(profile, &entry.kind, &entry.file_name) else { continue };
        if content_file_intact(&path, entry) {
            continue;
        }
        if entry.download_url.is_empty() {
            report.broken.push(entry.file_name.clone());
            continue;
        }
        damaged.push((entry.clone(), path, enabled));
    }

    let total = damaged.len();
    for (i, (entry, path, enabled)) in damaged.into_iter().enumerate() {
        if cancelled() {
            return;
        }
        emit(
            app,
            "content",
            88.0 + 12.0 * (i as f32 / total.max(1) as f32),
            &format!("Восстанавливаем моды {}/{}", i + 1, total),
        );
        // The damaged copy goes first: a download that resumes onto it would
        // append to garbage, and download_checked accepts a file it cannot hash.
        let _ = std::fs::remove_file(&path);
        let dest = match content_file_path(profile, &entry.kind, &entry.file_name) {
            Some((p, _)) if !enabled => p,
            _ => profile_dir(profile).join(content_dir(&entry.kind)).join(&entry.file_name),
        };
        let sum = if !entry.sha512.is_empty() {
            Some(Sum::Sha512(&entry.sha512))
        } else if !entry.sha1.is_empty() {
            Some(Sum::Sha1(&entry.sha1))
        } else {
            None
        };
        let size = (entry.file_size > 0).then_some(entry.file_size);
        match download_checked(&entry.download_url, &dest, sum, size).await {
            Ok(()) => {
                report.restored += 1;
                if !enabled {
                    let _ = toggle_content(profile, &entry.kind, &entry.file_name, false);
                }
            }
            Err(_) => report.broken.push(entry.file_name.clone()),
        }
    }
}

/// Re-runs the install with full checksum verification, then does the same for
/// installed content. Normal launches only compare file sizes, since rehashing
/// everything on each launch is too slow.
pub async fn repair_profile_files(app: AppHandle, profile: String) -> Result<RepairReport, String> {
    let _lock = RepairLock::take()?;
    if running_games().iter().any(|p| p == &profile) {
        return Err("Сборка сейчас запущена — закрой игру и повтори".into());
    }
    let known = load_profiles().into_iter().find(|p| p.name == profile);
    if known.is_none() && profile != DEFAULT_PROFILE {
        return Err("Сборка не найдена".into());
    }
    // The quick launch installs the latest release without a loader, so a repair
    // of "default" targets exactly what that launch would have installed.
    let version = known.as_ref().map(|p| p.version.clone()).unwrap_or_else(|| "latest".into());
    let loader = known.as_ref().map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
    let loader_version = known.as_ref().and_then(|p| p.loader_version.clone());

    CANCEL.store(false, Ordering::SeqCst);
    let _deep = DeepVerify::hold();
    emit(&app, "files", 2.0, "Сверяем файлы игры…");
    let java_pick = resolve_profile_java(&app, &profile).await?;
    install_loader_with_java(&app, &version, &loader, loader_version.as_deref(), java_pick).await?;

    let mut report = RepairReport::default();
    if known.is_some() {
        emit(&app, "content", 88.0, "Проверяем моды…");
        repair_content(&app, &profile, &mut report).await;
    }
    check_cancel()?;
    emit(&app, "content", 100.0, "Готово");
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join("millida-repair-test").join(name);
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_jar(path: &Path) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        z.start_file("fabric.mod.json", SimpleFileOptions::default()).unwrap();
        z.write_all(br#"{"id":"test"}"#).unwrap();
        z.finish().unwrap();
    }

    fn entry_for(path: &Path) -> ContentEntry {
        ContentEntry {
            kind: "mod".into(),
            file_name: "test.jar".into(),
            file_size: std::fs::metadata(path).unwrap().len(),
            ..Default::default()
        }
    }

    // вход -> вердикт: закрепляет ровно те состояния файла, из-за которых
    // «Починить сборку» раньше отчитывалась об успехе на битой сборке.
    #[test]
    fn intact_only_for_a_readable_archive_of_the_recorded_size() {
        let dir = tmp("intact");
        let jar = dir.join("test.jar");
        write_jar(&jar);
        let good = entry_for(&jar);
        assert!(content_file_intact(&jar, &good), "целый jar нужного размера — трогать нечего");

        let mut wrong_size = good.clone();
        wrong_size.file_size = good.file_size + 1;
        assert!(!content_file_intact(&jar, &wrong_size), "размер разошёлся с каталогом — файл битый");

        let truncated = dir.join("cut.jar");
        let bytes = std::fs::read(&jar).unwrap();
        std::fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
        let mut cut = good.clone();
        cut.file_size = 0;
        assert!(
            !content_file_intact(&truncated, &cut),
            "обрезанный jar без записанного размера ловится только чтением архива"
        );

        let empty = dir.join("empty.jar");
        std::fs::write(&empty, b"").unwrap();
        assert!(!content_file_intact(&empty, &cut), "пустой файл не может быть модом");

        assert!(!content_file_intact(&dir.join("gone.jar"), &good), "отсутствующий файл всегда битый");
    }

    #[test]
    fn leftover_part_files_are_swept() {
        let dir = tmp("partials");
        std::fs::write(dir.join("a.jar.part"), b"half").unwrap();
        std::fs::write(dir.join("b.jar"), b"whole").unwrap();
        assert_eq!(drop_partials(&dir), 1, "недокачанный хвост должен быть убран");
        assert!(dir.join("b.jar").exists(), "целые файлы починка не трогает");
    }

    #[test]
    fn second_repair_is_refused_while_the_first_runs() {
        let first = RepairLock::take().unwrap();
        assert!(RepairLock::take().is_err(), "две починки делят одни и те же файлы");
        drop(first);
        assert!(RepairLock::take().is_ok(), "после завершения замок снят");
    }
}
