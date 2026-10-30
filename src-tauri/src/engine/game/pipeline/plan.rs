// The Plan step of a launch: what the launch needs on disk and what it will start, worked out from
// the build, its settings, the machine and the version descriptions alone. Nothing here reads the
// disk, the system or the network, so every answer can be checked in a test against the reference
// builds (launch_snap.rs). The other steps carry the plan out: Prepare fetches and checks what it
// lists (graph.rs, install.rs), Start runs the command line it gives (launch.rs).
use crate::engine::*;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// One file a version needs, with where it comes from. Classpath order follows the version
/// description, so files are fetched in parallel and the classpath is put together afterwards.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LibJob {
    pub rel: String,
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub path: PathBuf,
}

/// Mojang's logging config for the versions whose log4j predates `formatMsgNoLookups`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Log4jPlan {
    pub url: String,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub dest: PathBuf,
    /// The JVM argument once the file is in place.
    pub arg: String,
}

/// What a vanilla version needs, read from its description.
#[derive(Clone, Debug)]
pub(crate) struct VersionPlan {
    pub client: LibJob,
    pub libs: Vec<LibJob>,
    /// Natives jars and the `extract` rule of each.
    pub natives: Vec<(LibJob, Value)>,
    pub natives_dir: PathBuf,
    /// What the natives folder was last laid out from.
    pub natives_stamp: String,
    pub main_class: String,
    pub java_major: u64,
    pub log4j: Option<Log4jPlan>,
}

fn lib_path(libs_root: &Path, rel: &str) -> Result<PathBuf, String> {
    // every library path in any version json is untrusted: joined only if it stays inside libraries/
    safe_join(libs_root, rel).map_err(|e| format!("Описание версии ссылается на библиотеку вне папки: {}", e))
}

/// The files and facts of a vanilla version. `libs` is the description's library list (on Linux
/// arm64 already swapped for builds that run there).
pub(crate) fn version_plan(vjson: &Value, libs: &[Value], vid: &str, root: &Path, platform: &Platform) -> Result<VersionPlan, String> {
    let libs_root = root.join("libraries");
    let client = LibJob {
        rel: format!("versions/{0}/{0}.jar", vid),
        url: vjson["downloads"]["client"]["url"]
            .as_str()
            .ok_or_else(|| format!("В описании версии {} нет ссылки на клиент", vid))?
            .to_string(),
        sha1: vjson["downloads"]["client"]["sha1"].as_str().map(String::from),
        size: vjson["downloads"]["client"]["size"].as_u64(),
        path: root.join("versions").join(vid).join(format!("{}.jar", vid)),
    };
    let mut jobs: Vec<LibJob> = vec![];
    let mut natives: Vec<(LibJob, Value)> = vec![];
    for lib in libs {
        if !rules_allow_on(&lib["rules"], platform) {
            continue;
        }
        if let Some(art) = lib["downloads"].get("artifact").filter(|a| a.is_object()) {
            if let (Some(rel), Some(url)) = (art["path"].as_str(), art["url"].as_str()) {
                jobs.push(LibJob {
                    rel: rel.to_string(),
                    url: url.to_string(),
                    sha1: art["sha1"].as_str().map(String::from),
                    size: art["size"].as_u64(),
                    path: lib_path(&libs_root, rel)?,
                });
            }
        }
        // natives: downloads.classifiers[ natives.<os> ], extracted into the natives folder
        if lib["natives"].is_object() {
            if let Some(key_tmpl) = lib["natives"][platform.os].as_str() {
                let key = key_tmpl.replace("${arch}", platform.bits);
                if let Some(cl) = lib["downloads"]["classifiers"].get(&key).filter(|c| c.is_object()) {
                    if let (Some(u), Some(rel)) = (cl["url"].as_str(), cl["path"].as_str()) {
                        natives.push((
                            LibJob {
                                rel: rel.to_string(),
                                url: u.to_string(),
                                sha1: cl["sha1"].as_str().map(String::from),
                                size: cl["size"].as_u64(),
                                path: lib_path(&libs_root, rel)?,
                            },
                            lib["extract"].clone(),
                        ));
                    }
                }
            }
        }
    }
    let natives_stamp = natives
        .iter()
        .map(|(j, _)| format!("{}:{}", j.rel, j.sha1.clone().unwrap_or_default()))
        .collect::<Vec<_>>()
        .join("\n");
    let main_class = vjson["mainClass"]
        .as_str()
        .ok_or_else(|| format!("В описании версии {} нет главного класса", vid))?
        .to_string();
    Ok(VersionPlan {
        client,
        libs: jobs,
        natives,
        natives_dir: root.join("versions").join(vid).join("natives"),
        natives_stamp,
        main_class,
        java_major: super::super::install::java_major_of(vjson, vid),
        log4j: log4j_plan(vjson, root),
    })
}

