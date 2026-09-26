use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Host allowed to serve a catalogue pack archive.
///
/// The address is signed by our own API, but it is still an address the core is
/// about to download two gigabytes from and unpack into a game folder. A
/// compromised or simply mistaken API answer must not be able to point the
/// launcher at another host, so the verdict is taken here and not upstream.
const PACK_HOST: &str = "garage.millida.net";

const MANIFEST_NAME: &str = "millida.pack.json";
const LOADERS: [&str; 5] = ["vanilla", "fabric", "quilt", "forge", "neoforge"];

pub(crate) fn job_key_catalog_pack(slug: &str) -> String {
    format!("catalog-pack:{}", slug)
}

fn pack_url_allowed(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else { return false };
    url.scheme() == "https" && url.host_str() == Some(PACK_HOST)
}

fn slug_ok(slug: &str) -> bool {
    catalog_slug_ok(slug)
}

fn sha512_ok(v: &str) -> bool {
    v.len() == 128 && v.chars().all(|c| c.is_ascii_hexdigit())
}

/// What the pack says about itself once unpacked.
///
/// The archive carries its own manifest so an already downloaded pack can be
/// re-read without the API, and the API answer is preferred where both have the
/// field: the site is where a wrong loader gets fixed.
struct PackMeta {
    name: String,
    version: String,
    game: String,
    loader: String,
    loader_version: String,
}

/// The archive is someone else's upload, and launcher service files steer what
/// the launcher does with a build: settings carry JVM flags, the content record
/// carries the addresses «Починить» downloads from. So the archive's copies
/// never reach the profile, by the same rule pack overrides follow. The one
/// exception is the launch description at the root, spelled exactly: that is
/// the file catalogue review reads, and only a catalogue install is trusted to
/// run it.
fn strip_pack_service_files(dir: &Path) -> Result<(), String> {
    drop_launcher_service_files(dir, &[PACK_LAUNCH_FILE]).map_err(|e| io_fail("Распаковка", dir, &e))
}

fn read_pack_manifest(dir: &Path) -> Option<Value> {
    let raw = std::fs::read(dir.join(MANIFEST_NAME)).ok()?;
    serde_json::from_slice(&raw).ok()
}

