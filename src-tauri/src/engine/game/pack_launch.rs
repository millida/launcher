use crate::engine::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

/// A catalogue pack that brings its own game.
///
/// Ordinary builds are assembled here: the launcher downloads vanilla, adds a
/// loader and puts mods next to them. A protected pack cannot be assembled that
/// way — it ships its own `libraries`, its own `minecraft.jar`, its own assets,
/// and its mods are loaded by name from those libraries, not from `mods/`.
/// Rebuilding such a pack from parts produces a folder that looks right and
/// starts without most of the content.
///
/// So the pack describes its own launch, and the launcher runs that description
/// instead of building one. The description is a file inside the pack, written
/// when the pack is packed, and everything it names must live inside the pack
/// folder: it decides a command line, and a path leading out of the folder
/// would be arbitrary code from an archive someone else prepared.
pub const PACK_LAUNCH_FILE: &str = "millida-pack-launch.json";

const MAX_ENTRIES: usize = 4000;
const MAX_GAME_ARGS: usize = 64;
const MAX_ARG_LEN: usize = 512;
const NATIVE_EXTENSIONS: &[&str] = &["dll", "so", "dylib", "jnilib"];

pub struct PackLaunch {
    /// Catalogue address — the pack asks the API for its launch token by it.
    pub slug: String,
    pub main_class: String,
    pub asset_index: String,
    /// Assets of the pack itself: it ships its own copy and its index is not
    /// the one our shared store holds.
    pub assets_dir: String,
    pub natives_dir: String,
    /// Folders and jars, in the order they must appear on the classpath.
    pub class_path: Vec<String>,
    pub jvm_args: Vec<String>,
    /// Arguments after the main class. Empty means the modern set; a pack on
    /// an old version brings its own (1.7.10 wants `--userProperties` and a
    /// `--tweakClass`, and rejects `--versionType`).
    pub game_args: Vec<String>,
    /// Vanilla version whose assets the pack uses from the shared store
    /// instead of shipping its own copy.
    pub vanilla_assets: String,
    pub java_major: u64,
    pub min_ram_mb: u32,
    pub max_ram_mb: u32,
    /// The pack refuses to start without a signature issued to the account.
    pub needs_token: bool,
}


/// Флаги, которые общий фильтр JVM режет (игроку их ставить нельзя), но
/// которые нужны конкретным сборкам каталога — строго с этим значением.
/// Загрузчик RetroFuturaBootstrap (lwjgl3ify, 1.7.10 на Java 21): его класс
/// лежит в jar-ах самой сборки, а моды сборки и так исполняют свой код, так
/// что лишнего доступа он не даёт.
const PACK_JVM_EXACT: &[&str] = &["-Djava.system.class.loader=com.gtnewhorizons.retrofuturabootstrap.RfbSystemClassLoader"];

fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").trim().to_string()
}

fn list(v: &Value, key: &str) -> Vec<String> {
    v[key]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

/// Reads the description a pack shipped with. Absent file = ordinary build.
pub fn pack_launch_spec(profile: &str) -> Option<PackLaunch> {
    let raw = std::fs::read(profile_dir(profile).join(PACK_LAUNCH_FILE)).ok()?;
    let v: Value = serde_json::from_slice(&raw).ok()?;
    parse_pack_launch(&v)
}

/// Key of the running system in the pack's per-platform tables.
fn platform_keys() -> [String; 2] {
    let key = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") { "arm64" } else { "x86_64" };
    [format!("{}-{}", key, arch), key.to_string()]
}

fn for_platform<'a>(v: &'a Value, table: &str) -> Option<&'a Value> {
    platform_keys().into_iter().find_map(|k| v[table].get(k.as_str()).filter(|x| !x.is_null()))
}

fn class_name_ok(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '$' || c == '_')
}

/// Game arguments come from someone else's archive, but they only reach the
/// game's own option parser after the main class: they cannot change what the
/// JVM loads. Still, a broken list means a broken launch, so it is refused
/// whole rather than trimmed into a different command.
fn game_args(v: &Value) -> Option<Vec<String>> {
    let Some(raw) = v["gameArgs"].as_array() else { return Some(Vec::new()) };
    if raw.len() > MAX_GAME_ARGS {
        return None;
    }
    raw.iter()
        .map(|x| {
            let s = x.as_str()?;
            (!s.is_empty() && s.len() <= MAX_ARG_LEN && !s.chars().any(|c| c.is_control())).then(|| s.to_string())
        })
        .collect()
}

