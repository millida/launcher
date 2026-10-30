// Reference launches: twenty builds whose Java command line must not change by accident. Each case
// is a real version description (Mojang, Fabric, Quilt, Forge, NeoForge; tests/data/launch) with
// an account, settings and a machine; the test builds what the launcher would start and compares it
// with the file in tests/data/launch/snapshots. A difference fails the test and names the first line
// that moved. A change that is meant gets new files: `MILLIDA_SNAPSHOTS=update cargo test launch_snap`.
// Nothing here touches the network or the player's folders: the game root is the made-up `/G`.
use super::*;
use crate::engine::*;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(super) const ROOT: &str = "/G";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Account {
    Offline,
    Microsoft,
    Millida,
}

/// One reference launch.
pub(super) struct Case {
    pub name: &'static str,
    pub platform: Platform,
    /// tests/data/launch/versions/<version>.json
    pub version: &'static str,
    pub loader: &'static str,
    /// tests/data/launch/loaders/<file>.json: a Fabric/Quilt profile or a Forge/NeoForge version.
    pub loader_json: Option<&'static str>,
    pub account: Account,
    pub nick: &'static str,
    pub settings: Value,
    pub heap: HeapAsk,
    pub machine: Machine,
    pub java_major: u32,
    /// Our mod went into the build, so the game gets its token.
    pub own_mod: bool,
    pub telemetry: bool,
    pub party: Option<&'static str>,
    pub world: Option<&'static str>,
    pub server: Option<&'static str>,
    /// A catalogue build that brings its own game (the protected-pack path).
    pub pack: Option<PackLaunch>,
}

pub(super) const WIN: Platform = Platform { os: "windows", arch: "x86_64", bits: "64" };
pub(super) const MAC: Platform = Platform { os: "osx", arch: "arm64", bits: "64" };
pub(super) const LINUX: Platform = Platform { os: "linux", arch: "x86_64", bits: "64" };

const MACHINE_16: Machine = Machine { total_mb: 16384, available_mb: 9000 };
const MACHINE_8: Machine = Machine { total_mb: 8192, available_mb: 3500 };
const MACHINE_4: Machine = Machine { total_mb: 4096, available_mb: 1500 };
const MACHINE_32: Machine = Machine { total_mb: 32768, available_mb: 20000 };

pub(super) const MILLIDA_UUID: &str = "c6d9db59f6fc4b81a447cd6b60936a6f";
pub(super) const MS_UUID: &str = "069a79f444e94726a5befca90e38aaf5";
pub(super) const AGENT_JAR: &str = "/D/agents/authlib-injector.jar";

fn auto(mods: u32, shaders: bool) -> HeapAsk {
    HeapAsk { requested: 0, manual: 0, auto_tune: true, mods, shaders }
}

fn base(name: &'static str, version: &'static str, loader: &'static str, loader_json: Option<&'static str>) -> Case {
    Case {
        name,
        platform: WIN,
        version,
        loader,
        loader_json,
        account: Account::Offline,
        nick: "Steve",
        settings: json!({}),
        heap: auto(0, false),
        machine: MACHINE_16,
        java_major: 21,
        own_mod: false,
        telemetry: true,
        party: None,
        world: None,
        server: None,
        pack: None,
    }
}

