use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Установка материала каталога Millida вместе с зависимостями — по плану,
/// который собирает наш API: `GET /v2/catalog/items/:slug/resolve?gameVersion=&loader=`.
///
/// Подход тот же, что у Modrinth App (theseus `install_project_with_dependencies`):
/// сначала план — сам материал, обязательные и необязательные зависимости и то,
/// чего в каталоге нет; потом установка плана целиком. Отличия:
///  - план считает сервер, а не клиент: у материалов не с Modrinth дерево
///    зависимостей есть только в нашем каталоге;
///  - файлы сначала все скачиваются и сверяются во временную папку и только
///    потом переезжают в сборку. Сорвавшаяся на третьей зависимости установка
///    не оставляет сборку с модом без его библиотеки.
///
/// Вебвью называет только slug, сборку и выбранные необязательные slug — план
/// ядро запрашивает у API само, как и адреса файлов в `millida.rs`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPlanReq {
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub icon: String,
    pub profile: String,
    /// mod | resourcepack | shader | datapack
    pub kind: String,
    /// Необязательные зависимости, которые человек отметил в окне плана.
    #[serde(default)]
    pub optional: Vec<String>,
}

#[derive(serde::Serialize, Default)]
pub struct CatalogPlanDone {
    /// Имя файла самого материала в сборке.
    pub file: String,
    /// Поставленные зависимости (названия).
    pub installed: Vec<String>,
    /// Уже стояли в сборке — не качали.
    pub skipped: Vec<String>,
    /// Нужны, но в каталоге Millida их нет — человеку говорим, что поставить руками.
    pub missing: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Role {
    Primary,
    Required,
    Optional,
}

#[derive(Debug, Clone)]
pub(crate) struct PlanFile {
    pub slug: String,
    pub title: String,
    pub kind: String,
    pub role: Role,
    pub file_id: String,
    pub version: String,
    pub name: String,
    pub url: String,
    pub sha1: String,
    pub sha256: String,
    pub sha512: String,
    pub size: u64,
    pub icon: String,
}

impl PlanFile {
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

#[derive(Debug, Default)]
pub(crate) struct Plan {
    pub files: Vec<PlanFile>,
    pub missing: Vec<String>,
}

/// Больше файлов в плане одного мода не бывает; ответ длиннее — ошибка API или
/// попытка залить в сборку чужой набор.
const MAX_FILES: usize = 64;

fn hex_len(s: &str, len: usize) -> String {
    let t = s.trim().to_ascii_lowercase();
    if t.len() == len && t.chars().all(|c| c.is_ascii_hexdigit()) { t } else { String::new() }
}

fn str_of<'a>(v: &'a Value, keys: &[&str]) -> &'a str {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if !s.trim().is_empty() {
                return s.trim();
            }
        }
    }
    ""
}

/// Вложенные объекты плана API `millida.install-plan/1`: карточка, файл и адрес
/// скачивания лежат отдельными ветками, а не плоскими полями.
const SUBS: &[&str] = &["project", "file", "download"];

/// Поле либо у самого элемента (плоский ответ), либо в одной из веток плана.
fn str_at<'a>(v: &'a Value, keys: &[&str]) -> &'a str {
    let direct = str_of(v, keys);
    if !direct.is_empty() {
        return direct;
    }
    for s in SUBS {
        if let Some(o) = v.get(*s) {
            let t = str_of(o, keys);
            if !t.is_empty() {
                return t;
            }
        }
    }
    ""
}

fn u64_at(v: &Value, key: &str) -> u64 {
    if let Some(n) = v.get(key).and_then(|x| x.as_u64()) {
        return n;
    }
    for s in SUBS {
        if let Some(n) = v.get(*s).and_then(|o| o.get(key)).and_then(|x| x.as_u64()) {
            return n;
        }
    }
    0
}

