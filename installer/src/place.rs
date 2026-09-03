use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::install::home_dir;

#[cfg(target_os = "linux")]
const DESKTOP_FILE: &str = "millida-launcher.desktop";

/// The launcher registers millida:// links, and on Linux nothing but the desktop
/// entry tells the system that. Without it a login link from the site opens
/// nowhere, which the deb package does not suffer from.
#[cfg(target_os = "linux")]
const SCHEME: &str = "x-scheme-handler/millida";

#[cfg(target_os = "linux")]
pub fn place(payload: &Path, workspace: &Path) -> Result<PathBuf, String> {
    use std::os::unix::fs::PermissionsExt;

    let home = home_dir()?;
    let dir = home.join(".local").join("share").join("millida-launcher");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не создать папку {}: {}", dir.display(), e))?;

    let target = dir.join("MillidaLauncher.AppImage");
    let staged = dir.join("MillidaLauncher.AppImage.new");
    let _ = std::fs::remove_file(&staged);
    std::fs::copy(payload, &staged).map_err(|e| format!("не записать {}: {}", staged.display(), e))?;
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("не выставить права на {}: {}", staged.display(), e))?;
    // Replaces the old copy in one step and keeps the inode of a running one
    // alive, so an update never leaves the user without a launcher.
    std::fs::rename(&staged, &target).map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        format!("не заменить {}: {}", target.display(), e)
    })?;

    let icon = extract_icon(&target, workspace, &dir);
    write_desktop_entry(&home, &target, icon.as_deref())?;
    register_scheme(&home);
    Ok(target)
}

/// A missing icon costs the user a grey square in the menu and nothing else, so
/// it never fails the install: the AppImage is already in place by this point.
#[cfg(target_os = "linux")]
fn extract_icon(appimage: &Path, workspace: &Path, dir: &Path) -> Option<PathBuf> {
    let stage = workspace.join("icon");
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).ok()?;
    extract(appimage, &stage, ".DirIcon")?;

    let root = stage.join("squashfs-root");
    let entry = root.join(".DirIcon");
    // .DirIcon is a symlink to the real picture, and extracting by pattern pulls
    // out the link alone: without the second pass it dangles.
    let source = match std::fs::read_link(&entry) {
        Ok(link) if link.is_relative() && !link.components().any(|part| part.as_os_str() == "..") => {
            extract(appimage, &stage, &link.to_string_lossy())?;
            root.join(link)
        }
        Ok(_) => return None,
        Err(_) => entry,
    };
    if !source.is_file() {
        return None;
    }
    let icon = dir.join("icon.png");
    std::fs::copy(&source, &icon).ok()?;
    Some(icon)
}

#[cfg(target_os = "linux")]
fn extract(appimage: &Path, stage: &Path, pattern: &str) -> Option<()> {
    let status = Command::new(appimage)
        .arg("--appimage-extract")
        .arg(pattern)
        .current_dir(stage)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()?;
    status.success().then_some(())
}

#[cfg(target_os = "linux")]
fn write_desktop_entry(home: &Path, target: &Path, icon: Option<&Path>) -> Result<(), String> {
    let dir = home.join(".local").join("share").join("applications");
    std::fs::create_dir_all(&dir).map_err(|e| format!("не создать папку {}: {}", dir.display(), e))?;
    let staged = dir.join(format!("{}.new", DESKTOP_FILE));
    std::fs::write(&staged, desktop_entry(target, icon)).map_err(|e| format!("не записать ярлык: {}", e))?;
    std::fs::rename(&staged, dir.join(DESKTOP_FILE)).map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        format!("не записать ярлык: {}", e)
    })
}

#[cfg(target_os = "linux")]
pub fn desktop_entry(target: &Path, icon: Option<&Path>) -> String {
    let icon = icon
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "millida-launcher".to_string());
    let mut entry = String::from("[Desktop Entry]\n");
    entry.push_str("Type=Application\n");
    entry.push_str("Version=1.0\n");
    entry.push_str("Name=Millida Launcher\n");
    entry.push_str("Comment=Лаунчер Minecraft от Millida\n");
    entry.push_str(&format!("Exec={} %u\n", quote_exec(target)));
    entry.push_str(&format!("Icon={}\n", icon));
    entry.push_str("Terminal=false\n");
    entry.push_str("Categories=Game;\n");
    entry.push_str("StartupNotify=true\n");
    entry.push_str("StartupWMClass=Millida Launcher\n");
    entry.push_str(&format!("MimeType={};\n", SCHEME));
    entry
}

