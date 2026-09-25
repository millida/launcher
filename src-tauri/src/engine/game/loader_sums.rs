//! Контрольные суммы инсталляторов Forge и NeoForge, которые ставят сборки
//! каталога и чаще всего выбирают игроки.
//!
//! Инсталлятор запускается JVM, поэтому без сверки хеша его ставить нельзя. Раньше
//! сумму всегда спрашивали у maven отдельным запросом, и в России этот запрос
//! падал у 4–10% запусков Forge («не дошли до maven за контрольной суммой
//! инсталлера»), хотя сам файл потом спокойно качался через наше зеркало.
//! Сборка на maven неизменна: однажды опубликованный файл не переписывают,
//! поэтому сумма, сверенная один раз, верна навсегда.
//!
//! Каждая строка сверена 25.09.2026: sha1 из соседнего `.sha1` на maven совпал
//! с sha1 самого скачанного файла. Сборки, которой в таблице нет, лаунчер
//! по-прежнему сверяет с maven.

/// (загрузчик, версия MC, сборка, имя файла инсталлятора, sha1).
const INSTALLERS: &[(&str, &str, &str, &str, &str)] = &[
    ("forge", "1.20.1", "47.4.0", "forge-1.20.1-47.4.0-installer.jar", "b73203963ea70aee0c38dc58de1f6d16a766605b"),
    ("forge", "1.20.1", "47.4.1", "forge-1.20.1-47.4.1-installer.jar", "c8ea169c0203fb7d55999b3157175bddeb716f7f"),
    ("forge", "1.20.1", "47.4.4", "forge-1.20.1-47.4.4-installer.jar", "dbf5151ff5b6e00c5ba711184e09f1cc549acae3"),
    ("forge", "1.20.1", "47.4.10", "forge-1.20.1-47.4.10-installer.jar", "66bfea9963bfa60d88bab6b2750e74a958392715"),
    ("forge", "1.20.1", "47.4.16", "forge-1.20.1-47.4.16-installer.jar", "0d4bdf4f4d8558c789df7313aeaf02e2c8f9211d"),
    ("forge", "1.20.1", "47.4.23", "forge-1.20.1-47.4.23-installer.jar", "ed31ce02ac69176f34353235cb2508d5a0f1e088"),
    ("forge", "1.16.5", "36.2.34", "forge-1.16.5-36.2.34-installer.jar", "ab306b654c44d659ce69da5d4f87590b66dc91e8"),
    ("forge", "1.16.5", "36.2.42", "forge-1.16.5-36.2.42-installer.jar", "e09ecf910e4d5eae12fb3564d9b7de212c1958b2"),
    ("forge", "1.12.2", "14.23.5.2859", "forge-1.12.2-14.23.5.2859-installer.jar", "6b3d5be8b58d5385fda9c4d285367f4cb6e697b2"),
    ("forge", "1.12.2", "14.23.5.2864", "forge-1.12.2-14.23.5.2864-installer.jar", "b5ec0016c292830f2325e39417d1ec4d9e166cab"),
    ("forge", "1.19.2", "43.5.0", "forge-1.19.2-43.5.0-installer.jar", "0a45a1d96388403c5f16556df81165ba4d96987a"),
    ("forge", "1.19.2", "43.5.2", "forge-1.19.2-43.5.2-installer.jar", "d242b6786039d4acb9ea7579624772b6809bda91"),
    ("forge", "1.18.2", "40.3.0", "forge-1.18.2-40.3.0-installer.jar", "d267e3dbd2df4e6849bdb2a81aa0b920c354efa6"),
    ("forge", "1.18.2", "40.3.12", "forge-1.18.2-40.3.12-installer.jar", "d7f759dec5b52ddb342c3e12511da1674d0401bf"),
    ("forge", "1.21.1", "52.1.0", "forge-1.21.1-52.1.0-installer.jar", "fa4f90047c23e6df4d2b4e649aec7fd5d1e20acd"),
    ("forge", "1.21.1", "52.1.16", "forge-1.21.1-52.1.16-installer.jar", "076aad17209fe7f153887f7f3992506ab58472f5"),
    ("forge", "1.21.10", "60.1.0", "forge-1.21.10-60.1.0-installer.jar", "27ef641cf186da66dcb75e62dc46b2fda64467fd"),
    ("forge", "1.21.10", "60.1.15", "forge-1.21.10-60.1.15-installer.jar", "8ad5b2fdb8983564d315ad0fdb783c9eb6779eb5"),
    ("forge", "1.21.11", "61.2.0", "forge-1.21.11-61.2.0-installer.jar", "b1146cac2e10fbe4f9adf6012f27bce510bbdcb8"),
    ("forge", "1.21.11", "61.2.1", "forge-1.21.11-61.2.1-installer.jar", "24d86289c56232d8510245cbe8cf4cde9bc06dba"),
    ("forge", "1.7.10", "10.13.4.1614", "forge-1.7.10-10.13.4.1614-1.7.10-installer.jar", "fccafccf8ad4ce6d9f008e786b48ff53172bf9de"),
    ("neoforge", "1.21.1", "21.1.233", "neoforge-21.1.233-installer.jar", "c08d30647f1dc8650bc098b03b5faacdb63d1cf4"),
    ("neoforge", "1.21.1", "21.1.248", "neoforge-21.1.248-installer.jar", "e818014b2ef9cdaa76dc9fedddaf17f46ade8fce"),
    ("neoforge", "1.21.1", "21.1.249", "neoforge-21.1.249-installer.jar", "d94d4445a3dda42e7dd54f5c7f789aa78c822074"),
    ("neoforge", "1.21.1", "21.1.250", "neoforge-21.1.250-installer.jar", "71467422ca7c37446d0e1e28c010655a361562c0"),
    ("neoforge", "1.21.1", "21.1.251", "neoforge-21.1.251-installer.jar", "d1801c94fc7769a4cc6160c660c43ef678d2c142"),
    ("neoforge", "1.21.10", "21.10.63", "neoforge-21.10.63-installer.jar", "c043f81dce834a2710671b9f4ea77d964fd62fdf"),
    ("neoforge", "1.21.10", "21.10.64", "neoforge-21.10.64-installer.jar", "fbf109b7ee9b40108ca21ba7d3656a16e10df0f7"),
    ("neoforge", "1.20.1", "47.1.106", "forge-1.20.1-47.1.106-installer.jar", "0c6074dd66487388258e1bb5d2a962d52080a22c"),
    ("neoforge", "1.20.1", "47.1.105", "forge-1.20.1-47.1.105-installer.jar", "b797c5783ffa5a49ea189606f77eb58af12abcf9"),
    ("neoforge", "1.20.1", "47.1.101", "forge-1.20.1-47.1.101-installer.jar", "a50fc9bcfe9065a59f25fd224d7a8da888e02fdc"),
    ("neoforge", "1.20.1", "47.1.79", "forge-1.20.1-47.1.79-installer.jar", "c56681ac1460a9565133a8b58ea0a1ed8a72c5ef"),
];

