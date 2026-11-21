// A mod that brings its own loading screen for Forge/NeoForge, set as the one the loader opens.
//
// The loader opens the provider named by `earlyWindowProvider` in `config/fml.toml` of the build,
// and only one. A mod such as Stargate Early Loading checks that line itself and, when it names
// someone else, stops the game with a Swing question «update the config and exit?». On macOS the
// game runs with `-XstartOnFirstThread`, the question never reaches the screen, and the build hangs
// forever on its first log line with no window at all. So the launcher writes the name before the
// start, when exactly one such mod is in the build; with several it cannot choose for the player.
use std::io::Read;
use std::path::Path;

/// The service files a loading-screen provider is registered in: NeoForge, then Forge 1.20+.
const SERVICES: [&str; 2] = [
    "META-INF/services/net.neoforged.neoforgespi.earlywindow.ImmediateWindowProvider",
    "META-INF/services/net.minecraftforge.fml.loading.ImmediateWindowProvider",
];

/// The loader's own loading screen: never in `mods/`, but a jar could list it all the same.
const LOADER_OWN: &str = "fmlearlywindow";

/// One loading-screen provider found in an enabled jar of the build.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Provider {
    pub jar: String,
    /// What its `name()` returns: the value `earlyWindowProvider` has to hold. None when the
    /// name is not a plain constant (inherited, computed), so it cannot be read without running it.
    pub name: Option<String>,
}

/// What the launch does with the loading screen of the build.
#[derive(Debug, PartialEq)]
pub(crate) enum EarlyWindow {
    /// Nothing to change: no such mod, or the config already names one of them.
    Keep,
    /// The single provider of the build, to be written into `fml.toml`.
    Set { name: String, jar: String },
    /// Several providers, or one whose name could not be read: the player has to choose.
    Manual { jars: Vec<String> },
}

/// The decision for the providers of the build and the name the config holds now.
pub(crate) fn decide(found: &[Provider], current: Option<&str>) -> EarlyWindow {
    let found: Vec<&Provider> = found
        .iter()
        .filter(|p| p.name.as_deref() != Some(LOADER_OWN))
        .collect();
    if found.is_empty() {
        return EarlyWindow::Keep;
    }
    // A choice the player (or an earlier launch) already made stays.
    if let Some(cur) = current {
        if found.iter().any(|p| p.name.as_deref() == Some(cur)) {
            return EarlyWindow::Keep;
        }
    }
    let mut names: Vec<&str> = found.iter().filter_map(|p| p.name.as_deref()).collect();
    names.sort_unstable();
    names.dedup();
    let unnamed = found.iter().any(|p| p.name.is_none());
    if names.len() == 1 && !unnamed {
        let jar = found
            .iter()
            .find(|p| p.name.as_deref() == Some(names[0]))
            .map(|p| p.jar.clone())
            .unwrap_or_default();
        return EarlyWindow::Set {
            name: names[0].to_string(),
            jar,
        };
    }
    let mut jars: Vec<String> = found.iter().map(|p| p.jar.clone()).collect();
    jars.sort();
    jars.dedup();
    EarlyWindow::Manual { jars }
}

/// The value of `earlyWindowProvider` in the text of `fml.toml`, if the line is there.
pub(crate) fn current_provider(fml: &str) -> Option<String> {
    let table: toml::Table = fml.parse().ok()?;
    table
        .get("earlyWindowProvider")?
        .as_str()
        .map(str::to_string)
}

