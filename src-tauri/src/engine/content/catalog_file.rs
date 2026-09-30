use crate::engine::*;
use serde_json::Value;
use tauri::AppHandle;

// A file of the Millida catalogue (a mod, resource pack, shader, data pack or
// map uploaded by an author, free or paid) put into a build.
//
// The webview names the build, the item and the file id; the address is asked
// for here. A paid file comes from `POST /catalog/files/:id/link`, which checks
// the purchase on the server with the token only the core holds. A free one
// may also come from the public counted address when nobody is signed in.

const KINDS: [&str; 5] = ["mod", "resourcepack", "shader", "datapack", "world"];

/// Hosts a signed or mirrored catalogue file may be served from. The answer is
/// ours, but it is still an address the core writes into a game folder from.
const FILE_HOSTS: [&str; 5] = ["millida.net", "millida.trade", "cdn.modrinth.com", "edge.forgecdn.net", "mediafilez.forgecdn.net"];

pub(crate) fn catalog_file_url_allowed(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw) else { return false };
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    FILE_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{}", h)))
}

/// Same shape as the server's check (`FILE_ID` in catalog-purchase.controller).
pub(crate) fn catalog_file_id_ok(id: &str) -> bool {
    (10..=40).contains(&id.len()) && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn hex_ok(v: &str, len: usize) -> bool {
    v.len() == len && v.chars().all(|c| c.is_ascii_hexdigit())
}

pub async fn install_catalog_file(
    app: AppHandle,
    profile: String,
    kind: String,
    slug: String,
    file_id: String,
    title: String,
    sha1: Option<String>,
) -> Result<ContentInstall, String> {
    if !KINDS.contains(&kind.as_str()) {
        return Err("Такой материал в сборку не ставится".into());
    }
    if !catalog_slug_ok(&slug) || !catalog_file_id_ok(&file_id) {
        return Err("Некорректный материал каталога".into());
    }
    let label = if title.trim().is_empty() { slug.clone() } else { title.chars().take(80).collect() };
    let job = Job::start(job_key_content("millida", &profile, &kind, &slug), label.clone())?;
    let res = install_catalog_file_job(&app, &job, &profile, &kind, &slug, &file_id, &label, sha1).await;
    job.finish(&app, res)
}

#[allow(clippy::too_many_arguments)]
async fn install_catalog_file_job(
    app: &AppHandle,
    job: &Job,
    profile: &str,
    kind: &str,
    slug: &str,
    file_id: &str,
    title: &str,
    sha1: Option<String>,
) -> Result<ContentInstall, String> {
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    job.emit(app, 5.0, "Получаем ссылку…");
    let signed_in = millida_token().is_some_and(|t| !t.is_empty());
    let (url, name, size, sha512) = if signed_in {
        let link: Value =
            millida_api_auth(format!("/catalog/files/{}/link", file_id), "POST".into(), Some(serde_json::json!({}))).await?;
        let url = link["url"].as_str().unwrap_or("").to_string();
        if !catalog_file_url_allowed(&url) {
            return Err("Сервер вернул ссылку на чужой адрес — установка остановлена".into());
        }
        (
            url,
            link["fileName"].as_str().unwrap_or("").to_string(),
            link["size"].as_u64().filter(|s| *s > 0),
            link["sha512"].as_str().filter(|s| hex_ok(s, 128)).map(str::to_string),
        )
    } else {
        // Без входа — только бесплатный файл, счётным адресом каталога.
        (format!("{}/catalog/files/{}/download", MILLIDA_API, file_id), String::new(), None, None)
    };
    let fallback = format!("{}.{}", slug, if kind == "mod" { "jar" } else { "zip" });
    let fname = safe_file_name(if name.is_empty() { &fallback } else { &name })?;
    let ext = fname.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let exts: &[&str] = if kind == "world" { &["zip"] } else { content_exts(kind) };
    if !exts.contains(&ext.as_str()) {
        return Err("Файл такого типа в сборку не добавить".into());
    }
    let sha1 = sha1.filter(|s| hex_ok(s, 40)).map(|s| s.to_ascii_lowercase());
    let sum = match (&sha512, &sha1) {
        (Some(s), _) => Some(Sum::Sha512(s.as_str())),
        (None, Some(s)) => Some(Sum::Sha1(s.as_str())),
        _ => None,
    };
    job.rename(title);
    job.emit(app, 20.0, &format!("Скачиваем {}…", fname));
    job.check()?;

    let (file_name, file_size) = if kind == "world" {
        let tmp_dir = data_dir().join("tmp");
        std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
        let zip = tmp_dir.join(format!("millida-world-{}.zip", slug));
        let work = tmp_dir.join(format!("millida-world-{}", slug));
        let _temp = TempPaths(vec![zip.clone(), work.clone()]);
        download_checked_cancellable(&url, &zip, sum, size, Some(job.cancel_flag())).await?;
        job.check()?;
        job.emit(app, 75.0, "Переносим мир…");
        let saves = profile_dir(profile).join("saves");
        let folder = place_world_from_zip(&saves, &zip, &work, title)?;
        (folder, std::fs::metadata(&zip).map(|m| m.len()).unwrap_or(0))
    } else {
        let dir = profile_dir(profile).join(content_dir(kind));
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let dest = safe_child(&dir, &fname)?;
        download_checked_cancellable(&url, &dest, sum, size, Some(job.cancel_flag())).await?;
        (fname.clone(), std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0))
    };

    manifest_upsert(
        profile,
        ContentEntry {
            kind: kind.to_string(),
            file_name: file_name.clone(),
            project_id: format!("millida:{}", slug),
            version_id: file_id.to_string(),
            title: title.to_string(),
            // A signed address expires in minutes: «Починить» must not replay it.
            download_url: String::new(),
            sha1: sha1.unwrap_or_default(),
            sha512: sha512.unwrap_or_default(),
            file_size,
            ..Default::default()
        },
    );
    job.emit(app, 100.0, "Готово");
    Ok(ContentInstall { file: file_name, mismatch: String::new(), warning: String::new() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_our_hosts_and_https_pass() {
        assert!(catalog_file_url_allowed("https://garage.millida.net/a.jar?X-Amz=1"));
        assert!(catalog_file_url_allowed("https://cdn.millida.trade/catalog/x.zip"));
        assert!(catalog_file_url_allowed("https://cdn.modrinth.com/data/x.jar"));
        assert!(!catalog_file_url_allowed("http://garage.millida.net/a.jar"));
        assert!(!catalog_file_url_allowed("https://millida.net.evil.io/a.jar"));
        assert!(!catalog_file_url_allowed("https://evilmillida.net/a.jar"));
        assert!(!catalog_file_url_allowed("file:///etc/passwd"));
    }

    #[test]
    fn file_ids_match_the_server_rule() {
        assert!(catalog_file_id_ok("cm1abcdefghij"));
        assert!(!catalog_file_id_ok("short"));
        assert!(!catalog_file_id_ok("../../etc/passwd00"));
    }
}