fn meta_from(api: &Value, local: Option<&Value>) -> Result<PackMeta, String> {
    let pick = |key: &str| -> String {
        let from_api = api[key].as_str().unwrap_or("").trim().to_string();
        if !from_api.is_empty() {
            return from_api;
        }
        local
            .and_then(|v| v[key].as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let loader = pick("loader").to_lowercase();
    if !LOADERS.contains(&loader.as_str()) {
        return Err(format!("Неизвестный загрузчик сборки: {}", loader));
    }
    let game = pick("game");
    if game.is_empty() {
        return Err("Сборка не сказала, под какую версию Minecraft она собрана".into());
    }
    check_version_id(&game)?;
    let loader_version = pick("loaderVersion");
    if !loader_version.is_empty() {
        check_loader_version(&loader_version)?;
    }
    Ok(PackMeta {
        name: pick("title"),
        version: pick("version"),
        game,
        loader,
        loader_version,
    })
}

/// Client half of the pack. A pack without one is a server-only upload: there
/// is nothing to install on this machine, and saying so beats installing the
/// server half into a game folder.
fn client_file(view: &Value) -> Result<(String, u64, String), String> {
    let files = view["files"].as_array().cloned().unwrap_or_default();
    let file = files
        .iter()
        .find(|f| f["side"].as_str() == Some("client"))
        .ok_or("У этой сборки нет клиентской части — её ставят только на сервер")?;
    let id = file["id"].as_str().unwrap_or("").to_string();
    if id.is_empty() {
        return Err("Ответ сервера не содержит файла сборки".into());
    }
    let size = file["size"].as_u64().unwrap_or(0);
    let sha512 = file["sha512"].as_str().unwrap_or("").to_string();
    Ok((id, size, sha512))
}

/// Версия сборки, которая ждёт проверки.
///
/// Отвечает только проверяющему и только по его же аккаунту: для всех
/// остальных адреса как будто нет. Пустой ответ — проверять нечего.
pub async fn pack_review_candidate(slug: &str) -> Result<Value, String> {
    if !slug_ok(slug) {
        return Err("Некорректный адрес сборки".into());
    }
    millida_api_auth(format!("/catalog/packs/{}/candidate", slug), "GET".into(), None).await
}

/// Сборки, чьи непроверенные версии доступны этому аккаунту.
///
/// Один запрос на весь список вместо опроса по каждой сборке: у игрока ответ
/// пустой, и кнопки проверки он не увидит просто потому, что проверять ему
/// нечего.
pub async fn pack_review_queue() -> Result<Value, String> {
    millida_api_auth("/catalog/packs/review/mine".into(), "GET".into(), None).await
}

/// Карточка сборки в том виде, в каком её ждёт установщик.
///
/// Кандидат приходит другим ответом — у него одна версия и нет витринных
/// полей. Приводим его к общему виду здесь, чтобы ниже по течению был ровно
/// один путь установки: две дороги разъезжаются, и проверка остаётся на одной.
fn view_from_candidate(slug: &str, answer: &Value) -> Result<Value, String> {
    let c = answer["candidate"].clone();
    if c.is_null() {
        return Err("У этой сборки нет версии на проверке".into());
    }
    if c["side"].as_str().unwrap_or("client") != "client" {
        return Err("На проверке лежит серверная половина — ставить её на игру нечего".into());
    }
    Ok(serde_json::json!({
        "slug": slug,
        "title": answer["title"],
        "cover": answer["cover"],
        "accessRequired": answer["accessRequired"],
        "version": c["version"],
        "game": c["game"],
        "loader": c["loader"],
        "loaderVersion": c["loaderVersion"],
        "files": [{
            "id": c["fileId"],
            "side": "client",
            "size": c["size"],
            "sha512": c["sha512"],
        }],
        "reviewFileId": c["fileId"],
    }))
}

pub async fn install_catalog_pack(app: AppHandle, slug: String, review: bool) -> Result<Profile, String> {
    if !slug_ok(&slug) {
        return Err("Некорректный адрес сборки".into());
    }
    let job = Job::start(job_key_catalog_pack(&slug), slug.clone())?;
    let res = install_catalog_pack_job(&app, &job, &slug, review).await;
    job.finish(&app, res)
}

/// A pack version checked against its hash and unpacked, not yet anybody's
/// build. The temp guard travels with it, so a caller that stops early still
/// leaves no gigabytes behind.
struct Fetched {
    view: Value,
    title: String,
    meta: PackMeta,
    unpacked: PathBuf,
    /// The hash the downloaded archive was checked against, lowercase hex.
    sha512: String,
    _temp: TempPaths,
}

/// The one road from the catalogue to a verified, unpacked tree, for a fresh
/// install and for an update alike: the access check, the host allowlist and
/// the hash live here once.
async fn fetch_pack(app: &AppHandle, job: &Job, slug: &str, review: bool) -> Result<Fetched, String> {
    job.emit(app, 4.0, "Читаем сборку…");
    let view = if review {
        let answer = pack_review_candidate(slug).await?;
        view_from_candidate(slug, &answer)?
    } else {
        millida_api(format!("/catalog/packs/{}", slug), "GET".into(), None, millida_token()).await?
    };
    let (file_id, size, sha512) = client_file(&view)?;
    let title = view["title"].as_str().unwrap_or(slug).to_string();
    job.rename(&title);

    job.emit(app, 8.0, "Получаем ссылку…");
    /*
     * Отказ по доступу помечается маркером, а не опознаётся по словам: текст
     * приходит с сервера и правится там же, а окно ввода ключа обязано
     * открыться и после того, как формулировку перепишут.
     */
    let link = millida_api_auth(
        format!("/catalog/packs/files/{}/link", file_id),
        "POST".into(),
        None,
    )
    .await
    .map_err(|e| {
        let paid = view["accessRequired"].as_bool().unwrap_or(false);
        if paid && e != CANCELLED && !e.contains("Войди") {
            format!("{}{}", PACK_ACCESS_PREFIX, e)
        } else {
            e
        }
    })?;
    let url = link["url"].as_str().unwrap_or("").to_string();
    if !pack_url_allowed(&url) {
        return Err("Сервер вернул ссылку на чужой адрес — установка остановлена".into());
    }
    // The link answer is the fresher of the two: it is produced from the same
    // row the file will be served from, while the card may be cached.
    let sha512 = link["sha512"].as_str().unwrap_or(&sha512).to_string();
    let size = link["size"].as_u64().unwrap_or(size);
    if !sha512_ok(&sha512) {
        return Err("У сборки нет контрольной суммы — ставить такой архив нельзя".into());
    }

    let tmp_dir = data_dir().join("tmp");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive = tmp_dir.join(format!("pack-{}.zip", slug));
    let unpacked = tmp_dir.join(format!("pack-{}", slug));
    let temp = TempPaths(vec![archive.clone(), unpacked.clone()]);

    job.emit(app, 12.0, "Скачиваем сборку…");
    // Скачивание занимает почти всё время установки, поэтому оно и занимает
    // почти всю полосу: от 12 до 70 процентов.
    let seen = std::sync::atomic::AtomicU64::new(0);
    let report = |done: u64, total: Option<u64>| {
        let Some(total) = total.filter(|t| *t > 0) else { return };
        let pct = 12.0 + 58.0 * (done as f64 / total as f64) as f32;
        // Отчёт приходит на каждом куске тела: без загрубления это десятки
        // тысяч сообщений в окно на гигабайтном архиве.
        let step = (pct * 2.0) as u64;
        if seen.swap(step, std::sync::atomic::Ordering::Relaxed) != step {
            job.emit(app, pct.min(70.0), &format!("Скачиваем сборку… {}", fmt_bytes(done, total)));
        }
    };
    download_checked_progress(
        &url,
        &archive,
        Some(Sum::Sha512(&sha512)),
        if size > 0 { Some(size) } else { None },
        Some(job.cancel_flag()),
        &report,
    )
    .await?;
    job.check()?;

    job.emit(app, 70.0, "Распаковываем…");
    let from = archive.clone();
    let into = unpacked.clone();
    let _ = std::fs::remove_dir_all(&into);
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        unzip_to(&from, &into)?;
        strip_pack_service_files(&into)
    })
    .await
    .map_err(|e| e.to_string())??;
    job.check()?;

    let meta = meta_from(&view, read_pack_manifest(&unpacked).as_ref())?;
    Ok(Fetched { view, title, meta, unpacked, sha512: sha512.to_ascii_lowercase(), _temp: temp })
}