/// The text of `fml.toml` with `earlyWindowProvider` set to `name`. Only that line changes, so the
/// loader's comments and the player's other settings stay as they were.
pub(crate) fn with_provider(fml: &str, name: &str) -> String {
    let line = format!(
        "earlyWindowProvider = \"{}\"",
        name.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let mut done = false;
    let mut out: Vec<String> = fml
        .lines()
        .map(|l| {
            let key = l.trim_start();
            let is_key = key
                .strip_prefix("earlyWindowProvider")
                .is_some_and(|rest| rest.trim_start().starts_with('='));
            if is_key && !done {
                done = true;
                line.clone()
            } else {
                l.to_string()
            }
        })
        .collect();
    if !done {
        // A top-level key must stand before the first table, or it would land inside it.
        let at = out
            .iter()
            .position(|l| l.trim_start().starts_with('['))
            .unwrap_or(out.len());
        out.insert(at, line);
    }
    let mut text = out.join("\n");
    text.push('\n');
    text
}

/// The constant a provider class returns from `name()`: javac compiles `return "X";` (and a
/// `static final String` constant) into `ldc #n; areturn`. Anything else reads as None.
pub(crate) fn provider_name(class: &[u8]) -> Option<String> {
    let mut r = ClassReader { b: class, at: 0 };
    if r.u4()? != 0xCAFE_BABE {
        return None;
    }
    r.skip(4)?;
    let count = r.u2()? as usize;
    // Utf8 texts by index, and String entries pointing at them.
    let mut utf8: Vec<Option<&[u8]>> = vec![None; count];
    let mut strings: Vec<Option<u16>> = vec![None; count];
    let mut i = 1;
    while i < count {
        match r.u1()? {
            1 => {
                let len = r.u2()? as usize;
                utf8[i] = Some(r.take(len)?);
            }
            8 => strings[i] = Some(r.u2()?),
            7 | 16 | 19 | 20 => r.skip(2)?,
            15 => r.skip(3)?,
            3 | 4 | 9 | 10 | 11 | 12 | 17 | 18 => r.skip(4)?,
            5 | 6 => {
                r.skip(8)?;
                i += 1;
            }
            _ => return None,
        }
        i += 1;
    }
    let text = |idx: usize| utf8.get(idx).copied().flatten();
    r.skip(6)?;
    let interfaces = r.u2()? as usize;
    r.skip(interfaces * 2)?;
    let fields = r.u2()?;
    for _ in 0..fields {
        r.skip(6)?;
        r.skip_attributes()?;
    }
    let methods = r.u2()?;
    for _ in 0..methods {
        r.skip(2)?;
        let name = text(r.u2()? as usize);
        let desc = text(r.u2()? as usize);
        let wanted =
            name == Some(b"name".as_slice()) && desc == Some(b"()Ljava/lang/String;".as_slice());
        let attrs = r.u2()?;
        for _ in 0..attrs {
            let attr = text(r.u2()? as usize);
            let len = r.u4()? as usize;
            let body = r.take(len)?;
            if !wanted || attr != Some(b"Code".as_slice()) {
                continue;
            }
            // max_stack, max_locals, code_length, then the code itself.
            let code = body.get(8..)?;
            let (idx, next) = match *code.first()? {
                0x12 => (*code.get(1)? as usize, 2),
                0x13 => (
                    u16::from_be_bytes([*code.get(1)?, *code.get(2)?]) as usize,
                    3,
                ),
                _ => return None,
            };
            if *code.get(next)? != 0xB0 {
                return None;
            }
            let s = strings.get(idx).copied().flatten()?;
            return text(s as usize)
                .map(|b| String::from_utf8_lossy(b).into_owned())
                .filter(|s| !s.is_empty());
        }
    }
    None
}

struct ClassReader<'a> {
    b: &'a [u8],
    at: usize,
}

impl<'a> ClassReader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.at..self.at.checked_add(n)?)?;
        self.at += n;
        Some(s)
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        self.take(n).map(|_| ())
    }
    fn u1(&mut self) -> Option<u8> {
        self.take(1).map(|s| s[0])
    }
    fn u2(&mut self) -> Option<u16> {
        self.take(2).map(|s| u16::from_be_bytes([s[0], s[1]]))
    }
    fn u4(&mut self) -> Option<u32> {
        self.take(4)
            .map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn skip_attributes(&mut self) -> Option<()> {
        for _ in 0..self.u2()? {
            self.skip(2)?;
            let len = self.u4()? as usize;
            self.skip(len)?;
        }
        Some(())
    }
}

/// Small entries only: a service file or a class is kilobytes, a hostile jar may claim gigabytes.
const ENTRY_CAP: u64 = 4 << 20;

fn entry<R: std::io::Read + std::io::Seek>(
    jar: &mut zip::ZipArchive<R>,
    name: &str,
) -> Option<Vec<u8>> {
    let f = jar.by_name(name).ok()?;
    let mut out = Vec::new();
    f.take(ENTRY_CAP).read_to_end(&mut out).ok()?;
    Some(out)
}