// The module is test-only already; the mark also tells the i18n scan (scripts/i18n-extract.mjs)
// that the world name below is not a text the player sees.
#[cfg(test)]
pub(super) fn cases() -> Vec<Case> {
    vec![
        Case { java_major: 8, ..base("vanilla-1.7.10-offline", "1.7.10", "vanilla", None) },
        Case { java_major: 8, account: Account::Microsoft, nick: "Notch", ..base("vanilla-1.8.9-microsoft", "1.8.9", "vanilla", None) },
        Case { java_major: 8, account: Account::Millida, nick: "BrainMcpe55", ..base("vanilla-1.12.2-millida", "1.12.2", "vanilla", None) },
        Case {
            java_major: 8,
            server: Some("mc.example.net:25570"),
            machine: MACHINE_4,
            ..base("vanilla-1.16.5-offline-server-4gb", "1.16.5", "vanilla", None)
        },
        Case { platform: MAC, java_major: 17, account: Account::Microsoft, ..base("vanilla-1.20.1-macos-microsoft", "1.20.1", "vanilla", None) },
        Case {
            account: Account::Millida,
            world: Some("Новый мир"),
            settings: json!({"width": 1600, "height": 900}),
            ..base("vanilla-1.21.1-millida-world", "1.21.1", "vanilla", None)
        },
        Case { java_major: 25, ..base("vanilla-26.3-offline", "26.3", "vanilla", None) },
        Case {
            platform: LINUX,
            java_major: 21,
            heap: HeapAsk { requested: 0, manual: 0, auto_tune: false, mods: 0, shaders: false },
            machine: MACHINE_32,
            ..base("vanilla-26.3-linux-java21-autotune-off", "26.3", "vanilla", None)
        },
        Case {
            java_major: 17,
            account: Account::Millida,
            own_mod: true,
            heap: auto(64, false),
            ..base("fabric-1.20.1-millida-mod", "1.20.1", "fabric", Some("fabric-1.20.1-0.19.5"))
        },
        Case {
            account: Account::Microsoft,
            heap: auto(120, true),
            machine: MACHINE_8,
            ..base("fabric-1.21.1-microsoft-shaders-8gb", "1.21.1", "fabric", Some("fabric-1.21.1-0.16.14"))
        },
        Case {
            java_major: 25,
            settings: json!({"fpsBoost": true, "jvmArgs": "-XX:+UseZGC -Xss2M -javaagent:/evil.jar"}),
            heap: auto(30, false),
            ..base("fabric-26.2-offline-boost-own-gc", "26.2", "fabric", Some("fabric-26.2-0.19.5"))
        },
        Case { java_major: 17, heap: auto(12, false), ..base("quilt-1.20.1-offline", "1.20.1", "quilt", Some("quilt-1.20.1-0.29.2")) },
        Case {
            java_major: 25,
            account: Account::Millida,
            own_mod: true,
            telemetry: false,
            ..base("quilt-26.3-millida-mod-no-telemetry", "26.3", "quilt", Some("quilt-26.3-0.20.0-beta.9"))
        },
        Case { java_major: 8, heap: auto(40, false), ..base("forge-1.7.10-offline", "1.7.10", "forge", Some("forge-1.7.10-10.13.4.1614")) },
        Case {
            java_major: 8,
            settings: json!({"fpsBoost": true}),
            heap: auto(90, false),
            ..base("forge-1.12.2-boost-on-java-8", "1.12.2", "forge", Some("forge-1.12.2-14.23.5.2860"))
        },
        Case {
            java_major: 8,
            account: Account::Microsoft,
            heap: auto(160, false),
            machine: MACHINE_32,
            ..base("forge-1.16.5-microsoft-32gb", "1.16.5", "forge", Some("forge-1.16.5-36.2.42"))
        },
        Case {
            java_major: 17,
            account: Account::Millida,
            own_mod: true,
            heap: HeapAsk { requested: 0, manual: 6144, auto_tune: false, mods: 200, shaders: false },
            settings: json!({"jvmArgs": "-XX:MaxGCPauseMillis=200 -Dfile.encoding=windows-1251", "autoTune": false, "ramMb": 6144}),
            ..base("forge-1.20.1-millida-mod-manual-ram", "1.20.1", "forge", Some("forge-1.20.1-47.4.10"))
        },
        Case { java_major: 17, heap: auto(80, false), ..base("neoforge-1.20.1-offline", "1.20.1", "neoforge", Some("neoforge-1.20.1-47.1.106")) },
        Case {
            account: Account::Millida,
            own_mod: true,
            party: Some("party-42"),
            heap: auto(260, true),
            server: Some("mpvp.millida.host"),
            ..base("neoforge-21.1.209-millida-mod-party-server", "1.21.1", "neoforge", Some("neoforge-21.1.209"))
        },
        Case {
            java_major: 17,
            account: Account::Millida,
            heap: HeapAsk { requested: 4096, manual: 0, auto_tune: true, mods: 300, shaders: false },
            settings: json!({"fpsBoost": true}),
            pack: Some(sample_pack()),
            ..base("pack-1.20.1-protected-millida", "1.20.1", "forge", None)
        },
    ]
}