/// Mojang's logging config, for the versions that need it and describe one.
pub(crate) fn log4j_plan(vjson: &Value, root: &Path) -> Option<Log4jPlan> {
    if !needs_log4j_config(vjson["id"].as_str().unwrap_or_default()) {
        return None;
    }
    let logging = vjson["logging"]["client"].as_object()?;
    let file = logging.get("file")?;
    let id = file["id"].as_str()?;
    let url = file["url"].as_str()?;
    let name = safe_file_name(id).ok()?;
    let dest = safe_child(&root.join("assets").join("log_configs"), &name).ok()?;
    let arg = logging
        .get("argument")
        .and_then(|a| a.as_str())
        .unwrap_or("-Dlog4j.configurationFile=${path}")
        .replace("${path}", &dest.to_string_lossy());
    Some(Log4jPlan { url: url.to_string(), sha1: file["sha1"].as_str().map(String::from), size: file["size"].as_u64(), dest, arg })
}

/// Fabric, Quilt or Legacy Fabric profile: its main class and its libraries.
pub(crate) fn fabric_plan(profile: &Value, loader: &str, vid: &str, libs_root: &Path) -> Result<(String, Vec<LibJob>), String> {
    let main_class = profile["mainClass"]
        .as_str()
        .ok_or_else(|| format!("{} не отдал главный класс для {}", loader, vid))?
        .to_string();
    let mut jobs: Vec<LibJob> = vec![];
    for lib in profile["libraries"].as_array().cloned().unwrap_or_default() {
        let Some(coord) = lib["name"].as_str() else { continue };
        let base = lib["url"].as_str().unwrap_or(match loader {
            "quilt" => "https://maven.quiltmc.org/repository/release/",
            "legacyfabric" => "https://maven.legacyfabric.net/",
            _ => "https://maven.fabricmc.net/",
        });
        let rel = maven_path(coord);
        jobs.push(LibJob { url: format!("{}{}", base, rel), path: lib_path(libs_root, &rel)?, rel, sha1: lib["sha1"].as_str().map(String::from), size: None });
    }
    Ok((main_class, jobs))
}

/// Old Forge profiles name `files.minecraftforge.net/maven`, which stopped
/// serving artifacts; the layout on the maven host is the same.
pub(crate) fn maven_base(url: &str) -> String {
    for dead in ["http://files.minecraftforge.net/maven/", "https://files.minecraftforge.net/maven/"] {
        if let Some(rest) = url.strip_prefix(dead) {
            return format!("https://maven.minecraftforge.net/{}", rest);
        }
    }
    url.to_string()
}

