use crate::engine::*;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// On-disk library of skins and capes. Stored as files next to the rest of the
// launcher data rather than in webview storage, which has a small quota and
// fails silently when it is exceeded.

const MAX_ITEMS: usize = 24;
const MAX_BYTES: usize = 2_000_000;

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct TextureMeta {
    file: String,
    name: String,
    #[serde(default)]
    slim: bool,
    #[serde(default)]
    slim_manual: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TextureEntry {
    pub file: String,
    pub name: String,
    pub slim: bool,
    pub slim_manual: bool,
    pub data: String,
}

fn kind_dir(kind: &str) -> Result<PathBuf, String> {
    let sub = match kind {
        "skins" | "capes" => kind,
        other => return Err(format!("неизвестный вид текстуры: {}", other)),
    };
    Ok(data_dir().join("textures").join(sub))
}

fn index_path(kind: &str) -> Result<PathBuf, String> {
    Ok(kind_dir(kind)?.join("index.json"))
}

fn read_index(kind: &str) -> Vec<TextureMeta> {
    index_path(kind)
        .ok()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Vec<TextureMeta>>(&b).ok())
        .unwrap_or_default()
}

pub(super) fn as_data_url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn entry(dir: &std::path::Path, meta: &TextureMeta) -> Option<TextureEntry> {
    let bytes = std::fs::read(dir.join(&meta.file)).ok()?;
    Some(TextureEntry {
        file: meta.file.clone(),
        name: meta.name.clone(),
        slim: meta.slim,
        slim_manual: meta.slim_manual,
        data: as_data_url(&bytes),
    })
}

/// The index only defines ordering; files on disk win, so a broken index.json
/// cannot lose the library.
fn sync_index(kind: &str) -> Result<Vec<TextureMeta>, String> {
    let dir = kind_dir(kind)?;
    let mut metas: Vec<TextureMeta> = read_index(kind)
        .into_iter()
        .filter(|m| dir.join(&m.file).is_file())
        .collect();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.to_lowercase().ends_with(".png") || metas.iter().any(|m| m.file == name) {
                continue;
            }
            metas.push(TextureMeta {
                name: name.trim_end_matches(".png").to_string(),
                file: name,
                ..TextureMeta::default()
            });
        }
    }
    Ok(metas)
}

fn store(kind: &str, metas: &[TextureMeta]) -> Result<Vec<TextureEntry>, String> {
    let dir = kind_dir(kind)?;
    write_json_atomic(&index_path(kind)?, &metas)?;
    Ok(metas.iter().filter_map(|m| entry(&dir, m)).collect())
}

pub fn list_textures(kind: &str) -> Result<Vec<TextureEntry>, String> {
    let metas = sync_index(kind)?;
    if metas.is_empty() {
        return Ok(vec![]);
    }
    store(kind, &metas)
}

fn file_stem(name: &str) -> String {
    let base = name.trim().trim_end_matches(".png").trim_end_matches(".PNG");
    let safe: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let safe = safe.trim_matches('-').to_string();
    if safe.is_empty() { "texture".into() } else { safe.chars().take(40).collect() }
}

pub fn save_texture(kind: &str, name: &str, data: &str, slim: bool) -> Result<Vec<TextureEntry>, String> {
    let raw = data.rsplit(',').next().unwrap_or(data);
    let bytes = b64_decode(raw).ok_or("битый PNG")?;
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("это не PNG".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err("PNG больше 2 МБ".into());
    }
    let dir = kind_dir(kind)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // content-hashed file name: no duplicates, and no collisions between
    // different textures sharing a display name
    let hash = sha256_hex(&bytes);
    let file = format!("{}-{}.png", file_stem(name), &hash[..8]);
    write_bytes_atomic(&dir.join(&file), &bytes)?;

    let title = name.trim().trim_end_matches(".png").trim();
    let mut metas = sync_index(kind)?;
    metas.retain(|m| m.file != file);
    metas.insert(
        0,
        TextureMeta {
            file,
            name: if title.is_empty() { "Скин".into() } else { title.to_string() },
            slim,
            slim_manual: false,
        },
    );
    for extra in metas.split_off(MAX_ITEMS.min(metas.len())) {
        let _ = std::fs::remove_file(dir.join(&extra.file));
    }
    store(kind, &metas)
}

/// Hosts the launcher itself links textures from: Mojang's texture CDN, the
/// head/skin proxy used across the UI, our own API and CDN, and the Modrinth CDN
/// that serves modpack assets.
const TEXTURE_HOSTS: &[&str] = &[
    "textures.minecraft.net",
    "mc-heads.net",
    "api.millida.net",
    "cdn.millida.net",
    "millida.net",
    "cdn.millida.trade",
    "millida.trade",
    "cdn.modrinth.com",
];