async fn install_catalog_pack_job(
    app: &AppHandle,
    job: &Job,
    slug: &str,
    review: bool,
) -> Result<Profile, String> {
    let Fetched { view, title, meta, unpacked, sha512, _temp } = fetch_pack(app, job, slug, review).await?;
    let pname = modpack_profile_name(
        if meta.name.is_empty() { &title } else { &meta.name },
        &meta.version,
    );
    job.rename(&pname);

    job.emit(app, 88.0, "Переносим файлы…");
    let pdir = profile_dir(&pname);
    if let Some(parent) = pdir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    /*
     * The unpacked tree becomes the profile in one move, and only after the
     * archive checked out. Copying into a half-created profile would leave a
     * build that looks installed and starts without half its mods if anything
     * failed midway — and a rename cannot half-succeed.
     */
    if pdir.exists() {
        return Err(format!("Папка сборки «{}» уже занята", pname));
    }
    place_unpacked(&unpacked, &pdir)?;
    let _ = std::fs::remove_file(pdir.join(MANIFEST_NAME));
    record_shipped(&pdir)?;
    trust_pack_launch(&pname, slug);
    restore_player_files(&pdir, slug);

    let prof = pack_profile(&pname, &meta, view["cover"].as_str().filter(|s| !s.is_empty()).map(String::from));
    put_profile(&prof)?;

    /*
     * Профиль помнит, что он проверочный. Иначе отчёт о запуске некуда
     * привязать: к моменту, когда игра закроется, от установки остаётся только
     * папка, а вопрос «эта версия вообще открылась?» решает, уедет она к
     * игрокам или нет.
     */
    let review_file = if review { view["reviewFileId"].as_str().unwrap_or_default() } else { "" };
    let review_sha512 = if review { sha512.as_str() } else { "" };
    merge_settings(&pname, pack_identity(slug, &meta.version, review_file, review_sha512));

    job.emit(app, 100.0, "Сборка установлена");
    Ok(prof)
}

fn place_unpacked(unpacked: &Path, dest: &Path) -> Result<(), String> {
    if std::fs::rename(unpacked, dest).is_ok() {
        return Ok(());
    }
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    copy_dir_all(unpacked, dest).map_err(|e| e.to_string())
}

fn pack_profile(name: &str, meta: &PackMeta, icon: Option<String>) -> Profile {
    Profile {
        name: name.to_string(),
        version: meta.game.clone(),
        fabric: matches!(meta.loader.as_str(), "fabric" | "quilt"),
        loader: Some(meta.loader.clone()),
        loader_version: if meta.loader_version.is_empty() { None } else { Some(meta.loader_version.clone()) },
        icon,
    }
}

fn put_profile(prof: &Profile) -> Result<(), String> {
    let mut all = load_profiles();
    if let Some(p) = all.iter_mut().find(|p| p.name == prof.name) {
        *p = prof.clone();
    } else {
        all.insert(0, prof.clone());
    }
    save_profiles(&all)
}

/// What a build remembers about the catalogue pack it came from. The install
/// and the update write it through here: two spellings of it would drift, and
/// the launcher would stop recognising its own builds.
fn pack_identity(slug: &str, version: &str, review_file: &str, review_sha512: &str) -> serde_json::Map<String, Value> {
    let mut m = serde_json::Map::new();
    m.insert("catalogPackSlug".into(), Value::String(slug.to_string()));
    m.insert("catalogPackVersion".into(), Value::String(version.to_string()));
    m.insert("catalogPackReviewFile".into(), Value::String(review_file.to_string()));
    m.insert("catalogPackReviewSha512".into(), Value::String(review_sha512.to_string()));
    m
}

/// The next published version of a catalogue build in place of the installed
/// one. The build keeps its name and folder, so its worlds, playtime, group and
/// settings stay where the player left them; the pack itself comes by the same
/// road as an install, access check included.
pub async fn update_catalog_pack(app: AppHandle, profile: String) -> Result<Profile, String> {
    let current = load_profiles()
        .into_iter()
        .find(|p| p.name == profile)
        .ok_or("Сборка не найдена — открой список сборок заново")?;
    let slug = profile_settings(&profile)["catalogPackSlug"]
        .as_str()
        .map(str::trim)
        .filter(|s| slug_ok(s))
        .map(String::from)
        .ok_or("Эта сборка поставлена не из каталога Millida — обновлять её неоткуда")?;
    let job = Job::start(job_key_catalog_pack(&slug), profile.clone())?;
    let res = update_catalog_pack_job(&app, &job, &current, &slug).await;
    job.finish(&app, res)
}