pub fn parse_pack_launch(v: &Value) -> Option<PackLaunch> {
    let main_class = text(v, "mainClass");
    if !class_name_ok(&main_class) {
        return None;
    }
    let game_args = game_args(v)?;
    let vanilla_assets = text(v, "vanillaAssets");
    if !vanilla_assets.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) {
        return None;
    }
    let platform_jvm: Vec<String> = for_platform(v, "jvmArgsByPlatform")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str()).map(|s| s.trim().to_string()).collect())
        .unwrap_or_default();
    let class_path = list(v, "classPath");
    if class_path.is_empty() {
        return None;
    }
    let java_major = v["javaMajor"].as_u64().filter(|m| (8..=99).contains(m)).unwrap_or(17);
    // both are joined onto the pack folder at launch: a path out of it would
    // hand the JVM natives or assets from anywhere on disk
    let assets_dir = {
        let d = text(v, "assetsDir");
        if d.is_empty() { "assets".into() } else { d }
    };
    let natives_dir = {
        let d = text(v, "nativesDir");
        platform_natives(v, if d.is_empty() { "natives" } else { &d })
    };
    if !rel_path_ok(&assets_dir) || !rel_path_ok(&natives_dir) {
        return None;
    }
    Some(PackLaunch {
        slug: text(v, "slug"),
        main_class,
        asset_index: text(v, "assetIndex"),
        assets_dir,
        natives_dir,
        class_path,
        /*
         * The pack's own flags go through the same filter as a player's: the
         * archive is prepared by someone else, and `-javaagent` in it would be
         * code execution on every start. Everything the pack actually needs
         * (`-D…`, `-XX:…`) passes that filter.
         */
        jvm_args: list(v, "jvmArgs")
            .into_iter()
            .chain(platform_jvm)
            .filter(|a| jvm_arg_allowed(a) || PACK_JVM_EXACT.contains(&a.as_str()))
            .collect(),
        game_args,
        vanilla_assets,
        java_major,
        min_ram_mb: v["minRamMb"].as_u64().unwrap_or(0) as u32,
        max_ram_mb: v["maxRamMb"].as_u64().unwrap_or(0) as u32,
        needs_token: v["needsToken"].as_bool().unwrap_or(false),
    })
}

/// Expands the declared classpath into real files.
///
/// A folder becomes every jar under it, sorted by name so two machines build
/// the same order: with two jars defining the same class, the order decides
/// which one wins, and a pack that works here must work there.
pub fn pack_classpath(profile: &str, spec: &PackLaunch) -> Result<Vec<PathBuf>, String> {
    let root = profile_dir(profile);
    let mut out: Vec<PathBuf> = Vec::new();
    for entry in &spec.class_path {
        let path = safe_join(&root, entry).map_err(|e| format!("Сборка указала путь вне своей папки: {}", e))?;
        if path.is_dir() {
            let mut found: Vec<PathBuf> = Vec::new();
            collect_jars(&path, &mut found);
            found.sort();
            out.extend(found);
        } else if path.is_file() {
            out.push(path);
        } else {
            return Err(format!("В сборке нет файла «{}» — архив распакован не полностью", entry));
        }
        if out.len() > MAX_ENTRIES {
            return Err("В сборке слишком много библиотек — она собрана неверно".into());
        }
    }
    if out.is_empty() {
        return Err("Сборка не назвала ни одной библиотеки для запуска".into());
    }
    Ok(out)
}

fn collect_jars(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_jars(&p, out);
        } else if p.extension().and_then(|x| x.to_str()).is_some_and(|x| x.eq_ignore_ascii_case("jar")) {
            out.push(p);
        }
    }
}

/// Windows не принимает командную строку длиннее 32767 символов, а classpath
/// сборки из четырёхсот jar перебирает этот предел вдвое: на живом клиенте это
/// «CreateProcess: слишком длинная строка» вместо игры. Java 9+ читает
/// аргументы из файла, и здесь он и подкладывается.
///
/// Обратный слэш в таком файле — символ экранирования, поэтому пути пишутся
/// прямыми: Windows принимает и такие. Файл лежит рядом со сборкой и
/// перезаписывается на каждый запуск: в нём ключ подписи, и хранить его дольше
/// одного старта незачем.
const ARGFILE_NAME: &str = "millida-args.txt";
const ARG_LIMIT: usize = 30_000;

pub fn args_need_file(args: &[String]) -> bool {
    args.iter().map(|a| a.len() + 3).sum::<usize>() > ARG_LIMIT
}

pub fn write_argfile(game_dir: &Path, args: &[String]) -> Result<PathBuf, String> {
    let path = game_dir.join(ARGFILE_NAME);
    let body: String = args
        .iter()
        // Каждый аргумент в кавычках, кавычка экранирована, обратный слэш
        // заменён на прямой (java читает его как экранирование на любой
        // системе): иначе пробел или «#» в нике и пути дописывают аргументы.
        .map(|a| argfile_line(a))
        .collect();
    let fail = |e: std::io::Error| format!("Не удалось подготовить запуск сборки: {}", e);
    // В файле ключ подписи и токены запуска: читать его может только владелец
    // (аудит 24.09.2026). Старый файл удаляется, чтобы права взялись заново.
    let _ = std::fs::remove_file(&path);
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut file = opts.open(&path).map_err(fail)?;
    std::io::Write::write_all(&mut file, body.as_bytes()).map_err(fail)?;
    Ok(path)
}

/// JVM читает файл аргументов при старте; через 10 секунд он уже не нужен и
/// не должен лежать на диске с ключом подписи.
pub fn drop_argfile_later(path: PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        let _ = std::fs::remove_file(&path);
    });
}