fn host_for(loader: &str) -> &'static str {
    if loader == "neoforge" { "maven.neoforged.net" } else { "maven.minecraftforge.net" }
}

/// Сумма инсталлятора по его адресу на maven. Совпадать должны и хост, и имя
/// файла: `forge-1.20.1-47.1.106-installer.jar` есть и у Forge, и у NeoForge, и
/// это два разных файла.
pub(crate) fn known_installer_sha1(url: &str) -> Option<&'static str> {
    let parsed = url::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let file = parsed.path_segments()?.next_back()?.to_string();
    INSTALLERS
        .iter()
        .find(|(loader, _, _, name, _)| host == host_for(loader) && file == *name)
        .map(|row| row.4)
}

/// Сборки из таблицы для версии MC, новые первыми. Это запасной список, когда
/// maven не отдал ни версий NeoForge, ни рекомендованных сборок Forge: без него
/// сборка без закреплённой версии загрузчика не ставилась вовсе.
pub(crate) fn known_builds(loader: &str, vid: &str) -> Vec<String> {
    let mut builds: Vec<String> = INSTALLERS
        .iter()
        .filter(|(l, mc, ..)| *l == loader && *mc == vid)
        .map(|row| row.2.to_string())
        .collect();
    builds.sort_by_key(|b| b.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>());
    builds.reverse();
    builds
}

#[cfg(test)]
pub(crate) fn rows() -> &'static [(&'static str, &'static str, &'static str, &'static str, &'static str)] {
    INSTALLERS
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Строка таблицы, которую нельзя прочитать как sha1, сломала бы установку
    /// этой сборки насовсем — сверка всегда давала бы «сумма не сошлась».
    #[test]
    fn every_sum_is_a_sha1() {
        for (loader, mc, build, _, sum) in INSTALLERS {
            assert!(
                sum.len() == 40 && sum.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()),
                "{} {} {}: в таблице не sha1",
                loader, mc, build
            );
        }
    }

    /// адрес -> сумма: хост различает одноимённые файлы Forge и NeoForge 1.20.1,
    /// неизвестная сборка идёт к maven, как раньше.
    #[test]
    fn lookup_is_by_host_and_file() {
        let cases: [(&str, Option<&str>, &str); 5] = [
            (
                "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.10/forge-1.20.1-47.4.10-installer.jar",
                Some("66bfea9963bfa60d88bab6b2750e74a958392715"),
                "рекомендованный Forge 1.20.1",
            ),
            (
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.233/neoforge-21.1.233-installer.jar",
                Some("c08d30647f1dc8650bc098b03b5faacdb63d1cf4"),
                "NeoForge сборки aeronautics",
            ),
            (
                "https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar",
                Some("0c6074dd66487388258e1bb5d2a962d52080a22c"),
                "NeoForge 1.20.1 лежит под координатами forge",
            ),
            (
                "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar",
                None,
                "то же имя у Forge — другой файл, суммы NeoForge ему не подходят",
            ),
            (
                "https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.22/forge-1.20.1-47.4.22-installer.jar",
                None,
                "сборки нет в таблице — сумму даёт maven",
            ),
        ];
        for (url, want, why) in cases {
            assert_eq!(known_installer_sha1(url), want, "{}", why);
        }
    }

    #[test]
    fn known_builds_are_newest_first_and_scoped() {
        assert_eq!(known_builds("forge", "1.16.5"), vec!["36.2.42", "36.2.34"]);
        assert_eq!(known_builds("neoforge", "1.21.1")[0], "21.1.251");
        assert!(known_builds("neoforge", "1.16.5").is_empty(), "чужая версия MC не подхватывается");
        assert!(
            !known_builds("forge", "1.20.1").iter().any(|b| b.starts_with("47.1.")),
            "сборки NeoForge 1.20.1 не попадают в список Forge"
        );
    }
}