async fn update_catalog_pack_job(app: &AppHandle, job: &Job, current: &Profile, slug: &str) -> Result<Profile, String> {
    let profile = current.name.as_str();
    let pdir = profile_dir(profile);
    let (staged, previous) = update_side_dirs(&pdir)?;
    settle_interrupted_update(&pdir, &staged, &previous)?;
    let _staged = TempPaths(vec![staged.clone()]);
    let meta = prepare_update(app, job, profile, slug, &pdir, &staged).await.map_err(old_version_kept)?;

    job.emit(app, 95.0, "Меняем версию…");
    // The installed version may have been started while the next one downloaded.
    assert_not_running(profile, "обнови ещё раз").map_err(old_version_kept)?;
    swap_in(&pdir, &staged, &previous)?;
    let prof = pack_profile(profile, &meta, current.icon.clone());
    if let Err(e) = put_profile(&prof) {
        return Err(match swap_back(&pdir, &staged, &previous) {
            Ok(()) => old_version_kept(e),
            Err(lost) => lost,
        });
    }
    trust_pack_launch(profile, slug);
    forget_skin_mod_install(profile);
    if let Err(e) = std::fs::remove_dir_all(&previous) {
        eprintln!("[pack] старая версия «{}» не удалилась, уберём при следующем обновлении: {}", profile, e);
    }
    job.emit(app, 100.0, "Сборка обновлена");
    Ok(prof)
}

/// Everything up to the switch. The installed build is only read here.
async fn prepare_update(
    app: &AppHandle,
    job: &Job,
    profile: &str,
    slug: &str,
    pdir: &Path,
    staged: &Path,
) -> Result<PackMeta, String> {
    assert_not_running(profile, "обнови ещё раз")?;
    if !pdir.is_dir() {
        return Err("Папки сборки нет на диске — установи сборку из каталога заново".into());
    }
    let Fetched { meta, unpacked, _temp, .. } = fetch_pack(app, job, slug, false).await?;
    job.rename(profile);
    job.emit(app, 80.0, "Переносим миры и настройки…");
    let settings = carried_settings(profile, slug, &meta.version);
    let (from, to, slug) = (pdir.to_path_buf(), staged.to_path_buf(), slug.to_string());
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        place_unpacked(&unpacked, &to)?;
        let _ = std::fs::remove_file(to.join(MANIFEST_NAME));
        record_shipped(&to)?;
        carry_player_files(&from, &to, &slug)?;
        write_json_atomic(&to.join("millida-settings.json"), &settings)
    })
    .await
    .map_err(|e| e.to_string())??;
    job.check()?;
    Ok(meta)
}

/// The build's own settings (memory, Java, JVM flags, window size) stay with
/// it; only what names the pack version changes.
fn carried_settings(profile: &str, slug: &str, version: &str) -> serde_json::Map<String, Value> {
    let mut s = profile_settings(profile).as_object().cloned().unwrap_or_default();
    s.extend(pack_identity(slug, version, "", ""));
    s
}

/// Where the next version of a build is put together, and where the installed
/// one waits while the two change places. Beside the build, so both moves are
/// renames on one disk; dot-named, so the build list never adopts them.
fn update_side_dirs(pdir: &Path) -> Result<(PathBuf, PathBuf), String> {
    let name = pdir.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|n| !n.is_empty());
    let (Some(name), Some(root)) = (name, pdir.parent()) else {
        return Err("Некорректная папка сборки".into());
    };
    Ok((root.join(format!(".millida-update-{}", name)), root.join(format!(".millida-previous-{}", name))))
}

/// Leftovers of an update cut short by a closed launcher. The next version is
/// only ever a copy, so it goes. The installed version is put back if the cut
/// fell between the two renames of the switch, and dropped if the switch had
/// already finished.
fn settle_interrupted_update(pdir: &Path, staged: &Path, previous: &Path) -> Result<(), String> {
    let busy = |e: std::io::Error| format!("Остались файлы прошлого обновления, и их не удалось убрать: {}. Закрой папку сборки в проводнике и обнови ещё раз", e);
    if previous.is_dir() {
        if pdir.exists() {
            std::fs::remove_dir_all(previous).map_err(busy)?;
        } else {
            std::fs::rename(previous, pdir).map_err(busy)?;
        }
    }
    if staged.is_dir() {
        std::fs::remove_dir_all(staged).map_err(busy)?;
    }
    Ok(())
}

/// The build folder changes to the next version in two renames on one disk.
/// Nothing is deleted here: the installed version waits beside it until the
/// build list agrees, and a failed step puts it back.
fn swap_in(pdir: &Path, staged: &Path, previous: &Path) -> Result<(), String> {
    std::fs::rename(pdir, previous).map_err(|e| {
        old_version_kept(format!("Папку сборки не удалось сдвинуть: {}. Закрой её в проводнике и обнови ещё раз", e))
    })?;
    if let Err(e) = std::fs::rename(staged, pdir) {
        return Err(match std::fs::rename(previous, pdir) {
            Ok(()) => old_version_kept(format!(
                "Новая версия не встала на место: {}. Закрой папку сборки в проводнике и обнови ещё раз",
                e
            )),
            Err(back) => switch_lost(previous, &back),
        });
    }
    Ok(())
}

fn swap_back(pdir: &Path, staged: &Path, previous: &Path) -> Result<(), String> {
    std::fs::rename(pdir, staged).map_err(|e| switch_lost(previous, &e))?;
    std::fs::rename(previous, pdir).map_err(|e| switch_lost(previous, &e))
}

/// Only the folder name goes into the text: the full path carries the Windows
/// user name, and the text is also a failure report.
fn switch_lost(previous: &Path, e: &std::io::Error) -> String {
    let name = previous.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    format!(
        "Старая версия сборки не вернулась на место ({}). Её файлы и миры целы — в папке «{}» рядом со сборками. Напиши в поддержку, поможем вернуть",
        e, name
    )
}