/// Папка нативных библиотек под текущую систему.
///
/// Сборка кладёт их по подпапкам, и имена в ней не наши: у Arcania Windows
/// зовётся `mustdie`. Поэтому имя берётся из описания сборки, а не угадывается,
/// и только если там ничего нет — пробуем разложить по общепринятым.
pub fn platform_natives(v: &Value, fallback: &str) -> String {
    for_platform(v, "nativesByPlatform")
        .and_then(|x| x.as_str())
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

/// Folders under the pack's natives that hold libraries of their own.
///
/// LWJGL 3 ships its natives in the layout of its jars, one folder per module
/// (`org/lwjgl/opengl/lwjgl_opengl.dll`), while `java.library.path` looks only
/// at the folder itself. Returns empty for a flat folder, which the plain
/// library path already covers.
pub fn nested_native_dirs(natives: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 8 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut has_native = false;
        let mut subdirs = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                subdirs.push(p);
            } else if p
                .extension()
                .and_then(|x| x.to_str())
                .is_some_and(|x| NATIVE_EXTENSIONS.iter().any(|n| x.eq_ignore_ascii_case(n)))
            {
                has_native = true;
            }
        }
        if has_native {
            out.push(dir.to_path_buf());
        }
        subdirs.sort();
        for d in subdirs {
            walk(&d, depth + 1, out);
        }
    }
    let mut out = Vec::new();
    walk(natives, 0, &mut out);
    if out.iter().all(|d| d == natives) {
        return Vec::new();
    }
    out
}

/// LWJGL reads this property before `java.library.path` and accepts a list,
/// which is what a nested layout needs.
pub fn lwjgl_library_path_arg(dirs: &[PathBuf]) -> Option<String> {
    if dirs.is_empty() {
        return None;
    }
    let sep = if cfg!(target_os = "windows") { ";" } else { ":" };
    let joined = dirs.iter().map(|d| d.to_string_lossy().to_string()).collect::<Vec<_>>().join(sep);
    Some(format!("-Dorg.lwjgl.librarypath={}", joined))
}

/// Наши сборки для списка «Контент». Открыто, как и карточка: игрок должен
/// видеть, что у нас есть, ещё до входа в аккаунт.
pub async fn catalog_packs() -> Result<Value, String> {
    millida_api("/catalog/packs".into(), "GET".into(), None, None).await
}

/// Маркер «сборка закрыта доступом» для окна ввода ключа.
///
/// Текст ошибки приходит с сервера и меняется там же, поэтому опознавать его по
/// словам нельзя: перефразированное сообщение молча перестало бы открывать
/// окно активации, и игрок с купленным ключом упирался бы в «нет доступа».
pub const PACK_ACCESS_PREFIX: &str = "pack-access: ";

/// Где взять ключ от платной сборки. Пусто, если продавец не указан.
///
/// Адрес приходит от службы, а не лежит в лаунчере: сборок с ключом будет
/// больше одной, и у каждой свой продавец - зашитый список пришлось бы
/// выпускать новой версией лаунчера ради одной строки.
pub async fn pack_buy_url(slug: &str) -> Result<String, String> {
    let view = millida_api(format!("/catalog/packs/{}", slug), "GET".into(), None, None).await?;
    let url = view["accessBuyUrl"].as_str().unwrap_or("").trim().to_string();
    // Наружу уходит только то, что откроется браузером как обычная страница.
    if url.starts_with("https://") { Ok(url) } else { Ok(String::new()) }
}

/// Активация ключа доступа к платной сборке.
pub async fn redeem_pack_key(slug: &str, code: &str) -> Result<Value, String> {
    let body = serde_json::json!({ "code": code });
    millida_api_auth(format!("/catalog/packs/{}/redeem", slug), "POST".into(), Some(body)).await
}

/// Signature the pack needs to start, issued to the signed-in account.
///
/// It lives neither in the archive nor in the profile: the pack is paid, and a
/// value stored on disk is a value that gets copied along with the folder. The
/// launcher asks for it on every start and passes it straight into the command
/// line, so revoking access on our side takes effect the next time the player
/// presses «Играть».
pub async fn pack_launch_token(slug: &str) -> Result<Vec<String>, String> {
    let res = millida_api_auth(format!("/catalog/packs/{}/launch-token", slug), "POST".into(), None)
        .await
        .map_err(|e| match e.as_str() {
            "unauthorized" => "Войди в аккаунт Millida — эта сборка запускается по доступу".to_string(),
            other if other.contains("403") => "У этого аккаунта нет доступа к сборке".to_string(),
            other => other.to_string(),
        })?;
    let args: Vec<String> = res["jvmArgs"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str()).map(str::to_string).collect())
        .unwrap_or_default();
    let kept: Vec<String> = args.into_iter().filter(|a| jvm_arg_allowed(a) || PACK_JVM_EXACT.contains(&a.as_str())).collect();
    if kept.is_empty() {
        return Err("Сервер не выдал ключ запуска сборки".into());
    }
    Ok(kept)
}

/// What the service says about a paid pack that is about to run or is running.
#[derive(Debug, PartialEq, Eq)]
pub enum PackAccess {
    Allowed { recheck_in: u64 },
    Lost(String),
}

const RECHECK_DEFAULT_SECS: u64 = 15 * 60;
const RECHECK_MIN_SECS: u64 = 5 * 60;
const RECHECK_MAX_SECS: u64 = 60 * 60;
const RECHECK_RETRY_SECS: u64 = 5 * 60;
const STOP_WAIT_SECS: u64 = 60;

