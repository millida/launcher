//! Иконка приложения: окно, панель задач, Dock — сразу, и ярлыки/бандл — чтобы
//! выбор было видно и при закрытом лаунчере.
//!
//! - macOS: Dock в рантайме (`setApplicationIconImage`) + своя иконка бандла
//!   `.app` через `NSWorkspace.setIcon:forFile:` (Finder и Dock у закрытого
//!   приложения). Пишет `Icon\r` и FinderInfo в корень бандла: исполняемый файл
//!   и подпись Mach-O не меняются (`codesign --verify --deep` проходит, строгая
//!   проверка ругается на FinderInfo — проверено 06.10.2026). Обновление
//!   заменяет бандл целиком, выбор возвращается на следующем старте.
//! - Windows: иконка окна и панели задач + ярлыки «Рабочий стол» и «Пуск»,
//!   которые ведут на наш .exe (`IShellLinkW::SetIconLocation` на копию .ico
//!   в данных приложения). Сам .exe не трогаем — подпись цела.
//! - Linux: окно + `Icon=` в `~/.local/share/applications/millida-launcher.desktop`.
//!
//! Выбор хранит интерфейс и присылает его при каждом запуске.
use tauri::image::Image;
use tauri::AppHandle;

// Чёткий кадр (без сцены): в Dock и на панели задач знак читается рядом с соседями.
const SPARK: &[u8] = include_bytes!("../icons/alt/spark/runtime-256.png");
const GOLD: &[u8] = include_bytes!("../icons/alt/gold/runtime-256.png");
const DIAMOND: &[u8] = include_bytes!("../icons/alt/diamond/runtime-256.png");
const FLAME: &[u8] = include_bytes!("../icons/alt/flame/runtime-256.png");
const AMETHYST: &[u8] = include_bytes!("../icons/alt/amethyst/runtime-256.png");
const LEGEND: &[u8] = include_bytes!("../icons/alt/legend/runtime-256.png");

/// PNG выбранной иконки; `None` — штатная иконка приложения.
fn png_of(id: &str) -> Result<Option<&'static [u8]>, String> {
    match id {
        "default" => Ok(None),
        "spark" => Ok(Some(SPARK)),
        "gold" => Ok(Some(GOLD)),
        "diamond" => Ok(Some(DIAMOND)),
        "flame" => Ok(Some(FLAME)),
        "amethyst" => Ok(Some(AMETHYST)),
        "legend" => Ok(Some(LEGEND)),
        other => Err(format!("unknown app icon: {other}")),
    }
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
fn decode(png: &[u8]) -> Result<Image<'static>, String> {
    let rgba = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?
        .to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), w, h))
}

/// Папка с копиями иконок для ярлыков (Windows .ico, Linux .png).
#[cfg(not(target_os = "macos"))]
fn icon_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("app-icons");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[cfg(not(target_os = "macos"))]
fn apply(app: &AppHandle, id: &str, png: Option<&'static [u8]>) -> Result<(), String> {
    use tauri::Manager;
    let icon = match png {
        Some(bytes) => Some(decode(bytes)?),
        None => app.default_window_icon().cloned(),
    };
    for (_, window) in app.webview_windows() {
        window.set_icon(icon.clone().ok_or("no default icon")?).map_err(|e| e.to_string())?;
    }
    // Ярлыки — в фоне: COM и диск не держат окно, ошибка ярлыка не ломает окно.
    let dir = icon_dir(app);
    let id = id.to_string();
    std::thread::spawn(move || {
        let res = dir.and_then(|d| shortcuts::apply(&d, &id, png));
        if let Err(e) = res {
            eprintln!("[app_icon] shortcuts: {e}");
        }
    });
    Ok(())
}