/// Every failure before the switch leaves the installed version as it was, and
/// saying so tells the player they can go on playing. A refused access and a
/// cancel pass unchanged: the key window and the cancel toast read them as
/// they are.
fn old_version_kept(e: String) -> String {
    if e == CANCELLED || e.starts_with(PACK_ACCESS_PREFIX) {
        return e;
    }
    format!(
        "{}. Старая версия сборки на месте — в неё можно играть, а обновить позже",
        e.trim_end_matches(['.', ' '])
    )
}

/// Builds whose `millida-pack-launch.json` the core honours, kept outside every
/// profile folder: profile folder name -> catalogue slug. The descriptor itself
/// lives in the profile folder, where pack overrides, share codes, imports and
/// the player can all put files; only a build this core installed from the
/// catalogue gets to decide its own command line.
const TRUST_FILE: &str = "pack-launch-trust.json";

fn trust_path() -> PathBuf {
    data_dir().join(TRUST_FILE)
}

fn folder_key(profile: &str) -> String {
    profile_dir(profile).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn read_trust() -> serde_json::Map<String, Value> {
    let path = trust_path();
    if let Some(m) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Value>(&b).ok()).and_then(|v| v.as_object().cloned()) {
        return m;
    }
    // First run with the registry: builds installed from the catalogue before
    // it existed carry catalogPackSlug in their settings. Adopted once, then
    // the file exists and only installs add to it.
    let mut m = serde_json::Map::new();
    if !path.exists() {
        if let Ok(rd) = std::fs::read_dir(game_root().join("profiles")) {
            for e in rd.flatten() {
                let dir = e.path();
                if !dir.join(PACK_LAUNCH_FILE).is_file() {
                    continue;
                }
                let slug = std::fs::read(dir.join("millida-settings.json")).ok()
                    .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                    .and_then(|v| v["catalogPackSlug"].as_str().map(String::from))
                    .unwrap_or_default();
                if catalog_slug_ok(&slug) {
                    m.insert(e.file_name().to_string_lossy().to_string(), Value::String(slug));
                }
            }
        }
        let _ = write_json_atomic(&path, &m);
    }
    m
}

fn write_trust(m: &serde_json::Map<String, Value>) {
    let _ = write_json_atomic(&trust_path(), m);
}

pub(crate) fn trust_pack_launch(profile: &str, slug: &str) {
    if !catalog_slug_ok(slug) {
        return;
    }
    let mut m = read_trust();
    m.insert(folder_key(profile), Value::String(slug.to_string()));
    write_trust(&m);
}

/// Deleting a build forgets it: a later build that lands in a folder of the
/// same name (any mrpack can be named like a paid pack) must not inherit trust.
pub fn forget_pack_launch(profile: &str) {
    let mut m = read_trust();
    if m.remove(&folder_key(profile)).is_some() {
        write_trust(&m);
    }
}

pub fn move_pack_launch_trust(old: &str, new: &str) {
    let mut m = read_trust();
    if let Some(v) = m.remove(&folder_key(old)) {
        m.insert(folder_key(new), v);
        write_trust(&m);
    }
}

/// The pack's own launch description, only for a build installed from the
/// catalogue. The slug comes from the registry, not from the file.
pub fn trusted_pack_launch_spec(profile: &str) -> Option<PackLaunch> {
    let slug = read_trust().get(&folder_key(profile))?.as_str()?.to_string();
    if !catalog_slug_ok(&slug) {
        return None;
    }
    let mut spec = pack_launch_spec(profile)?;
    spec.slug = slug;
    Some(spec)
}

/// Отчёт о живом запуске проверочной версии.
///
/// Единственный способ узнать, открывается ли сборка, — открыть её. Отчёт шлёт
/// лаунчер того, кто её проверяет, и только про ту версию, которую он же и
/// ставил: «запускается» со слов заливающего ничего не значит.
///
/// Отметка снимается сразу после отправки. Проверка нужна один раз; без снятия
/// каждый следующий выход из игры слал бы её заново, а после одобрения — ещё и
/// про версию, которая давно у всех.
pub async fn report_review_launch(profile: &str, ok: bool, detail: &str) {
    let settings = profile_settings(profile);
    let file_id = settings["catalogPackReviewFile"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if file_id.is_empty() {
        return;
    }
    let body = launch_check_body(&settings, ok, detail);
    match millida_api_auth(
        format!("/catalog/packs/review/{}/launch-check", file_id),
        "POST".into(),
        Some(body),
    )
    .await
    {
        Ok(_) => {
            let mut patch = serde_json::Map::new();
            patch.insert("catalogPackReviewFile".into(), Value::String(String::new()));
            patch.insert("catalogPackReviewSha512".into(), Value::String(String::new()));
            merge_settings(profile, patch);
        }
        // Проглотить нельзя: без отчёта версия висит в очереди, и человек
        // ждёт результата проверки, которого никогда не будет.
        Err(e) => eprintln!("[pack] отчёт о проверке запуска «{}» не ушёл: {}", profile, e),
    }
}

/// The hash ties the report to the bytes this launcher installed, so a version
/// re-uploaded after the install is not approved by this launch. A build
/// installed before the hash was kept has none, and a malformed one would make
/// the server refuse the whole report: without the field the report still
/// arrives and waits for a moderator.
fn launch_check_body(settings: &Value, ok: bool, detail: &str) -> Value {
    let mut body = serde_json::json!({ "ok": ok, "detail": detail.chars().take(400).collect::<String>() });
    let sha512 = settings["catalogPackReviewSha512"].as_str().unwrap_or("").trim().to_ascii_lowercase();
    if sha512_ok(&sha512) {
        body["sha512"] = Value::String(sha512);
    }
    body
}

/// Removes the download and the unpacked tree on every path out, including the
/// early returns and the cancel. Four hand-written deletions in the happy path
/// leave gigabytes behind exactly when the install failed.
struct TempPaths(Vec<PathBuf>);

impl Drop for TempPaths {
    fn drop(&mut self) {
        for p in &self.0 {
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(p);
            } else {
                let _ = std::fs::remove_file(p);
            }
        }
    }
}

