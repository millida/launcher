//! Other Minecraft games the player owns in a store (Steam, Microsoft Store),
//! plus Minecraft Education, whose installer Microsoft hands out directly.
//!
//! The launcher never ships these games itself:
//! - a Steam copy starts through Steam, a missing one installs through Steam;
//! - a Microsoft Store copy starts by its app id, a missing one installs
//!   through winget from the msstore source (the Store's own download, tied to
//!   the player's licence) or, failing that, through the Store page;
//! - Education downloads Microsoft's own installer and runs it.
//!
//! The list is fixed here, so the webview can only name a slug and never an
//! arbitrary URI or command.

use crate::engine::*;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;

pub struct StoreGame {
    pub slug: &'static str,
    pub steam_appid: Option<u32>,
    /// Microsoft Store product id: its page offers Install or Play.
    pub ms_product: Option<&'static str>,
    /// Appx package name, to find an installed Store copy.
    pub appx: Option<&'static str>,
}

// Ids and package names: Steam API, displaycatalog.mp.microsoft.com (разбор 29.09.2026).
pub const STORE_GAMES: &[StoreGame] = &[
    StoreGame { slug: "dungeons", steam_appid: Some(1672970), ms_product: Some("9N8NJ74FZTG9"), appx: Some("Microsoft.LovikaX1") },
    StoreGame { slug: "dungeons-2", steam_appid: Some(1912410), ms_product: Some("9P5786PJB9RP"), appx: Some("Microsoft.MinecraftDungeons2") },
    StoreGame { slug: "legends", steam_appid: Some(1928870), ms_product: Some("9NF0D13RPX5L"), appx: Some("Microsoft.296897AFE3FDD") },
    StoreGame { slug: "education", steam_appid: None, ms_product: Some("9NBLGGH4R2R6"), appx: None },
    // Bedrock для Windows: с 1.21.120 (осень 2025) — GDK-пакет через Xbox, файлы
    // зашифрованы под лицензию; запускается ссылкой minecraft:// (разбор 29.09.2026).
    StoreGame { slug: "bedrock", steam_appid: None, ms_product: Some("9NBLGGH2JHXJ"), appx: Some("Microsoft.MinecraftUWP") },
];

/// Microsoft's permanent link to the current Education desktop installer
/// (1,25 GB on 29.09.2026: MinecraftEducation_x64_1.26.3200.0.exe).
const EDUCATION_INSTALLER: &str = "https://aka.ms/downloadmee-desktopApp";

