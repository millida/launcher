// Performance mods by pins: for each loader and game version an exact Modrinth version of each mod, not "the latest release".
// The table ships inside the launcher (perf-profiles.json, built by scripts/perf-pins-gen.py) and can be replaced without a
// release by a newer copy from cdn.millida.net. A remote copy may only name mods of the shipped list, and the files still come
// from cdn.modrinth.com with Modrinth's own hashes.
use crate::engine::*;
use serde::Deserialize;
use std::sync::OnceLock;

const BUNDLED: &str = include_str!("perf-profiles.json");
const REMOTE_URL: &str = "https://cdn.millida.net/launcher/perf-profiles.json";
/// The remote copy is a refinement, never a reason to wait: past this the shipped table is used.
const REMOTE_BUDGET: std::time::Duration = std::time::Duration::from_secs(4);

#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pin {
    /// One job per slot; "renderer" is Sodium and its ports.
    pub slot: String,
    pub slug: String,
    /// Modrinth version id: the exact file, the same on every PC.
    pub version: String,
    #[serde(default)]
    pub number: String,
    /// Crashes or renders garbage next to OptiFine.
    #[serde(default)]
    pub optifine_clash: bool,
    /// Only on this system ("windows"): Ixeris fixes a Windows input path.
    #[serde(default)]
    pub os: Option<String>,
    /// Only for these graphics levels (RenderScale: "potato", "low"); such a
    /// pin is not part of the FPS boost set and is installed by the preset.
    #[serde(default)]
    pub levels: Vec<String>,
    /// Not next to any of these jars (OptiFine, shader loaders, Distant Horizons).
    #[serde(default)]
    pub conflicts: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct PinProfile {
    pub loader: String,
    pub game: String,
    pub mods: Vec<Pin>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PinDoc {
    pub rev: u64,
    /// Myths and dead mods: never installed by the launcher, whatever a table says.
    #[serde(default)]
    pub never: Vec<String>,
    /// Licence or taste: only when the player installs them by hand (Entity Culling, More Culling).
    #[serde(default)]
    pub manual_only: Vec<String>,
    pub profiles: Vec<PinProfile>,
}

pub(super) fn bundled() -> &'static PinDoc {
    static DOC: OnceLock<PinDoc> = OnceLock::new();
    DOC.get_or_init(|| serde_json::from_str(BUNDLED).expect("perf-profiles.json shipped with the launcher must parse"))
}

/// Slugs the launcher itself ships pins for. A remote table naming anything
/// else is refused whole: the copy on our CDN must not turn into a way to
/// install arbitrary mods.
fn known_slugs() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = bundled().profiles.iter().flat_map(|p| p.mods.iter().map(|m| m.slug.as_str())).collect();
    out.sort_unstable();
    out.dedup();
    out
}

pub(super) fn acceptable(remote: &PinDoc, shipped: &PinDoc, known: &[&str]) -> bool {
    remote.rev > shipped.rev
        && remote.profiles.iter().all(|p| {
            p.mods.iter().all(|m| known.contains(&m.slug.as_str()) && !m.version.is_empty() && m.version.len() <= 16 && m.version.chars().all(|c| c.is_ascii_alphanumeric()))
        })
}

/// The table to install from: a newer checked copy from our CDN, the shipped one otherwise.
pub(super) async fn current() -> PinDoc {
    let shipped = bundled().clone();
    let cache = data_dir().join("perf-profiles.json");
    let fetched = tokio::time::timeout(REMOTE_BUDGET, get_json_revalidated(REMOTE_URL, &cache)).await;
    let Ok(Ok(value)) = fetched else { return shipped };
    match serde_json::from_value::<PinDoc>(value) {
        Ok(remote) if acceptable(&remote, &shipped, &known_slugs()) => remote,
        _ => shipped,
    }
}

const THIS_OS: &str = if cfg!(windows) {
    "windows"
} else if cfg!(target_os = "macos") {
    "macos"
} else {
    "linux"
};

/// Pins for a build: Quilt takes the Fabric table. None when the table has no
/// row for this version: then the launcher installs no mods at all rather
/// than guessing with "the latest release".
pub(super) fn pins_for(doc: &PinDoc, loader: &str, game_version: &str) -> Option<Vec<Pin>> {
    let table = if loader == "quilt" { "fabric" } else { loader };
    let row = doc.profiles.iter().find(|p| p.loader == table && p.game == game_version)?;
    Some(
        row.mods
            .iter()
            .filter(|m| m.levels.is_empty())
            .filter(|m| !doc.never.contains(&m.slug) && !doc.manual_only.contains(&m.slug))
            .filter(|m| m.os.as_deref().is_none_or(|os| os == THIS_OS))
            .cloned()
            .collect(),
    )
}

