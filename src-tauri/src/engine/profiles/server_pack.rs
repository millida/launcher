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
}