/// Our own domains; wardrobe textures live on `cdn.millida.trade`.
const TEXTURE_HOST_SUFFIXES: &[&str] = &[".millida.net", ".millida.trade"];

/// Names and literals that resolve inside the machine or the user's LAN. The
/// fetch runs in the core, outside the webview CSP, so without this check a URL
/// coming from the webview could read back local and intranet responses.
pub(crate) fn host_is_local(host: &str) -> bool {
    use std::net::IpAddr;
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => {
                let o = v4.octets();
                v4.is_loopback()
                    || v4.is_private()
                    || v4.is_link_local()
                    || v4.is_unspecified()
                    || v4.is_broadcast()
                    // carrier-grade NAT, 100.64.0.0/10
                    || (o[0] == 100 && (64..128).contains(&o[1]))
            }
            IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
                Some(v4) => host_is_local(&v4.to_string()),
                None => {
                    v6.is_loopback()
                        || v6.is_unspecified()
                        // unique local fc00::/7 and link-local fe80::/10
                        || (v6.segments()[0] & 0xfe00) == 0xfc00
                        || (v6.segments()[0] & 0xffc0) == 0xfe80
                }
            },
        };
    }
    host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local") || host.ends_with(".internal")
}

fn validate_texture_url(url: &str) -> Result<url::Url, String> {
    let raw = url.trim();
    if raw.contains(['\r', '\n', '\0']) {
        return Err("Некорректная ссылка".into());
    }
    let parsed = url::Url::parse(raw).map_err(|_| "Некорректная ссылка".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Нужна ссылка https на PNG".into());
    }
    let host = parsed.host_str().unwrap_or_default().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host_is_local(&host) {
        return Err("Скины из локальной сети лаунчер не забирает".into());
    }
    let allowed = TEXTURE_HOSTS.contains(&host.as_str())
        || TEXTURE_HOST_SUFFIXES.iter().any(|s| host.ends_with(s));
    if !allowed {
        return Err(format!("Скины берём только с проверенных сайтов: {}", TEXTURE_HOSTS.join(", ")));
    }
    Ok(parsed)
}

