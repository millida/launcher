use url::{Host, Url};

/// Same key as the updater plugin in tauri.conf.json: the stub must not become a
/// second, weaker way to run code that the launcher itself would refuse.
pub const PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENGQUI2NEEwQjYwMUZFM0MKUldROC9nRzJvR1NyejZ5M0Z6UmpaaVRWb2F6cDI2VlJOTVN6OGZLRlhMWEZCa21VYUlMb3Erdi8K";

/// millida.net is a multi-tenant site where users upload files, so only the
/// launcher folder counts as ours; the storage domain serves nothing else.
const ALLOWED: &[(&str, &str)] = &[("launcher-storage.millida.net", "/"), ("millida.net", "/launcher/")];

/// install.json is the first-install manifest and can be pinned to an older
/// build by hand; latest.json is the auto-update one and only serves as a
/// fallback, so a missing install.json never blocks new installs.
pub const MANIFEST_URLS: &[&str] = &[
    "https://launcher-storage.millida.net/install.json",
    "https://launcher-storage.millida.net/latest.json",
    "https://millida.net/launcher/install.json",
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
    Ok(Build { version, url, signature })
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
