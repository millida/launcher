//! Окна лаунчера и оверлея никогда не уходят со своей страницы: любая внешняя
//! навигация (ссылка в описании мода, window.location из скомпрометированного
//! скрипта) отменяется и открывается в браузере (аудит 24.09.2026).

use tauri::{plugin::TauriPlugin, Manager, Wry};

/// Окна, у которых есть доступ к командам ядра. Окно «external» намеренно
/// показывает чужие сайты и под охрану не попадает.
const GUARDED: &[&str] = &["main", "overlay"];

/// Своя страница: собранный фронт (tauri://localhost, http(s)://tauri.localhost)
/// и dev-сервер Vite только в отладочной сборке.
pub fn is_app_url(url: &url::Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        ("about", _) => url.as_str() == "about:blank",
        ("http", Some("localhost" | "127.0.0.1")) => cfg!(debug_assertions) && url.port() == Some(5173),
        _ => false,
    }
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("navguard")
        .on_navigation(|webview, url| {
            if !GUARDED.contains(&webview.label()) || is_app_url(url) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https") {
                let _ = crate::engine::open_external_anyhow(webview.app_handle(), url.as_str());
            }
            false
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::is_app_url;

    #[test]
    fn only_own_pages_are_allowed() {
        let cases: &[(&str, bool)] = &[
            ("tauri://localhost/index.html", true),
            ("http://tauri.localhost/", true),
            ("https://tauri.localhost/#overlay", true),
            ("about:blank", true),
            ("https://evil.example/", false),
            ("http://localhost:8080/", false),
            ("https://tauri.localhost.evil.example/", false),
            ("file:///etc/passwd", false),
            ("millida://join?x=1", false),
        ];
        for (u, ok) in cases {
            let parsed = url::Url::parse(u).unwrap();
            assert_eq!(is_app_url(&parsed), *ok, "{u}");
        }
    }
}