/// A Forge or NeoForge version: its main class (when it names one) and its libraries. The
/// installer already laid most of them out; their order is the classpath order.
pub(crate) fn forge_plan(lj: &Value, libs_root: &Path, platform: &Platform) -> Result<(Option<String>, Vec<LibJob>), String> {
    let mut jobs: Vec<LibJob> = vec![];
    for lib in lj["libraries"].as_array().cloned().unwrap_or_default() {
        if !rules_allow_on(&lib["rules"], platform) {
            continue;
        }
        if let Some(art) = lib["downloads"].get("artifact").filter(|a| a.is_object()) {
            let rel = art["path"].as_str().unwrap_or("").to_string();
            if rel.is_empty() {
                continue;
            }
            let path = lib_path(libs_root, &rel)?;
            let url = art["url"].as_str().unwrap_or("").to_string();
            let sha1 = art["sha1"].as_str().map(String::from);
            jobs.push(LibJob { rel, url, sha1, size: None, path });
        } else if let Some(name) = lib["name"].as_str() {
            let rel = maven_path(name);
            let path = lib_path(libs_root, &rel)?;
            let base = maven_base(lib["url"].as_str().unwrap_or("https://libraries.minecraft.net/"));
            jobs.push(LibJob { url: format!("{}{}", base, rel), path, rel, sha1: None, size: None });
        }
    }
    Ok((lj["mainClass"].as_str().map(String::from), jobs))
}

/// The loader side of a version once it is in place.
pub(crate) struct LoaderPart<'a> {
    /// The loader's own description (Fabric profile, Forge version json).
    pub json: &'a Value,
    pub main_class: String,
    /// Its libraries that are on disk, in its order.
    pub libs: Vec<LibJob>,
}

/// What a launch starts from: the merged version description, the main class and the classpath.
#[derive(Clone, Debug)]
pub(crate) struct Merged {
    pub v: Value,
    pub main_class: String,
    pub classpath: Vec<PathBuf>,
}

/// Puts a vanilla version and its loader together: loader libraries replace the vanilla ones of the
/// same artifact, the client jar goes last, and the loader's arguments ride along.
pub(crate) fn merge(vjson: &Value, plan: &VersionPlan, loader: Option<LoaderPart<'_>>, game_assets: Option<&Path>, log4j_arg: Option<&str>) -> Merged {
    let mut cp: Vec<(String, PathBuf)> = vec![];
    for j in &plan.libs {
        cp_put(&mut cp, &j.rel, j.path.clone());
    }
    let mut main_class = plan.main_class.clone();
    let mut v = vjson.clone();
    if let Some(part) = loader {
        main_class = part.main_class;
        for j in &part.libs {
            cp_put(&mut cp, &j.rel, j.path.clone());
        }
        apply_loader_args(&mut v, part.json);
    }
    let mut classpath: Vec<PathBuf> = cp.into_iter().map(|(_, p)| p).collect();
    classpath.push(plan.client.path.clone());
    if let Some(dir) = game_assets {
        v["millidaGameAssets"] = Value::String(dir.to_string_lossy().to_string());
    }
    if let Some(arg) = log4j_arg {
        v["millidaLog4jArg"] = Value::String(arg.to_string());
    }
    Merged { v, main_class, classpath }
}

/// A pack's memory bounds win over the player's choice outside them: «не хватило памяти» on a paid
/// build reads as a broken build.
pub(crate) fn pack_heap(ram: u32, min_mb: u32, max_mb: u32) -> u32 {
    let mut ram = ram;
    if min_mb > 0 && ram < min_mb {
        ram = min_mb;
    }
    if max_mb > 0 && ram > max_mb {
        ram = max_mb;
    }
    ram
}

/// The heap of a launch: the build's own choice (`heap_for`), a pack's bounds, and then the system's
/// share of the memory, which no number may take — the slider, a crash fix or a pack author's
/// memory alike: a heap that pushes Windows into the swap is worse than a smaller one.
pub(crate) fn launch_heap(ask: &HeapAsk, machine: &Machine, pack: Option<(u32, u32)>) -> u32 {
    let ram = heap_for(ask, machine);
    let ram = match pack {
        Some((min_mb, max_mb)) => pack_heap(ram, min_mb, max_mb),
        None => ram,
    };
    clamp_to_os_reserve(ram, machine.total_mb)
}

