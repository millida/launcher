use super::http::{client, urlencode};
use crate::engine::MILLIDA_API;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Modrinth и CurseForge заблокированы в России: без VPN прямой запрос упирается
/// в таймаут на каждой попытке. Наш API отдаёт то же самое своим адресом, а
/// прямой путь остаётся первым там, где он работает — так трафик каталога и
/// модов не идёт через нас без нужды.
const MODRINTH_API: &str = "https://api.modrinth.com/";

const MODRINTH_FILE_HOST: &str = "cdn.modrinth.com";

const FORGE_FILE_HOSTS: [&str; 3] = ["edge.forgecdn.net", "mediafilez.forgecdn.net", "media.forgecdn.net"];

/// Площадки загрузчиков: у части провайдеров соединение до них рвётся сразу
/// после установки («Удалённый хост принудительно разорвал подключение»), и без
/// запасного пути установка Fabric или Forge не начинается вовсе.
const LOADER_HOSTS: [&str; 7] = [
    "meta.fabricmc.net",
    "maven.fabricmc.net",
    "meta.quiltmc.org",
    "maven.quiltmc.org",
    "files.minecraftforge.net",
    "maven.minecraftforge.net",
    "maven.neoforged.net",
];

/// Java runtime directories and Azul's CDN. From some networks neither vendor
/// answers, and without another route a fresh install cannot get Java at all.
const JAVA_HOSTS: [&str; 3] = ["api.adoptium.net", "api.azul.com", "cdn.azul.com"];

/// Adoptium keeps its archives in GitHub releases. Only this owner is mirrored:
/// the rest of GitHub is not ours to relay.
const JAVA_GITHUB_OWNER: &str = "/adoptium/";

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

#[derive(Clone, Copy, PartialEq)]
enum Source {
    Modrinth,
    Forge,
    Loader,
    Java,
}

static MODRINTH_DIRECT: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();
static FORGE_DIRECT: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();
static LOADER_DIRECT: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();
static JAVA_DIRECT: tokio::sync::OnceCell<bool> = tokio::sync::OnceCell::const_new();

/// The startup probe is a HEAD to one host; a filter that lets it through can
/// still stall file bodies on the CDN. One stalled direct transfer moves the
/// whole source behind our mirror for the session, so a pack of hundreds of
/// files pays the timeout once instead of once per file.
static MODRINTH_DEMOTED: AtomicBool = AtomicBool::new(false);
static FORGE_DEMOTED: AtomicBool = AtomicBool::new(false);
static LOADER_DEMOTED: AtomicBool = AtomicBool::new(false);
static JAVA_DEMOTED: AtomicBool = AtomicBool::new(false);

fn demoted(source: Source) -> &'static AtomicBool {
    match source {
        Source::Modrinth => &MODRINTH_DEMOTED,
        Source::Forge => &FORGE_DEMOTED,
        Source::Loader => &LOADER_DEMOTED,
        Source::Java => &JAVA_DEMOTED,
    }
}

/// True when `route` is a direct address that has a mirror and the failure
/// looks like a network block rather than an answer from the server; the
/// source is then demoted and the caller should move to the next route
/// instead of spending its remaining attempts on the same wall.
pub(crate) fn abandon_direct(route: &str, err: &str) -> bool {
    if !err.contains(NO_LINK) {
        return false;
    }
    let Some(source) = source_of(route) else { return false };
    if proxy_url(route).is_none() {
        return false;
    }
    demoted(source).store(true, Ordering::Relaxed);
    true
}

/// Marker `net_err` puts on transport failures (no connection, timeout, reset).
pub(crate) const NO_LINK: &str = "нет связи";

fn host_of(url: &str) -> Option<String> {
    url::Url::parse(url).ok()?.host_str().map(|h| h.to_ascii_lowercase())
}

/// The path is taken from the parsed address, so `/adoptium/../other/` does
/// not pass for Adoptium's.
fn adoptium_release(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str().is_some_and(|h| h.eq_ignore_ascii_case("github.com"))
            && u.path().starts_with(JAVA_GITHUB_OWNER)
    })
}

fn java_source(url: &str, host: &str) -> bool {
    JAVA_HOSTS.contains(&host) || adoptium_release(url)
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
    if LOADER_HOSTS.contains(&host.as_str()) {
        return Some(Source::Loader);
    }
    if java_source(url, &host) {
        return Some(Source::Java);
    }
    None
}

