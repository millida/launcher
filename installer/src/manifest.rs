use url::{Host, Url};

/// Same key as the updater plugin in tauri.conf.json: the stub must not become a
/// second, weaker way to run code that the launcher itself would refuse. The key
/// of the legacy channel leaked on 05.09.2026, so only the v2 pair counts.
pub const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDI5MzUwRDVGRUE4NUI5NzcKUldSM3VZWHFYdzAxS1VyamhaeUdwQkRTNzZwN3U2WXRjaDFpWDZ6b3FvLzN0bkFvY3JwWEFQeCsK";

/// millida.net is a multi-tenant site where users upload files, so only the
/// launcher folder counts as ours; the storage domain serves nothing else.
///
/// GitHub counts only for the public release repository, and its asset hosts
/// only as the places github.com redirects a release download to. Whatever the
/// host, the file still has to pass the signature check below.
const ALLOWED: &[(&str, &str)] = &[
    ("launcher-storage.millida.net", "/"),
    ("millida.net", "/launcher/"),
    ("github.com", "/millida/launcher/releases/download/"),
    ("release-assets.githubusercontent.com", "/github-production-release-asset"),
    ("objects.githubusercontent.com", "/github-production-release-asset"),
];

/// install.json is the first-install manifest and can be pinned to an older
/// build by hand; latest.json is the auto-update one and only serves as a
/// fallback, so a missing install.json never blocks new installs. Both live
/// under v2/: the manifests at the root are signed with the leaked key and a
/// fresh install must never trust them.
/// v2/gh/latest.json is the same release with files on GitHub and the CDN as
/// a mirror; it goes first so a fresh install comes straight from the public
/// release.
///
/// The query is there for the edge in front of the CDN: a bare manifest URL it
/// serves from its own copy, which on 11.10.2026 was a day stale and kept half
/// of the players on an old version. A URL with a query goes to the origin.
pub const MANIFEST_URLS: &[&str] = &[
    "https://launcher-storage.millida.net/v2/gh/latest.json?from=setup",
    "https://launcher-storage.millida.net/v2/install.json?from=setup",
    "https://launcher-storage.millida.net/v2/latest.json?from=setup",
    "https://millida.net/launcher/v2/install.json?from=setup",
];

/// The keys of latest.json, which the release pipeline fills per target. A stub
/// built for a target with no key would install someone else's build.
#[cfg(all(windows, target_arch = "x86_64"))]
pub const PLATFORM_KEY: &str = "windows-x86_64";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub const PLATFORM_KEY: &str = "linux-x86_64";
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub const PLATFORM_KEY: &str = "darwin-aarch64";
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub const PLATFORM_KEY: &str = "darwin-x86_64";

#[cfg(not(any(
    all(windows, target_arch = "x86_64"),
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "macos", any(target_arch = "aarch64", target_arch = "x86_64"))
)))]
compile_error!("для этой платформы лаунчер не собирается — стаб ставить нечего");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Build {
    pub version: String,
    pub url: String,
    pub signature: String,
    /// The same bytes elsewhere (our CDN when `url` is on GitHub).
    pub mirror: Option<String>,
}

pub fn check_url(raw: &str) -> Result<Url, String> {
    let parsed = Url::parse(raw.trim()).map_err(|_| format!("непонятный адрес: {}", raw))?;
    if parsed.scheme() != "https" {
        return Err(format!("адрес не по https: {}", raw));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(format!("в адресе есть логин или пароль: {}", raw));
    }
    if parsed.port().is_some() {
        return Err(format!("адрес с нестандартным портом: {}", raw));
    }
    let Some(Host::Domain(host)) = parsed.host() else {
        return Err(format!("адрес не с наших серверов: {}", raw));
    };
    let host = host.to_ascii_lowercase();
    let allowed = ALLOWED
        .iter()
        .any(|(name, prefix)| *name == host && parsed.path().starts_with(prefix));
    if !allowed {
        return Err(format!("адрес не с наших серверов: {}", raw));
    }
    Ok(parsed)
}

