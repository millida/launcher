use super::http::{client, urlencode};
use crate::engine::MILLIDA_API;
use std::time::Duration;

/// Modrinth и CurseForge заблокированы в России: без VPN прямой запрос упирается
/// в таймаут на каждой попытке. Наш API отдаёт то же самое своим адресом, а
/// прямой путь остаётся первым там, где он работает — так трафик каталога и
/// модов не идёт через нас без нужды.
const MODRINTH_API: &str = "https://api.modrinth.com/";

const MODRINTH_FILE_HOST: &str = "cdn.modrinth.com";

const FORGE_FILE_HOSTS: [&str; 3] = ["edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net"];

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Clone, Copy, PartialEq)]
enum Source {
    Modrinth,
    Forge,
}

static MODRINTH_DIRECT: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();
static FORGE_DIRECT: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok()?.host_str().map(|h| h.to_ascii_lowercase())
}

fn source_of(url: &str) -> Option<Source> {
    if url.starts_with(MODRINTH_API) {
        return Some(Source::Modrinth);
    }
    let host = host_of(url)?;
    if host == MODRINTH_FILE_HOST {
        return Some(Source::Modrinth);
    }
    if FORGE_FILE_HOSTS.contains(&host.as_str()) {
        return Some(Source::Forge);
    }
    None
}

/// Тот же ресурс, но через наш API. `None` — адрес, который зеркалить нечем.
pub(crate) fn proxy_url(url: &str) -> Option<String> {
    if let Some(path) = url.strip_prefix(MODRINTH_API) {
        return Some(format!("{}/launcher/mr/{}", MILLIDA_API, path));
    }
    let host = host_of(url)?;
    if host == MODRINTH_FILE_HOST || FORGE_FILE_HOSTS.contains(&host.as_str()) {
        return Some(format!("{}/launcher/dl?url={}", MILLIDA_API, urlencode(url)));
    }
    None
}

/// Живой ли источник напрямую. Ответ любой — даже 404 значит, что до хоста
/// дошли: блокировка выглядит как таймаут или обрыв соединения, а не как статус.
async fn direct_works(probe: &str) -> bool {
    client().head(probe).timeout(PROBE_TIMEOUT).send().await.is_ok()
}

async fn direct_available(source: Source) -> bool {
    match source {
        Source::Modrinth => {
            *MODRINTH_DIRECT
                .get_or_init(|| direct_works("https://api.modrinth.com/v2/tag/loader"))
                .await
        }
        Source::Forge => {
            *FORGE_DIRECT
                .get_or_init(|| direct_works("https://edge.forgecdn.net/"))
                .await
        }
    }
}

/// Адреса одного и того же ресурса в порядке попыток. Проверка доступности
/// делается один раз за запуск на источник, а запасной путь остаётся всегда:
/// прямой путь может отвалиться позже, а наш API — быть недоступен сам.
pub(crate) async fn routes(url: &str) -> Vec<String> {
    let Some(source) = source_of(url) else {
        return vec![url.to_string()];
    };
    let Some(proxied) = proxy_url(url) else {
        return vec![url.to_string()];
    };
    if direct_available(source).await {
        vec![url.to_string(), proxied]
    } else {
        vec![proxied, url.to_string()]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Таблица «адрес → чем его заменяем». Каждая строка закрывает путь, которым
    /// лаунчер реально ходит: каталог, карточка мода, файл мода, файл с CDN
    /// CurseForge — и адрес, который зеркалить нельзя.
    #[test]
    fn mirrors_only_blocked_sources() {
        let cases: [(&str, Option<&str>, &str); 6] = [
            (
                "https://api.modrinth.com/v2/search?limit=20",
                Some("https://api.millida.net/v2/launcher/mr/v2/search?limit=20"),
                "каталог модов",
            ),
            (
                "https://api.modrinth.com/v2/project/sodium/version",
                Some("https://api.millida.net/v2/launcher/mr/v2/project/sodium/version"),
                "версии проекта",
            ),
            (
                "https://cdn.modrinth.com/data/AAA/versions/1/mod.jar",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fcdn.modrinth.com%2Fdata%2FAAA%2Fversions%2F1%2Fmod.jar"),
                "файл мода с CDN Modrinth",
            ),
            (
                "https://mediafilez.forgecdn.net/files/1/2/jei.jar",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fmediafilez.forgecdn.net%2Ffiles%2F1%2F2%2Fjei.jar"),
                "файл с CDN CurseForge",
            ),
            ("https://api.millida.net/v2/launcher/packs", None, "свой API уже доступен"),
            (
                "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
                None,
                "Mojang не блокируется и через нас не гоняется",
            ),
        ];
        for (url, want, why) in cases {
            assert_eq!(
                proxy_url(url).as_deref(),
                want,
                "{}: подмена адреса разошлась с ожидаемой ({})",
                url,
                why
            );
        }
    }

    /// Хост проверяется разбором адреса, а не поиском подстроки: иначе чужой
    /// сервер с нашим хостом в пути уезжал бы в прокси как свой.
    #[test]
    fn host_lookalikes_are_not_mirrored() {
        for url in [
            "https://evil.example/cdn.modrinth.com/x.jar",
            "https://cdn.modrinth.com.evil.example/x.jar",
            "https://api.modrinth.com.evil.example/v2/search",
        ] {
            assert_eq!(proxy_url(url), None, "{}: похожий хост не должен считаться своим", url);
        }
    }
}