fn sample_pack() -> PackLaunch {
    PackLaunch {
        slug: "arcania".into(),
        main_class: "cpw.mods.bootstraplauncher.BootstrapLauncher".into(),
        asset_index: String::new(),
        assets_dir: "assets".into(),
        natives_dir: "natives".into(),
        class_path: vec!["libraries".into(), "minecraft.jar".into()],
        module_path: vec![],
        jvm_args: vec!["-Dfml.ignorePatchDiscrepancies=true".into(), "-Dfml.ignoreInvalidMinecraftCertificates=true".into()],
        game_args: vec![],
        vanilla_assets: "1.20.1".into(),
        java_major: 17,
        min_ram_mb: 6144,
        max_ram_mb: 10240,
        needs_token: true,
    }
}

/// The launch key a paid pack gets from the API (made up).
pub(super) fn pack_token() -> Vec<String> {
    vec!["-Dmillida.pack.key=k-123".into(), "-Dmillida.pack.sig=s-456".into()]
}

/// The pack's own files as `pack_classpath` would list them.
pub(super) fn pack_files(game_dir: &Path) -> Vec<PathBuf> {
    ["libraries/cpw/bootstraplauncher-1.1.2.jar", "libraries/net/minecraftforge/fmlloader-1.20.1-47.4.10.jar", "minecraft.jar"]
        .iter()
        .map(|r| game_dir.join(r))
        .collect()
}

pub(super) fn fixture(rel: &str) -> Value {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/launch").join(rel);
    let raw = std::fs::read(&path).unwrap_or_else(|e| panic!("{}: {}", path.display(), e));
    serde_json::from_slice(&raw).unwrap_or_else(|e| panic!("{}: {}", path.display(), e))
}

pub(super) fn auth_of(account: Account) -> Auth {
    match account {
        Account::Offline => Auth::default(),
        Account::Microsoft => Auth { token: "ms-token".into(), uuid: MS_UUID.into(), xuid: "2535428504476914".into(), yggdrasil: String::new() },
        Account::Millida => Auth { token: "ygg-token".into(), uuid: MILLIDA_UUID.into(), xuid: String::new(), yggdrasil: millida_yggdrasil() },
    }
}

/// What the skin server gave: the agent and the description handed to it ahead of the game.
pub(super) fn skin_args(account: Account) -> (Option<String>, Option<String>) {
    if account != Account::Millida {
        return (None, None);
    }
    use base64::Engine as _;
    let meta = json!({"meta": {"serverName": "Millida"}, "skinDomains": ["millida.net"]});
    (
        Some(format!("-javaagent:{}={}", AGENT_JAR, millida_yggdrasil())),
        Some(format!("-Dauthlibinjector.yggdrasil.prefetched={}", base64::engine::general_purpose::STANDARD.encode(meta.to_string()))),
    )
}

/// What the launch puts together, before it becomes text.
pub(super) struct Built {
    pub main_class: String,
    pub classpath: Vec<PathBuf>,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Paths in one spelling whatever system the test runs on.
fn norm(s: &str) -> String {
    s.replace('\\', "/")
}

pub(super) fn render(case: &Case, b: &Built) -> String {
    let mut out = String::new();
    out.push_str(&format!("# {}\n", case.name));
    out.push_str(&format!("platform: {} {}, java {}\n", case.platform.os, case.platform.arch, case.java_major));
    out.push_str(&format!("main: {}\n", b.main_class));
    let joined = b.classpath.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>().join(case.platform.path_sep());
    out.push_str(&format!("classpath ({}):\n", b.classpath.len()));
    for p in &b.classpath {
        out.push_str(&format!("  {}\n", norm(&p.to_string_lossy())));
    }
    let main_at = b.args.iter().position(|a| *a == b.main_class);
    out.push_str("jvm:\n");
    for (i, a) in b.args.iter().enumerate() {
        if Some(i) == main_at {
            out.push_str("game:\n");
            continue;
        }
        let shown = if !joined.is_empty() && *a == joined { "${classpath}".to_string() } else { norm(a) };
        out.push_str(&format!("  {}\n", shown));
    }
    out.push_str("env:\n");
    for (k, v) in &b.env {
        out.push_str(&format!("  {}={}\n", k, v));
    }
    out
}

fn snapshot_path(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/launch/snapshots").join(format!("{}.txt", name))
}

/// Compares every case with its file; `MILLIDA_SNAPSHOTS=update` writes the files instead.
pub(super) fn check_snapshots(build: impl Fn(&Case) -> Built) {
    let update = std::env::var("MILLIDA_SNAPSHOTS").is_ok_and(|v| v == "update");
    let all = cases();
    assert_eq!(all.len(), 20, "twenty reference builds");
    let mut failed: Vec<String> = vec![];
    for case in &all {
        let text = render(case, &build(case));
        let path = snapshot_path(case.name);
        if update {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &text).unwrap();
            continue;
        }
        let want = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("no snapshot for {}: run with MILLIDA_SNAPSHOTS=update", case.name));
        let want = want.replace("\r\n", "\n");
        if want != text {
            let first = want
                .lines()
                .zip(text.lines())
                .enumerate()
                .find(|(_, (a, b))| a != b)
                .map(|(i, (a, b))| format!("line {}: was `{}`, now `{}`", i + 1, a, b))
                .unwrap_or_else(|| format!("{} lines were, {} now", want.lines().count(), text.lines().count()));
            failed.push(format!("{}: {}", case.name, first));
        }
    }
    assert!(failed.is_empty(), "the command line moved:\n{}", failed.join("\n"));
}