/// Тот же ресурс, но через наш API. `None` — адрес, который зеркалить нечем.
pub(crate) fn proxy_url(url: &str) -> Option<String> {
    if let Some(path) = url.strip_prefix(MODRINTH_API) {
        return Some(format!("{}/launcher/mr/{}", MILLIDA_API, path));
    }
    let host = host_of(url)?;
    if host == MODRINTH_FILE_HOST
        || FORGE_FILE_HOSTS.contains(&host.as_str())
        || LOADER_HOSTS.contains(&host.as_str())
        || java_source(url, &host)
    {
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
        Source::Loader => {
            *LOADER_DIRECT
                .get_or_init(|| direct_works("https://meta.fabricmc.net/v2/versions/loader"))
                .await
        }
        Source::Java => {
            *JAVA_DIRECT
                .get_or_init(|| direct_works("https://api.adoptium.net/v3/info/available_releases"))
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
    if !demoted(source).load(Ordering::Relaxed) && direct_available(source).await {
        vec![url.to_string(), proxied]
    } else {
        vec![proxied, url.to_string()]
    }
}

/// Прямой путь → наше зеркало → снова прямой. Для мелких, но обязательных
/// запросов (контрольная сумма инсталлятора, список версий загрузчика): проверка
/// доступности делается раз за запуск и к моменту установки может устареть, а
/// зеркало само бывает недоступно — последняя попытка возвращается к первому
/// пути, который к тому времени мог ожить.
pub(crate) async fn routes_round_trip(url: &str) -> Vec<String> {
    with_return(routes(url).await)
}

fn with_return(mut routes: Vec<String>) -> Vec<String> {
    if routes.len() > 1 {
        let first = routes[0].clone();
        routes.push(first);
    }
    routes
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Таблица «адрес → чем его заменяем». Каждая строка закрывает путь, которым
    /// лаунчер реально ходит: каталог, карточка мода, файл мода, файл с CDN
    /// CurseForge — и адрес, который зеркалить нельзя.
    #[test]
    fn mirrors_only_blocked_sources() {
        let cases: [(&str, Option<&str>, &str); 12] = [
            (
                "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fapi.adoptium.net%2Fv3%2Fassets%2Flatest%2F21%2Fhotspot%3Farchitecture%3Dx64"),
                "справочник Java — без него Java не ставится",
            ),
            (
                "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21/jre.zip",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fgithub.com%2Fadoptium%2Ftemurin21-binaries%2Freleases%2Fdownload%2Fjdk-21%2Fjre.zip"),
                "архив Java Adoptium в релизах GitHub",
            ),
            (
                "https://cdn.azul.com/zulu/bin/zulu21-jre-win_x64.zip",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fcdn.azul.com%2Fzulu%2Fbin%2Fzulu21-jre-win_x64.zip"),
                "архив Java Azul",
            ),
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
            (
                "https://meta.fabricmc.net/v2/versions/loader/1.20.1",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fmeta.fabricmc.net%2Fv2%2Fversions%2Floader%2F1.20.1"),
                "список версий Fabric — с него срывался запуск",
            ),
            (
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.0/neoforge-21.1.0-installer.jar",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fmaven.neoforged.net%2Freleases%2Fnet%2Fneoforged%2Fneoforge%2F21.1.0%2Fneoforge-21.1.0-installer.jar"),
                "установщик NeoForge",
            ),
            (
                "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
                Some("https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Ffiles.minecraftforge.net%2Fnet%2Fminecraftforge%2Fforge%2Fpromotions_slim.json"),
                "рекомендованные версии Forge",
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

    /// вход (адрес попытки, ошибка) -> бросать ли прямой путь. Сетевой отказ на
    /// прямом адресе источника переводит весь источник на зеркало, чтобы пак из
    /// сотен файлов не ждал таймаут на каждом; ответ сервера статусом — нет.
    #[test]
    fn only_a_network_wall_on_a_direct_route_moves_to_the_mirror() {
        let jar = "https://cdn.modrinth.com/data/AAA/versions/1/mod.jar";
        let cases: [(&str, &str, bool, &str); 5] = [
            (jar, "x: нет связи (operation timed out)", true, "прямой Modrinth не отвечает"),
            (jar, "x: обрыв загрузки (нет связи (connection reset))", true, "тело встало посреди файла"),
            (jar, "x → 404 Not Found", false, "сервер ответил — сеть ни при чём"),
            ("https://api.millida.net/v2/launcher/dl?url=x", "x: нет связи (reset)", false, "это уже зеркало"),
            ("https://garage.millida.net/a.zip", "x: нет связи (reset)", false, "у адреса нет зеркала"),
        ];
        for (route, err, want, why) in cases {
            assert_eq!(abandon_direct(route, err), want, "{}", why);
        }
        assert!(MODRINTH_DEMOTED.swap(false, Ordering::Relaxed), "отказ прямого пути обязан пометить источник");
    }

    #[test]
    fn round_trip_returns_to_the_first_route() {
        let two = vec!["https://maven.minecraftforge.net/a".to_string(), "https://api.millida.net/v2/launcher/dl?url=a".to_string()];
        assert_eq!(
            with_return(two.clone()),
            vec![two[0].clone(), two[1].clone(), two[0].clone()],
            "прямой → зеркало → снова прямой"
        );
        let one = vec!["https://launchermeta.mojang.com/x.json".to_string()];
        assert_eq!(with_return(one.clone()), one, "без зеркала повторять нечего");
    }

    /// Хост проверяется разбором адреса, а не поиском подстроки: иначе чужой
    /// сервер с нашим хостом в пути уезжал бы в прокси как свой.
    #[test]
    fn host_lookalikes_are_not_mirrored() {
        for url in [
            "https://evil.example/cdn.modrinth.com/x.jar",
            "https://cdn.modrinth.com.evil.example/x.jar",
            "https://api.modrinth.com.evil.example/v2/search",
            "https://meta.fabricmc.net.evil.example/v2/versions/loader",
            "https://evil.example/maven.neoforged.net/x.jar",
            "https://github.com/someone/tool/releases/download/v1/tool.exe",
            "https://github.com/adoptium.evil/x.zip",
            "https://github.com/adoptium/../someone/x.zip",
            "https://api.adoptium.net.evil.example/v3/assets",
        ] {
            assert_eq!(proxy_url(url), None, "{}: похожий хост не должен считаться своим", url);
        }
    }
}