/// Папка установки из плана API → вид материала. Раздел карточки надёжнее, но у
/// зависимости без публичной карточки его нет, а папка есть всегда.
fn kind_of_path(path: &str) -> Option<&'static str> {
    Some(match path {
        "mods" => "mod",
        "resourcepacks" => "resourcepack",
        "shaderpacks" => "shader",
        "datapacks" => "datapack",
        _ => return None,
    })
}

/// Раздел каталога → папка сборки. Зависимость без раздела — мод: библиотеки и
/// API (Fabric API, Cloth Config) — моды.
fn kind_of_section(section: &str) -> Option<&'static str> {
    Some(match section {
        "" | "mods" | "mod" => "mod",
        "texture-packs" | "resourcepack" => "resourcepack",
        "shaders" | "shader" => "shader",
        "data-packs" | "datapack" => "datapack",
        _ => return None,
    })
}

fn slug_ok(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 128
        && slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Ответ API → план. Всё, что не проходит проверку, отбрасывает план целиком:
/// «починенный» план с выкинутой обязательной зависимостью ставит мод, который
/// потом не запускается, и человек не узнаёт почему.
pub(crate) fn parse_plan(v: &Value, primary_slug: &str, primary_kind: &str) -> Result<Plan, String> {
    let list = v
        .get("files")
        .or_else(|| v.get("install"))
        .and_then(|x| x.as_array())
        .ok_or("План установки пуст")?;
    // Необязательные зависимости план API отдаёт отдельным списком, где сам файл
    // лежит в поле `file` (а его может и не быть — тогда ставить нечего).
    let extra: Vec<&Value> = v
        .get("optional")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|o| o.get("file").filter(|f| f.is_object())).collect())
        .unwrap_or_default();
    if list.len() + extra.len() > MAX_FILES {
        return Err("План установки слишком длинный".into());
    }
    let mut files = Vec::new();
    for (f, forced) in list.iter().map(|f| (f, None)).chain(extra.into_iter().map(|f| (f, Some(Role::Optional)))) {
        let slug = str_at(f, &["slug", "itemSlug"]).to_string();
        let role = match forced {
            Some(r) => r,
            // `root`/`dependency` — роли плана API; `primary`/`required`/`optional`
            // остаются для плоского ответа.
            None => match str_of(f, &["role"]).to_ascii_lowercase().as_str() {
                "primary" | "main" | "self" | "root" => Role::Primary,
                "required" | "dependency" => {
                    if slug == primary_slug { Role::Primary } else { Role::Required }
                }
                "optional" => Role::Optional,
                other => return Err(format!("Неизвестная роль файла в плане: {}", other)),
            },
        };
        if !slug_ok(&slug) {
            return Err("В плане файл без адреса в каталоге".into());
        }
        let kind = if role == Role::Primary {
            primary_kind.to_string()
        } else {
            let path = str_of(f, &["installPath"]);
            let by_path = if path.is_empty() { None } else { kind_of_path(path) };
            by_path
                .or_else(|| kind_of_section(str_at(f, &["section", "kind"])))
                .ok_or_else(|| format!("Зависимость «{}» не ставится в сборку", slug))?
                .to_string()
        };
        let url = str_at(f, &["url", "downloadUrl"]).to_string();
        check_file_url(&url)?;
        let name = safe_file_name(str_at(f, &["fileName", "name", "filename"]))?;
        let lower = name.to_ascii_lowercase();
        if kind == "mod" && (!lower.ends_with(".jar") || lower.starts_with("installer")) {
            return Err(format!("«{}» — не файл мода", name));
        }
        if matches!(kind.as_str(), "resourcepack" | "shader" | "datapack") && !lower.ends_with(".zip") {
            return Err(format!("«{}» — не архив zip", name));
        }
        let pf = PlanFile {
            title: {
                let t = str_at(f, &["title", "name"]);
                if t.is_empty() { slug.clone() } else { t.to_string() }
            },
            slug,
            kind,
            role,
            file_id: str_at(f, &["fileId", "id"]).to_string(),
            version: str_at(f, &["version", "versionNumber"]).to_string(),
            name,
            url,
            sha1: hex_len(str_at(f, &["sha1"]), 40),
            sha256: hex_len(str_at(f, &["sha256"]), 64),
            sha512: hex_len(str_at(f, &["sha512"]), 128),
            size: u64_at(f, "size"),
            icon: str_at(f, &["icon"]).to_string(),
        };
        // Без суммы файл — непроверенный код в папке модов.
        if pf.sum().is_none() {
            return Err(format!("У файла «{}» нет контрольной суммы — ставить его нельзя", pf.name));
        }
        files.push(pf);
    }
    let primaries = files.iter().filter(|f| f.role == Role::Primary).count();
    if primaries != 1 {
        return Err("В плане нет самого материала".into());
    }
    // Два файла с одним именем в одной папке затрут друг друга.
    for (i, a) in files.iter().enumerate() {
        if files[..i].iter().any(|b| b.kind == a.kind && b.name.eq_ignore_ascii_case(&a.name)) {
            return Err(format!("В плане дважды один файл: {}", a.name));
        }
    }
    let missing = v
        .get("missing")
        .or_else(|| v.get("notInCatalog"))
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|m| {
                    let t = if let Some(s) = m.as_str() { s } else { str_of(m, &["title", "name", "slug", "projectId"]) };
                    let t = t.trim();
                    (!t.is_empty()).then(|| t.chars().take(80).collect::<String>())
                })
                .take(32)
                .collect()
        })
        .unwrap_or_default();
    Ok(Plan { files, missing })
}