/// Import by URL. Fetched by the core because the webview CSP blocks arbitrary
/// hosts, and the response is validated as a reasonably sized PNG.
pub async fn fetch_texture(url: String) -> Result<String, String> {
    let parsed = validate_texture_url(&url)?;
    let res = client().get(parsed.as_str()).send().await.map_err(|e| e.to_string())?;
    // The shared client follows redirects, so an allowed host could still bounce
    // the request onto a local address; the body is only handed back when the
    // final URL passes the same check.
    validate_texture_url(res.url().as_str())?;
    if !res.status().is_success() {
        return Err(format!("Ссылка ответила {}", res.status().as_u16()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("PNG больше 2 МБ".into());
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("По ссылке не PNG".into());
    }
    Ok(as_data_url(&bytes))
}

pub fn delete_texture(kind: &str, file: &str) -> Result<Vec<TextureEntry>, String> {
    let dir = kind_dir(kind)?;
    let name = safe_file_name(file)?;
    let _ = std::fs::remove_file(dir.join(&name));
    let mut metas = sync_index(kind)?;
    metas.retain(|m| m.file != name);
    store(kind, &metas)
}

pub fn set_texture_slim(kind: &str, file: &str, slim: bool, manual: bool) -> Result<Vec<TextureEntry>, String> {
    let name = safe_file_name(file)?;
    let mut metas = sync_index(kind)?;
    for m in metas.iter_mut() {
        if m.file == name {
            m.slim = slim;
            m.slim_manual = manual || m.slim_manual;
        }
    }
    store(kind, &metas)
}

pub fn rename_texture(kind: &str, file: &str, name: &str) -> Result<Vec<TextureEntry>, String> {
    let target = safe_file_name(file)?;
    let title = name.trim();
    if title.is_empty() {
        return Err("пустое имя".into());
    }
    let mut metas = sync_index(kind)?;
    for m in metas.iter_mut() {
        if m.file == target {
            m.name = title.to_string();
        }
    }
    store(kind, &metas)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_kind() {
        assert!(kind_dir("wallpapers").is_err());
        assert!(kind_dir("skins").is_ok());
    }

    /// Touches the real launcher data directory, so it is run manually:
    /// `cargo test -- --ignored`.
    #[test]
    #[ignore = "writes into the launcher data directory"]
    fn saves_reads_and_deletes() {
        const PNG: &[u8] = &[
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        ];
        use base64::Engine as _;
        let data = base64::engine::general_purpose::STANDARD.encode(PNG);

        let saved = save_texture("skins", "Тестовый скин.png", &data, true).expect("сохранение");
        let fresh = saved.first().expect("список не пуст").clone();
        assert_eq!(fresh.name, "Тестовый скин");
        assert!(fresh.slim);
        assert!(fresh.data.starts_with("data:image/png;base64,"));

        let listed = list_textures("skins").expect("чтение");
        assert!(listed.iter().any(|t| t.file == fresh.file), "скин не читается обратно");

        let after_slim = set_texture_slim("skins", &fresh.file, false, true).expect("тип рук");
        let updated = after_slim.iter().find(|t| t.file == fresh.file).expect("запись на месте");
        assert!(!updated.slim && updated.slim_manual);

        let left = delete_texture("skins", &fresh.file).expect("удаление");
        assert!(!left.iter().any(|t| t.file == fresh.file), "запись осталась после удаления");
        assert!(!kind_dir("skins").unwrap().join(&fresh.file).exists(), "файл остался на диске");
    }

    #[test]
    fn texture_url_verdicts() {
        // (input, should be accepted, why this case exists)
        let cases: &[(&str, bool, &str)] = &[
            ("https://textures.minecraft.net/texture/abc", true, "Mojang texture CDN is where player skins live"),
            ("https://mc-heads.net/skin/Notch", true, "import by nickname goes through mc-heads"),
            ("https://api.millida.net/v2/skins/1.png", true, "wardrobe textures come from our own API"),
            ("https://cdn.millida.net/skins/1.png", true, "our CDN is covered by the .millida.net suffix"),
            ("https://cdn.millida.trade/launcher/capes/1.png", true, "wardrobe skins and capes are stored on this CDN"),
            ("https://cdn.modrinth.com/data/x/icon.png", true, "modpack assets are served by the Modrinth CDN"),
            ("  https://mc-heads.net/skin/Notch  ", true, "pasted links carry surrounding whitespace"),
            ("HTTPS://MC-HEADS.NET/skin/Notch", true, "scheme and host comparison must be case-insensitive"),
            ("https://mc-heads.net./skin/Notch", true, "a trailing root dot is the same host"),
            ("http://mc-heads.net/skin/Notch", false, "plain http would let a proxy swap the texture"),
            ("https://evil.example.com/x.png", false, "an arbitrary host is the SSRF the allowlist exists for"),
            ("https://mc-heads.net.evil.com/x.png", false, "suffix trick: the real host is evil.com"),
            ("https://millida.net.evil.com/x.png", false, "the .millida.net suffix must not match as a prefix"),
            ("https://cdn.millida.trade.evil.com/x.png", false, "the .millida.trade suffix must not match as a prefix"),
            ("https://127.0.0.1/x.png", false, "loopback reaches services bound to the user's machine"),
            ("https://localhost:8080/x.png", false, "localhost is loopback by name"),
            ("https://192.168.1.1/x.png", false, "private LAN addresses expose the user's router"),
            ("https://10.0.0.5/x.png", false, "private LAN range"),
            ("https://169.254.169.254/latest/meta-data", false, "link-local is the cloud metadata endpoint"),
            ("https://[::1]/x.png", false, "IPv6 loopback"),
            ("https://[::ffff:127.0.0.1]/x.png", false, "IPv4-mapped IPv6 hides loopback from a naive check"),
            ("https://router.local/x.png", false, "mDNS names resolve inside the LAN"),
            ("file:///C:/Windows/win.ini", false, "file: would read the local filesystem"),
            ("data:image/png;base64,AAAA", false, "data: is not a fetchable host"),
            ("https://mc-heads.net/\r\nHeader: x", false, "CR/LF enable request splitting"),
            ("https://mc-heads.net/\0evil", false, "NUL truncates the URL in C-string based APIs"),
            ("", false, "empty input is not a URL"),
        ];

        for (input, expected_ok, why) in cases {
            let verdict = validate_texture_url(input);
            assert_eq!(
                verdict.is_ok(),
                *expected_ok,
                "validate_texture_url({input:?}) returned {verdict:?}, expected {}. \
                 Reason this case is pinned: {why}",
                if *expected_ok { "Ok" } else { "Err" },
            );
        }
    }

    #[test]
    fn cleans_file_stem() {
        assert_eq!(file_stem("Мой скин.png"), "Мой-скин");
        assert_eq!(file_stem("cool_skin-2.PNG"), "cool_skin-2");
        assert_eq!(file_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(file_stem("   "), "texture");
    }
}