/// The Exec key is split on spaces, and a home directory with a space in it is
/// ordinary. Backslash and quote are the two characters the spec makes us escape
/// inside the quoted form.
#[cfg(target_os = "linux")]
fn quote_exec(target: &Path) -> String {
    let escaped = target.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

/// Both tools are optional on a minimal desktop; the entry itself already works
/// after a relogin, only the link handler needs the database refreshed.
#[cfg(target_os = "linux")]
fn register_scheme(home: &Path) {
    let applications = home.join(".local").join("share").join("applications");
    let _ = Command::new("update-desktop-database")
        .arg(&applications)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = Command::new("xdg-mime")
        .args(["default", DESKTOP_FILE, SCHEME])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(target_os = "macos")]
pub fn place(payload: &Path, workspace: &Path) -> Result<PathBuf, String> {
    let stage = workspace.join("stage");
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| format!("не создать папку распаковки: {}", e))?;
    let status = Command::new("/usr/bin/tar")
        .arg("-xzf")
        .arg(payload)
        .arg("-C")
        .arg(&stage)
        .status()
        .map_err(|e| format!("не запустить распаковку: {}", e))?;
    if !status.success() {
        return Err("архив с программой не распаковался".into());
    }
    let app = find_app(&stage)?;
    let name = app
        .file_name()
        .ok_or_else(|| "в архиве нет программы".to_string())?
        .to_os_string();

    let root = applications_dir()?;
    let target = root.join(&name);
    let backup = root.join(format!("{}.old-{}", name.to_string_lossy(), std::process::id()));
    let replacing = target.exists();
    if replacing {
        // The old copy is moved aside rather than deleted: if the new one fails
        // to land, the user keeps a working launcher instead of none.
        std::fs::rename(&target, &backup)
            .map_err(|e| format!("не убрать прежнюю версию из {}: {}", root.display(), e))?;
    }
    match move_in(&app, &target) {
        Ok(()) => {
            if replacing {
                let _ = std::fs::remove_dir_all(&backup);
            }
            drop_quarantine(&target);
            Ok(target)
        }
        Err(reason) => {
            if replacing {
                let _ = std::fs::remove_dir_all(&target);
                let _ = std::fs::rename(&backup, &target);
            }
            Err(reason)
        }
    }
}

/// rename cannot cross volumes, and the cache directory and /Applications are
/// only on the same one by default. ditto is the copy that keeps the bundle's
/// symlinks and metadata intact.
#[cfg(target_os = "macos")]
fn move_in(app: &Path, target: &Path) -> Result<(), String> {
    if std::fs::rename(app, target).is_ok() {
        return Ok(());
    }
    let status = Command::new("/usr/bin/ditto")
        .arg(app)
        .arg(target)
        .status()
        .map_err(|e| format!("не запустить копирование: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("не скопировать программу в {}", target.display()))
    }
}

#[cfg(target_os = "macos")]
fn find_app(stage: &Path) -> Result<PathBuf, String> {
    let entries = std::fs::read_dir(stage).map_err(|e| format!("не прочитать распакованное: {}", e))?;
    entries
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "app"))
        .ok_or_else(|| "в архиве нет программы .app".to_string())
}

/// /Applications is the expected home, but it belongs to the machine: on a
/// managed Mac an ordinary account cannot write there and only its own folder
/// is left.
#[cfg(target_os = "macos")]
fn applications_dir() -> Result<PathBuf, String> {
    let shared = PathBuf::from("/Applications");
    if writable(&shared) {
        return Ok(shared);
    }
    let own = home_dir()?.join("Applications");
    std::fs::create_dir_all(&own).map_err(|e| format!("не создать папку {}: {}", own.display(), e))?;
    Ok(own)
}

#[cfg(target_os = "macos")]
fn writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".millida-setup-{}", std::process::id()));
    match std::fs::File::create(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The archive itself carries no quarantine flag, but a copy the browser left in
/// the folder earlier can, and Gatekeeper then blocks the replaced bundle.
#[cfg(target_os = "macos")]
fn drop_quarantine(target: &Path) {
    let _ = Command::new("/usr/bin/xattr")
        .arg("-dr")
        .arg("com.apple.quarantine")
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Detached on purpose: the stub is done, and holding the terminal open would
/// tie the launcher to a window the user is about to close.
pub fn launch(target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut open = Command::new("/usr/bin/open");
        open.arg(target);
        open
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new(target);

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("не запустить лаунчер: {}", e))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn desktop_entry_quotes_paths_and_registers_links() {
        let entry = desktop_entry(Path::new("/home/игрок с пробелом/app.AppImage"), None);
        let cases: &[(&str, &str)] = &[
            (
                "Exec=\"/home/игрок с пробелом/app.AppImage\" %u",
                "путь с пробелом обязан быть в кавычках, иначе ярлык не запускается",
            ),
            (
                "MimeType=x-scheme-handler/millida;",
                "без схемы ссылки входа с сайта открывать нечем",
            ),
            ("Icon=millida-launcher", "без иконки берётся имя из темы, а не пустая строка"),
            ("Terminal=false", "лаунчер не консольный: с Terminal=true открывается лишнее окно"),
        ];
        for (needle, why) in cases {
            assert!(entry.contains(needle), "{}: в ярлыке нет {}", why, needle);
        }
    }

    #[test]
    fn desktop_entry_takes_extracted_icon() {
        let entry = desktop_entry(Path::new("/opt/app.AppImage"), Some(Path::new("/opt/icon.png")));
        assert!(
            entry.contains("Icon=/opt/icon.png"),
            "распакованная иконка обязана попадать в ярлык, иначе меню показывает заглушку"
        );
    }

    #[test]
    fn quote_exec_escapes_quotes() {
        assert_eq!(
            quote_exec(Path::new("/home/a\"b/app")),
            "\"/home/a\\\"b/app\"",
            "кавычка в пути обязана экранироваться: иначе ярлык обрывается на середине команды"
        );
    }
}