fn game(slug: &str) -> Result<&'static StoreGame, String> {
    STORE_GAMES.iter().find(|g| g.slug == slug).ok_or_else(|| "Такой игры нет".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreGameState {
    pub slug: String,
    /// Installed in one of the player's Steam libraries.
    pub steam: bool,
    /// Steam itself is installed: a missing game can install through it.
    pub steam_client: bool,
    /// Installed from the Microsoft Store (or Education on the machine).
    pub store: bool,
    pub windows: bool,
}

pub fn store_games_state() -> Vec<StoreGameState> {
    let libs = steam_libraries();
    let apps = installed_appx();
    STORE_GAMES
        .iter()
        .map(|g| StoreGameState {
            slug: g.slug.to_string(),
            steam: g.steam_appid.is_some_and(|id| steam_installed(&libs, id)),
            steam_client: !libs.is_empty(),
            store: match g.appx {
                Some(_) if g.slug == "bedrock" => bedrock_installed(&apps),
                Some(name) => apps.iter().any(|a| a.name.eq_ignore_ascii_case(name)),
                None => g.slug == "education" && education_exe().is_some(),
            },
            windows: cfg!(target_os = "windows"),
        })
        .collect()
}

/// `steam` starts the Steam copy, `steam-install` asks Steam to install it,
/// `store-page` opens the Microsoft Store page, `store` starts the installed
/// Store copy (or Education).
pub fn store_game_open(slug: &str, via: &str) -> Result<(), String> {
    let g = game(slug)?;
    let steam_id = || g.steam_appid.ok_or("Этой игры нет в Steam");
    let uri = match via {
        "steam" => format!("steam://rungameid/{}", steam_id()?),
        "steam-install" => format!("steam://install/{}", steam_id()?),
        "store-page" => format!("ms-windows-store://pdp/?productid={}", g.ms_product.ok_or("Этой игры нет в Microsoft Store")?),
        "store" => return launch_store_copy(g),
        _ => return Err("Неизвестный способ запуска".into()),
    };
    tauri_plugin_opener::open_url(uri, None::<&str>).map_err(|e| format!("Не удалось открыть: {}", e))
}

/// GDK installs go to `<drive>:\XboxGames\Minecraft for Windows`; older UWP
/// installs register the Microsoft.MinecraftUWP package.
fn bedrock_installed(apps: &[Appx]) -> bool {
    apps.iter().any(|a| a.name.eq_ignore_ascii_case("Microsoft.MinecraftUWP"))
        || ('C'..='H').any(|d| {
            PathBuf::from(format!("{}:\\XboxGames\\Minecraft for Windows\\Content\\Minecraft.Windows.exe", d)).is_file()
        })
}

/// A host the player may join: letters, digits, dots and dashes only, so the
/// value cannot smuggle extra query parameters into the minecraft:// link.
fn server_host_ok(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && !host.starts_with(['.', '-'])
}

/// Opens Bedrock and connects to the server. The server is also added to the
/// game's list first: Mojang calls these links internal and may change them.
pub fn bedrock_join(host: &str, port: u16) -> Result<(), String> {
    let host = host.trim();
    if !server_host_ok(host) || port == 0 {
        return Err("Неверный адрес сервера".into());
    }
    let add = format!("minecraft://?addExternalServer={}|{}:{}", host, host, port);
    let _ = tauri_plugin_opener::open_url(add, None::<&str>);
    std::thread::sleep(std::time::Duration::from_millis(400));
    let join = format!("minecraft://connect?serverUrl={}&serverPort={}", host, port);
    tauri_plugin_opener::open_url(join, None::<&str>).map_err(|e| format!("Bedrock не открылся: {}", e))
}

fn launch_store_copy(g: &StoreGame) -> Result<(), String> {
    if g.slug == "bedrock" {
        return tauri_plugin_opener::open_url("minecraft://", None::<&str>).map_err(|e| format!("Bedrock не открылся: {}", e));
    }
    if g.slug == "education" {
        let exe = education_exe().ok_or("Minecraft Education не установлена")?;
        let mut cmd = std::process::Command::new(&exe);
        if let Some(dir) = exe.parent() {
            cmd.current_dir(dir);
        }
        quiet(&mut cmd).spawn().map_err(|e| format!("Не удалось запустить игру: {}", e))?;
        return Ok(());
    }
    let name = g.appx.ok_or("Игра не из Microsoft Store")?;
    let app = installed_appx()
        .into_iter()
        .find(|a| a.name.eq_ignore_ascii_case(name))
        .ok_or("Игра не установлена из Microsoft Store")?;
    // Store apps start through the shell by their AppUserModelID.
    let aumid = format!("shell:AppsFolder\\{}!{}", app.family, app.app_id);
    let mut cmd = std::process::Command::new("explorer.exe");
    cmd.arg(aumid);
    quiet(&mut cmd).spawn().map_err(|e| format!("Не удалось запустить игру: {}", e))?;
    Ok(())
}

/// Installs the game without the player leaving the launcher: winget pulls it
/// from the msstore source, the Store's own download under the player's own
/// licence; Education downloads Microsoft's installer. On failure the caller
/// falls back to the Store page.
pub async fn store_game_install(app: AppHandle, slug: String) -> Result<(), String> {
    let g = game(&slug)?;
    if !cfg!(target_os = "windows") {
        return Err("Игра ставится только на Windows".into());
    }
    let job = Job::start(format!("game-{}", slug), slug.clone())?;
    let res = if g.slug == "education" {
        install_education(&app, &job).await
    } else {
        install_via_winget(&app, &job, g).await
    };
    job.finish(&app, res)
}

async fn install_via_winget(app: &AppHandle, job: &Job, g: &StoreGame) -> Result<(), String> {
    job.not_pausable();
    let id = g.ms_product.ok_or("Этой игры нет в Microsoft Store")?.to_string();
    job.emit(app, 5.0, "Ставим через Microsoft Store");
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new("winget");
        cmd.args([
            "install",
            "--id",
            &id,
            "--source",
            "msstore",
            "--exact",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ]);
        quiet(&mut cmd).output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "winget не найден — открываем Microsoft Store".to_string())?;
    job.check()?;
    if out.status.success() {
        job.emit(app, 100.0, "Готово");
        return Ok(());
    }
    let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
    // 0x8A15002B: already installed and nothing newer — that is a success.
    if text.contains("already installed") || text.contains("уже установлен") || out.status.code() == Some(-1978335189) {
        return Ok(());
    }
    Err("Microsoft Store не выдал игру — открываем страницу магазина".into())
}