/// Everything the Java command line is made of.
pub(crate) struct ArgsInput<'a> {
    pub v: &'a Value,
    pub main_class: &'a str,
    pub classpath: &'a [PathBuf],
    pub nick: &'a str,
    pub game_dir: &'a Path,
    pub assets_root: &'a Path,
    pub natives_dir: &'a Path,
    pub libraries_dir: &'a Path,
    pub auth: &'a Auth,
    /// `-javaagent:` of authlib-injector and the server description handed to it.
    pub agent: Option<&'a str>,
    pub prefetched: Option<&'a str>,
    /// Heap after the pack's bounds.
    pub ram_mb: u32,
    pub settings: &'a Value,
    /// «Буст FPS» is on (never for a protected pack).
    pub boost_on: bool,
    pub auto_tune: bool,
    pub world: Option<&'a str>,
    /// (game version, address) of the server the game joins.
    pub server: Option<(&'a str, &'a str)>,
    pub java_major: Option<u32>,
    pub platform: &'a Platform,
}

/// The whole command line after `java`, in the order the JVM reads it. The JVM keeps the last of
/// two equal flags, so everything the launcher adds on its own stands left of the player's own
/// arguments, and the version's own arguments are passed as the description lists them.
pub(crate) fn jvm_args(i: &ArgsInput<'_>) -> Vec<String> {
    let settings = i.settings;
    let mut args = build_args_on(i.v, i.main_class, i.classpath, i.nick, i.game_dir, i.assets_root, i.natives_dir, i.libraries_dir, i.auth, i.platform);
    args.insert(0, format!("-Xmx{}M", i.ram_mb));
    if let Some(a) = i.agent {
        args.insert(1, a.to_string());
    }
    if let Some(p) = i.prefetched {
        args.insert(1, p.to_string());
    }
    // Log4Shell mitigation for 1.7-1.18; harmless on newer versions.
    args.insert(1, "-Dlog4j2.formatMsgNoLookups=true".into());
    // 1.7-1.11.2 predate that property and can only be patched via Mojang's
    // replacement logging config, downloaded during version install.
    if let Some(l4j) = i.v["millidaLog4jArg"].as_str() {
        args.insert(1, l4j.to_string());
    }
    let own = settings["jvmArgs"].as_str();
    if let Some(jvm) = own {
        for (n, a) in sanitize_jvm_args(jvm).into_iter().enumerate() {
            args.insert(1 + n, a);
        }
    }
    // Профиль GC режима «Буст FPS» встаёт левее пользовательских аргументов:
    // у JVM выигрывает последний одноимённый флаг, поэтому свой -XX игрока
    // остаётся сильнее нашего.
    if i.boost_on {
        let taken: Vec<&str> = own.unwrap_or("").split_whitespace().collect();
        let flags: Vec<String> = boost_flags()
            .into_iter()
            .filter(|f| !taken.iter().any(|a| a.eq_ignore_ascii_case(f)))
            .map(|f| f.to_string())
            .collect();
        for (n, a) in flags.into_iter().enumerate() {
            args.insert(1 + n, a);
        }
    }
    // Ask the JVM for UTF-8 on stdout, stderr and log files. Left of the
    // player's own arguments on purpose: this is a default, and a player who
    // pins another encoding must still win. Without it the game writes the
    // console code page and every non-ASCII line arrived as mojibake.
    for (n, a) in ["-Dfile.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8", "-Dsun.stderr.encoding=UTF-8"]
        .into_iter()
        .filter(|f| {
            let key = f.split('=').next().unwrap_or_default();
            !own.unwrap_or("").split_whitespace().any(|a| a.starts_with(key))
        })
        .enumerate()
    {
        args.insert(1 + n, a.to_string());
    }
    // Same order and for the same reason: auto-tuning goes to the left of the
    // player's own arguments and stays quiet once the boost mode has already
    // placed its GC profile.
    for (n, a) in tuned_flags_for(i.auto_tune, own.unwrap_or(""), i.boost_on).into_iter().enumerate() {
        args.insert(1 + n, a);
    }
    // Zero means "let the game decide": passing --width/--height 0 makes
    // Minecraft open a minimum-size window.
    if let (Some(w), Some(h)) = (settings["width"].as_u64(), settings["height"].as_u64()) {
        if w > 0 && h > 0 {
            args.push("--width".into());
            args.push(w.to_string());
            args.push("--height".into());
            args.push(h.to_string());
        }
    }
    if let Some(w) = i.world {
        args.push("--quickPlaySingleplayer".into());
        args.push(w.to_string());
    }
    if let Some((version, addr)) = i.server {
        args.extend(server_join_args(version, addr));
    }
    // Флаги из четырёх источников сводятся под выбранную Java: разблокировка
    // экспериментальных, один сборщик мусора, опции новее этой Java — прочь.
    fit_jvm_args(&mut args, i.java_major);
    args
}

