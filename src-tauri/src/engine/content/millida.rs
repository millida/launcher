// Install from the Millida catalog (millida.net/mods, textures, modpacks) when the user asks.
// The file address comes from api.millida.net. It is checked for https and a Millida host, then the hash is checked.
use crate::engine::*;
use serde_json::Value;
use tauri::AppHandle;

/// Установка из каталога Millida (millida.net/mods, /texture-packs, /modpacks…).
///
/// Вебвью называет только материал и файл — адрес файла ядро спрашивает у
/// нашего API само. Иначе любая страница, открывшая лаунчер ссылкой millida://,
/// могла бы подсунуть ему свой файл под видом мода из каталога.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogInstallReq {
    /// Slug карточки каталога: адрес /{section}/{slug} на сайте.
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub icon: String,
    /// "file" — файл карточки через резолвер статьи-хранилища;
    /// "curated" — файлы разделов /cheats и /addons.
    /// Готовая сборка лаунчера (launcherOnly) сюда не ходит: у неё свой путь —
    /// install_catalog_pack (catalog_pack.rs): ключ доступа, миры игрока, свой хост.
    pub via: String,
    #[serde(default)]
    pub article: String,
    #[serde(default)]
    pub section: String,
    pub file_id: String,
    /// Сборка, в которую ставим. Для модпака пусто: он сам становится сборкой.
    #[serde(default)]
    pub profile: String,
    /// mod | resourcepack | shader | datapack | world | modpack
    pub kind: String,
    #[serde(default)]
    pub version_label: String,
    /// Контрольная сумма из карточки. Сверяем по ней, если API её не отдал сам.
    #[serde(default)]
    pub sha1: String,
    /// Файлы разделов /cheats и /addons приходят с sha256, а не sha1.
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub size: u64,
    /// Версия игры и загрузчик из карточки — для сборки, по файлам которой
    /// их не видно (готовая сборка каталога — это папка игры в zip).
    #[serde(default)]
    pub game: String,
    #[serde(default)]
    pub loader: String,
    #[serde(default)]
    pub loader_version: String,
}

#[derive(serde::Serialize, Default)]
pub struct CatalogInstall {
    /// Имя файла в сборке или папки мира; у модпака пусто.
    pub file: String,
    /// Сборка, созданная модпаком.
    pub profile: Option<Profile>,
}

struct Resolved {
    url: String,
    name: String,
    sha1: String,
    sha256: String,
    sha512: String,
    size: u64,
}

impl Resolved {
    fn sum(&self) -> Option<Sum<'_>> {
        if !self.sha512.is_empty() {
            Some(Sum::Sha512(&self.sha512))
        } else if !self.sha256.is_empty() {
            Some(Sum::Sha256(&self.sha256))
        } else if !self.sha1.is_empty() {
            Some(Sum::Sha1(&self.sha1))
        } else {
            None
        }
    }
}

fn hex_or_empty(s: &str) -> String {
    let t = s.trim().to_ascii_lowercase();
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_hexdigit()) { t } else { String::new() }
}

/// Кусок имени временного файла: slug приходит из ссылки, в путь идёт только
/// то, что не может сделать из него другой путь.
pub(crate) fn tmp_tag(slug: &str) -> String {
    let t: String = slug.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(64).collect();
    if t.is_empty() { "item".into() } else { t }
}

/// Резолвер отдаёт адрес файла, а у файла без зеркала — страницу автора. Её
/// скачивание положило бы в папку модов HTML под именем jar.
// Checks the file address from the API answer: https only, allowed hosts only, local addresses are not accepted.
pub(crate) fn check_file_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url.trim()).map_err(|_| "API вернул некорректную ссылку на файл".to_string())?;
    if parsed.scheme() != "https" {
        return Err("API вернул ссылку не по https".into());
    }
    let host = parsed.host_str().unwrap_or_default().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host_is_local(&host) {
        return Err("Ссылка на файл ведёт в локальную сеть".into());
    }
    if matches!(host.as_str(), "modrinth.com" | "www.modrinth.com" | "curseforge.com" | "www.curseforge.com") {
        return Err("Этого файла нет на зеркале Millida — только страница автора".into());
    }
    Ok(())
}

