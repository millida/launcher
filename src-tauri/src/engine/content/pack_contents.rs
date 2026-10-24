// What a modpack holds, before it is installed: mods, resource packs and shader packs, the loader and the weight.
// A Modrinth pack: downloads the .mrpack from cdn.modrinth.com (checked by the sha512 Modrinth published), reads only modrinth.index.json, and deletes the file.
// A Millida catalogue pack: asks api.millida.net for the archive's table of contents (names and sizes only), nothing is downloaded.
use super::catalog_pack::client_file;
use super::pack_delta::parse_index;
use crate::engine::*;
use serde_json::Value;

/// A pack this heavy carries its world or assets inside: reading its list is
/// not worth downloading it twice.
const MAX_PREVIEW_BYTES: u64 = 64 * 1024 * 1024;

#[derive(serde::Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PackEntry {
    pub name: String,
    pub size: u64,
}

#[derive(serde::Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PackContents {
    pub game: String,
    pub loader: String,
    pub loader_version: String,
    pub mods: Vec<PackEntry>,
    pub resourcepacks: Vec<PackEntry>,
    pub shaderpacks: Vec<PackEntry>,
    /// Files the archive carries itself (configs, worlds, own jars).
    pub bundled: u32,
    /// Everything the install downloads: the listed files and the archive.
    pub total_bytes: u64,
}

fn loader_of(deps: &Value) -> (String, String) {
    for (key, id) in [("neoforge", "neoforge"), ("forge", "forge"), ("quilt-loader", "quilt"), ("fabric-loader", "fabric")] {
        if let Some(v) = deps.get(key).and_then(Value::as_str) {
            return (id.to_string(), v.to_string());
        }
    }
    ("vanilla".into(), String::new())
}

/// Puts a file into its folder's list. Paths come from the pack, so only a
/// plain name directly inside one of the three known folders is listed.
fn place(out: &mut PackContents, path: &str, size: u64) -> bool {
    let Some((dir, name)) = path.split_once('/') else { return false };
    if name.is_empty() || name.contains('/') {
        return false;
    }
    let entry = PackEntry { name: name.to_string(), size };
    match dir {
        "mods" => out.mods.push(entry),
        "resourcepacks" => out.resourcepacks.push(entry),
        "shaderpacks" => out.shaderpacks.push(entry),
        _ => return false,
    }
    true
}

fn sorted(mut out: PackContents) -> PackContents {
    for list in [&mut out.mods, &mut out.resourcepacks, &mut out.shaderpacks] {
        list.sort_by_key(|e| e.name.to_lowercase());
    }
    out
}

/// The index of a pack -> its contents by folder.
pub(crate) fn contents_from_index(idx: &Value, archive_bytes: u64, bundled: u32) -> PackContents {
    let (loader, loader_version) = loader_of(&idx["dependencies"]);
    let mut out = PackContents {
        game: idx["dependencies"]["minecraft"].as_str().unwrap_or("").to_string(),
        loader,
        loader_version,
        bundled,
        total_bytes: archive_bytes,
        ..Default::default()
    };
    for f in idx["files"].as_array().into_iter().flatten() {
        if f["env"]["client"].as_str() == Some("unsupported") {
            continue;
        }
        let path = f["path"].as_str().unwrap_or("");
        let size = f["fileSize"].as_u64().unwrap_or(0);
        if path.split('/').count() > 2 {
            continue;
        }
        out.total_bytes += size;
        place(&mut out, path, size);
    }
    sorted(out)
}

/// A catalogue archive is the game folder itself: what is not in the three
/// folders (configs, worlds, scripts) counts as bundled.
pub(crate) fn contents_from_archive(view: &Value, files: &[(String, u64)], archive_bytes: u64) -> PackContents {
    let text = |k: &str| view[k].as_str().unwrap_or("").to_string();
    let mut out = PackContents { game: text("game"), loader: text("loader").to_lowercase(), loader_version: text("loaderVersion"), total_bytes: archive_bytes, ..Default::default() };
    for (path, size) in files {
        if !place(&mut out, path, *size) {
            out.bundled += 1;
        }
    }
    sorted(out)
}

fn file_id_ok(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Contents of a Millida catalogue pack from the table of contents the catalogue
/// serves for in-place updates. It is given past the same access check as the
/// download, so it needs a Millida sign-in.
pub async fn catalog_pack_contents(slug: String) -> Result<PackContents, String> {
    if !catalog_slug_ok(&slug) {
        return Err("Некорректный адрес сборки".into());
    }
    // Request for the modpack card to api.millida.net. The Millida token is added if the user is logged in.
    let view = millida_api(format!("/catalog/packs/{}", slug), "GET".into(), None, millida_token()).await?;
    let (file_id, size, _) = client_file(&view)?;
    if !file_id_ok(&file_id) {
        return Err("Ответ сервера не содержит файла сборки".into());
    }
    let answer = match millida_api_auth(format!("/catalog/packs/files/{}/index", file_id), "GET".into(), None).await {
        Ok(a) => a,
        Err(e) if e == "http 401" => return Err("Состав сборки виден после входа в аккаунт Millida".into()),
        Err(e) => return Err(e),
    };
    if answer["entries"].is_null() {
        return Err("Сервер не отдал состав этой сборки — он виден после установки".into());
    }
    let index = parse_index(&answer, size)?;
    let files: Vec<(String, u64)> = index.entries.iter().filter(|e| !e.dir).map(|e| (e.rel.clone(), e.size)).collect();
    Ok(contents_from_archive(&view, &files, size))
}

fn read_index(path: &std::path::Path) -> Result<(Value, u32), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|_| "Архив сборки повреждён".to_string())?;
    let bundled = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| (f.name().to_string(), f.is_dir())))
        .filter(|(n, dir)| !dir && (n.starts_with("overrides/") || n.starts_with("client-overrides/")))
        .count() as u32;
    let mut entry = zip.by_name("modrinth.index.json").map_err(|_| "В архиве сборки нет modrinth.index.json".to_string())?;
    let mut raw = String::new();
    std::io::Read::read_to_string(&mut entry, &mut raw).map_err(|e| e.to_string())?;
    let idx: Value = serde_json::from_str(&raw).map_err(|_| "Список файлов сборки не читается".to_string())?;
    Ok((idx, bundled))
}