/// Pins a graphics level adds on top of the boost set (RenderScale for Potato and Low).
pub(super) fn level_pins(doc: &PinDoc, loader: &str, game_version: &str, level: &str) -> Vec<Pin> {
    let table = if loader == "quilt" { "fabric" } else { loader };
    doc.profiles
        .iter()
        .find(|p| p.loader == table && p.game == game_version)
        .map(|row| {
            row.mods
                .iter()
                .filter(|m| m.levels.iter().any(|l| l == level))
                .filter(|m| !doc.never.contains(&m.slug) && !doc.manual_only.contains(&m.slug))
                .filter(|m| m.os.as_deref().is_none_or(|os| os == THIS_OS))
                .cloned()
                .collect()
        })
        .unwrap_or_default()
}

/// Whether the shipped table has mods for this build (for the interface, which must not wait for the network).
pub fn pins_exist(loader: &str, game_version: &str) -> bool {
    pins_for(bundled(), loader, game_version).is_some_and(|p| !p.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shipped table: parses, has no myths and no licence-restricted mods,
    /// pins exact versions and covers the versions most of the fleet plays
    /// (launcher_pack_sessions, 7 days to 27.10.2026).
    #[test]
    fn the_shipped_table_is_strict_and_covers_the_fleet() {
        let doc = bundled();
        for p in &doc.profiles {
            for m in &p.mods {
                assert!(!doc.never.contains(&m.slug), "{} {}: {} is a myth or dead", p.loader, p.game, m.slug);
                assert!(!doc.manual_only.contains(&m.slug), "{} {}: {} only by hand", p.loader, p.game, m.slug);
                assert!(!m.version.is_empty(), "{} {}: {} without a pinned version", p.loader, p.game, m.slug);
            }
            let renderers = p.mods.iter().filter(|m| m.slot == "renderer").count();
            assert!(renderers <= 1, "{} {}: two renderers crash on start", p.loader, p.game);
        }
        for (loader, game) in [("fabric", "1.21.11"), ("fabric", "26.3"), ("fabric", "26.2"), ("neoforge", "1.21.1"), ("forge", "1.20.1"), ("fabric", "1.21.1")] {
            assert!(pins_exist(loader, game), "{loader} {game} is among the most played and must have pins");
        }
        for (loader, game, slug, want) in [
            ("fabric", "1.21.1", "dynamic-fps", true),
            ("fabric", "1.21.11", "dynamic-fps", false),
            ("fabric", "1.21.11", "modernfix-mvus", true),
            ("fabric", "1.21.11", "modernfix", false),
            ("fabric", "1.21.8", "modernfix", false),
            ("fabric", "1.21.4", "modernfix", true),
        ] {
            let has = pins_for(doc, loader, game).unwrap_or_default().iter().any(|m| m.slug == slug);
            assert_eq!(has, want, "{loader} {game} {slug}: Dynamic FPS only before 1.21.2, ModernFix and its mVUS fork by version");
        }
        assert!(pins_for(doc, "quilt", "1.21.11").is_some(), "Quilt takes the Fabric table");
        // RenderScale: only Potato and Low, only stable releases, never in the boost set.
        let scale = |loader: &str, game: &str, level: &str| level_pins(doc, loader, game, level).iter().any(|m| m.slug == "renderscale");
        assert!(scale("fabric", "1.21.1", "potato") && scale("fabric", "1.21.1", "low"), "1.21.1 has a stable RenderScale");
        assert!(!scale("fabric", "1.21.1", "standard"), "only the light levels scale the world");
        assert!(!scale("fabric", "26.3", "potato"), "26.x has only betas of RenderScale — not installed");
        assert!(!scale("fabric", "1.21.11", "potato"), "1.21.11 has only betas too");
        assert!(scale("forge", "1.20.1", "potato"), "Forge 1.20.1 has a stable release");
        assert!(
            !pins_for(doc, "fabric", "1.21.1").unwrap_or_default().iter().any(|m| m.slug == "renderscale"),
            "the boost set never carries a level-only mod"
        );
        for p in &doc.profiles {
            for m in p.mods.iter().filter(|m| m.slug == "renderscale") {
                for c in ["optifine", "iris", "oculus", "distanthorizons"] {
                    assert!(m.conflicts.iter().any(|x| x == c), "{} {}: RenderScale must stay away from {c}", p.loader, p.game);
                }
            }
        }
        assert!(pins_for(doc, "fabric", "1.13.2").is_none(), "no row means no guessing");
    }

    /// A remote table is taken only when it is newer and names nothing beyond
    /// the shipped mods with plain Modrinth version ids.
    #[test]
    fn a_remote_table_cannot_name_new_mods() {
        let shipped = bundled();
        let known = known_slugs();
        let mut newer = shipped.clone();
        newer.rev = shipped.rev + 1;
        assert!(acceptable(&newer, shipped, &known), "a newer table of the same mods");
        let same = shipped.clone();
        assert!(!acceptable(&same, shipped, &known), "not newer — keep the shipped one");
        let mut foreign = newer.clone();
        foreign.profiles[0].mods[0].slug = "some-miner".into();
        assert!(!acceptable(&foreign, shipped, &known), "a mod the launcher never shipped");
        let mut odd = newer;
        odd.profiles[0].mods[0].version = "../../x".into();
        assert!(!acceptable(&odd, shipped, &known), "a version id is letters and digits only");
    }
}