async fn resolve(req: &CatalogInstallReq) -> Result<Resolved, String> {
    let file = urlencode(req.file_id.trim());
    if file.is_empty() {
        return Err("Не выбран файл".into());
    }
    let (v, name_key): (Value, &str) = match req.via.as_str() {
        "file" => {
            if req.article.trim().is_empty() {
                return Err("У карточки нет файла для скачивания".into());
            }
            let path = format!("/forum/articles/{}/download?file={}", urlencode(req.article.trim()), file);
            (millida_api_auth(path, "GET".into(), None).await?, "name")
        }
        "curated" => {
            if !matches!(req.section.as_str(), "cheats" | "addons") {
                return Err("Раздел не найден".into());
            }
            let path = format!("/catalog/curated/{}/{}/download?file={}", req.section, urlencode(req.slug.trim()), file);
            (millida_api_auth(path, "GET".into(), None).await?, "name")
        }
        _ => return Err("Неизвестный источник файла".into()),
    };
    let url = v["url"].as_str().unwrap_or("").to_string();
    check_file_url(&url)?;
    let r = Resolved {
        url,
        name: v[name_key].as_str().unwrap_or("").to_string(),
        sha1: hex_or_empty(&req.sha1),
        sha256: {
            let from_api = hex_or_empty(v["sha256"].as_str().unwrap_or(""));
            if from_api.is_empty() { hex_or_empty(&req.sha256) } else { from_api }
        },
        sha512: hex_or_empty(v["sha512"].as_str().unwrap_or("")),
        size: v["size"].as_u64().filter(|s| *s > 0).unwrap_or(req.size),
    };
    // Файл без суммы — непроверенный код в папке игры: не ставим, а не «ставим как есть».
    if r.sum().is_none() {
        return Err("У файла нет контрольной суммы — установка остановлена".into());
    }
    Ok(r)
}

pub async fn content_catalog_install(app: AppHandle, req: CatalogInstallReq) -> Result<CatalogInstall, String> {
    let key = if req.kind == "modpack" {
        job_key_modpack_millida(&req.slug)
    } else {
        job_key_content("millida", &req.profile, &req.kind, &req.slug)
    };
    let job = Job::start(key, req.title.clone())?;
    let res = if req.kind == "modpack" {
        install_pack_job(&app, &job, &req).await
    } else {
        install_content_job(&app, &job, &req).await
    };
    job.finish(&app, res)
}

async fn install_content_job(app: &AppHandle, job: &Job, req: &CatalogInstallReq) -> Result<CatalogInstall, String> {
    if !matches!(req.kind.as_str(), "mod" | "resourcepack" | "shader" | "datapack" | "world") {
        return Err("Этот раздел в сборку не ставится".into());
    }
    if !load_profiles().iter().any(|p| p.name == req.profile) {
        return Err("Сборка не найдена".into());
    }
    job.emit(app, 10.0, "Спрашиваем файл у Millida…");
    let r = resolve(req).await?;
    let fname = safe_file_name(&r.name)?;
    let lower = fname.to_ascii_lowercase();
    // Аддон Bedrock или установщик чита — не мод: игра Java-издания его не
    // прочитает, а в папке модов он только сломает запуск.
    if req.kind == "mod" && (!lower.ends_with(".jar") || lower.starts_with("installer")) {
        return Err("Этот файл не ставится в сборку как мод — скачай его со страницы на сайте".into());
    }
    job.check()?;
    job.emit(app, 30.0, &format!("Скачиваем {}…", fname));
    let size = Some(r.size).filter(|s| *s > 0);
    if req.kind == "world" {
        if !lower.ends_with(".zip") {
            return Err("Файл карты не в формате zip — поставь его вручную".into());
        }
        let tag = tmp_tag(&req.slug);
        let tmp = data_dir().join("tmp").join(format!("millida-world-{}.zip", tag));
        download_checked_cancellable(&r.url, &tmp, r.sum(), size, Some(job.cancel_flag()))
            .await
            .map_err(|e| if e == CANCELLED { e } else { format!("Не скачалась карта: {}", e) })?;
        job.check()?;
        job.emit(app, 80.0, "Переносим мир…");
        let saves = profile_dir(&req.profile).join("saves");
        let ex = data_dir().join("tmp").join(format!("millida-world-{}", tag));
        let placed = place_world_from_zip(&saves, &tmp, &ex, &req.title);
        let _ = std::fs::remove_file(&tmp);
        let folder = placed?;
        upsert(req, &r, "world", &folder);
        job.emit(app, 100.0, "Карта установлена");
        return Ok(CatalogInstall { file: folder, profile: None });
    }
    let dir = profile_dir(&req.profile).join(content_dir(&req.kind));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = safe_child(&dir, &fname)?;
    download_checked_cancellable(&r.url, &dest, r.sum(), size, Some(job.cancel_flag())).await?;
    if !r.sha1.is_empty() {
        adopt_to_store(&dest, &r.sha1);
    }
    upsert(req, &r, &req.kind, &fname);
    job.emit(app, 100.0, "Установлено");
    Ok(CatalogInstall { file: fname, profile: None })
}

