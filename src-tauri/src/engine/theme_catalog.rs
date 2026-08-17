use std::path::PathBuf;

use serde_json::Value;

use crate::engine::{
    download_checked, install_theme_from, millida_api, millida_api_auth, millida_token,
    millida_upload_auth, pack_theme, themes_dir, InstalledTheme, Sum, MILLIDA_API,
};

const CATALOG: &str = "/launcher/themes";
const SORTS: &[&str] = &["popular", "new", "liked"];
const BASES: &[&str] = &["dark", "light", "any"];
const MAX_QUERY: usize = 60;
const MAX_CHANGELOG: usize = 300;
const MAX_LIMIT: u32 = 60;
const MAX_INSTALL_ID: usize = 64;

/// What the gallery may ask for. Everything is re-checked here: the webview
/// hands over search words, never a path or a URL.
#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub base: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

fn slug_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 32
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !s.starts_with('-')
}

fn slug_or_err(slug: &str) -> Result<&str, String> {
    if slug_ok(slug) {
        Ok(slug)
    } else {
        Err("некорректный идентификатор темы".into())
    }
}

/// Builds the query string from vetted values only, so a stray character in the
/// search box cannot grow another parameter.
pub(crate) fn list_path(query: &CatalogQuery) -> String {
    let mut pairs = url::form_urlencoded::Serializer::new(String::new());
    let words: String = query
        .q
        .as_deref()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_QUERY)
        .collect();
    let words = words.trim();
    if !words.is_empty() {
        pairs.append_pair("q", words);
    }
    if let Some(sort) = query.sort.as_deref().filter(|s| SORTS.contains(s)) {
        pairs.append_pair("sort", sort);
    }
    if let Some(base) = query.base.as_deref().filter(|b| BASES.contains(b)) {
        pairs.append_pair("base", base);
    }
    pairs.append_pair("limit", &query.limit.unwrap_or(24).clamp(1, MAX_LIMIT).to_string());
    pairs.append_pair("offset", &query.offset.unwrap_or(0).min(5000).to_string());
    format!("{CATALOG}?{}", pairs.finish())
}

/// Signed-in players see their own likes and their own themes marked, so the
/// call carries the session when there is one — and stays available when there
/// is not.
async fn get(path: String) -> Result<Value, String> {
    if millida_token().is_none() {
        return millida_api(path.clone(), "GET".into(), None, None).await;
    }
    match millida_api_auth(path.clone(), "GET".into(), None).await {
        // A session that ended must not take the catalogue with it: the listing
        // is public, only the "liked by me" marks need an account.
        Err(e) if e == "unauthorized" => millida_api(path, "GET".into(), None, None).await,
        other => other,
    }
}

pub async fn catalog_list(query: CatalogQuery) -> Result<Value, String> {
    get(list_path(&query)).await
}

pub async fn catalog_detail(slug: &str) -> Result<Value, String> {
    get(format!("{CATALOG}/{}", slug_or_err(slug)?)).await
}

pub async fn catalog_mine() -> Result<Value, String> {
    millida_api_auth(format!("{CATALOG}/mine"), "GET".into(), None).await
}

pub async fn catalog_like(slug: &str) -> Result<Value, String> {
    millida_api_auth(format!("{CATALOG}/{}/like", slug_or_err(slug)?), "POST".into(), None).await
}

/// Tells the catalogue the theme actually landed on disk. The counter it keeps
/// is per launcher installation, so the identifier travels with the report:
/// deleting a theme and fetching it again must not inflate anyone's numbers.
pub async fn catalog_report_install(slug: &str, install_id: &str) -> Result<Value, String> {
    let slug = slug_or_err(slug)?.to_string();
    let id: String = install_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(MAX_INSTALL_ID)
        .collect();
    let body = serde_json::json!({ "installId": id });
    millida_api(format!("{CATALOG}/{slug}/installed"), "POST".into(), Some(body), None).await
}

pub async fn catalog_unpublish(slug: &str) -> Result<Value, String> {
    millida_api_auth(format!("{CATALOG}/{}", slug_or_err(slug)?), "DELETE".into(), None).await
}

/// Removes the downloaded archive on every exit, including the failures: the
/// themes folder is scanned for packs and a leftover zip has no business there.
struct Temp(PathBuf);

impl Drop for Temp {
    fn drop(&mut self) {
        std::fs::remove_file(&self.0).ok();
    }
}