/// The launch as the pipeline makes it: the Plan step (pipeline/plan.rs) on the reference build,
/// with every file in place. The snapshot files were made by the code before the pipeline
/// (commit 3b0dce81, taken over line by line from `install_loader_with_java` and
/// `install_and_launch_inner`); this must keep producing them byte for byte.
fn pipeline_launch(case: &Case) -> Built {
    use super::pipeline::plan::*;
    let root = PathBuf::from(ROOT);
    let game_dir = root.join("profiles").join(case.name.replace('.', ""));
    let (v, main_class, classpath, assets_root, natives_dir, libraries_dir) = match &case.pack {
        Some(spec) => {
            let mut v = pack_version_json(spec, &pack_token());
            let vjson = fixture(&format!("versions/{}.json", spec.vanilla_assets));
            v["assetIndex"]["id"] = vjson["assetIndex"]["id"].clone();
            (v, spec.main_class.clone(), pack_files(&game_dir), root.join("assets"), game_dir.join(&spec.natives_dir), game_dir.join("libraries"))
        }
        None => {
            let (vjson, plan, lj) = version_of(case, &root);
            let vid = vjson["id"].as_str().unwrap_or_default().to_string();
            let part = lj.as_ref().map(|lj| loader_part(case, lj, &vid, &plan, &root));
            let m = merge(&vjson, &plan, part, None, plan.log4j.as_ref().map(|l| l.arg.as_str()));
            (m.v, m.main_class, m.classpath, root.join("assets"), plan.natives_dir.clone(), root.join("libraries"))
        }
    };
    let auth = auth_of(case.account);
    let (agent, prefetched) = skin_args(case.account);
    let nick = launch_nick(case.nick);
    let ram = launch_heap(&case.heap, &case.machine, case.pack.as_ref().map(|s| (s.min_ram_mb, s.max_ram_mb)));
    let args = jvm_args(&ArgsInput {
        v: &v,
        main_class: &main_class,
        classpath: &classpath,
        nick: &nick,
        game_dir: &game_dir,
        assets_root: &assets_root,
        natives_dir: &natives_dir,
        libraries_dir: &libraries_dir,
        auth: &auth,
        agent: agent.as_deref(),
        prefetched: prefetched.as_deref(),
        ram_mb: ram,
        settings: &case.settings,
        boost_on: case.pack.is_none() && case.settings["fpsBoost"].as_bool().unwrap_or(false),
        auto_tune: case.heap.auto_tune,
        world: case.world,
        server: case.server.map(|sv| (case.version, sv)),
        java_major: Some(case.java_major),
        platform: &case.platform,
    });
    let env = game_env(case.own_mod.then_some("mod-token"), case.party, case.telemetry);
    Built { main_class, classpath, args, env: env.into_iter().map(|(k, v)| (k.to_string(), v)).collect() }
}

