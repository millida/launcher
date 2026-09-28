use crate::engine::*;

/// What one enabled jar registers with the loader.
#[derive(Debug, Clone)]
pub(crate) struct JarIds {
    pub file: String,
    pub own: String,
    pub provides: Vec<String>,
}

impl JarIds {
    fn registers(&self, id: &str) -> bool {
        self.own == id || self.provides.iter().any(|p| p == id)
    }
}

/// FML before 1.13 stops the game with «duplicate mod sources» whenever two jars
/// register one mod id, so such a build cannot start at all. The launcher is
/// one way it gets there: a mod asks for GTNHMixins, and the standalone jar goes
/// in next to UniMixins, which already registers it as a module.
pub(crate) fn legacy_forge(game_version: &str) -> bool {
    let key: Vec<u32> = game_version
        .split(|c: char| !c.is_ascii_digit())
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse().ok())
        .collect();
    key.first() == Some(&1) && key.get(1).is_some_and(|m| *m < 13)
}

/// The standalone jars another jar already covers as its module. Only a jar
/// that adds nothing beyond the composite goes: the composite registers the
/// whole set, so keeping it loses nothing the build had.
pub(crate) fn redundant_jars(jars: &[JarIds]) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for a in jars {
        if a.own.is_empty() {
            continue;
        }
        let covered = jars.iter().any(|b| {
            b.file != a.file
                && !out.contains(&b.file)
                && b.provides.iter().any(|p| p == &a.own)
                && a.provides.iter().all(|p| b.registers(p))
        });
        if covered {
            out.push(a.file.clone());
        }
    }
    out
}

/// Turns the redundant standalone jars off before a Forge 1.7.10-1.12.2 build
/// starts. Off, not deleted: the file stays in the build and can be switched
/// back on by hand.
pub async fn resolve_legacy_duplicates(profile: &str, game_version: &str) -> Vec<String> {
    if !legacy_forge(game_version) {
        return vec![];
    }
    let prof = profile.to_string();
    let Ok(metas) = tokio::task::spawn_blocking(move || scan_local_meta(&prof, "mod", false)).await else {
        return vec![];
    };
    let mods = profile_dir(profile).join(content_dir("mod"));
    let jars: Vec<JarIds> = metas
        .into_iter()
        .filter(|m| mods.join(&m.file_name).is_file())
        .map(|m| JarIds { file: m.file_name, own: m.mod_id, provides: m.provides })
        .collect();
    let mut off = vec![];
    for file in redundant_jars(&jars) {
        match toggle_content(profile, "mod", &file, false) {
            Ok(()) => off.push(file),
            Err(e) => eprintln!("[mods] дубль «{}» не выключился: {}", file, e),
        }
    }
    off
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jar(file: &str, own: &str, provides: &[&str]) -> JarIds {
        JarIds { file: file.into(), own: own.into(), provides: provides.iter().map(|s| s.to_string()).collect() }
    }

    fn unimixins() -> JarIds {
        jar(
            "+unimixins-all-1.7.10-0.3.1.jar",
            "unimixins",
            &["unimixins-mixin", "unimixins-compat", "mixingasm", "spongemixins", "mixinbooterlegacy", "gtnhmixins", "mixinextras"],
        )
    }

    /// build -> jars turned off. Each case is a state FML 1.7.10 either refuses
    /// to start or starts fine; only the first kind may lose a jar.
    #[test]
    fn only_a_standalone_copy_of_a_module_goes() {
        let cases: Vec<(Vec<JarIds>, Vec<&str>, &str)> = vec![
            (
                vec![unimixins(), jar("gtnhmixins-2.1.2.jar", "gtnhmixins", &[]), jar("angelica-2.2.5.jar", "angelica", &[])],
                vec!["gtnhmixins-2.1.2.jar"],
                "OneBlock 28.09: the standalone GTNHMixins next to UniMixins is the duplicate, UniMixins stays",
            ),
            (
                vec![jar("gtnhmixins-2.1.2.jar", "gtnhmixins", &["spongemixins"]), unimixins()],
                vec!["gtnhmixins-2.1.2.jar"],
                "the standalone that also answers for spongemixins adds nothing UniMixins lacks",
            ),
            (
                vec![jar("gtnhmixins-2.1.2.jar", "gtnhmixins", &["somethingelse"]), unimixins()],
                vec![],
                "a jar that registers an id the composite lacks is not a copy: removing it would lose a mod",
            ),
            (
                vec![unimixins(), jar("angelica-2.2.5.jar", "angelica", &[])],
                vec![],
                "a healthy pack is not touched",
            ),
            (
                vec![jar("a.jar", "same", &[]), jar("b.jar", "same", &[])],
                vec![],
                "two versions of one mod are not a module inside a composite; which one is right is not ours to guess",
            ),
            (
                vec![jar("x.jar", "", &[]), unimixins()],
                vec![],
                "a jar without metadata is never taken for a copy",
            ),
        ];
        for (jars, want, why) in cases {
            assert_eq!(redundant_jars(&jars), want, "{why}");
        }
    }

    #[test]
    fn two_composites_never_switch_each_other_off() {
        let a = jar("a.jar", "core", &["mod-a", "shared"]);
        let b = jar("b.jar", "shared", &["mod-a"]);
        let c = jar("c.jar", "mod-a", &["shared"]);
        let off = redundant_jars(&[a, b, c]);
        assert!(
            off.len() < 3 && off.iter().all(|f| f != "a.jar"),
            "the jar that registers the most stays, and the build always keeps a provider: {off:?}"
        );
    }

    #[test]
    fn duplicates_are_resolved_only_where_they_are_fatal() {
        let cases: [(&str, bool, &str); 6] = [
            ("1.7.10", true, "FML 1.7.10 refuses duplicate mod sources"),
            ("1.12.2", true, "and so does 1.12.2"),
            ("1.8.9", true, "every FML before the 1.13 rewrite"),
            ("1.13.2", false, "modern Forge resolves jar-in-jar copies itself"),
            ("1.20.1", false, "modern Forge"),
            ("26.2", false, "the year numbering is modern"),
        ];
        for (v, want, why) in cases {
            assert_eq!(legacy_forge(v), want, "{v}: {why}");
        }
    }
}