fn sha256_ok(sum: &str) -> bool {
    sum.len() == 64 && sum.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Installs a catalogue theme. The address is built here from the slug rather
/// than taken from the webview or from the catalogue response, and the archive
/// is accepted only when its digest matches the one the catalogue published —
/// the file itself is served by a CDN and must not be trusted on its own.
pub async fn catalog_install(slug: String) -> Result<InstalledTheme, String> {
    let slug = slug_or_err(&slug)?.to_string();
    let meta = catalog_detail(&slug).await?;
    let sha = meta.get("sha256").and_then(Value::as_str).unwrap_or_default().to_ascii_lowercase();
    if !sha256_ok(&sha) {
        return Err("каталог не сообщил контрольную сумму темы".into());
    }
    let size = meta.get("sizeBytes").and_then(Value::as_u64).filter(|n| *n > 0);

    let dir = themes_dir().join(".download");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("{slug}.zip"));
    let temp = Temp(dest.clone());
    // A stale file from an interrupted install would be reused by size alone.
    std::fs::remove_file(&dest).ok();

    let url = format!("{MILLIDA_API}{CATALOG}/{slug}/download");
    download_checked(&url, &dest, Some(Sum::Sha256(&sha)), size).await?;

    let path = temp.0.clone();
    let installed = tauri::async_runtime::spawn_blocking(move || install_theme_from(&path))
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
    if installed.manifest.id != slug {
        // The digest matched, so this is the catalogue's own bookkeeping being
        // wrong, not a swapped file — but the folder on disk is now named after
        // the manifest and the card the player pressed points elsewhere.
        return Err("тема в каталоге записана под другим идентификатором".into());
    }
    Ok(installed)
}

/// Publishes an installed theme. The archive is built by the core from the
/// theme folder, so the webview cannot upload an arbitrary file.
pub async fn catalog_publish(id: String, changelog: Option<String>) -> Result<Value, String> {
    let slug = slug_or_err(&id)?.to_string();
    let (manifest, bytes) = tauri::async_runtime::spawn_blocking(move || pack_theme(&slug))
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))??;
    let note: String = changelog
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(MAX_CHANGELOG)
        .collect();
    let fields = if note.trim().is_empty() {
        Vec::new()
    } else {
        vec![("changelog".to_string(), note.trim().to_string())]
    };
    millida_upload_auth(CATALOG.to_string(), format!("{}.mtheme", manifest.id), "application/zip", bytes, fields).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// query -> path. The search box is the one place a player types free text
    /// that reaches the API, so anything but vetted pairs must not survive.
    #[test]
    fn list_path_only_carries_vetted_parameters() {
        let path = list_path(&CatalogQuery {
            q: Some("тёмная&limit=999".into()),
            sort: Some("new".into()),
            base: Some("dark".into()),
            limit: Some(1000),
            offset: Some(9999),
        });
        assert!(
            path.starts_with("/launcher/themes?"),
            "the path must stay inside the catalogue endpoint, got {path}",
        );
        assert!(
            !path.contains("&limit=999&"),
            "the search words are a value, not more parameters: {path}",
        );
        assert!(path.contains("sort=new") && path.contains("base=dark"), "{path}");
        assert!(
            path.contains("limit=60") && path.contains("offset=5000"),
            "limit and offset are clamped to what the API accepts, got {path}",
        );

        let plain = list_path(&CatalogQuery { sort: Some("rating".into()), ..Default::default() });
        assert!(!plain.contains("sort="), "an unknown sort is dropped, not forwarded: {plain}");
    }

    /// slug -> verdict. The slug becomes a folder name on disk and a path
    /// segment in the download URL.
    #[test]
    fn only_slug_ids_reach_the_catalogue() {
        for id in ["mario", "my-theme-2"] {
            assert!(slug_ok(id), "«{id}» is a plain slug");
        }
        for id in ["", "../evil", "Mario", "my theme", "-lead", "a/b"] {
            assert!(
                !slug_ok(id),
                "«{id}» must be rejected: it is used as a folder name under themes/ and as a path \
                 segment of the download address",
            );
        }
    }

    #[test]
    fn digest_must_be_a_full_sha256() {
        assert!(sha256_ok(&"a".repeat(64)));
        assert!(!sha256_ok(&"a".repeat(63)), "a short digest verifies almost nothing");
        assert!(!sha256_ok(&"z".repeat(64)), "non-hex is not a digest at all");
    }
}