/// «812 МБ из 1,6 ГБ»: цифра рядом с полосой отвечает на вопрос «оно вообще
/// движется», на который сама полоса за минуту не отвечает.
fn fmt_bytes(done: u64, total: u64) -> String {
    let gb = 1024f64 * 1024.0 * 1024.0;
    let mb = 1024f64 * 1024.0;
    if total as f64 >= gb {
        format!("{:.1} из {:.1} ГБ", done as f64 / gb, total as f64 / gb)
    } else {
        format!("{:.0} из {:.0} МБ", done as f64 / mb, total as f64 / mb)
    }
}

#[cfg(test)]
mod tests {
    /// Полоса на гигабайтном архиве стоит минутами, поэтому рядом идёт число.
    /// Единица выбирается по РАЗМЕРУ АРХИВА, а не по скачанному: иначе первые
    /// мегабайты подписаны в мегабайтах, а потом подпись перескакивает в
    /// гигабайты, и человек читает это как откат прогресса.
    #[test]
    fn size_next_to_the_bar_keeps_one_unit() {
        let gb = 1024u64 * 1024 * 1024;
        assert_eq!(fmt_bytes(0, 1_588_073_827), "0.0 из 1.5 ГБ", "начало закачки уже в гигабайтах");
        assert_eq!(fmt_bytes(gb / 2, 1_588_073_827), "0.5 из 1.5 ГБ");
        assert_eq!(fmt_bytes(190 * 1024 * 1024, 500 * 1024 * 1024), "190 из 500 МБ", "мелкой сборке гигабайты не нужны");
    }

    use super::*;

    /// url -> verdict. The address is signed by our API, but the core is about
    /// to download gigabytes from it and unpack them into a game folder.
    #[test]
    fn only_our_storage_may_serve_a_pack() {
        let good = "https://garage.millida.net/millida-packs/catalog/packs/a/a-1-client.zip?X-Amz-Signature=x";
        assert!(pack_url_allowed(good), "«{good}» — обычная подписанная ссылка хранилища");
        for bad in [
            "http://garage.millida.net/x.zip",
            "https://garage.millida.net.evil.example/x.zip",
            "https://evil.example/garage.millida.net/x.zip",
            "https://127.0.0.1/x.zip",
            "file:///C:/Windows/System32/x.dll",
            "",
        ] {
            assert!(
                !pack_url_allowed(bad),
                "«{bad}» обязан отклоняться: по этому адресу лаунчер скачает архив и распакует его в папку игры",
            );
        }
    }