async fn install_education(app: &AppHandle, job: &Job) -> Result<(), String> {
    let dir = data_dir().join("installers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join("MinecraftEducation.exe");
    job.emit(app, 1.0, "Скачиваем установщик");
    let gb = |b: u64| b as f64 / 1_073_741_824.0;
    let size = content_length(EDUCATION_INSTALLER).await;
    let report = |got: u64, _: Option<u64>| {
        if let Some(total) = size {
            job.emit(app, 1.0 + 94.0 * (got as f32 / total as f32), &format!("{:.2} / {:.2} ГБ", gb(got), gb(total)));
        }
    };
    download_checked_progress(EDUCATION_INSTALLER, &dest, None, size, Some(job.cancel_flag()), &report).await?;
    job.check()?;
    job.emit(app, 96.0, "Запускаем установщик");
    let mut cmd = std::process::Command::new(&dest);
    cmd.current_dir(&dir);
    quiet(&mut cmd).spawn().map_err(|e| format!("Установщик не запустился: {}", e))?;
    job.emit(app, 100.0, "Готово");
    Ok(())
}

async fn content_length(url: &str) -> Option<u64> {
    let r = client().head(url).send().await.ok()?;
    r.headers().get("content-length")?.to_str().ok()?.parse().ok().filter(|n: &u64| *n > 0)
}

struct Appx {
    name: String,
    family: String,
    app_id: String,
}

/// One PowerShell call for all Store games: name, family name and the app id
/// from the package manifest (the part after `!` in the AUMID).
#[cfg(windows)]
fn installed_appx() -> Vec<Appx> {
    let names: Vec<String> = STORE_GAMES.iter().filter_map(|g| g.appx).map(|n| format!("'{}'", n)).collect();
    let script = format!(
        "Get-AppxPackage | Where-Object {{ @({}) -contains $_.Name }} | ForEach-Object {{ $id = (Get-AppxPackageManifest $_).Package.Applications.Application | Select-Object -First 1 -ExpandProperty Id; $_.Name + '|' + $_.PackageFamilyName + '|' + $id }}",
        names.join(",")
    );
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    let Ok(out) = quiet(&mut cmd).output() else { return Vec::new() };
    parse_appx(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(not(windows))]
fn installed_appx() -> Vec<Appx> {
    Vec::new()
}

#[cfg_attr(not(any(windows, test)), allow(dead_code))]
fn parse_appx(text: &str) -> Vec<Appx> {
    text.lines()
        .filter_map(|l| {
            let mut p = l.trim().split('|');
            let (name, family, app_id) = (p.next()?, p.next()?, p.next()?);
            (!name.is_empty() && !family.is_empty() && !app_id.is_empty())
                .then(|| Appx { name: name.into(), family: family.into(), app_id: app_id.into() })
        })
        .collect()
}

/// The Education desktop app registers an uninstall entry whose DisplayIcon
/// points at its executable.
#[cfg(windows)]
fn education_exe() -> Option<PathBuf> {
    let paths = [
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall",
        r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for root in [windows_registry::LOCAL_MACHINE, windows_registry::CURRENT_USER] {
        for p in paths {
            let Ok(key) = root.open(p) else { continue };
            let Ok(subs) = key.keys() else { continue };
            for sub in subs {
                let Ok(k) = key.open(sub) else { continue };
                let name = k.get_string("DisplayName").unwrap_or_default();
                if !name.to_lowercase().contains("minecraft education") {
                    continue;
                }
                let icon = k.get_string("DisplayIcon").unwrap_or_default();
                let exe = PathBuf::from(icon.split(',').next().unwrap_or("").trim_matches('"'));
                if exe.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) && exe.is_file() {
                    return Some(exe);
                }
            }
        }
    }
    None
}

#[cfg(not(windows))]
fn education_exe() -> Option<PathBuf> {
    None
}

fn steam_libraries() -> Vec<PathBuf> {
    let Some(root) = steam_root() else { return Vec::new() };
    let mut libs = vec![root.clone()];
    if let Ok(vdf) = std::fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        libs.extend(library_paths(&vdf).into_iter().map(PathBuf::from));
    }
    libs.sort();
    libs.dedup();
    libs
}

#[cfg(windows)]
fn steam_root() -> Option<PathBuf> {
    let key = windows_registry::CURRENT_USER.open(r"Software\Valve\Steam").ok()?;
    let p = key.get_string("SteamPath").ok()?;
    let p = PathBuf::from(p.replace('/', "\\"));
    p.is_dir().then_some(p)
}

#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> {
    None
}