/// Что из плана уже стоит в сборке. Зависимость, которая уже есть в любой
/// версии, не трогаем (так же поступает Modrinth App: existing_project_ids) —
/// её мог поставить другой мод или сам человек. Сам материал ставим всегда:
/// человек нажал «Установить» ровно ради него.
pub(crate) fn already_there(f: &PlanFile, manifest: &[ContentEntry], dir: &Path) -> bool {
    if f.role == Role::Primary {
        return false;
    }
    let pid = format!("millida:{}", f.slug);
    manifest.iter().any(|e| {
        e.kind == f.kind
            && (e.project_id == pid
                || (!f.sha1.is_empty() && e.sha1.eq_ignore_ascii_case(&f.sha1))
                || (!f.sha512.is_empty() && e.sha512.eq_ignore_ascii_case(&f.sha512)))
    }) || dir.join(&f.name).exists()
        || dir.join(format!("{}.disabled", f.name)).exists()
}

pub async fn catalog_install_plan(app: AppHandle, req: CatalogPlanReq) -> Result<CatalogPlanDone, String> {
    let key = job_key_content("millida", &req.profile, &req.kind, &req.slug);
    let job = Job::start(key, req.title.clone())?;
    let res = plan_job(&app, &job, &req).await;
    job.finish(&app, res)
}