/// What the game process finds in its environment from the launcher. The token is the narrow one
/// of our mod (cosmetics), never the account's; it goes to the process, not to a file.
pub(crate) fn game_env(mod_token: Option<&str>, party: Option<&str>, telemetry: bool) -> Vec<(&'static str, String)> {
    let mut env = vec![];
    if let Some(token) = mod_token {
        env.push(("MILLIDA_TOKEN", token.to_string()));
        // The mod joins this party's voice room instead of the server's
        // (VoiceScreen «Канал пати»), so the lobby talk carries on in game.
        if let Some(party) = party {
            env.push(("MILLIDA_PARTY", party.to_string()));
        }
    }
    if !telemetry {
        env.push(("MILLIDA_TELEMETRY", "0".to_string()));
    }
    env
}

/// The Prepare step as a graph: which nodes run and what each waits for. Data only; the launch
/// builds the same graph, and the reference builds keep this shape in their `.plan.txt`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NodeSpec {
    pub name: &'static str,
    /// Telemetry stage the node's time goes to (`launch_stages`).
    pub stage: &'static str,
    pub after: Vec<&'static str>,
}

/// Which way a build is put together.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    /// Mojang's version plus a loader.
    Version,
    /// A catalogue pack that brings its own game.
    Pack,
    /// The lobby prepared this build a moment ago and nothing changed: no file is fetched or
    /// checked again (warm.rs).
    Prepared,
}

/// Facts the plan of a launch is made of.
pub(crate) struct PlanInput<'a> {
    pub route: Route,
    pub loader: &'a str,
    /// The loader is Forge or NeoForge and its installer still has to run.
    pub needs_installer: bool,
    pub checks: &'a super::super::launch_pre::Plan,
    /// The account still has to be turned into a session.
    pub auth_pending: bool,
    /// Missing dependencies of the build's mods are looked for (and put in) before the start.
    pub deps: bool,
    pub log4j: bool,
    pub natives: bool,
}