/// Only a verdict spelled out by our own API takes the pack away. Anything
/// else — an unknown word, a missing field, `need-login` — means we do not
/// know, and not knowing must never cost a paying player their pack.
pub fn pack_access_from(res: &Value) -> Option<PackAccess> {
    let access = res["access"].as_str()?;
    match access {
        "allow" => Some(PackAccess::Allowed {
            recheck_in: res["recheckInSec"]
                .as_u64()
                .unwrap_or(RECHECK_DEFAULT_SECS)
                .clamp(RECHECK_MIN_SECS, RECHECK_MAX_SECS),
        }),
        "revoked" | "expired" | "no-access" | "not-paid" => {
            let message = res["message"].as_str().unwrap_or("").trim();
            Some(PackAccess::Lost(if message.is_empty() {
                "У этого аккаунта больше нет доступа к сборке".to_string()
            } else {
                message.to_string()
            }))
        }
        _ => None,
    }
}

pub async fn pack_access(slug: &str) -> Result<Option<PackAccess>, String> {
    let res = millida_api_auth(format!("/catalog/packs/{}/access", slug), "POST".into(), None).await?;
    Ok(pack_access_from(&res))
}

fn pid_running(pid: u32) -> bool {
    RUNNING.lock().map(|v| v.iter().any(|(_, id)| *id == pid)).unwrap_or(false)
}

/// Access is gone: the game is closed and the pack leaves the disk, so the
/// paid content does not stay behind for anyone to copy or keep playing. The
/// player's worlds and own files are moved aside first and return with the
/// next install of the same pack. Returns what the player is told.
pub async fn forfeit_pack(app: &AppHandle, profile: &str, slug: &str, reason: &str) -> String {
    if running_games().iter().any(|p| p == profile) {
        if let Err(e) = stop_game(Some(profile)) {
            eprintln!("[pack] не удалось закрыть игру «{}»: {}", profile, e);
        }
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(STOP_WAIT_SECS);
        while running_games().iter().any(|p| p == profile) && std::time::Instant::now() < deadline {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }
    }
    let removed = stash_player_files(profile, slug).and_then(|_| delete_profile(profile).map(|_| ()));
    let message = match &removed {
        Ok(_) => format!(
            "{}. Сборка удалена с компьютера, а миры и твои файлы сохранены — они вернутся, когда установишь её снова",
            reason
        ),
        Err(e) => format!("{}. Сборку не удалось убрать: {}", reason, e),
    };
    let _ = app.emit(
        "pack-access-lost",
        json!({ "profile": profile, "message": message, "removed": removed.is_ok() }),
    );
    message
}

/// Rechecks access while a paid pack is running. A refund or a revoked key
/// takes effect within one interval instead of at the next launch, which for a
/// launcher left open for days might never come.
pub async fn watch_pack_access(app: AppHandle, profile: String, slug: String, pid: u32) {
    let mut wait = RECHECK_DEFAULT_SECS;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
        if !pid_running(pid) {
            return;
        }
        match pack_access(&slug).await {
            Ok(Some(PackAccess::Allowed { recheck_in })) => wait = recheck_in,
            Ok(Some(PackAccess::Lost(reason))) => {
                forfeit_pack(&app, &profile, &slug, &reason).await;
                return;
            }
            Ok(None) | Err(_) => wait = RECHECK_RETRY_SECS,
        }
    }
}