/// Contents of a Modrinth modpack version (the newest with a .mrpack when none
/// is named), for the «Состав» tab of its page.
pub async fn modpack_contents(slug: String, version_id: Option<String>) -> Result<PackContents, String> {
    check_modpack_slug(&slug)?;
    if version_id.as_deref().is_some_and(|v| !modrinth_id_ok(v)) {
        return Err("Некорректная версия сборки".into());
    }
    // GET to api.modrinth.com: version list of a modpack. No tokens, no data about you.
    let versions = get_json(&format!("https://api.modrinth.com/v2/project/{}/version", slug)).await?;
    let is_mrpack = |f: &Value| f["filename"].as_str().unwrap_or("").ends_with(".mrpack");
    let ver = versions
        .as_array()
        .and_then(|a| match &version_id {
            Some(id) => a.iter().find(|v| v["id"].as_str() == Some(id.as_str())),
            None => a.iter().find(|v| v["files"].as_array().is_some_and(|fs| fs.iter().any(is_mrpack))),
        })
        .ok_or("Версия сборки не найдена")?;
    let file = ver["files"].as_array().and_then(|fs| fs.iter().find(|f| is_mrpack(f))).ok_or("Файл сборки не найден")?;
    let url = file["url"].as_str().unwrap_or("");
    if !pack_download_allowed(url) {
        return Err("Файл сборки лежит на чужом адресе".into());
    }
    let sha512 = file["hashes"]["sha512"].as_str().unwrap_or("");
    if sha512.len() != 128 || !sha512.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("У сборки нет контрольной суммы".into());
    }
    let size = file["size"].as_u64().unwrap_or(0);
    if size > MAX_PREVIEW_BYTES {
        return Err("Сборка слишком большая для предпросмотра — состав видно после установки".into());
    }
    let vid = ver["id"].as_str().unwrap_or("");
    let tmp = data_dir().join("tmp").join(format!("{}.mrpack", hashed_name(&["contents", &slug, vid])));
    if let Some(dir) = tmp.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    download_checked(url, &tmp, Some(Sum::Sha512(sha512)), Some(size)).await?;
    let path = tmp.clone();
    let read = tokio::task::spawn_blocking(move || read_index(&path)).await.map_err(|e| e.to_string());
    // Deletes our own temporary copy in data/tmp; its name is a hash, nothing else matches it.
    let _ = std::fs::remove_file(&tmp);
    let (idx, bundled) = read??;
    Ok(contents_from_index(&idx, size, bundled))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// index -> what the tab lists. Paths come from a stranger's archive: only
    /// a plain name inside a known folder is shown, server-only files are not.
    #[test]
    fn the_tab_lists_only_client_files_by_folder() {
        let idx = serde_json::json!({
            "dependencies": { "minecraft": "1.20.1", "fabric-loader": "0.15.11" },
            "files": [
                { "path": "mods/sodium.jar", "fileSize": 100, "env": { "client": "required" } },
                { "path": "mods/server-only.jar", "fileSize": 7, "env": { "client": "unsupported" } },
                { "path": "resourcepacks/Faithful.zip", "fileSize": 20 },
                { "path": "shaderpacks/BSL.zip", "fileSize": 30 },
                { "path": "mods/nested/x.jar", "fileSize": 5 },
                { "path": "config/x.toml", "fileSize": 1 }
            ]
        });
        let c = contents_from_index(&idx, 1000, 3);
        assert_eq!((c.game.as_str(), c.loader.as_str(), c.loader_version.as_str()), ("1.20.1", "fabric", "0.15.11"), "version and loader come from dependencies");
        assert_eq!(c.mods, vec![PackEntry { name: "sodium.jar".into(), size: 100 }], "server-only and nested files are not shown as mods");
        assert_eq!(c.resourcepacks.len(), 1, "resource packs have their own list");
        assert_eq!(c.shaderpacks.len(), 1, "shader packs have their own list");
        assert_eq!(c.total_bytes, 1000 + 100 + 20 + 30 + 1, "the weight counts the archive and every client file it downloads");
        assert_eq!(c.bundled, 3, "files inside the archive are counted, not listed");
    }

    /// A catalogue archive: the three folders are listed, the rest is bundled.
    #[test]
    fn a_catalogue_archive_lists_its_folders_and_counts_the_rest() {
        let view = serde_json::json!({ "game": "1.20.1", "loader": "Forge", "loaderVersion": "47.2.0" });
        let files: Vec<(String, u64)> = [("mods/jei.jar", 10), ("config/jei.toml", 1), ("shaderpacks/BSL.zip", 5), ("saves/World/level.dat", 2), ("mods/sub/x.jar", 3)]
            .iter()
            .map(|(p, s)| (p.to_string(), *s))
            .collect();
        let c = contents_from_archive(&view, &files, 500);
        assert_eq!(c.loader, "forge", "the loader is shown by its id");
        assert_eq!(c.mods.len(), 1, "a nested jar is not a mod the game loads");
        assert_eq!(c.shaderpacks.len(), 1);
        assert_eq!(c.bundled, 3, "configs, worlds and nested files are bundled");
        assert_eq!(c.total_bytes, 500, "the weight is the archive the install downloads");
    }
}