pub fn parse(doc: &str) -> Result<Build, String> {
    let value: serde_json::Value =
        serde_json::from_str(doc).map_err(|e| format!("список сборок не разобран: {}", e))?;
    let version = value["version"].as_str().unwrap_or("").trim().trim_start_matches('v').to_string();
    if version.is_empty() {
        return Err("в списке сборок нет версии".into());
    }
    let entry = &value["platforms"][PLATFORM_KEY];
    let url = entry["url"].as_str().unwrap_or("").trim().to_string();
    let signature = entry["signature"].as_str().unwrap_or("").trim().to_string();
    if url.is_empty() || signature.is_empty() {
        return Err(format!("в списке сборок нет сборки под {}", PLATFORM_KEY));
    }
    check_url(&url)?;
    let mirror = entry["mirror"].as_str().map(str::trim).filter(|m| check_url(m).is_ok()).map(str::to_string);
    Ok(Build { version, url, signature, mirror })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The stub must never install a build meant for another platform: the
    /// manifest is one document with an entry per key.
    #[test]
    fn parse_ignores_other_platforms() {
        let other = if PLATFORM_KEY == "linux-x86_64" { "windows-x86_64" } else { "linux-x86_64" };
        let doc = format!(
            r#"{{"version":"1.0.9","platforms":{{"{}":{{"url":"https://launcher-storage.millida.net/a","signature":"c2ln"}}}}}}"#,
            other
        );
        assert!(
            parse(&doc).is_err(),
            "сборка под чужую платформу обязана отклоняться, иначе стаб скачает неисполняемый файл"
        );
    }

    /// The root manifests are still served for launchers 1.0.89 and older and are
    /// signed with the key that leaked on 05.09.2026. A stub reading them would
    /// install anything that leak can sign.
    #[test]
    fn manifests_come_from_the_rotated_channel() {
        for url in MANIFEST_URLS {
            assert!(
                url.contains("/v2/"),
                "источник {} лежит вне канала v2 — он подписан утёкшим ключом",
                url
            );
        }
    }

    /// The key is baked into the stub and never updated. Drift from
    /// tauri.conf.json and the stub installs nothing, with no way to ship a fix.
    #[test]
    fn pubkey_matches_launcher_config() {
        let config = include_str!("../../src-tauri/tauri.conf.json");
        let value: serde_json::Value = serde_json::from_str(config).expect("tauri.conf.json должен читаться");
        let launcher = value["plugins"]["updater"]["pubkey"].as_str().expect("в конфиге лаунчера нет ключа");
        assert_eq!(
            launcher, PUBKEY,
            "ключ стаба разошёлся с ключом автообновления — стаб перестанет ставить лаунчер"
        );
    }

    fn doc(url: &str) -> String {
        format!(
            r#"{{"version":"1.0.9","platforms":{{"{}":{{"url":"{}","signature":"c2ln"}}}}}}"#,
            PLATFORM_KEY, url
        )
    }

    #[test]
    fn url_verdicts() {
        let cases: &[(&str, bool)] = &[
            ("https://launcher-storage.millida.net/1.0.9/x/a-setup.exe", true),
            ("https://millida.net/launcher/a-setup.exe", true),
            ("https://millida.net/uploads/a-setup.exe", false),
            ("https://launcher-storage.millida.net:8443/a.exe", false),
            ("https://LAUNCHER-STORAGE.MILLIDA.NET/a.exe", true),
            ("http://launcher-storage.millida.net/a.exe", false),
            ("https://evil.example/a.exe", false),
            ("https://launcher-storage.millida.net.evil.example/a.exe", false),
            ("https://user:pass@launcher-storage.millida.net/a.exe", false),
            ("https://127.0.0.1/a.exe", false),
            ("https://[::1]/a.exe", false),
            ("https://github.com/millida/launcher/releases/download/v2.0.203/a-setup.exe", true),
            ("https://github.com/someone/launcher/releases/download/v1/a-setup.exe", false),
            ("https://github.com/millida/launcher/raw/main/a.exe", false),
            ("https://release-assets.githubusercontent.com/github-production-release-asset/1/x?sig=1", true),
            ("https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/x", true),
            ("https://objects.githubusercontent.com/other/x.exe", false),
            ("https://raw.githubusercontent.com/millida/launcher/main/a.exe", false),
            ("file:///C:/a.exe", false),
            ("не адрес", false),
        ];
        for (raw, expected) in cases {
            assert_eq!(
                check_url(raw).is_ok(),
                *expected,
                "адрес {} должен был быть {}, иначе установщик запустит файл не с наших серверов",
                raw,
                if *expected { "принят" } else { "отклонён" }
            );
        }
    }

    #[test]
    fn parse_takes_own_platform_build() {
        let b = parse(&doc("https://launcher-storage.millida.net/1.0.9/x/a-setup.exe"))
            .expect("манифест должен разбираться");
        assert_eq!(b.version, "1.0.9", "версия берётся из манифеста");
        assert_eq!(b.signature, "c2ln", "подпись берётся из манифеста");
    }

    #[test]
    fn parse_keeps_cdn_mirror_of_github_build() {
        let doc = format!(
            r#"{{"version":"2.0.203","platforms":{{"{}":{{"url":"https://github.com/millida/launcher/releases/download/v2.0.203/a-setup.exe","mirror":"https://launcher-storage.millida.net/2.0.203/x/a-setup.exe","signature":"c2ln"}}}}}}"#,
            PLATFORM_KEY
        );
        let b = parse(&doc).expect("манифест с GitHub должен разбираться");
        assert_eq!(b.mirror.as_deref(), Some("https://launcher-storage.millida.net/2.0.203/x/a-setup.exe"));
        let evil = doc.replace("https://launcher-storage.millida.net/2.0.203/x/a-setup.exe", "https://evil.example/a.exe");
        assert_eq!(parse(&evil).expect("чужое зеркало не ломает основной адрес").mirror, None, "зеркало с чужого хоста отбрасывается");
    }

    #[test]
    fn parse_rejects_foreign_host() {
        assert!(
            parse(&doc("https://evil.example/a.exe")).is_err(),
            "манифест с чужим адресом обязан отклоняться целиком, а не только на скачивании"
        );
    }

    #[test]
    fn parse_rejects_missing_pieces() {
        let cases = [
            format!(r#"{{"platforms":{{"{}":{{"url":"https://millida.net/launcher/a","signature":"c2ln"}}}}}}"#, PLATFORM_KEY),
            r#"{"version":"1.0.9","platforms":{"solaris-sparc":{"url":"https://millida.net/launcher/a","signature":"c2ln"}}}"#.to_string(),
            format!(r#"{{"version":"1.0.9","platforms":{{"{}":{{"url":"https://millida.net/launcher/a"}}}}}}"#, PLATFORM_KEY),
            "не json".to_string(),
        ];
        for case in cases {
            assert!(parse(&case).is_err(), "неполный манифест обязан отклоняться: {}", case);
        }
    }
}
