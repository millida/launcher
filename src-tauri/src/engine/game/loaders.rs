use crate::engine::*;
use std::time::Duration;

const LIST_TTL: Duration = Duration::from_secs(6 * 3600);

/// One selectable loader build. `recommended` marks the build the installer
/// would pick on its own, so the UI can offer it as the default.
#[derive(Clone, serde::Serialize)]
pub struct LoaderBuild {
    pub version: String,
    pub stable: bool,
    pub recommended: bool,
}

fn num_key(v: &str) -> Vec<u64> {
    v.split(['.', '-', '+'])
        .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect()
}

async fn fabric_like(loader: &str, vid: &str, cache_dir: &std::path::Path) -> Result<Vec<LoaderBuild>, String> {
    let meta_base = if loader == "quilt" { "https://meta.quiltmc.org/v3" } else { "https://meta.fabricmc.net/v2" };
    let list = get_json_fresh(
        &format!("{}/versions/loader/{}", meta_base, vid),
        &cache_dir.join(format!("{}-{}-list.json", loader, vid)),
        LIST_TTL,
    )
    .await?;
    let arr = list.as_array().cloned().unwrap_or_default();
    let mut out: Vec<LoaderBuild> = arr
        .iter()
        .filter_map(|l| {
            Some(LoaderBuild {
                version: l["loader"]["version"].as_str()?.to_string(),
                stable: l["loader"]["stable"] == true,
                recommended: false,
            })
        })
        .collect();
    // Same pick as the installer: first stable, otherwise the newest build.
    if let Some(i) = out.iter().position(|b| b.stable).or(if out.is_empty() { None } else { Some(0) }) {
        out[i].recommended = true;
    }
    Ok(out)
}

/// Forge lists builds as "<mc>-<build>", older ones with a trailing "-<mc>"
/// ("1.7.10-10.13.4.1614-1.7.10"). Oldest first in the source, newest first out.
fn forge_builds(all: &serde_json::Value, vid: &str) -> Vec<String> {
    let mut b: Vec<String> = all[vid]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str())
                .filter_map(|v| v.strip_prefix(&format!("{}-", vid)))
                .map(|v| v.strip_suffix(&format!("-{}", vid)).unwrap_or(v).to_string())
                .collect()
        })
        .unwrap_or_default();
    b.reverse();
    b
}

/// A prerelease build is marked by a qualifier ("21.1.0-beta",
/// "26.1.0.0-alpha.1+snapshot-1"); release numbers carry digits only.
pub(crate) fn neoforge_prerelease(v: &str) -> bool {
    v.contains('-')
}

/// NeoForge tracks the Minecraft version: "1.A.B" -> "A.B.", "1.A" -> "A.0."
/// (MC 1.21.1 -> 21.1.x, MC 1.21 -> 21.0.x). Year-based releases keep their own
/// number and gain a patch element instead (MC 26.2 -> 26.2.0.x), so the longer
/// prefix is tried first and the plain one covers a future patch layout.
fn neoforge_prefixes(vid: &str) -> Vec<String> {
    let parts: Vec<&str> = vid.split('.').collect();
    if parts.first() == Some(&"1") {
        let a = parts.get(1).copied().unwrap_or("");
        let b = parts.get(2).copied().unwrap_or("0");
        return vec![format!("{}.{}.", a, b)];
    }
    match parts.len() {
        2 => vec![format!("{}.0.", vid), format!("{}.", vid)],
        _ => vec![format!("{}.", vid)],
    }
}

/// Builds for one Minecraft version, newest first, prereleases included.
pub(crate) fn neoforge_builds(list: &serde_json::Value, vid: &str) -> Vec<String> {
    let all: Vec<&str> = list["versions"]
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    for prefix in neoforge_prefixes(vid) {
        let mut cands: Vec<String> =
            all.iter().filter(|v| v.starts_with(&prefix)).map(|v| v.to_string()).collect();
        if cands.is_empty() {
            continue;
        }
        cands.sort_by_key(|v| num_key(v));
        cands.reverse();
        return cands;
    }
    vec![]
}

async fn forge(vid: &str, cache_dir: &std::path::Path) -> Result<Vec<LoaderBuild>, String> {
    let all = get_json_fresh(
        "https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json",
        &cache_dir.join("forge-metadata.json"),
        LIST_TTL,
    )
    .await?;
    let builds = forge_builds(&all, vid);
    if builds.is_empty() {
        return Err(format!("Forge для {} не найден", vid));
    }
    let promos = get_json_fresh(
        "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
        &cache_dir.join("forge-promos.json"),
        LIST_TTL,
    )
    .await
    .unwrap_or(serde_json::Value::Null);
    let promo = |kind: &str| promos["promos"][format!("{}-{}", vid, kind)].as_str().map(String::from);
    let rec = promo("recommended").or_else(|| promo("latest"));
    Ok(builds
        .into_iter()
        // Forge publishes only releases here, so nothing in the list is a prerelease.
        .map(|b| LoaderBuild {
            stable: true,
            recommended: rec.as_deref() == Some(b.as_str()),
            version: b,
        })
        .collect())
}