/// The loading-screen providers one jar registers.
pub(crate) fn jar_providers(path: &Path) -> Vec<Provider> {
    let jar_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let Ok(file) = std::fs::File::open(path) else {
        return vec![];
    };
    let Ok(mut jar) = zip::ZipArchive::new(std::io::BufReader::new(file)) else {
        return vec![];
    };
    let mut out = vec![];
    for service in SERVICES {
        let Some(list) = entry(&mut jar, service) else {
            continue;
        };
        for line in String::from_utf8_lossy(&list).lines() {
            let class = line.split('#').next().unwrap_or("").trim();
            if class.is_empty() {
                continue;
            }
            let name = entry(&mut jar, &format!("{}.class", class.replace('.', "/")))
                .and_then(|b| provider_name(&b));
            out.push(Provider {
                jar: jar_name.clone(),
                name,
            });
        }
    }
    out
}

/// Every provider in the enabled jars of `mods/`. A turned-off mod (`.jar.disabled`) is not loaded,
/// so it does not count.
fn build_providers(game_dir: &Path) -> Vec<Provider> {
    let Ok(dir) = std::fs::read_dir(game_dir.join("mods")) else {
        return vec![];
    };
    let mut jars: Vec<_> = dir
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|x| x.eq_ignore_ascii_case("jar")))
        .collect();
    jars.sort();
    jars.iter().flat_map(|p| jar_providers(p)).collect()
}

/// Sets the loading screen of the build before it starts. Returns what was decided; on `Set` the
/// config is already written (a failed write turns into `Manual`, so the player still hears of it).
pub(crate) fn settle_early_window(game_dir: &Path) -> EarlyWindow {
    let found = build_providers(game_dir);
    if found.is_empty() {
        return EarlyWindow::Keep;
    }
    let path = game_dir.join("config").join("fml.toml");
    // No file yet is a build that never started; a file that cannot be read is not overwritten.
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(_) => {
            let mut jars: Vec<String> = found.into_iter().map(|p| p.jar).collect();
            jars.sort();
            jars.dedup();
            return EarlyWindow::Manual { jars };
        }
    };
    let verdict = decide(&found, current_provider(&text).as_deref());
    if let EarlyWindow::Set { name, jar } = &verdict {
        let tmp = path.with_extension("toml.millida-tmp");
        let wrote = std::fs::create_dir_all(game_dir.join("config"))
            .and_then(|_| std::fs::write(&tmp, with_provider(&text, name)))
            .and_then(|_| std::fs::rename(&tmp, &path));
        if let Err(e) = wrote {
            eprintln!("[early-window] could not write {}: {}", path.display(), e);
            return EarlyWindow::Manual {
                jars: vec![jar.clone()],
            };
        }
        eprintln!(
            "[early-window] {} set as the loading screen ({})",
            name, jar
        );
    }
    verdict
}

/// What the window is told when the player has to pick the loading screen by hand.
#[derive(serde::Serialize, Clone)]
pub(crate) struct EarlyWindowNotice {
    pub profile: String,
    pub mods: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(jar: &str, name: Option<&str>) -> Provider {
        Provider {
            jar: jar.into(),
            name: name.map(str::to_string),
        }
    }

    /// (providers, current value, expected, why)
    #[test]
    fn the_launch_picks_only_when_there_is_one_choice() {
        let stargate = p(
            "StargateEarlyLoading-1.0-neoforge.jar",
            Some("StargateEarlyLoading"),
        );
        let other = p("FancyScreen-2.0.jar", Some("fancy"));
        let cases: Vec<(Vec<Provider>, Option<&str>, EarlyWindow, &str)> = vec![
            (vec![], Some("fmlearlywindow"), EarlyWindow::Keep, "no provider in the build: the loader's own screen stays"),
            (
                vec![stargate.clone()],
                Some("fmlearlywindow"),
                EarlyWindow::Set { name: "StargateEarlyLoading".into(), jar: stargate.jar.clone() },
                "the one provider replaces the default, or the mod hangs the game on its hidden question",
            ),
            (
                vec![stargate.clone()],
                None,
                EarlyWindow::Set { name: "StargateEarlyLoading".into(), jar: stargate.jar.clone() },
                "a build that never started has no fml.toml yet",
            ),
            (vec![stargate.clone()], Some("StargateEarlyLoading"), EarlyWindow::Keep, "already set: nothing is rewritten"),
            (
                vec![stargate.clone(), other.clone()],
                Some("fmlearlywindow"),
                EarlyWindow::Manual { jars: vec![other.jar.clone(), stargate.jar.clone()] },
                "two providers: the launcher does not choose for the player",
            ),
            (vec![stargate.clone(), other.clone()], Some("fancy"), EarlyWindow::Keep, "with two, a choice already in the config stays"),
            (
                vec![p("Odd.jar", None)],
                Some("fmlearlywindow"),
                EarlyWindow::Manual { jars: vec!["Odd.jar".into()] },
                "a name that cannot be read is asked about, not guessed",
            ),
            (vec![p("x.jar", Some("fmlearlywindow"))], Some("fmlearlywindow"), EarlyWindow::Keep, "the loader's own screen is not a third-party one"),
        ];
        for (found, current, want, why) in cases {
            assert_eq!(decide(&found, current), want, "{}", why);
        }
    }