async fn plan_job(app: &AppHandle, job: &Job, req: &CatalogPlanReq) -> Result<CatalogPlanDone, String> {
    if !matches!(req.kind.as_str(), "mod" | "resourcepack" | "shader" | "datapack") {
        return Err("Этот раздел по плану не ставится".into());
    }
    if !slug_ok(&req.slug) {
        return Err("Некорректный адрес материала".into());
    }
    let prof = load_profiles().into_iter().find(|p| p.name == req.profile).ok_or("Сборка не найдена")?;
    let loader = prof.loader.clone().unwrap_or_else(|| if prof.fabric { "fabric".into() } else { "vanilla".into() });

    job.emit(app, 5.0, "Собираем зависимости…");
    let path = format!(
        "/catalog/items/{}/resolve?gameVersion={}&loader={}",
        urlencode(&req.slug),
        urlencode(&prof.version),
        urlencode(&loader),
    );
    let v = millida_api_auth(path, "GET".into(), None).await?;
    let plan = parse_plan(&v, &req.slug, &req.kind)?;

    let manifest = load_content_manifest(&req.profile);
    let pdir = profile_dir(&req.profile);
    let mut out = CatalogPlanDone { missing: plan.missing.clone(), ..Default::default() };
    let mut todo: Vec<PlanFile> = Vec::new();
    for f in plan.files {
        if f.role == Role::Optional && !req.optional.iter().any(|s| s == &f.slug) {
            continue;
        }
        if already_there(&f, &manifest, &pdir.join(content_dir(&f.kind))) {
            out.skipped.push(f.title.clone());
            continue;
        }
        todo.push(f);
    }

    // Всё качаем рядом, в свою папку, и только проверенное переносим в сборку.
    let stage = data_dir().join("tmp").join(format!("millida-plan-{}", tmp_tag(&req.slug)));
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let _guard = StageDir(stage.clone());
    let total = todo.len().max(1) as f32;
    let mut staged: Vec<(PlanFile, PathBuf)> = Vec::new();
    for (i, f) in todo.into_iter().enumerate() {
        job.check()?;
        job.emit(app, 10.0 + 75.0 * (i as f32 / total), &format!("Скачиваем {}…", f.name));
        let sub = stage.join(i.to_string());
        std::fs::create_dir_all(&sub).map_err(|e| e.to_string())?;
        let tmp = safe_child(&sub, &f.name)?;
        download_checked_cancellable(&f.url, &tmp, f.sum(), Some(f.size).filter(|s| *s > 0), Some(job.cancel_flag()))
            .await
            .map_err(|e| format!("Не скачался «{}»: {}", f.title, e))?;
        staged.push((f, tmp));
    }
    job.check()?;

    job.emit(app, 90.0, "Кладём в сборку…");
    for (f, tmp) in staged {
        let dir = pdir.join(content_dir(&f.kind));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = safe_child(&dir, &f.name)?;
        if f.role == Role::Primary {
            // Другая версия того же материала уходит: две версии одного мода
            // в папке — самый частый краш на старте.
            for e in manifest.iter().filter(|e| e.kind == f.kind && e.project_id == format!("millida:{}", f.slug)) {
                if e.file_name != f.name {
                    if let Ok(old) = safe_child(&dir, &e.file_name) {
                        let _ = std::fs::remove_file(&old);
                    }
                    manifest_remove(&req.profile, &e.kind, &e.file_name);
                }
            }
        }
        if std::fs::rename(&tmp, &dest).is_err() {
            std::fs::copy(&tmp, &dest).map_err(|e| format!("Не удалось положить {}: {}", f.name, e))?;
        }
        if !f.sha1.is_empty() {
            adopt_to_store(&dest, &f.sha1);
        }
        manifest_upsert(&req.profile, ContentEntry {
            kind: f.kind.clone(),
            file_name: f.name.clone(),
            project_id: format!("millida:{}", f.slug),
            version_id: f.file_id.clone(),
            version_number: f.version.clone(),
            title: f.title.clone(),
            icon_url: if f.role == Role::Primary && f.icon.is_empty() { req.icon.clone() } else { f.icon.clone() },
            description: String::new(),
            author: String::new(),
            download_url: f.url.clone(),
            sha1: f.sha1.clone(),
            sha512: f.sha512.clone(),
            file_size: f.size,
        });
        if f.role == Role::Primary {
            out.file = f.name.clone();
        } else {
            out.installed.push(f.title.clone());
        }
    }
    if out.file.is_empty() {
        // Сам материал уже лежал тем же файлом — это тоже «установлено».
        out.file = req.title.clone();
    }
    job.emit(app, 100.0, "Установлено");
    Ok(out)
}

struct StageDir(PathBuf);