/// `"path"  "D:\\SteamLibrary"` lines of libraryfolders.vdf.
fn library_paths(vdf: &str) -> Vec<String> {
    vdf.lines()
        .filter_map(|l| {
            let l = l.trim();
            let rest = l.strip_prefix("\"path\"")?.trim();
            let v = rest.strip_prefix('"')?.strip_suffix('"')?;
            Some(v.replace("\\\\", "\\"))
        })
        .collect()
}

fn steam_installed(libs: &[PathBuf], appid: u32) -> bool {
    libs.iter().any(|l| l.join("steamapps").join(format!("appmanifest_{}.acf", appid)).is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdf_library_paths_are_read() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        assert_eq!(library_paths(vdf), vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
    }

    #[test]
    fn only_known_games_and_ways_open() {
        assert!(store_game_open("minecraft-earth", "steam").is_err());
        assert!(store_game_open("legends", "cmd").is_err());
        assert!(store_game_open("education", "steam").is_err());
    }

    #[test]
    fn only_plain_hosts_join() {
        assert!(server_host_ok("mhell.ru"));
        assert!(server_host_ok("play.hivebedrock-network.com"));
        assert!(server_host_ok("192.168.0.10"));
        assert!(!server_host_ok("evil.ru&serverPort=1"));
        assert!(!server_host_ok("a b"));
        assert!(!server_host_ok("-x.ru"));
        assert!(!server_host_ok(""));
        assert!(bedrock_join("x.ru|y", 19132).is_err());
    }

    #[test]
    fn appx_lines_are_parsed() {
        let out = "Microsoft.MinecraftDungeons2|Microsoft.MinecraftDungeons2_8wekyb3d8bbwe|Game\r\n\r\nbroken|line\n";
        let apps = parse_appx(out);
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].family, "Microsoft.MinecraftDungeons2_8wekyb3d8bbwe");
        assert_eq!(apps[0].app_id, "Game");
    }
}