/// Запись в манифест сборки: по ней строка каталога говорит «Установлено», а
/// экспорт сборки знает, откуда файл. Id проекта — slug каталога Millida с
/// префиксом, чтобы не спутать его с id Modrinth.
fn upsert(req: &CatalogInstallReq, r: &Resolved, kind: &str, file_name: &str) {
    manifest_upsert(&req.profile, ContentEntry {
        kind: kind.to_string(),
        file_name: file_name.to_string(),
        project_id: format!("millida:{}", req.slug),
        version_id: req.file_id.clone(),
        version_number: req.version_label.clone(),
        title: req.title.clone(),
        icon_url: req.icon.clone(),
        description: String::new(),
        author: String::new(),
        download_url: r.url.clone(),
        sha1: r.sha1.clone(),
        sha512: r.sha512.clone(),
        file_size: r.size,
    });
}

async fn install_pack_job(app: &AppHandle, job: &Job, req: &CatalogInstallReq) -> Result<CatalogInstall, String> {
    job.emit(app, 5.0, "Спрашиваем сборку у Millida…");
    let r = resolve(req).await?;
    let fname = safe_file_name(&r.name)?;
    let lower = fname.to_ascii_lowercase();
    if !(lower.ends_with(".zip") || lower.ends_with(".mrpack")) {
        return Err("Файл сборки не в формате zip или mrpack".into());
    }
    let tag = tmp_tag(&req.slug);
    let tmp = data_dir().join("tmp").join(format!("millida-pack-{}-{}", tag, fname));
    job.check()?;
    job.emit(app, 10.0, &format!("Скачиваем {}…", fname));
    download_checked_cancellable(&r.url, &tmp, r.sum(), Some(r.size).filter(|s| *s > 0), Some(job.cancel_flag()))
        .await
        .map_err(|e| if e == CANCELLED { e } else { format!("Не скачалась сборка: {}", e) })?;
    job.check()?;
    job.emit(app, 60.0, "Собираем сборку…");
    let hint = PackHint {
        version: req.game.clone(),
        loader: req.loader.clone(),
        loader_version: Some(req.loader_version.clone()).filter(|v| !v.is_empty()),
    };
    let import = ImportJob { job, from: 60.0, to: 95.0 };
    let res = import_pack_archive(app, Some(&import), &tmp, &req.title, Some(&hint), &format!("millida-pack-{}", tag)).await;
    let _ = std::fs::remove_file(&tmp);
    let prof = res?;
    job.emit(app, 100.0, "Сборка готова");
    Ok(CatalogInstall { file: String::new(), profile: Some(prof) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_of_the_author_is_not_a_file() {
        assert!(check_file_url("https://modrinth.com/mod/iris").is_err());
        assert!(check_file_url("https://www.curseforge.com/minecraft/mc-mods/jei").is_err());
        assert!(check_file_url("http://cdn.millida.trade/a.jar").is_err());
        assert!(check_file_url("https://127.0.0.1/a.jar").is_err());
        assert!(check_file_url("https://cdn.millida.trade/forum/dl/a.jar").is_ok());
    }

    #[test]
    fn temp_tag_cannot_escape_the_folder() {
        assert_eq!(tmp_tag("../../etc"), "etc");
        assert_eq!(tmp_tag("iris-shaders"), "iris-shaders");
        assert_eq!(tmp_tag("///"), "item");
    }

    #[test]
    fn checksum_from_the_webview_must_be_hex() {
        assert_eq!(hex_or_empty(" ABCdef01 "), "abcdef01");
        assert_eq!(hex_or_empty("not-a-hash"), "");
    }
}