    /// path in the archive -> kept. The archive is someone else's upload: its
    /// copies of launcher service files would steer the launch and the repair
    /// of the build it becomes, so they go by the same rule as pack overrides.
    /// Each case gets its own folder: two spellings of one name share a file on
    /// Windows.
    #[test]
    fn pack_archive_brings_no_launcher_service_files() {
        let cases: &[(&str, bool, &str)] = &[
            ("millida-pack-launch.json", true, "описание запуска в корне читает проверка каталога, а запускает его только сборка из каталога"),
            ("Millida-Pack-Launch.json", false, "другое написание проверка не сверяет, а Windows всё равно откроет его как описание запуска"),
            ("config/millida-pack-launch.json", false, "вложенную копию никто не проверял; правило то же, что у overrides"),
            ("millida-settings.json", false, "в настройках сборки лежат JVM-флаги — это запуск чужого кода"),
            ("millida-content.json", false, "по адресам из этой записи «Починить» качает моды в mods/"),
            ("millida-local-meta.json", false, "служебная запись лаунчера о модах сборки"),
            ("millida-args.txt", false, "лишние аргументы запуска игры"),
            ("servers.dat.millida", false, "служебная копия списка серверов"),
            ("mods/millida-content.json", false, "служебный файл глубже корня всё равно служебный"),
            ("millida-content.json/x.jar", false, "папка со служебным именем уходит целиком"),
            ("mods/sodium.jar", true, "содержимое сборки не трогается"),
            ("millida.pack.json", true, "манифест сборки установщик читает после распаковки и убирает сам"),
        ];
        let base = std::env::temp_dir().join(format!("millida-pack-strip-{}", std::process::id()));
        for (i, (path, kept, why)) in cases.iter().enumerate() {
            let dir = base.join(i.to_string());
            let _ = std::fs::remove_dir_all(&dir);
            let file = dir.join(path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, b"x").unwrap();
            strip_pack_service_files(&dir).expect("разбор распакованной сборки не должен падать на обычных файлах");
            assert_eq!(file.exists(), *kept, "«{path}»: {why}");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// slug -> verdict. The slug arrives from a `millida://` link, which any web
    /// page can fire, and lands in an API path and a temp file name.
    #[test]
    fn slug_is_a_catalogue_address_and_nothing_else() {
        for good in ["lost-souls", "freshcraft-industry", "tlou", "dotg2"] {
            assert!(slug_ok(good), "«{good}» — обычный адрес карточки каталога");
        }
        for bad in ["", "../etc", "a/b", "Lost-Souls", "a b", &"x".repeat(81)] {
            assert!(!slug_ok(bad), "«{bad}» обязан отклоняться: он идёт в путь API и в имя файла");
        }
    }

    /// hash -> verdict. Without a hash the archive is unverified code, so an
    /// empty or short value must stop the install rather than pass silently.
    #[test]
    fn only_a_full_sha512_counts_as_a_hash() {
        assert!(sha512_ok(&"a".repeat(128)));
        assert!(!sha512_ok(&"a".repeat(127)), "обрезанный хеш — не хеш");
        assert!(!sha512_ok(""), "пустой хеш означает «проверять нечем»");
        assert!(!sha512_ok(&"z".repeat(128)), "не-hex значит, что в поле лежит не хеш");
    }

    /// settings -> sha512 in the launch-check body. The hash lets the server
    /// count the launch only for the bytes it ran on; a value the server would
    /// refuse must not cost the whole report.
    #[test]
    fn launch_check_carries_the_installed_archive_hash() {
        let hex = "ab".repeat(64);
        let cases: &[(Value, Option<&str>, &str)] = &[
            (serde_json::json!({ "catalogPackReviewSha512": hex }), Some(hex.as_str()), "хеш, с которым сверялся скачанный архив, уходит как есть"),
            (serde_json::json!({ "catalogPackReviewSha512": hex.to_uppercase() }), Some(hex.as_str()), "сервер сверяет строчный hex: регистр не должен ронять отчёт"),
            (serde_json::json!({}), None, "сборка, поставленная до этой версии лаунчера, хеша не помнит: отчёт уходит модератору без него"),
            (serde_json::json!({ "catalogPackReviewSha512": "" }), None, "обычная установка и обновление хеш не записывают"),
            (serde_json::json!({ "catalogPackReviewSha512": "ab".repeat(63) }), None, "обрезанный хеш сервер отклонил бы вместе со всем отчётом"),
            (serde_json::json!({ "catalogPackReviewSha512": 42 }), None, "файл настроек лежит у игрока на диске, в поле может оказаться что угодно"),
        ];
        for (settings, want, why) in cases {
            let body = launch_check_body(settings, true, "сессия 30 с");
            assert_eq!(body["sha512"].as_str(), *want, "{why}");
            assert_eq!(body["ok"], true, "{why}: итог запуска обязан дойти при любом хеше");
        }
    }

    /// api/manifest -> meta. The card is authoritative where it has a value:
    /// a wrong loader is fixed on the site, not by re-uploading the archive.
    #[test]
    fn card_wins_over_the_manifest_inside_the_archive() {
        let api = serde_json::json!({ "title": "Lost Souls", "version": "1.6.1", "game": "1.20.1", "loader": "forge", "loaderVersion": "47.4.0" });
        let local = serde_json::json!({ "loader": "fabric", "loaderVersion": "0.16.0", "game": "1.19.2" });
        let meta = meta_from(&api, Some(&local)).expect("карточка полная");
        assert_eq!(meta.loader, "forge");
        assert_eq!(meta.game, "1.20.1");
        assert_eq!(meta.loader_version, "47.4.0");

        let thin = serde_json::json!({ "title": "Lost Souls", "version": "1.6.1" });
        let meta = meta_from(&thin, Some(&local)).expect("манифест дополняет карточку");
        assert_eq!(meta.loader, "fabric", "чего нет в карточке, берётся из архива");
        assert_eq!(meta.game, "1.19.2");

        let broken = serde_json::json!({ "title": "X", "version": "1", "game": "1.20.1", "loader": "sponge" });
        assert!(meta_from(&broken, None).is_err(), "чужой загрузчик обязан остановить установку");
        let no_game = serde_json::json!({ "title": "X", "version": "1", "loader": "forge" });
        assert!(meta_from(&no_game, None).is_err(), "без версии игры профиль собрать не из чего");
    }

    /// files -> verdict. A server-only pack must say so instead of installing
    /// the server half into a game folder.
    #[test]
    fn a_pack_without_a_client_half_refuses_to_install() {
        let ok = serde_json::json!({ "files": [{ "id": "abc1234567", "side": "client", "size": 10, "sha512": "a" }] });
        let (id, size, _) = client_file(&ok).expect("клиентская половина есть");
        assert_eq!(id, "abc1234567");
        assert_eq!(size, 10);

        let server_only = serde_json::json!({ "files": [{ "id": "abc1234567", "side": "server" }] });
        assert!(client_file(&server_only).is_err(), "серверную половину нельзя ставить как клиент");
        assert!(client_file(&serde_json::json!({ "files": [] })).is_err(), "пустой список файлов — не установка");
    }

    /// error -> what the player reads. Before the switch the installed version
    /// is untouched, and the text has to say so; the key window and the cancel
    /// toast match their own markers and must get them unchanged.
    #[test]
    fn a_failed_update_says_the_old_version_is_still_there() {
        let cases: &[(&str, bool, &str)] = &[
            ("Не скачались файлы сборки: 502", true, "сбой сети до подмены: игроку важно знать, что играть можно"),
            ("Архив повреждён: bad zip.", true, "точка в конце причины не удваивается"),
            (CANCELLED, false, "отмену окно узнаёт по точному тексту"),
            ("pack-access: Подписка закончилась", false, "по маркеру открывается окно ключа, приписка испортила бы текст причины"),
        ];
        for (input, noted, why) in cases {
            let out = old_version_kept(input.to_string());
            assert_eq!(out.contains("Старая версия сборки на месте"), *noted, "«{input}»: {why}");
            assert!(out.starts_with(input.trim_end_matches('.')), "«{input}»: исходная причина обязана остаться в начале текста");
            assert!(!out.contains(".."), "«{input}»: {why}");
        }
    }

    /// build folder -> side folders. Both sit next to the build, because the
    /// switch is two renames and a rename cannot cross disks, and both start
    /// with a dot, because the build list adopts every other folder as a build.
    #[test]
    fn update_folders_sit_beside_the_build_and_stay_out_of_the_list() {
        let pdir = std::env::temp_dir().join("profiles").join("Arcania");
        let (staged, previous) = update_side_dirs(&pdir).expect("у папки сборки есть имя и родитель");
        for side in [&staged, &previous] {
            assert_eq!(side.parent(), pdir.parent(), "{side:?}: подмена — это переименование, на другой диск оно не переносит");
            let name = side.file_name().unwrap().to_string_lossy().into_owned();
            assert!(name.starts_with('.'), "{side:?}: папку без точки список сборок подхватит как ещё одну сборку");
            assert!(name.ends_with("Arcania"), "{side:?}: у двух сборок не должно быть общей папки обновления");
        }
        assert_ne!(staged, previous, "новая и старая версии не могут делить одну папку");
    }

    fn mark(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("which"), body).unwrap();
    }

    fn which(dir: &Path) -> Option<String> {
        std::fs::read_to_string(dir.join("which")).ok()
    }

    /// Folders left by a launcher closed mid-update -> the build after the next
    /// attempt. The next version is only ever a copy; the installed one holds
    /// the only copy of the player's worlds and is never the one that goes.
    #[test]
    fn a_cut_update_is_settled_without_losing_the_installed_version() {
        let base = std::env::temp_dir().join(format!("millida-pack-settle-{}", std::process::id()));
        type Case<'a> = (&'a [(&'a str, &'a str)], &'a str, &'a str);
        let cases: &[Case] = &[
            (&[("build", "old"), ("staged", "new")], "old", "недоделанная новая версия — копия, её можно убрать"),
            (&[("previous", "old")], "old", "обрыв между двумя переименованиями: старая версия возвращается на место"),
            (&[("build", "new"), ("previous", "old")], "new", "подмена прошла, не успела только уборка"),
        ];
        for (i, (layout, want, why)) in cases.iter().enumerate() {
            let root = base.join(i.to_string());
            let _ = std::fs::remove_dir_all(&root);
            let pdir = root.join("Build");
            let (staged, previous) = update_side_dirs(&pdir).unwrap();
            for (at, body) in layout.iter() {
                let dir = match *at {
                    "build" => &pdir,
                    "staged" => &staged,
                    _ => &previous,
                };
                mark(dir, body);
            }
            settle_interrupted_update(&pdir, &staged, &previous).expect(why);
            assert_eq!(which(&pdir).as_deref(), Some(*want), "{why}");
            assert!(!staged.exists() && !previous.exists(), "{why}: после разбора рядом со сборкой не остаётся лишних гигабайт");
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// The switch: the next version takes the folder and the installed one
    /// waits beside it; a switch that cannot finish puts the installed version
    /// back where it was.
    #[test]
    fn the_switch_puts_the_old_version_back_when_the_new_one_cannot_move_in() {
        let base = std::env::temp_dir().join(format!("millida-pack-swap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let pdir = base.join("Build");
        let (staged, previous) = update_side_dirs(&pdir).unwrap();

        mark(&pdir, "old");
        mark(&staged, "new");
        swap_in(&pdir, &staged, &previous).expect("обе папки на месте — подмена обязана пройти");
        assert_eq!(which(&pdir).as_deref(), Some("new"), "после подмены в папке сборки новая версия");
        assert_eq!(which(&previous).as_deref(), Some("old"), "старая версия ждёт рядом, пока не записан список сборок");

        swap_back(&pdir, &staged, &previous).expect("откат, когда список сборок не записался");
        assert_eq!(which(&pdir).as_deref(), Some("old"), "откат возвращает игроку старую версию");

        let _ = std::fs::remove_dir_all(&staged);
        let err = swap_in(&pdir, &staged, &previous).expect_err("без новой версии подменять нечем");
        assert_eq!(which(&pdir).as_deref(), Some("old"), "неудачная подмена обязана вернуть старую версию на место");
        assert!(err.contains("Старая версия сборки на месте"), "игрок должен узнать, что играть можно: {err}");
        let _ = std::fs::remove_dir_all(&base);
    }
}