    #[test]
    fn only_the_provider_line_of_fml_toml_changes() {
        let fml = "#Should we control the window.\nearlyWindowControl = true\n#Early window provider\nearlyWindowProvider = \"fmlearlywindow\"\nearlyWindowWidth = 854\ndependencyOverrides = {}\n";
        let out = with_provider(fml, "StargateEarlyLoading");
        assert_eq!(
            current_provider(&out).as_deref(),
            Some("StargateEarlyLoading")
        );
        assert_eq!(
            out,
            fml.replace("\"fmlearlywindow\"", "\"StargateEarlyLoading\""),
            "comments and other keys stay as they were"
        );
        assert_eq!(
            current_provider(&with_provider("", "X")).as_deref(),
            Some("X"),
            "a missing file becomes one line the loader completes itself"
        );
        let tabled = "maxThreads = -1\n[dependencyOverrides]\na = [\"-b\"]\n";
        let t: toml::Table = with_provider(tabled, "X").parse().unwrap();
        assert_eq!(
            t.get("earlyWindowProvider").and_then(|v| v.as_str()),
            Some("X"),
            "the key goes before the first table, not inside it"
        );
    }

    /// A class file with one method `name()Ljava/lang/String;` whose code is `code`, the
    /// constant pool holding the Utf8 "StargateEarlyLoading" at #5 and a String to it at #6.
    fn class_with(code: &[u8]) -> Vec<u8> {
        let utf8 = |s: &str| {
            let mut v = vec![1u8];
            v.extend((s.len() as u16).to_be_bytes());
            v.extend(s.as_bytes());
            v
        };
        let mut b = vec![0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 65];
        b.extend(8u16.to_be_bytes()); // entries #1..#7
        b.extend(utf8("name")); // #1
        b.extend(utf8("()Ljava/lang/String;")); // #2
        b.extend(utf8("Code")); // #3
        b.extend([5u8, 0, 0, 0, 0, 0, 0, 0, 0]); // #4 Long, takes #4 and #5's slot
        b.extend(utf8("StargateEarlyLoading")); // #6
        b.extend([8u8, 0, 6]); // #7 String -> #6
        b.extend([0, 0x21, 0, 0, 0, 0]); // access, this, super
        b.extend([0, 0]); // interfaces
        b.extend([0, 0]); // fields
        b.extend([0, 1]); // methods
        b.extend([0, 1, 0, 1, 0, 2, 0, 1]); // access, name #1, desc #2, one attribute
        let mut attr = vec![0, 1, 0, 1];
        attr.extend((code.len() as u32).to_be_bytes());
        attr.extend(code);
        attr.extend([0, 0, 0, 0]); // exception table, attributes
        b.extend([0, 3]);
        b.extend((attr.len() as u32).to_be_bytes());
        b.extend(attr);
        b.extend([0, 0]); // class attributes
        b
    }

    #[test]
    fn the_name_is_read_from_the_constant_name_returns() {
        assert_eq!(
            provider_name(&class_with(&[0x12, 7, 0xB0])).as_deref(),
            Some("StargateEarlyLoading"),
            "ldc #7; areturn"
        );
        assert_eq!(
            provider_name(&class_with(&[0x13, 0, 7, 0xB0])).as_deref(),
            Some("StargateEarlyLoading"),
            "ldc_w #7; areturn"
        );
        assert_eq!(
            provider_name(&class_with(&[0x2A, 0xB4, 0, 1, 0xB0])),
            None,
            "a field read is not a constant: asked, not guessed"
        );
        assert_eq!(
            provider_name(&class_with(&[0x12, 7])),
            None,
            "cut-off code is not read past its end"
        );
        assert_eq!(provider_name(b"not a class"), None);
    }
}