fn version_of(case: &Case, root: &Path) -> (Value, super::pipeline::plan::VersionPlan, Option<Value>) {
    let vjson = fixture(&format!("versions/{}.json", case.version));
    let vid = vjson["id"].as_str().unwrap().to_string();
    let libs = vjson["libraries"].as_array().cloned().unwrap_or_default();
    let plan = super::pipeline::plan::version_plan(&vjson, &libs, &vid, root, &case.platform).unwrap();
    let lj = case.loader_json.map(|f| fixture(&format!("loaders/{}.json", f)));
    (vjson, plan, lj)
}

fn loader_part<'a>(case: &Case, lj: &'a Value, vid: &str, plan: &super::pipeline::plan::VersionPlan, root: &Path) -> super::pipeline::plan::LoaderPart<'a> {
    use super::pipeline::plan::*;
    match case.loader {
        "fabric" | "quilt" | "legacyfabric" => {
            let (main_class, libs) = fabric_plan(lj, case.loader, vid, &root.join("libraries")).unwrap();
            LoaderPart { json: lj, main_class, libs }
        }
        _ => {
            let (main_class, libs) = forge_plan(lj, &root.join("libraries"), &case.platform).unwrap();
            LoaderPart { json: lj, main_class: main_class.unwrap_or_else(|| plan.main_class.clone()), libs }
        }
    }
}

/// The Prepare graph and the file counts of a reference build: what the launch fetches or checks,
/// and what waits for what.
fn render_plan(case: &Case) -> String {
    use super::pipeline::plan::*;
    let root = PathBuf::from(ROOT);
    let settings = &case.settings;
    let yggdrasil = if case.account == Account::Millida { millida_yggdrasil() } else { String::new() };
    let pack = case.pack.as_ref().map(|p| (p.slug.as_str(), p.needs_token));
    let checks = super::launch_pre::plan(settings, pack, &yggdrasil, case.loader, true, &|_| false);
    let modded = matches!(case.loader, "fabric" | "quilt" | "forge" | "neoforge");
    let mut out = format!("# {}\n", case.name);
    let route = if case.pack.is_some() { Route::Pack } else { Route::Version };
    let mut log4j = false;
    let mut natives = false;
    match &case.pack {
        Some(spec) => out.push_str(&format!("route: pack {}, java {}, heap {}-{} MB\n", spec.slug, spec.java_major, spec.min_ram_mb, spec.max_ram_mb)),
        None => {
            let (vjson, plan, lj) = version_of(case, &root);
            let vid = vjson["id"].as_str().unwrap_or_default().to_string();
            log4j = plan.log4j.is_some();
            natives = !plan.natives.is_empty();
            let loader_libs = lj.as_ref().map(|lj| loader_part(case, lj, &vid, &plan, &root).libs.len()).unwrap_or(0);
            out.push_str(&format!(
                "route: version {} + {}, java {}\nfiles: client 1, libraries {}, natives {}, log4j {}, loader libraries {}\n",
                vid,
                case.loader,
                plan.java_major,
                plan.libs.len(),
                plan.natives.len(),
                if log4j { "yes" } else { "no" },
                loader_libs
            ));
        }
    }
    out.push_str(&format!("checks: {:?}\n", checks));
    let installer = matches!(case.loader, "forge" | "neoforge");
    let graph = prepare_graph(&PlanInput {
        route,
        loader: case.loader,
        needs_installer: installer,
        checks: &checks,
        auth_pending: case.account == Account::Millida,
        deps: case.pack.is_none() && modded,
        log4j,
        natives,
    });
    out.push_str("graph (first launch):\n");
    out.push_str(&render_graph(&graph));
    out
}

#[test]
fn reference_launches_keep_their_command_line() {
    check_snapshots(pipeline_launch);
}

#[test]
fn reference_launches_keep_their_prepare_graph() {
    let update = std::env::var("MILLIDA_SNAPSHOTS").is_ok_and(|v| v == "update");
    let mut failed = vec![];
    for case in cases() {
        let text = render_plan(&case);
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/launch/snapshots").join(format!("{}.plan.txt", case.name));
        if update {
            std::fs::write(&path, &text).unwrap();
            continue;
        }
        let want = std::fs::read_to_string(&path).unwrap_or_default().replace("\r\n", "\n");
        if want != text {
            failed.push(format!("{}:\n{}", case.name, text));
        }
    }
    assert!(failed.is_empty(), "the Prepare graph moved:\n{}", failed.join("\n"));
}
