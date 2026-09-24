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

async fn install_catalog_pack_job(
    app: &AppHandle,
    job: &Job,
    slug: &str,
    review: bool,
) -> Result<Profile, String> {
    job.emit(app, 4.0, "Читаем сборку…");
    let view = if review {
        let answer = pack_review_candidate(slug).await?;
        view_from_candidate(slug, &answer)?
    } else {
        millida_api(format!("/catalog/packs/{}", slug), "GET".into(), None, None).await?
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
    let _guard = TempPaths(vec![archive.clone(), unpacked.clone()]);

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
    tokio::task::spawn_blocking(move || unzip_to(&from, &into))
        .await
        .map_err(|e| e.to_string())??;
    job.check()?;

    let meta = meta_from(&view, read_pack_manifest(&unpacked).as_ref())?;
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
    if std::fs::rename(&unpacked, &pdir).is_err() {
        std::fs::create_dir_all(&pdir).map_err(|e| e.to_string())?;
        copy_dir_all(&unpacked, &pdir).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::remove_file(pdir.join(MANIFEST_NAME));
    record_shipped(&pdir)?;
    trust_pack_launch(&pname, slug);
    restore_player_files(&pdir, slug);

    let prof = Profile {
        name: pname.clone(),
        version: meta.game.clone(),
        fabric: matches!(meta.loader.as_str(), "fabric" | "quilt"),
        loader: Some(meta.loader.clone()),
        loader_version: if meta.loader_version.is_empty() { None } else { Some(meta.loader_version.clone()) },
        icon: view["cover"].as_str().filter(|s| !s.is_empty()).map(String::from),
    };
    let mut all = load_profiles();
    if let Some(p) = all.iter_mut().find(|p| p.name == prof.name) {
        *p = prof.clone();
    } else {
        all.insert(0, prof.clone());
    }
    save_profiles(&all)?;

    let mut patch = serde_json::Map::new();
    patch.insert("catalogPackSlug".into(), Value::String(slug.to_string()));
    patch.insert("catalogPackVersion".into(), Value::String(meta.version.clone()));
    /*
     * Профиль помнит, что он проверочный. Иначе отчёт о запуске некуда
     * привязать: к моменту, когда игра закроется, от установки остаётся только
     * папка, а вопрос «эта версия вообще открылась?» решает, уедет она к
     * игрокам или нет.
     */
    patch.insert(
        "catalogPackReviewFile".into(),
        Value::String(if review {
            view["reviewFileId"].as_str().unwrap_or_default().to_string()
        } else {
            String::new()
        }),
    );
    merge_settings(&pname, patch);

    job.emit(app, 100.0, "Сборка установлена");
    Ok(prof)
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
    let file_id = profile_settings(profile)["catalogPackReviewFile"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if file_id.is_empty() {
        return;
    }
    let body = serde_json::json!({ "ok": ok, "detail": detail.chars().take(400).collect::<String>() });
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
            merge_settings(profile, patch);
        }
        // Проглотить нельзя: без отчёта версия висит в очереди, и человек
        // ждёт результата проверки, которого никогда не будет.
        Err(e) => eprintln!("[pack] отчёт о проверке запуска «{}» не ушёл: {}", profile, e),
    }
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
}