/// A version json in Mojang's shape, built from the pack's own description.
///
/// Producing this instead of a second launch path is the point: argument
/// substitution, logging, playtime and crash handling stay in one place, and
/// the pack differs only by where the description came from.
pub fn pack_version_json(spec: &PackLaunch, extra_jvm: &[String]) -> Value {
    let mut jvm: Vec<Value> = vec![
        json!("-Djava.library.path=${natives_directory}"),
        json!("-cp"),
        json!("${classpath}"),
    ];
    for a in spec.jvm_args.iter().chain(extra_jvm.iter()) {
        jvm.push(json!(a));
    }
    let game: Vec<Value> = if spec.game_args.is_empty() {
        [
            "--username", "${auth_player_name}",
            "--version", "${version_name}",
            "--gameDir", "${game_directory}",
            "--assetsDir", "${assets_root}",
            "--assetIndex", "${assets_index_name}",
            "--uuid", "${auth_uuid}",
            "--accessToken", "${auth_access_token}",
            "--userType", "${user_type}",
            "--versionType", "${version_type}",
        ]
        .iter()
        .map(|a| json!(a))
        .collect()
    } else {
        spec.game_args.iter().map(|a| json!(a)).collect()
    };
    json!({
        "id": if spec.slug.is_empty() { "millida-pack".to_string() } else { format!("pack-{}", spec.slug) },
        "type": "release",
        "assetIndex": { "id": spec.asset_index },
        "arguments": {
            "jvm": jvm,
            "game": game
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec_json() -> Value {
        json!({
            "formatVersion": 1,
            "slug": "arcania",
            "mainClass": "net.fabricmc.loader.impl.launch.knot.KnotClient",
            "assetIndex": "1.20.1",
            "assetsDir": "assets",
            "nativesDir": "natives",
            "classPath": ["libraries", "minecraft.jar"],
            "jvmArgs": ["-XX:+DisableAttachMechanism", "-Dfml.ignorePatchDiscrepancies=true"],
            "javaMajor": 17,
            "minRamMb": 4096,
            "maxRamMb": 12288,
            "needsToken": true
        })
    }

    /// Длина команды -> нужен ли файл аргументов. Порог не косметика: на
    /// Windows сборка со своим classpath просто не стартует, а ошибка приходит
    /// от CreateProcess и о причине не говорит.
    #[test]
    fn a_pack_sized_classpath_goes_through_an_argfile() {
        let short: Vec<String> = vec!["-Xmx4G".into(), "-cp".into(), "a.jar;b.jar".into()];
        assert!(!args_need_file(&short), "обычный запуск не должен писать файл на диск");

        let long: Vec<String> = vec![
            "-cp".into(),
            // Длина как в жизни: профиль лежит в AppData, а имена защищённых
            // библиотек у сборки длинные — на них и набегают 80 000 символов.
            (0..400)
                .map(|i| {
                    format!(
                        "C:/Users/Player/AppData/Roaming/MillidaLauncher/profiles/Arcania 1.4.3/libraries/com/ijm/iku/60.2/framework-terrain-manager-{}.7.57.jar",
                        i
                    )
                })
                .collect::<Vec<_>>()
                .join(";"),
        ];
        assert!(args_need_file(&long), "classpath из четырёхсот jar обязан уехать в файл");

        let dir = std::env::temp_dir().join("millida-argfile-test");
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_argfile(&dir, &long).expect("файл аргументов записан");
        let body = std::fs::read_to_string(&path).unwrap();
        // Именно обратный слэш, а не разделитель текущей системы: файл читает
        // java, и для неё он всегда означает экранирование — где бы мы его ни
        // записали.
        let backslash = char::from(92);
        assert!(
            !body.contains(backslash),
            "обратный слэш в файле аргументов java считает экранированием",
        );
        assert_eq!(body.lines().count(), long.len(), "каждый аргумент — своей строкой");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "файл с ключом подписи читает только владелец");
        }
        let _ = std::fs::remove_file(&path);
    }

    /// Сборка раскладывает нативы по своим именам папок — у Arcania Windows
    /// зовётся `mustdie`. Угадывать их нельзя: не найдётся OpenGL, и запуск
    /// падает ещё до окна.
    #[test]
    fn natives_folder_comes_from_the_pack_not_from_a_guess() {
        let v = json!({
            "nativesByPlatform": {
                "windows-x86_64": "natives/mustdie/x86-64",
                "linux-x86_64": "natives/linux/x86-64",
                "macos-arm64": "natives/macosx/arm64"
            }
        });
        let picked = platform_natives(&v, "natives");
        assert!(picked.starts_with("natives/"), "путь остаётся внутри сборки");
        #[cfg(target_os = "windows")]
        assert_eq!(picked, "natives/mustdie/x86-64", "на Windows нужны именно эти нативы");

        assert_eq!(
            platform_natives(&json!({}), "natives"),
            "natives",
            "сборка без таблицы платформ работает по своему общему пути",
        );
    }

    /// Полная команда запуска для Arcania: то, что реально уедет в java.
    ///
    /// Эталон взят у автора сборки: главный класс Fabric, свой classpath из
    /// `libraries` и `minecraft.jar`, свои нативы, ключ подписи и глушилка
    /// рукопожатия owo-lib. Пропажа любой из трёх опор — подписи, стаба в
    /// classpath или папки `iku` — означает сборку, которая не стартует, и
    /// проверять это на живом клиенте дороже, чем закрепить здесь.
    #[test]
    fn the_command_line_matches_what_the_pack_expects() {
        let spec = parse_pack_launch(&spec_json()).expect("описание разобрано");
        let token = vec![
            "-Dlauncher.signature=SIG".to_string(),
            "-Dowo.handshake.disable=true".to_string(),
        ];
        let v = pack_version_json(&spec, &token);
        let dir = std::env::temp_dir().join("millida-pack-args-test");
        let cp = vec![
            dir.join("libraries").join("pro").join("gravit").join("launcher-api").join("stub").join("launcher-api-stub.jar"),
            dir.join("libraries").join("com").join("ijm").join("iku").join("60.2").join("core-forge-handler.jar"),
            dir.join("libraries").join("net").join("fabricmc").join("fabric-loader").join("fabric-loader-0.16.0.jar"),
            dir.join("minecraft.jar"),
        ];
        let args = crate::engine::build_args(
            &v,
            &spec.main_class,
            &cp,
            "Steve",
            &dir,
            &dir.join("assets"),
            &dir.join("natives"),
            &dir.join("libraries"),
            &Auth::default(),
        );
        let line = args.join(" ");

        let main_at = args.iter().position(|a| a == &spec.main_class).expect("главный класс в команде");
        let cp_at = args.iter().position(|a| a == "-cp").expect("classpath передан");
        assert!(cp_at < main_at, "classpath объявляется до главного класса, иначе java его не увидит");
        assert_eq!(args[main_at], "net.fabricmc.loader.impl.launch.knot.KnotClient");

        let cp_value = &args[cp_at + 1];
        assert!(cp_value.contains("launcher-api-stub.jar"), "без стаба защищённые моды не грузятся");
        assert!(cp_value.contains("iku"), "контент сборки лежит в iku и обязан быть в classpath");
        assert!(cp_value.contains("fabric-loader"), "загрузчик берётся из самой сборки");
        assert!(cp_value.ends_with("minecraft.jar"), "клиент игры идёт последним — по нему считается primary jar");

        for need in [
            "-Dlauncher.signature=SIG",
            "-Dowo.handshake.disable=true",
            "-XX:+DisableAttachMechanism",
        ] {
            assert!(args.iter().any(|a| a == need), "в команде нет «{}»", need);
        }
        assert!(
            args.iter().any(|a| a.starts_with("-Djava.library.path=") && a.contains("natives")),
            "нативы сборки: без них LWJGL не поднимет окно",
        );
        for need in ["--username", "Steve", "--assetIndex", "1.20.1", "--gameDir", "--accessToken", "--userType"] {
            assert!(line.contains(need), "в команде нет «{}»", need);
        }
        // Офлайн-сессия: токена нет, значит игра запускается legacy-пользователем.
        assert!(line.contains("legacy"), "без входа Mojang сессия обязана быть офлайновой");
    }

    /// server answer -> what happens to the pack. Deleting is irreversible for
    /// the player, so it must follow only an explicit refusal from our API.
    #[test]
    fn only_an_explicit_refusal_takes_the_pack_away() {
        let cases: Vec<(Value, Option<PackAccess>, &str)> = vec![
            (json!({"access": "allow", "recheckInSec": 900}), Some(PackAccess::Allowed { recheck_in: 900 }), "доступ есть — играем дальше"),
            (json!({"access": "allow", "recheckInSec": 1}), Some(PackAccess::Allowed { recheck_in: RECHECK_MIN_SECS }), "сервер не может заставить лаунчер долбить себя раз в секунду"),
            (json!({"access": "allow"}), Some(PackAccess::Allowed { recheck_in: RECHECK_DEFAULT_SECS }), "старый сервер без интервала — берём свой"),
            (json!({"access": "revoked", "message": "Доступ к сборке отозван"}), Some(PackAccess::Lost("Доступ к сборке отозван".into())), "продавец отозвал ключ"),
            (json!({"access": "expired", "message": ""}), Some(PackAccess::Lost("У этого аккаунта больше нет доступа к сборке".into())), "срок кончился, текст пустой — свой"),
            (json!({"access": "no-access"}), Some(PackAccess::Lost("У этого аккаунта больше нет доступа к сборке".into())), "доступ сняли вручную"),
            (json!({"access": "need-login"}), None, "вылет из аккаунта — не повод стирать купленное"),
            (json!({"access": "maybe"}), None, "незнакомое слово — не знаем, ничего не трогаем"),
            (json!({"message": "Forbidden"}), None, "ответ щита или чужой json без вердикта"),
        ];
        for (res, want, why) in cases {
            assert_eq!(pack_access_from(&res), want, "{}", why);
        }
    }

    /// spec -> verdict. The file decides a command line, so a description that
    /// cannot produce a working one must be refused rather than half-used.
    #[test]
    fn a_description_without_a_launchable_shape_is_refused() {
        assert!(parse_pack_launch(&spec_json()).is_some(), "обычное описание сборки принимается");

        let mut no_main = spec_json();
        no_main["mainClass"] = json!("");
        assert!(parse_pack_launch(&no_main).is_none(), "без главного класса запускать нечего");

        let mut weird_main = spec_json();
        weird_main["mainClass"] = json!("net.fabric; rm -rf /");
        assert!(parse_pack_launch(&weird_main).is_none(), "главный класс — имя класса, а не строка команды");

        let mut no_cp = spec_json();
        no_cp["classPath"] = json!([]);
        assert!(parse_pack_launch(&no_cp).is_none(), "пустой classpath означает сборку без кода");
    }

    /// arg -> kept?. The archive comes from outside, and its flags are replayed
    /// on every start — the same filter as for a player's own arguments.
    #[test]
    fn pack_folders_cannot_point_outside_the_pack() {
        for bad in ["../../..", "/usr/lib", "C:/Windows/System32"] {
            let mut v = spec_json();
            v["nativesDir"] = json!(bad);
            assert!(parse_pack_launch(&v).is_none(), "нативы «{bad}» вне папки сборки");
            let mut v = spec_json();
            v["assetsDir"] = json!(bad);
            assert!(parse_pack_launch(&v).is_none(), "ассеты «{bad}» вне папки сборки");
        }
    }

    #[test]
    fn a_pack_cannot_smuggle_an_agent_through_its_own_flags() {
        let mut v = spec_json();
        v["jvmArgs"] = json!([
            "-Dlauncher.signature=abc",
            "-javaagent:/tmp/evil.jar",
            "-XX:+DisableAttachMechanism",
            "-cp",
            "/etc"
        ]);
        let spec = parse_pack_launch(&v).expect("описание разобрано");
        assert!(spec.jvm_args.iter().any(|a| a.starts_with("-Dlauncher.signature")), "подпись обязана доехать");
        assert!(
            !spec.jvm_args.iter().any(|a| a.starts_with("-javaagent")),
            "агент из чужого архива — запуск произвольного кода при каждом старте",
        );
        assert!(!spec.jvm_args.iter().any(|a| a == "-cp"), "classpath задаётся полем, а не флагом");
    }

    /// The generated version json must carry what the pack needs: its own
    /// classpath, its own natives, its asset index and the token flags.
    #[test]
    fn the_generated_version_json_carries_the_packs_own_launch() {
        let spec = parse_pack_launch(&spec_json()).expect("описание разобрано");
        let token = vec!["-Dlauncher.signature=SIG".to_string(), "-Dowo.handshake.disable=true".to_string()];
        let v = pack_version_json(&spec, &token);
        let jvm: Vec<String> = v["arguments"]["jvm"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        assert!(jvm.contains(&"-cp".to_string()) && jvm.contains(&"${classpath}".to_string()), "классы берутся из сборки");
        assert!(jvm.iter().any(|a| a.contains("natives_directory")), "нативы сборки, а не общие");
        assert!(jvm.contains(&"-Dlauncher.signature=SIG".to_string()), "подпись подставляется в запуск");
        assert!(jvm.contains(&"-Dowo.handshake.disable=true".to_string()));
        assert_eq!(v["assetIndex"]["id"], "1.20.1", "индекс ассетов у сборки свой");
        let game: Vec<String> = v["arguments"]["game"].as_array().unwrap().iter().map(|x| x.as_str().unwrap().to_string()).collect();
        for need in ["--username", "--uuid", "--accessToken", "--assetIndex", "--gameDir", "--userType"] {
            assert!(game.contains(&need.to_string()), "игре нужен аргумент {}", need);
        }
    }

    /// OneBlock ships 1.7.10 on LWJGL 3 through lwjgl3ify: its own client jar,
    /// libraries and natives, Mojang's assets. The description below is the
    /// one handed to the partner; the reference is lwjgl3ify's own
    /// launcher-metadata/version.json.
    fn lwjgl3ify_spec() -> Value {
        json!({
            "formatVersion": 1,
            "slug": "oneblock-metalabs",
            "mainClass": "com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread",
            "vanillaAssets": "1.7.10",
            "assetIndex": "1.7.10",
            "nativesByPlatform": {
                "windows-x86_64": "natives/windows/x64",
                "windows-arm64": "natives/windows/arm64",
                "linux-x86_64": "natives/linux/x64",
                "linux-arm64": "natives/linux/arm64",
                "macos-x86_64": "natives/macos/x64",
                "macos-arm64": "natives/macos/arm64"
            },
            "classPath": ["libraries", "versions/1.7.10ANGELICA/1.7.10ANGELICA.jar"],
            "jvmArgs": [
                "-Djava.system.class.loader=com.gtnewhorizons.retrofuturabootstrap.RfbSystemClassLoader",
                "-Dfml.ignorePatchDiscrepancies=true",
                "-Dfml.ignoreInvalidMinecraftCertificates=true",
                "--enable-native-access=ALL-UNNAMED",
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=jdk.naming.dns/com.sun.jndi.dns=ALL-UNNAMED,java.naming"
            ],
            "jvmArgsByPlatform": { "macos": ["-XstartOnFirstThread"] },
            "gameArgs": [
                "--username", "${auth_player_name}",
                "--version", "${version_name}",
                "--gameDir", "${game_directory}",
                "--assetsDir", "${assets_root}",
                "--assetIndex", "${assets_index_name}",
                "--uuid", "${auth_uuid}",
                "--accessToken", "${auth_access_token}",
                "--userProperties", "${user_properties}",
                "--userType", "${user_type}",
                "--tweakClass", "cpw.mods.fml.common.launcher.FMLTweaker"
            ],
            "javaMajor": 21,
            "minRamMb": 4096
        })
    }

    /// What 1.7.10 on lwjgl3ify cannot start without, each one checked on the
    /// real command line: RetroFuturaBootstrap as the main class and system
    /// class loader, the Forge tweaker, `--userProperties` as a JSON value, the
    /// module openings that Java 17+ closes by default, and the FML flags a
    /// patched client jar needs. Every item here was a failed start of the
    /// real OneBlock client before it was added.
    #[test]
    fn a_1_7_10_lwjgl3ify_pack_gets_the_command_line_it_needs() {
        let spec = parse_pack_launch(&lwjgl3ify_spec()).expect("описание OneBlock разобрано");
        assert_eq!(spec.java_major, 21, "lwjgl3ify требует Java 17+, сборка просит 21");
        assert_eq!(spec.vanilla_assets, "1.7.10", "звуки и языки берутся из общего хранилища");
        assert_eq!(
            spec.main_class,
            "com.gtnewhorizons.retrofuturabootstrap.MainStartOnFirstThread",
            "lwjgl3ify 3 падает на старте, если main() пришёл не из этого класса, на любой системе"
        );
        #[cfg(target_os = "macos")]
        assert!(spec.jvm_args.iter().any(|a| a == "-XstartOnFirstThread"), "без него окно на macOS не создаётся");
        #[cfg(not(target_os = "macos"))]
        assert!(
            !spec.jvm_args.iter().any(|a| a == "-XstartOnFirstThread"),
            "флаг macOS на других системах JVM не принимает"
        );

        let v = pack_version_json(&spec, &[]);
        let dir = std::env::temp_dir().join("millida-lwjgl3ify-args-test");
        let cp = vec![
            dir.join("libraries").join("_forgePatches.jar"),
            dir.join("libraries").join("lwjgl-3.4.2.jar"),
            dir.join("versions").join("1.7.10ANGELICA").join("1.7.10ANGELICA.jar"),
        ];
        let args = crate::engine::build_args(
            &v,
            &spec.main_class,
            &cp,
            "Steve",
            &dir,
            &dir.join("assets"),
            &dir.join("natives"),
            &dir.join("libraries"),
            &Auth::default(),
        );
        let main_at = args.iter().position(|a| a == &spec.main_class).expect("главный класс в команде");
        let after: Vec<&String> = args[main_at + 1..].iter().collect();
        let tweak = after.iter().position(|a| *a == "--tweakClass").expect("без tweakClass Forge не загрузится");
        assert_eq!(after[tweak + 1], "cpw.mods.fml.common.launcher.FMLTweaker");
        let props = after.iter().position(|a| *a == "--userProperties").expect("1.7.10 требует --userProperties");
        assert_eq!(after[props + 1], "{}", "значение читает Gson: нераскрытый плейсхолдер роняет игру до окна");
        assert!(!after.iter().any(|a| *a == "--versionType"), "1.7.10 не знает --versionType и падает на нём");

        for need in [
            "-Djava.system.class.loader=com.gtnewhorizons.retrofuturabootstrap.RfbSystemClassLoader",
            "-Dfml.ignorePatchDiscrepancies=true",
            "--enable-native-access=ALL-UNNAMED",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
        ] {
            let at = args.iter().position(|a| a == need).unwrap_or_else(|| panic!("в команде нет «{}»", need));
            assert!(at < main_at, "«{}» — флаг JVM и обязан стоять до главного класса", need);
        }
    }

    /// LWJGL 3 natives laid out like its jars: one folder per module. Only the
    /// running platform's folder is handed over — Windows x86 and arm64 carry
    /// the same file names, and picking one of theirs crashes the JVM.
    #[test]
    fn natives_in_module_folders_reach_lwjgl_as_a_library_path_list() {
        let root = std::env::temp_dir().join("millida-nested-natives-test");
        let _ = std::fs::remove_dir_all(&root);
        let platform = root.join("windows").join("x64");
        let core = platform.join("org").join("lwjgl");
        let opengl = core.join("opengl");
        std::fs::create_dir_all(&opengl).unwrap();
        std::fs::write(core.join("lwjgl.dll"), b"x").unwrap();
        std::fs::write(opengl.join("lwjgl_opengl.dll"), b"x").unwrap();
        std::fs::write(core.join(".DS_Store"), b"x").unwrap();

        let dirs = nested_native_dirs(&platform);
        assert_eq!(dirs, vec![core.clone(), opengl.clone()], "каждая папка модуля с библиотекой, по порядку");
        let arg = lwjgl_library_path_arg(&dirs).expect("вложенные нативы передаются списком");
        assert!(arg.starts_with("-Dorg.lwjgl.librarypath="));
        assert!(arg.contains("opengl"), "без папки opengl окно не откроется");
        assert!(jvm_arg_allowed(&arg), "свой же аргумент проходит фильтр JVM");

        let flat = root.join("flat");
        std::fs::create_dir_all(&flat).unwrap();
        std::fs::write(flat.join("lwjgl64.dll"), b"x").unwrap();
        assert!(nested_native_dirs(&flat).is_empty(), "плоская папка уже покрыта java.library.path, лишний флаг не нужен");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// gameArgs -> accepted?. The list lands after the main class verbatim, so
    /// a list that could not come from a real launch description is refused
    /// whole instead of being trimmed into a different command.
    #[test]
    fn game_args_that_cannot_be_a_launch_are_refused() {
        let cases: Vec<(Value, bool, &str)> = vec![
            (json!(["--tweakClass", "cpw.mods.fml.common.launcher.FMLTweaker"]), true, "обычный список"),
            (json!(["--username", "${auth_player_name}"]), true, "плейсхолдеры лаунчера"),
            (json!(["--demo\n--server"]), false, "перевод строки склеил бы два аргумента"),
            (json!(["--width", 800]), false, "не строка"),
            (json!([""]), false, "пустой аргумент"),
            (json!(vec!["--x"; 65]), false, "длиннее любой настоящей команды"),
        ];
        for (args, ok, why) in cases {
            let mut v = lwjgl3ify_spec();
            v["gameArgs"] = args;
            assert_eq!(parse_pack_launch(&v).is_some(), ok, "{}", why);
        }
        let mut no_args = lwjgl3ify_spec();
        no_args.as_object_mut().unwrap().remove("gameArgs");
        let spec = parse_pack_launch(&no_args).expect("описание без gameArgs");
        let game: Vec<String> = pack_version_json(&spec, &[])["arguments"]["game"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        assert!(game.contains(&"--versionType".to_string()), "без своего списка — прежний набор, Arcania не меняется");
    }
}