/// `set_icon` не меняет Dock на macOS (tauri#2985), поэтому зовём AppKit сами.
#[cfg(target_os = "macos")]
fn apply(app: &AppHandle, _id: &str, png: Option<&'static [u8]>) -> Result<(), String> {
    app.run_on_main_thread(move || {
        use objc2::{AllocAnyThread, MainThreadMarker};
        use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
        use objc2_foundation::{NSBundle, NSData};
        let Some(mtm) = MainThreadMarker::new() else { return };
        let ns_app = NSApplication::sharedApplication(mtm);
        let img = png.and_then(|bytes| NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(bytes)));
        unsafe { ns_app.setApplicationIconImage(img.as_deref()) };
        // Иконка самого бандла — видна в Finder и в Dock, когда лаунчер закрыт.
        // Только у настоящего .app (не у dev-бинарника); нет прав на запись — пропускаем.
        let bundle = NSBundle::mainBundle().bundlePath();
        if bundle.to_string().ends_with(".app") {
            let ok = NSWorkspace::sharedWorkspace().setIcon_forFile_options(img.as_deref(), &bundle, NSWorkspaceIconCreationOptions(0));
            if !ok {
                eprintln!("[app_icon] bundle icon not written: {bundle}");
            }
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(windows)]
mod shortcuts {
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, HSTRING};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHChangeNotify, SHGetKnownFolderPath, ShellLink, FOLDERID_CommonPrograms, FOLDERID_Desktop, FOLDERID_Programs,
        FOLDERID_PublicDesktop, KF_FLAG_DEFAULT, SHCNE_ASSOCCHANGED, SHCNF_IDLIST,
    };

    const ICO: &[(&str, &[u8])] = &[
        ("spark", include_bytes!("../icons/alt/spark/icon.ico")),
        ("flame", include_bytes!("../icons/alt/flame/icon.ico")),
        ("amethyst", include_bytes!("../icons/alt/amethyst/icon.ico")),
        ("legend", include_bytes!("../icons/alt/legend/icon.ico")),
        ("gold", include_bytes!("../icons/alt/gold/icon.ico")),
        ("diamond", include_bytes!("../icons/alt/diamond/icon.ico")),
    ];

    fn known(id: &windows::core::GUID) -> Option<PathBuf> {
        unsafe {
            let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            let out = p.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(p.0 as _));
            out
        }
    }

    /// .lnk в папке (и на уровень глубже — папка в «Пуске»).
    fn links(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() && depth > 0 {
                links(&p, depth - 1, out);
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")) {
                out.push(p);
            }
        }
    }

    pub fn apply(dir: &Path, id: &str, png: Option<&[u8]>) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let icon: PathBuf = match png.and(ICO.iter().find(|(k, _)| *k == id)) {
            Some((k, bytes)) => {
                // Своё имя на каждую иконку: кэш иконок Windows держится за путь.
                let p = dir.join(format!("{k}.ico"));
                if std::fs::read(&p).ok().as_deref() != Some(*bytes) {
                    std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
                }
                p
            }
            None => exe.clone(),
        };
        let mut found = Vec::new();
        for f in [FOLDERID_Desktop, FOLDERID_PublicDesktop, FOLDERID_Programs, FOLDERID_CommonPrograms] {
            if let Some(d) = known(&f) {
                links(&d, 1, &mut found);
            }
        }
        let exe_l = exe.to_string_lossy().to_lowercase();
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let mut changed = 0;
            for lnk in found {
                let Ok(link) = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) else { continue };
                let Ok(file) = link.cast::<IPersistFile>() else { continue };
                let path = HSTRING::from(lnk.as_os_str());
                if file.Load(&path, STGM_READWRITE).is_err() {
                    continue;
                }
                let mut buf = [0u16; 1024];
                if link.GetPath(&mut buf, std::ptr::null_mut(), 0).is_err() {
                    continue;
                }
                let n = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
                if String::from_utf16_lossy(&buf[..n]).to_lowercase() != exe_l {
                    continue; // чужой ярлык
                }
                // Общие ярлыки без прав администратора не сохранятся — это нормально.
                if link.SetIconLocation(&HSTRING::from(icon.as_os_str()), 0).is_ok() && file.Save(&path, true).is_ok() {
                    changed += 1;
                }
            }
            if changed > 0 {
                SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None);
            }
            if init.is_ok() {
                CoUninitialize();
            }
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod shortcuts {
    use std::path::{Path, PathBuf};

    const DESKTOP: &str = "millida-launcher.desktop";

    fn entry() -> Option<PathBuf> {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))?;
        Some(base.join("applications").join(DESKTOP))
    }

    /// Меняет строку `Icon=`; прежнюю (из установщика) хранит рядом, чтобы вернуть.
    pub fn retarget(text: &str, icon: &str) -> String {
        let mut out = String::new();
        let mut seen = false;
        for line in text.lines() {
            if !seen && line.starts_with("Icon=") {
                out.push_str("Icon=");
                out.push_str(icon);
                seen = true;
            } else {
                out.push_str(line);
            }
            out.push('\n');
        }
        out
    }

    pub fn apply(dir: &Path, id: &str, png: Option<&[u8]>) -> Result<(), String> {
        let Some(file) = entry() else { return Ok(()) };
        let Ok(text) = std::fs::read_to_string(&file) else { return Ok(()) };
        let orig = dir.join("desktop-icon.orig");
        let current = text.lines().find_map(|l| l.strip_prefix("Icon=")).unwrap_or("").to_string();
        if !current.starts_with(&dir.to_string_lossy().to_string()) {
            std::fs::write(&orig, &current).map_err(|e| e.to_string())?;
        }
        let icon = match png {
            Some(bytes) => {
                let p = dir.join(format!("{id}.png"));
                std::fs::write(&p, bytes).map_err(|e| e.to_string())?;
                p.to_string_lossy().to_string()
            }
            None => match std::fs::read_to_string(&orig) {
                Ok(o) if !o.is_empty() => o,
                _ => return Ok(()),
            },
        };
        let staged = file.with_extension("desktop.new");
        std::fs::write(&staged, retarget(&text, &icon)).map_err(|e| e.to_string())?;
        std::fs::rename(&staged, &file).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn set_app_icon(app: AppHandle, id: String) -> Result<(), String> {
    let png = png_of(&id)?;
    apply(&app, &id, png)
}

/// Только dev-сборка: `MILLIDA_APP_ICON=amethyst` ставит иконку на старте —
/// проверить переключение без входа в аккаунт.
#[cfg(debug_assertions)]
pub fn apply_from_env(app: &AppHandle) {
    // После старта: dev-сборка сама ставит свою иконку в Dock уже после setup.
    if let Ok(id) = std::env::var("MILLIDA_APP_ICON") {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(3));
            match set_app_icon(app, id) {
                Ok(()) => eprintln!("[app_icon] applied from env"),
                Err(e) => eprintln!("[app_icon] {e}"),
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_icon_decodes_as_a_square_png() {
        for id in ["spark", "flame", "amethyst", "legend", "gold", "diamond"] {
            let img = decode(png_of(id).unwrap().unwrap()).unwrap();
            assert_eq!(img.width(), img.height(), "{id}");
            assert!(img.width() >= 128, "{id}");
        }
    }

    #[test]
    fn unknown_icon_is_refused_and_default_resets() {
        assert!(png_of("nope").is_err());
        assert!(png_of("default").unwrap().is_none());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn desktop_entry_icon_is_replaced_once() {
        let t = "[Desktop Entry]\nName=Millida\nIcon=/opt/icon.png\nExec=x\n";
        let r = shortcuts::retarget(t, "/data/gold.png");
        assert!(r.contains("Icon=/data/gold.png\n"));
        assert!(!r.contains("/opt/icon.png"));
        assert!(r.contains("Exec=x\n"));
    }
}