impl Drop for StageDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(slug: &str, role: &str, name: &str) -> Value {
        json!({ "slug": slug, "title": slug, "role": role, "fileName": name, "url": "https://cdn.millida.trade/forum/dl/".to_string() + name, "sha1": "a".repeat(40), "size": 10 })
    }

    /// План → вердикт: сам материал, обязательная и необязательная зависимости,
    /// и то, чего нет в каталоге, — каждое на своём месте.
    #[test]
    fn plan_keeps_every_role() {
        let v = json!({
            "files": [file("iris", "primary", "iris.jar"), file("sodium", "required", "sodium.jar"), file("modmenu", "optional", "modmenu.jar")],
            "missing": [{ "title": "Fabric Language Kotlin" }, "Cloth Config"],
        });
        let p = parse_plan(&v, "iris", "mod").expect("план целый");
        assert_eq!(p.files.len(), 3);
        assert_eq!(p.files[0].role, Role::Primary);
        assert_eq!(p.files[1].role, Role::Required);
        assert_eq!(p.files[2].role, Role::Optional);
        assert_eq!(p.missing, vec!["Fabric Language Kotlin".to_string(), "Cloth Config".to_string()]);
    }

    /// Так отвечает бэкенд: карточка, файл и адрес — тремя ветками, роли
    /// `root`/`dependency`, необязательные — отдельным списком. Раньше ядро
    /// падало на «Неизвестная роль файла в плане: root».
    fn api_file(slug: &str, role: &str, name: &str) -> Value {
        json!({
            "role": role,
            "project": { "slug": slug, "section": "mods", "title": slug.to_string() + " Mod", "icon": "https://millida.net/i.png" },
            "file": { "id": "f-".to_string() + slug, "version": "1.20.1", "fileName": name, "size": 42, "sha1": "a".repeat(40), "sha512": "b".repeat(128) },
            "download": { "url": "https://api.millida.net/v2/catalog/files/f-".to_string() + slug + "/download", "host": "millida" },
            "installPath": "mods",
        })
    }

    #[test]
    fn api_plan_shape_is_understood() {
        let v = json!({
            "schema": "millida.install-plan/1",
            "files": [api_file("iris", "root", "iris.jar"), api_file("sodium", "dependency", "sodium.jar")],
            "optional": [{ "title": "Mod Menu", "file": api_file("modmenu", "dependency", "modmenu.jar") }],
            "missing": [{ "title": "Fabric Language Kotlin", "reason": "no-version" }],
        });
        let p = parse_plan(&v, "iris", "mod").expect("план бэкенда разбирается");
        assert_eq!(p.files.len(), 3);
        assert_eq!(p.files[0].role, Role::Primary);
        assert_eq!(p.files[0].slug, "iris");
        assert_eq!(p.files[1].role, Role::Required);
        assert_eq!(p.files[1].kind, "mod");
        assert_eq!(p.files[1].size, 42);
        assert_eq!(p.files[1].file_id, "f-sodium");
        assert_eq!(p.files[1].sha512, "b".repeat(128));
        assert_eq!(p.files[2].role, Role::Optional);
        assert_eq!(p.files[2].slug, "modmenu");
        assert_eq!(p.missing, vec!["Fabric Language Kotlin".to_string()]);
    }

    /// Необязательная зависимость без подходящей версии — ставить нечего.
    #[test]
    fn optional_without_a_file_is_skipped() {
        let v = json!({
            "files": [api_file("iris", "root", "iris.jar")],
            "optional": [{ "title": "Нет версии", "file": null }],
        });
        let p = parse_plan(&v, "iris", "mod").unwrap();
        assert_eq!(p.files.len(), 1);
    }

    /// Папка установки решает вид материала, когда раздела у зависимости нет.
    #[test]
    fn install_path_decides_the_kind() {
        let mut shader = api_file("complementary", "dependency", "comp.zip");
        shader["installPath"] = json!("shaderpacks");
        shader["project"]["section"] = Value::Null;
        let v = json!({ "files": [api_file("iris", "root", "iris.jar"), shader] });
        let p = parse_plan(&v, "iris", "mod").unwrap();
        assert_eq!(p.files[1].kind, "shader");
    }

    /// Сервер может пометить сам материал как required — это всё равно он.
    #[test]
    fn primary_may_come_as_required() {
        let v = json!({ "files": [file("iris", "required", "iris.jar"), file("sodium", "required", "sodium.jar")] });
        let p = parse_plan(&v, "iris", "mod").unwrap();
        assert_eq!(p.files[0].role, Role::Primary);
        assert_eq!(p.files[1].role, Role::Required);
    }

    /// Любой плохой файл роняет план целиком, а не выкидывается молча.
    #[test]
    fn a_bad_file_rejects_the_whole_plan() {
        let base = || vec![file("iris", "primary", "iris.jar")];
        let mut path_escape = base();
        path_escape.push(file("x", "required", "../../evil.jar"));
        let mut author_page = base();
        author_page.push(json!({ "slug": "x", "role": "required", "fileName": "x.jar", "url": "https://modrinth.com/mod/x", "sha1": "a".repeat(40) }));
        let mut no_hash = base();
        no_hash.push(json!({ "slug": "x", "role": "required", "fileName": "x.jar", "url": "https://cdn.millida.trade/x.jar" }));
        let mut local = base();
        local.push(json!({ "slug": "x", "role": "required", "fileName": "x.jar", "url": "https://127.0.0.1/x.jar", "sha1": "a".repeat(40) }));
        let mut not_jar = base();
        not_jar.push(file("x", "required", "x.exe"));
        let mut dup = base();
        dup.push(file("y", "required", "IRIS.jar"));
        for (why, files) in [
            ("выход из папки модов", path_escape),
            ("страница автора вместо файла", author_page),
            ("файл без суммы", no_hash),
            ("локальная сеть", local),
            ("не jar в папке модов", not_jar),
            ("два файла с одним именем", dup),
        ] {
            assert!(parse_plan(&json!({ "files": files }), "iris", "mod").is_err(), "{why}: план обязан отклоняться");
        }
        assert!(parse_plan(&json!({ "files": [file("sodium", "required", "s.jar")] }), "iris", "mod").is_err(), "без самого материала план не план");
        assert!(parse_plan(&json!({}), "iris", "mod").is_err());
    }

    /// Зависимость, которая уже стоит (по id каталога или тем же файлом), не качаем;
    /// сам материал качаем всегда.
    #[test]
    fn installed_dependency_is_skipped() {
        let v = json!({ "files": [file("iris", "primary", "iris.jar"), file("sodium", "required", "sodium.jar")] });
        let p = parse_plan(&v, "iris", "mod").unwrap();
        let dir = std::env::temp_dir().join("millida-plan-test-none");
        let by_id = vec![ContentEntry { kind: "mod".into(), file_name: "sodium-old.jar".into(), project_id: "millida:sodium".into(), ..Default::default() }];
        let by_sha = vec![ContentEntry { kind: "mod".into(), file_name: "s.jar".into(), project_id: "AANobbMI".into(), sha1: "A".repeat(40), ..Default::default() }];
        assert!(already_there(&p.files[1], &by_id, &dir));
        assert!(already_there(&p.files[1], &by_sha, &dir), "тот же файл с Modrinth — тоже стоит");
        assert!(!already_there(&p.files[1], &[], &dir));
        assert!(!already_there(&p.files[0], &by_id, &dir), "сам материал ставим всегда");
    }

    /// Ресурспак-зависимость идёт в свою папку, неизвестный раздел — отказ.
    #[test]
    fn dependency_kind_comes_from_its_section() {
        let mut dep = file("pack", "required", "pack.zip");
        dep["section"] = json!("texture-packs");
        let p = parse_plan(&json!({ "files": [file("iris", "primary", "iris.jar"), dep] }), "iris", "mod").unwrap();
        assert_eq!(p.files[1].kind, "resourcepack");
        let mut world = file("map", "required", "map.zip");
        world["section"] = json!("maps");
        assert!(parse_plan(&json!({ "files": [file("iris", "primary", "iris.jar"), world] }), "iris", "mod").is_err());
    }
}