async fn neoforge(vid: &str, cache_dir: &std::path::Path) -> Result<Vec<LoaderBuild>, String> {
    let list = get_json_fresh(
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
        &cache_dir.join("neoforge-versions.json"),
        LIST_TTL,
    )
    .await?;
    let cands = neoforge_builds(&list, vid);
    if cands.is_empty() {
        return Err(format!("NeoForge для {} не найден", vid));
    }
    let rec = cands.iter().find(|v| !neoforge_prerelease(v)).or(cands.first()).cloned();
    Ok(cands
        .into_iter()
        .map(|v| LoaderBuild {
            stable: !neoforge_prerelease(&v),
            recommended: rec.as_deref() == Some(v.as_str()),
            version: v,
        })
        .collect())
}

/// Builds available for a loader on one Minecraft version, newest first.
pub async fn list_loader_versions(loader: &str, mc_version: &str) -> Result<Vec<LoaderBuild>, String> {
    if loader == "vanilla" || mc_version.is_empty() || mc_version == "latest" {
        return Ok(vec![]);
    }
    let cache_dir = game_root_ready()?.join("loader-cache");
    match loader {
        "fabric" | "quilt" => fabric_like(loader, mc_version, &cache_dir).await,
        "forge" => forge(mc_version, &cache_dir).await,
        "neoforge" => neoforge(mc_version, &cache_dir).await,
        _ => Err(format!("Неизвестный загрузчик: {}", loader)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// вход -> вердикт: формат записей Forge менялся, и суффикс "-<mc>" у 1.7.10
    /// раньше попадал в номер сборки, из-за чего инсталлер качался по битому URL.
    #[test]
    fn forge_builds_strip_mc_prefix_and_suffix() {
        let meta = json!({
            "1.20.1": ["1.20.1-47.0.0", "1.20.1-47.4.22"],
            "1.7.10": ["1.7.10-10.13.4.1566-1.7.10", "1.7.10-10.13.4.1614-1.7.10"],
        });
        assert_eq!(
            forge_builds(&meta, "1.20.1"),
            vec!["47.4.22", "47.0.0"],
            "список Forge должен идти от новых к старым и без префикса версии MC"
        );
        assert_eq!(
            forge_builds(&meta, "1.7.10"),
            vec!["10.13.4.1614", "10.13.4.1566"],
            "хвост «-<версия MC>» у старых сборок не должен попадать в номер сборки"
        );
        assert!(forge_builds(&meta, "1.21.4").is_empty(), "у версии без сборок список пустой");
    }

    /// Сортировка по строке ставит 21.1.9 выше 21.1.248 — рекомендованной
    /// оказалась бы не та сборка.
    #[test]
    fn neoforge_builds_are_numeric_and_scoped_to_mc() {
        let list = json!({ "versions": [
            "21.0.167", "21.1.9", "21.1.248", "21.1.100", "21.1.0-beta", "20.4.1",
        ]});
        assert_eq!(
            neoforge_builds(&list, "1.21.1"),
            vec!["21.1.248", "21.1.100", "21.1.9", "21.1.0-beta"],
            "сборки NeoForge сортируются числами, а не строками"
        );
        assert_eq!(
            neoforge_builds(&list, "1.21"),
            vec!["21.0.167"],
            "MC без третьего числа означает ветку x.0.y"
        );
    }

    /// вход -> вердикт: Minecraft перешёл на номера по годам ("26.2"), NeoForge
    /// повторяет их как "26.2.0.<сборка>". Старое правило «отбросить 1.» давало
    /// префикс "2.0.", список выходил пустым и установка падала с «NeoForge для
    /// этой версии не найден» на любой выбранной сборке.
    #[test]
    fn neoforge_builds_follow_year_based_mc_versions() {
        let list = json!({ "versions": [
            "21.1.248", "26.1.0.7", "26.1.2.9", "26.1.2.109", "26.2.0.9", "26.2.0.83",
            "26.2.0.12-beta", "26.3.0.1",
        ]});
        assert_eq!(
            neoforge_builds(&list, "26.2"),
            vec!["26.2.0.83", "26.2.0.12-beta", "26.2.0.9"],
            "у версии MC по годам сборки берутся из ветки 26.2.0.x"
        );
        assert_eq!(
            neoforge_builds(&list, "26.1.2"),
            vec!["26.1.2.109", "26.1.2.9"],
            "патч-версия MC по годам берёт свою ветку, а не соседнюю 26.1.0.x"
        );
        assert_eq!(
            neoforge_builds(&list, "26.1"),
            vec!["26.1.0.7"],
            "26.1 означает ветку 26.1.0.x и не подхватывает сборки версии 26.1.2"
        );
        assert!(
            neoforge_builds(&list, "26.4").is_empty(),
            "версия без сборок не должна подхватывать соседнюю ветку"
        );
        assert!(
            neoforge_prerelease("26.2.0.12-beta") && !neoforge_prerelease("26.2.0.83"),
            "квалификатор в номере отличает нестабильную сборку от релиза"
        );
    }
}