/// The graph of the Prepare step for these facts. Java, the client, the libraries, the natives,
/// the assets and the loader's metadata go at once; a Forge/NeoForge installer waits for Java, the
/// client and the libraries; the mods of the build wait for the account (our mod is signed in with
/// it) and are checked for missing dependencies last.
pub(crate) fn prepare_graph(p: &PlanInput<'_>) -> Vec<NodeSpec> {
    let n = |name, stage, after: &[&'static str]| NodeSpec { name, stage, after: after.to_vec() };
    let mut out: Vec<NodeSpec> = vec![];
    if p.auth_pending {
        out.push(n("auth", "net", &[]));
    }
    if p.checks.gate.is_some() {
        out.push(n("gate", "net", &[]));
    }
    if p.checks.kill_switch {
        out.push(n("kill-switch", "net", &[]));
    }
    if p.checks.mod_token {
        out.push(n("mod-token", "net", &[]));
    }
    let skin_after: &[&'static str] = if p.auth_pending { &["auth"] } else { &[] };
    if p.checks.skin_server.is_some() || p.auth_pending {
        out.push(n("skin-server", "net", skin_after));
    }
    match p.route {
        Route::Prepared => out.push(n("prepared", "spawn", &[])),
        Route::Pack => {
            out.push(n("java-pick", "java", &[]));
            if p.checks.token.is_some() {
                out.push(n("pack-token", "pack", &[]));
            }
            out.push(n("pack-files", "pack", &[]));
            out.push(n("java", "java", &["java-pick"]));
            out.push(n("assets", "assets", &[]));
        }
        Route::Version => {
            out.push(n("meta", "client", &[]));
            out.push(n("java-pick", "java", &[]));
            out.push(n("java", "java", &["meta", "java-pick"]));
            out.push(n("client", "client", &["meta"]));
            out.push(n("libs", "libs", &["meta"]));
            if p.natives {
                out.push(n("natives", "natives", &["meta"]));
            }
            out.push(n("assets", "assets", &["meta"]));
            if p.log4j {
                out.push(n("log4j", "assets", &["meta"]));
            }
            match p.loader {
                "fabric" | "quilt" | "legacyfabric" => out.push(n("loader", "loader", &["meta"])),
                "forge" | "neoforge" if p.needs_installer => out.push(n("loader", "loader", &["meta", "java", "client", "libs"])),
                "forge" | "neoforge" => out.push(n("loader", "loader", &["meta"])),
                _ => {}
            }
        }
    }
    let mut mods_after: Vec<&'static str> = vec![];
    if p.checks.skin_server.is_some() || p.auth_pending {
        mods_after.push("skin-server");
    }
    if p.checks.kill_switch {
        mods_after.push("kill-switch");
    }
    // Our mod, the skin mod, a Forge mod that is in twice: always looked at.
    out.push(NodeSpec { name: "mods", stage: "mods", after: mods_after });
    if p.deps {
        out.push(n("deps", "mods", &["mods"]));
    }
    out
}

/// The graph as lines, for a test to compare.
#[cfg(test)]
pub(crate) fn render_graph(nodes: &[NodeSpec]) -> String {
    nodes
        .iter()
        .map(|n| {
            if n.after.is_empty() {
                format!("  {} [{}]\n", n.name, n.stage)
            } else {
                format!("  {} [{}] <- {}\n", n.name, n.stage, n.after.join(", "))
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn version(libs: Value) -> Value {
        json!({
            "id": "1.20.1",
            "mainClass": "net.minecraft.client.main.Main",
            "downloads": {"client": {"url": "https://piston-data.mojang.com/c.jar", "sha1": "ab", "size": 10}},
            "libraries": libs,
        })
    }

    #[test]
    fn a_version_without_a_client_link_or_a_main_class_is_refused_before_anything_is_fetched() {
        let platform = Platform { os: "windows", arch: "x86_64", bits: "64" };
        let mut v = version(json!([]));
        v["downloads"] = json!({});
        let err = version_plan(&v, &[], "1.20.1", Path::new("/G"), &platform).unwrap_err();
        assert!(err.contains("нет ссылки на клиент"), "{err}");
        let mut v = version(json!([]));
        v.as_object_mut().unwrap().remove("mainClass");
        let err = version_plan(&v, &[], "1.20.1", Path::new("/G"), &platform).unwrap_err();
        assert!(err.contains("нет главного класса"), "{err}");
    }

    #[test]
    fn a_library_that_points_out_of_the_libraries_folder_stops_the_plan() {
        let platform = Platform { os: "windows", arch: "x86_64", bits: "64" };
        let libs = vec![json!({"name": "x:y:1", "downloads": {"artifact": {"path": "../../evil.jar", "url": "https://e/x.jar"}}})];
        let err = version_plan(&version(json!([])), &libs, "1.20.1", Path::new("/G"), &platform).unwrap_err();
        assert!(err.contains("вне папки"), "{err}");
    }

    #[test]
    fn natives_follow_the_planned_system_not_the_running_one() {
        let lib = json!({
            "name": "org.lwjgl:lwjgl-platform:2.9.4",
            "natives": {"windows": "natives-windows-${arch}", "osx": "natives-osx", "linux": "natives-linux"},
            "downloads": {"classifiers": {
                "natives-windows-64": {"path": "l/w64.jar", "url": "https://l/w64.jar", "sha1": "1"},
                "natives-osx": {"path": "l/osx.jar", "url": "https://l/osx.jar", "sha1": "2"},
            }},
        });
        let win = Platform { os: "windows", arch: "x86_64", bits: "64" };
        let mac = Platform { os: "osx", arch: "arm64", bits: "64" };
        let linux = Platform { os: "linux", arch: "x86_64", bits: "64" };
        let on = |p: &Platform| version_plan(&version(json!([])), std::slice::from_ref(&lib), "1.8.9", Path::new("/G"), p).unwrap();
        assert_eq!(on(&win).natives[0].0.rel, "l/w64.jar", "${{arch}} is the planned system's");
        assert_eq!(on(&mac).natives[0].0.rel, "l/osx.jar");
        assert!(on(&linux).natives.is_empty(), "no classifier for Linux in this description");
        assert_eq!(on(&win).natives_stamp, "l/w64.jar:1");
    }

    #[test]
    fn a_pack_keeps_the_player_inside_its_memory_bounds() {
        assert_eq!(pack_heap(4096, 6144, 10240), 6144);
        assert_eq!(pack_heap(16384, 6144, 10240), 10240);
        assert_eq!(pack_heap(8192, 6144, 10240), 8192);
        assert_eq!(pack_heap(3000, 0, 0), 3000, "a pack without bounds leaves the choice alone");
    }

    /// The system keeps its share whatever asked for more: the player's slider, a pack's own minimum.
    #[test]
    fn the_heap_never_takes_the_systems_share() {
        let pc4 = Machine { total_mb: 4096, available_mb: 1500 };
        let pc16 = Machine { total_mb: 16384, available_mb: 9000 };
        let manual = |mb| HeapAsk { manual: mb, ..HeapAsk::default() };
        assert_eq!(launch_heap(&manual(6144), &pc4, None), 2048, "6 GB asked on a 4 GB PC: the swap instead of a game");
        assert_eq!(launch_heap(&manual(6144), &pc16, None), 6144);
        assert_eq!(launch_heap(&HeapAsk { requested: 4096, ..HeapAsk::default() }, &pc4, Some((6144, 10240))), 2048, "a pack's minimum does not override the system either");
        assert_eq!(launch_heap(&HeapAsk { requested: 4096, ..HeapAsk::default() }, &pc16, Some((6144, 10240))), 6144);
    }

    #[test]
    fn the_game_hears_only_what_its_mod_needs() {
        assert_eq!(game_env(None, Some("p"), true), vec![], "no mod, no token and no party room");
        assert_eq!(
            game_env(Some("t"), Some("p"), false),
            vec![("MILLIDA_TOKEN", "t".to_string()), ("MILLIDA_PARTY", "p".to_string()), ("MILLIDA_TELEMETRY", "0".to_string())]
        );
    }

    fn checks() -> super::super::super::launch_pre::Plan {
        super::super::super::launch_pre::Plan::default()
    }

    #[test]
    fn a_forge_installer_waits_for_java_the_client_and_the_libraries_and_nothing_else_does() {
        let c = checks();
        let input = PlanInput {
            route: Route::Version,
            loader: "forge",
            needs_installer: true,
            checks: &c,
            auth_pending: false,
            deps: true,
            log4j: false,
            natives: false,
        };
        let g = prepare_graph(&input);
        let after = |name: &str| g.iter().find(|n| n.name == name).map(|n| n.after.clone()).unwrap_or_default();
        assert_eq!(after("loader"), vec!["meta", "java", "client", "libs"]);
        for parallel in ["client", "libs", "assets"] {
            assert_eq!(after(parallel), vec!["meta"], "{parallel} only needs the description");
        }
        assert_eq!(after("deps"), vec!["mods"], "dependencies are judged once our own mods are in place");
        let warm = prepare_graph(&PlanInput { route: Route::Prepared, ..input });
        assert!(!warm.iter().any(|n| matches!(n.name, "meta" | "client" | "libs" | "loader")), "a prepared build fetches nothing: {warm:?}");
    }
}
