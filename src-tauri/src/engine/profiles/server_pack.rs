// The .mrpack a Millida hosting server's owner uploaded for players: downloaded from api.millida.net by the server id,
// kept only when its sha512 and size match what the server's manifest published, then installed like any .mrpack file.
use crate::engine::*;
use tauri::AppHandle;

/// Bigger than any client pack: an archive this size carries a world, not mods.
const MAX_SERVER_PACK_BYTES: u64 = 2 * 1024 * 1024 * 1024;

pub(crate) fn server_id_ok(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub(crate) fn sha512_hex_ok(v: &str) -> bool {
    v.len() == 128 && v.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The webview names the server and the digest it read from the manifest; the
/// address is built here, so it can only ever point at the Millida API.
pub async fn install_server_pack_file(app: AppHandle, server_id: String, sha512: String, size: u64, name: String) -> Result<Profile, String> {
    if !server_id_ok(&server_id) {
        return Err("Некорректный сервер".into());
    }
    if !sha512_hex_ok(&sha512) {
        return Err("У сборки сервера нет контрольной суммы — ставить её нельзя".into());
    }
    if size == 0 || size > MAX_SERVER_PACK_BYTES {
        return Err("Размер сборки сервера не сходится".into());
    }
    let url = format!("{}/hosting/client/pack/{}/file", MILLIDA_API, server_id);
    let work = hashed_name(&["srvpack", &server_id, &sha512]);
    let tmp = data_dir().join("tmp").join(format!("{}.mrpack", work));
    if let Some(dir) = tmp.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // The owner's file from the hosting server, checked against the sha512 and size the manifest published.
    let got = download_checked(&url, &tmp, Some(Sum::Sha512(&sha512.to_ascii_lowercase())), Some(size)).await;
    if let Err(e) = got {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Сборка сервера не скачалась: {}", e));
    }
    let hint: String = name.chars().filter(|c| !c.is_control()).take(48).collect();
    let hint = if hint.trim().is_empty() { "Сборка сервера".to_string() } else { hint };
    let res = import_pack_archive(&app, None, &tmp, &hint, None, &format!("srvpack-{}", work)).await;
    // Deletes our own temporary copy in data/tmp; its name is a hash of the server and the digest.
    let _ = std::fs::remove_file(&tmp);
    res
}

/// A single mod the owner put on the server; larger means assets, not code.
const MAX_SERVER_MOD_BYTES: u64 = 64 * 1024 * 1024;

/// The pass the API issued with the mod list: `<unix seconds>.<base64url mac>`, nothing that could alter the query.
pub(crate) fn mod_ticket_ok(t: &str) -> bool {
    let Some((exp, mac)) = t.split_once('.') else { return false };
    (1..=12).contains(&exp.len())
        && exp.bytes().all(|b| b.is_ascii_digit())
        && mac.len() == 43
        && mac.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub(crate) fn server_mod_path(file_name: &str) -> Result<String, String> {
    if !file_name.to_ascii_lowercase().ends_with(".jar") {
        return Err("Это не файл мода".into());
    }
    super::share::shared_entry_path("mod", &format!("mods/{}", file_name)).map_err(|why| format!("Мод сервера не принят: {}", why))
}

/// One of the owner's own mods, which the player approved after seeing it
/// listed. The address is built here and can only point at the Millida API;
/// the file is kept only when its sha512 and size match what the player saw.
pub async fn install_server_mod_file(profile: String, server_id: String, sha512: String, size: u64, file_name: String, ticket: String) -> Result<String, String> {
    if !server_id_ok(&server_id) {
        return Err("Некорректный сервер".into());
    }
    if !mod_ticket_ok(&ticket) {
        return Err("Ссылка на мод устарела — зайди на сервер ещё раз".into());
    }
    if !sha512_hex_ok(&sha512) {
        return Err("У мода сервера нет контрольной суммы — ставить его нельзя".into());
    }
    if size == 0 || size > MAX_SERVER_MOD_BYTES {
        return Err("Размер мода сервера не сходится".into());
    }
    let rel = server_mod_path(&file_name)?;
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let dest = safe_join(&profile_dir(&profile), &rel).map_err(|e| format!("Небезопасный путь мода: {}", e))?;
    let want = sha512.to_ascii_lowercase();
    let url = format!("{}/hosting/client/mods/{}/file/{}?t={}", MILLIDA_API, server_id, want, ticket);
    let tmp = data_dir().join("tmp").join(format!("{}.jar", hashed_name(&["srvmod", &server_id, &want])));
    if let Some(dir) = tmp.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    if let Err(e) = download_checked(&url, &tmp, Some(Sum::Sha512(&want)), Some(size)).await {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Мод {} не скачался: {}", file_name, e));
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    // data/tmp and the game folder may sit on different drives, where a rename fails.
    let placed = std::fs::rename(&tmp, &dest).or_else(|_| std::fs::copy(&tmp, &dest).map(|_| ()));
    let _ = std::fs::remove_file(&tmp);
    placed.map_err(|e| format!("Мод {} не записался в сборку: {}", file_name, e))?;
    Ok(file_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Values from the webview -> accepted. The id lands in a URL path and the
    /// digest is the only proof the file is the owner's.
    #[test]
    fn only_a_plain_id_and_a_full_digest_pass() {
        let table: [(&str, bool, &str); 4] = [
            ("a1b2-c3_d4", true, "an ordinary server id"),
            ("../admin", false, "a path in the id would leave the route"),
            ("", false, "an empty id"),
            ("x?y=1", false, "a query in the id"),
        ];
        for (id, ok, why) in table {
            assert_eq!(server_id_ok(id), ok, "{why}");
        }
        assert!(sha512_hex_ok(&"ab".repeat(64)), "a full sha512");
        assert!(!sha512_hex_ok(&"ab".repeat(20)), "a sha1-length digest is not enough");
        assert!(!sha512_hex_ok(&"zz".repeat(64)), "not hex");
    }

    /// Passes come from the API and land in a URL query: anything beyond digits and base64url is refused.
    #[test]
    fn only_a_plain_pass_reaches_the_query() {
        let mac = "A".repeat(43);
        let table: [(String, bool, &str); 5] = [
            (format!("1763380000.{mac}"), true, "an ordinary pass"),
            (format!("1763380000.{mac}&x=1"), false, "an extra query parameter"),
            (format!("abc.{mac}"), false, "a non-numeric expiry"),
            ("1763380000.short".to_string(), false, "a truncated signature"),
            (String::new(), false, "no pass"),
        ];
        for (t, ok, why) in table {
            assert_eq!(mod_ticket_ok(&t), ok, "{why}");
        }
    }

    /// File names come from the API -> where the jar may land. Anything but a
    /// plain jar name in mods/ would let a server write elsewhere in the build.
    #[test]
    fn a_server_mod_lands_only_in_mods_as_a_plain_jar() {
        let table: [(&str, bool, &str); 6] = [
            ("sodium-0.6.jar", true, "an ordinary mod"),
            ("../options.txt", false, "a path out of mods/"),
            ("sub/x.jar", false, "a nested path"),
            ("readme.txt", false, "not a jar"),
            ("..\\evil.jar", false, "a Windows path separator"),
            ("", false, "an empty name"),
        ];
        for (name, ok, why) in table {
            assert_eq!(server_mod_path(name).is_ok(), ok, "{why}");
        }
    }
}
