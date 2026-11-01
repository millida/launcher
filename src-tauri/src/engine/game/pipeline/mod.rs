// The Play button as a pipeline: Plan → Prepare → Start → Watch.
//
// Plan reads the build, its settings and the version descriptions and decides what the launch
// needs (plan.rs, no disk writes, no network). Prepare is a graph of tasks (graph.rs): the
// account's session, Java, the client, the libraries, the natives, the assets, the loader and the
// network checks of the launch run side by side, a Forge/NeoForge installer waits for Java, the
// client and the libraries, and the mods of the build (our mod, the skin mod, missing
// dependencies) are put in place next to all that. Start builds the command line from the plan
// and starts Java (launch.rs, `start_game`); Watch follows the game until it exits (`watch_game`).
// Before, all of it was one function and every step waited for the one before it.
pub(crate) mod graph;
pub(crate) mod plan;
pub(crate) mod progress;
pub(crate) mod warm;

use self::graph::{work_begins, Graph, Node};
use self::plan::*;
use super::launch::{offline_keeping_uuid, start_game, QuickTarget, StartSpec};
use super::launch_perf::{GraphFacts, LaunchPerf};
use super::launch_pre::{gate_verdict, pack_mod_answer, prepare_skin_server, Preflight, SkinJob, Ygg};
use crate::engine::*;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tauri::AppHandle;

pub(crate) use self::progress::lane_emit;

/// Where the account of a launch comes from.
pub(crate) enum AuthSource {
    /// Credentials already made (the autotest, a caller inside the core).
    Ready(Auth),
    /// The account the window named. Its session is issued next to the install, not before it.
    Account(Option<AuthArgs>),
}

impl AuthSource {
    /// The skin server this account will have if its session comes: the description is asked for
    /// at once and thrown away if it does not.
    fn expected_yggdrasil(&self) -> String {
        match self {
            AuthSource::Ready(a) => a.yggdrasil.clone(),
            AuthSource::Account(Some(args)) if args.kind.as_deref() == Some("millida") => millida_yggdrasil(),
            AuthSource::Account(_) => String::new(),
        }
    }

    fn pending(&self) -> bool {
        matches!(self, AuthSource::Account(Some(args)) if args.kind.as_deref() == Some("millida"))
    }
}

/// Who plays: the session and the nick the game starts with.
struct Who {
    auth: Auth,
    nick: String,
}

async fn sign_in(app: AppHandle, source: AuthSource, nick: String) -> Result<Arc<Who>, String> {
    let (auth, nick) = match source {
        AuthSource::Ready(auth) => (auth, nick),
        AuthSource::Account(args) => {
            let r = resolve_launch_auth(&app, args).await;
            (r.auth, r.nick.unwrap_or(nick))
        }
    };
    // the nick lands on the command line and in an argfile
    Ok(Arc::new(Who { auth, nick: launch_nick(&nick) }))
}

/// What the skin server came to: the session the game starts with (offline if the server did not
/// answer) and the authlib-injector agent with the description handed to it.
struct Skin {
    auth: Auth,
    agent: Option<String>,
    prefetched: Option<String>,
    held: Option<Arc<GameAgent>>,
}

// authlib-injector redirects Yggdrasil to a custom auth server. Without the
// agent the game would authenticate against Mojang with a non-Mojang token
// and fail session checks, so a failure here falls back to offline mode.
// Метаданные сервера входа лаунчер берёт сам и отдаёт агенту готовыми:
// иначе authlib-injector качает их из игры при старте, и сбой DNS у игрока
// или 502 на выкатке роняет игру до окна (2.0.122, 25.09.2026: 13 игроков
// за 6 часов). Сети нет даже у лаунчера — игра идёт офлайн, а не падает.
async fn skin_server(app: AppHandle, who: Node<Arc<Who>>, started: Option<SkinJob>) -> Result<Arc<Skin>, String> {
    let w = who.get().await?;
    work_begins();
    let mut auth = w.auth.clone();
    let none = |auth: Auth| Arc::new(Skin { auth, agent: None, prefetched: None, held: None });
    if auth.yggdrasil.is_empty() {
        return Ok(none(auth));
    }
    let ygg = match started {
        Some((url, job)) if url == auth.yggdrasil => match job.answer().await {
            Some(done) => done,
            None => prepare_skin_server(url).await,
        },
        _ => prepare_skin_server(auth.yggdrasil.clone()).await,
    };
    match ygg {
        Ygg::Ready(jar, meta) => {
            use base64::Engine as _;
            let prefetched = format!(
                "-Dauthlibinjector.yggdrasil.prefetched={}",
                base64::engine::general_purpose::STANDARD.encode(meta.to_string())
            );
            let agent = format!("-javaagent:{}={}", jar.path.to_string_lossy(), auth.yggdrasil);
            Ok(Arc::new(Skin { auth, agent: Some(agent), prefetched: Some(prefetched), held: Some(Arc::new(jar)) }))
        }
        Ygg::NoReply(e) => {
            warn(&app, &format!("Сервер скинов Millida не ответил ({}) — запускаем в офлайн-режиме", e));
            auth = offline_keeping_uuid(&auth);
            Ok(none(auth))
        }
        Ygg::NoAgent(e) => {
            warn(&app, &format!("Скины Millida недоступны ({}) — запускаем в офлайн-режиме", e));
            auth = offline_keeping_uuid(&auth);
            Ok(none(auth))
        }
    }
}

/// Our mod and what goes with it, as the mods step left the build.
#[derive(Default)]
struct ModsOut {
    own_mod: bool,
    /// Which file of our mod went in: if it brings the build down, that file is quarantined.
    own_mod_jar: String,
}

struct ModsAsk {
    profile: String,
    loader: String,
    game_version: String,
    game_dir: PathBuf,
    pack_slug: Option<String>,
}

/// The mods of the build before the game reads them: our cosmetics mod (or the skin mod where ours
/// has no build), a Forge mod that is in the build twice. Needs the account: our mod is signed in
/// with it and the skin mod follows the skin server.
#[allow(clippy::too_many_arguments)]
async fn mods_step(
    app: AppHandle,
    ask: ModsAsk,
    who: Node<Arc<Who>>,
    skin: Node<Arc<Skin>>,
    access: Node<()>,
    pack_mod: Option<super::launch_pre::Job<(bool, bool)>>,
    kill: KillPrefetch,
) -> Result<Arc<ModsOut>, String> {
    let ModsAsk { profile, loader, game_version, game_dir, pack_slug } = ask;
    // Nothing in the build changes before the build may be played: the access check and a paid
    // pack's key come first, as they always did.
    access.get().await?;
    std::fs::create_dir_all(game_dir.join("mods")).ok();
    if loader == "fabric" && !running_games().iter().any(|p| p == &profile) {
        let dir = game_dir.clone();
        let _ = spawn_blocking_held(move |_| drop_broken_remap_cache(&dir)).await;
    }
    let w = who.get().await?;
    let s = skin.get().await?;
    work_begins();
    let auth = &s.auth;
    // CustomSkinLoader is a client mod, so it can only be installed on modded
    // profiles; vanilla has no way to load custom skins without Yggdrasil.
    // Only our server has the CustomSkinAPI next to Yggdrasil.
    let root = if s.agent.is_some() && auth.yggdrasil == millida_yggdrasil() {
        Some(format!("{}/csl/", auth.yggdrasil.trim_end_matches('/')))
    } else {
        None
    };
    let want_skin = want_in_game_skins(root.as_deref());
    /*
     * A protected pack checks its own files, and its content lives in signed
     * libraries rather than in `mods/`. Dropping our skin mod into that folder
     * either changes what the pack verifies or simply never loads — either way
     * it is a change to someone else's build made behind their back.
     */
    // Our own cosmetics mod is the one exception, and only for a pack our card
    // opted in: the archive cannot ask for it itself.
    let touch_mods = pack_slug.is_none();
    let (pack_mod, pack_mod_before) = match &pack_slug {
        Some(slug) => pack_mod_answer(pack_mod, &profile, slug).await,
        None => (false, false),
    };
    let modded = matches!(loader.as_str(), "fabric" | "quilt" | "forge" | "neoforge");
    let mut out = ModsOut::default();
    // Наш мод умеет всё, что умел CustomSkinLoader, и сверх того косметику,
    // поэтому сначала пробуем его. Под связку, которой у мода ещё нет варианта,
    // остаётся прежний путь: игроку нужен скин и на такой сборке.
    match own_mod_action(pack_slug.is_some(), pack_mod, pack_mod_before, millida_mod_wanted(&profile)) {
        OwnMod::Place if modded => {
            let licensed = !auth.token.is_empty() && auth.yggdrasil.is_empty();
            match ensure_millida_mod_with(&app, &profile, &w.nick, licensed, kill).await {
                Ok(Some(jar)) => {
                    out.own_mod = true;
                    // Какой именно файл поехал в сборку: если он её и уронит, под
                    // карантин пойдёт он, а не «мод вообще».
                    out.own_mod_jar = jar;
                }
                Ok(None) => {}
                Err(e) => warn(&app, &format!("Мод Millida не поставлен: {}", e)),
            }
        }
        OwnMod::Remove => remove_millida_mod(&profile),
        OwnMod::Place | OwnMod::Leave => {}
    }
    if touch_mods && modded && !out.own_mod {
        let licensed = !auth.token.is_empty() && auth.yggdrasil.is_empty();
        if want_skin {
            match ensure_custom_skin_loader(&profile, &loader, root.as_deref(), &w.nick, licensed).await {
                Err(e) => warn(&app, &format!("Мод скинов не поставлен: {}", e)),
                Ok(off) if !off.is_empty() => warn(
                    &app,
                    &format!(
                        "Выключили мод скинов другого лаунчера ({}) — он показывал скин с его сервера. Теперь скин берётся из Millida",
                        off.join(", ")
                    ),
                ),
                Ok(_) => {}
            }
        }
    } else if touch_mods && !out.own_mod {
        if let Some(why) = in_game_skin_blocker(&loader, !auth.token.is_empty(), want_skin) {
            warn(&app, why);
        }
    }
    if loader == "forge" {
        let off = resolve_legacy_duplicates(&profile, &game_version).await;
        if !off.is_empty() {
            warn(
                &app,
                &format!(
                    "Выключили лишнюю копию мода: {}. Этот мод уже есть в сборке внутри другого файла, а с двумя копиями Forge не запускается",
                    off.join(", ")
                ),
            );
        }
    }
    Ok(Arc::new(out))
}

/// Longest the launch looks for the mods the build is missing before it starts without them.
const DEPS_BUDGET: std::time::Duration = std::time::Duration::from_secs(20);

/// Missing dependencies of the build's mods, put in before the game: a mod that requires another
/// one the build does not have stops the loader before the window (17.5 % of all crashes).
async fn deps_step(app: AppHandle, profile: String, mods: Node<Arc<ModsOut>>) -> Result<u32, String> {
    mods.get().await?;
    work_begins();
    match tokio::time::timeout(DEPS_BUDGET, settle_launch_deps(&app, &profile)).await {
        Ok(found) if !found.installed.is_empty() => {
            warn(&app, &format!("Доставили моды, без которых сборка не запустится: {}", found.installed.join(", ")));
            Ok(found.installed.len() as u32)
        }
        _ => Ok(0),
    }
}

/// What Start needs from Prepare.
struct Ready {
    v: Value,
    main_class: String,
    classpath: Vec<PathBuf>,
    java: PathBuf,
    assets_root: PathBuf,
    natives_dir: PathBuf,
    libraries_dir: PathBuf,
}

impl Ready {
    fn of_version(i: &InstalledVersion) -> Ready {
        Ready {
            v: i.merged.v.clone(),
            main_class: i.merged.main_class.clone(),
            classpath: i.merged.classpath.clone(),
            java: i.java.clone(),
            assets_root: game_root().join("assets"),
            natives_dir: i.natives_dir.clone(),
            libraries_dir: i.root.join("libraries"),
        }
    }
}

/// The files of a catalogue pack that brings its own game, read from its folder.
#[derive(Clone)]
struct PackFiles {
    classpath: Vec<PathBuf>,
    module_args: Vec<String>,
    lwjgl: Option<String>,
}

/*
 * A catalogue pack that brought its own game is launched by its own
 * description: it ships libraries, minecraft.jar, assets and natives, and
 * its content is loaded out of those libraries rather than out of `mods/`.
 * Assembling such a build from parts gives a folder that starts without
 * most of what the player paid for.
 */
/// Returns the pack in place and the verdict of its launch key: nothing else of the pack is fetched
/// or changed before the key came (a pack whose access was taken away is removed by that step).
fn prepare_pack(
    g: &mut Graph,
    app: &AppHandle,
    profile: &str,
    spec: &PackLaunch,
    token_job: Option<super::launch_pre::Job<Result<Vec<String>, String>>>,
    java_pick: Node<Option<PathBuf>>,
) -> (Node<Arc<Ready>>, Node<()>) {
    let game_dir = profile_dir(profile);
    let token: Node<Vec<String>> = if spec.needs_token {
        let (app, profile, slug) = (app.clone(), profile.to_string(), spec.slug.clone());
        g.spawn("pack-token", "pack", None, async move {
            let got = match token_job {
                Some(job) => match job.answer().await {
                    Some(done) => done,
                    None => pack_launch_token(&slug).await,
                },
                None => pack_launch_token(&slug).await,
            };
            match got {
                Ok(t) => Ok(t),
                Err(e) => {
                    if let Ok(Some(PackAccess::Lost(reason))) = pack_access(&slug).await {
                        return Err(forfeit_pack(&app, &profile, &slug, &reason).await);
                    }
                    Err(e)
                }
            }
        })
    } else {
        Node::ready(Vec::new())
    };
    let keyed = {
        let token = token.clone();
        Node::<()>::from_future(async move { token.get().await.map(|_| ()) })
    };
    let java: Node<PathBuf> = {
        let (app, need, keyed) = (app.clone(), spec.java_major, keyed.clone());
        g.spawn("java", "java", Some((0.0, 60.0)), async move {
            keyed.get().await?;
            /*
             * A pack names the Java it was built for, and a player's own Java
             * older than that never starts it: Java 8 does not even read the
             * argument file, so a 1.20.1 pack dies with «Could not find or load
             * main class @…millida-args.txt». Such a pick is set aside for this
             * pack only; a newer Java than required is still the player's call.
             */
            let pick = java_pick.get().await?;
            work_begins();
            let pick = pick.filter(|p| match java_major_at(p) {
                Some(m) if u64::from(m) >= need => true,
                found => {
                    warn(
                        &app,
                        &format!(
                            "Выбранная Java {} не подходит сборке — ей нужна Java {}. Запускаем на своей",
                            found.map(|m| m.to_string()).unwrap_or_else(|| "неизвестной версии".into()),
                            need
                        ),
                    );
                    false
                }
            });
            match pick {
                Some(p) => Ok(p),
                None => ensure_java(&app, need).await,
            }
        })
    };
    let files: Node<PackFiles> = {
        let (profile, spec_cp, natives, keyed) = (profile.to_string(), spec.clone(), game_dir.join(&spec.natives_dir), keyed.clone());
        g.spawn("pack-files", "pack", None, async move {
            keyed.get().await?;
            work_begins();
            spawn_blocking_held(move |_| {
                let classpath = pack_classpath(&profile, &spec_cp)?;
                let module_args = module_path_args(&pack_module_path(&profile, &spec_cp)?);
                let lwjgl = lwjgl_library_path_arg(&nested_native_dirs(&natives));
                Ok(PackFiles { classpath, module_args, lwjgl })
            })
            .await
            .map_err(|e| e.to_string())?
        })
    };
    /*
     * A pack built on a vanilla version may leave the sounds and
     * languages out and name the version instead: the objects are the
     * same for every pack of that version, so they live once in the
     * shared store rather than inside each archive.
     */
    let assets: Node<(PathBuf, Option<PathBuf>, Option<Value>)> = if spec.vanilla_assets.is_empty() {
        Node::ready((game_dir.join(&spec.assets_dir), None, None))
    } else {
        let (app, vanilla, keyed) = (app.clone(), spec.vanilla_assets.clone(), keyed.clone());
        g.spawn("assets", "assets", Some((55.0, 86.0)), async move {
            keyed.get().await?;
            work_begins();
            let root = game_root_ready()?;
            let (vid, vjson) = vanilla_meta(&app, &root, &vanilla).await?;
            let dir = ensure_assets(&app, &root, &vjson, &vid).await?;
            Ok((root.join("assets"), dir, Some(vjson["assetIndex"]["id"].clone())))
        })
    };
    let spec = spec.clone();
    let ready = Node::from_future(async move {
        let (token, java, files, (assets_root, laid_out, index_id)) = futures::try_join!(token.get(), java.get(), files.get(), assets.get())?;
        let mut extra_jvm = token;
        extra_jvm.extend(files.module_args.iter().cloned());
        if let Some(arg) = &files.lwjgl {
            extra_jvm.push(arg.clone());
        }
        let mut v = pack_version_json(&spec, &extra_jvm);
        if let Some(dir) = laid_out {
            v["millidaGameAssets"] = Value::String(dir.to_string_lossy().to_string());
        }
        if let Some(id) = index_id.filter(|_| spec.asset_index.is_empty()) {
            v["assetIndex"]["id"] = id;
        }
        Ok(Arc::new(Ready {
            v,
            main_class: spec.main_class.clone(),
            classpath: files.classpath.clone(),
            java,
            assets_root,
            natives_dir: game_dir.join(&spec.natives_dir),
            libraries_dir: game_dir.join("libraries"),
        }))
    });
    (ready, keyed)
}

/// Resolves with the launch's cancel: the graph is waited for next to it, so a cancel ends the wait
/// even while a step that never checks the flag (a session request) is still out.
async fn until_cancelled() -> String {
    loop {
        if cancelled() {
            return LAUNCH_CANCELLED.to_string();
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// One launch, from the click to the game watched until it exits.
pub(crate) struct LaunchAsk {
    pub version_id: String,
    pub nick: String,
    pub with_fabric: bool,
    pub ram_mb: u32,
    pub profile: String,
    pub auth: AuthSource,
    pub quick: QuickTarget,
}

pub(crate) async fn launch(app: AppHandle, ask: LaunchAsk, perf: LaunchPerf) -> Result<String, String> {
    let LaunchAsk { version_id, nick, with_fabric, ram_mb, profile, auth: auth_source, quick } = ask;
    check_cancel()?;
    let _slot = match claim_profile_start(&profile, || emit(&app, "files", 2.0, "Останавливаем прошлый запуск этой сборки…")).await {
        Ok(slot) => slot,
        // The first start of this build is still under way: there is no window to raise yet.
        Err(e) if e == ALREADY_STARTING => return Ok(OUTCOME_STARTING.into()),
        Err(e) => return Err(e),
    };
    if let Some(outcome) = bring_running_forward(&profile, true) {
        return Ok(outcome);
    }

    // ── Plan ────────────────────────────────────────────────────────────────────────────────
    let planned_at = Instant::now();
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    // The window may still hold the loader id the build was imported with
    // ("neoforge-21.1.233"); the stored build already has the game version.
    let version_id = match &prof {
        Some(p) if split_loader_version_id(&version_id).is_some() => p.version.clone(),
        _ => version_id,
    };
    let loader_id = prof.as_ref().map(|p| p.loader_id()).unwrap_or_else(|| if with_fabric { "fabric".into() } else { "vanilla".into() });
    let loader_ver = prof.as_ref().and_then(|p| p.loader_version.clone());
    let game_version = prof.as_ref().map(|p| p.version.clone()).unwrap_or_else(|| version_id.clone());
    // Settings are read before install so a user-provided Java path can skip the
    // bundled JRE download instead of replacing it afterwards.
    let settings: Value = std::fs::read(profile_dir(&profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    // Ahead of the Java pick: a pinned Java would otherwise be downloaded for
    // a game that never runs on it.
    if let Some(native) = trusted_native_launch(&profile) {
        let who = sign_in(app.clone(), auth_source, nick).await?;
        return launch_native(app, profile, who.nick.clone(), who.auth.clone(), &settings, native?).await;
    }
    if let Some(wanted) = horizon_wanted(&profile, &game_version, &loader_id) {
        let asset = wanted?;
        let who = sign_in(app.clone(), auth_source, nick).await?;
        let ask = HorizonAsk { profile, nick: who.nick.clone(), auth: who.auth.clone(), settings, asset };
        return launch_horizon(app, ask, perf).await;
    }
    share_common_before_launch(&profile);
    let game_dir = profile_dir(&profile);
    // the descriptor is a file in the profile folder: it is honoured only for
    // a build the core itself installed from the catalogue
    let pack = trusted_pack_launch_spec(&profile);
    // The network checks of this launch start now and run next to the install; each is awaited
    // where its answer is needed. A refusal from the access check still stops the launch.
    let mut pre = Preflight::start(&profile, &settings, pack.as_ref(), &auth_source.expected_yggdrasil(), &loader_id);
    let modded = matches!(loader_id.as_str(), "fabric" | "quilt" | "forge" | "neoforge");
    // The lobby may have prepared this very build a moment ago (warm.rs): then nothing is fetched
    // or checked again and Play is the start.
    let prepared = if pack.is_none() { warm::take(&profile, &version_id, &loader_id, loader_ver.as_deref()) } else { None };
    let route = match (&pack, &prepared) {
        (Some(_), _) => Route::Pack,
        (None, Some(_)) => Route::Prepared,
        (None, None) => Route::Version,
    };
    let shape = prepare_graph(&PlanInput {
        route,
        loader: &loader_id,
        needs_installer: false,
        checks: &pre.planned,
        auth_pending: auth_source.pending(),
        deps: pack.is_none() && modded && !catalog_pack_settings(&settings),
        log4j: needs_log4j_config(&game_version),
        natives: true,
    });
    let plan_ms = planned_at.elapsed().as_millis() as u64;

    // ── Prepare ─────────────────────────────────────────────────────────────────────────────
    perf.pause();
    if pack.is_some() {
        emit(&app, "launch", 20.0, "Готовим сборку…");
    }
    let mut g = Graph::new(Some(launch_board(&app)), Some(perf.clone()));
    let pending = auth_source.pending();
    let who: Node<Arc<Who>> = if pending {
        g.spawn("auth", "auth", None, sign_in(app.clone(), auth_source, nick))
    } else {
        Node::from_future(sign_in(app.clone(), auth_source, nick))
    };
    let gate: Node<()> = match pre.take_gate() {
        Some(job) => g.spawn("gate", "net", None, gate_verdict(job)),
        None => Node::ready(()),
    };
    let skin: Node<Arc<Skin>> = g.spawn("skin-server", "net", None, skin_server(app.clone(), who.clone(), pre.take_skin()));
    let java_pick = |g: &mut Graph| -> Node<Option<PathBuf>> {
        let (app, profile) = (app.clone(), profile.clone());
        g.spawn("java-pick", "java", Some((0.0, 60.0)), async move { resolve_profile_java(&app, &profile).await })
    };
    let warm = prepared.is_some();
    let (ready, keyed): (Node<Arc<Ready>>, Node<()>) = match (&pack, prepared) {
        (Some(spec), _) => {
            let pick = java_pick(&mut g);
            prepare_pack(&mut g, &app, &profile, spec, pre.take_token(), pick)
        }
        (None, Some(version)) => (Node::ready(Arc::new(Ready::of_version(&version))), Node::ready(())),
        (None, None) => {
            let pick = java_pick(&mut g);
            let ask = VersionAsk { version_id: version_id.clone(), loader: loader_id.clone(), loader_version: loader_ver.clone(), mode: Mode::Fetch };
            let installed = prepare_version(&mut g, &app, ask, pick);
            (Node::from_future(async move { Ok(Arc::new(Ready::of_version(&*installed.get().await?))) }), Node::ready(()))
        }
    };
    // The build may be played: the access check said nothing against it and a paid pack has its key.
    let access: Node<()> = {
        let (gate, keyed) = (gate.clone(), keyed.clone());
        Node::from_future(async move {
            gate.get().await?;
            keyed.get().await
        })
    };
    let mods: Node<Arc<ModsOut>> = {
        let ask = ModsAsk {
            profile: profile.clone(),
            loader: loader_id.clone(),
            game_version: game_version.clone(),
            game_dir: game_dir.clone(),
            pack_slug: pack.as_ref().map(|p| p.slug.clone()),
        };
        // No lane of the bar: our mod is usually in place already, and a lane that says nothing
        // would hold the bar back while the files are long done.
        g.spawn("mods", "mods", None, mods_step(app.clone(), ask, who.clone(), skin.clone(), access, pre.take_pack_mod(), pre.take_kill_prefetch()))
    };
    let deps: Node<u32> = if shape.iter().any(|n| n.name == "deps") {
        g.spawn("deps", "mods", None, deps_step(app.clone(), profile.clone(), mods.clone()))
    } else {
        Node::ready(0)
    };
    // Everything the start needs; the first failure ends the launch and stops the rest, and so does
    // a cancel.
    let all = async { futures::try_join!(ready.get(), mods.get(), deps.get(), gate.get(), skin.get(), who.get()) };
    let (ready, mods, deps, (), skin, who) = tokio::select! {
        done = all => done?,
        stop = until_cancelled() => return Err(stop),
    };
    let done = g.done();
    perf.graph(GraphFacts {
        plan_ms,
        prep_ms: g.elapsed().as_millis() as u64,
        crit: done.last().map(|d| d.name).unwrap_or(""),
        nodes: done.len() as u32,
        warm,
        deps,
        auth_ms: done.iter().find(|d| d.name == "auth").map(|d| d.ended_ms.saturating_sub(d.began_ms)),
    });
    drop(g);

    // ── Start ───────────────────────────────────────────────────────────────────────────────
    super::launch_perf::enter("spawn");
    check_cancel()?;
    emit(&app, "launch", 92.0, "Запускаем игру…");
    let heap = HeapAsk::of(&profile, ram_mb);
    let machine = Machine::now();
    let ram = launch_heap(&heap, &machine, pack.as_ref().map(|s| (s.min_ram_mb, s.max_ram_mb)));
    let chosen = heap_for(&heap, &machine);
    if pack.is_none() && ram < chosen {
        eprintln!("[launch] heap {chosen}M cut to {ram}M: the system keeps its share of the memory");
    }
    if let Some(bad) = settings["jvmArgs"].as_str().and_then(rejected_jvm_arg) {
        // Second line of defence: the setting may have been written by a build
        // that stored the value unchecked.
        warn(&app, &format!("Аргумент JVM «{}» пропущен — такие лаунчер не передаёт", bad));
    }
    let platform = Platform::host();
    let quick_server = quick.server.clone();
    let args = jvm_args(&ArgsInput {
        v: &ready.v,
        main_class: &ready.main_class,
        classpath: &ready.classpath,
        nick: &who.nick,
        game_dir: &game_dir,
        assets_root: &ready.assets_root,
        natives_dir: &ready.natives_dir,
        libraries_dir: &ready.libraries_dir,
        auth: &skin.auth,
        agent: skin.agent.as_deref(),
        prefetched: skin.prefetched.as_deref(),
        ram_mb: ram,
        settings: &settings,
        boost_on: pack.is_none() && settings["fpsBoost"].as_bool().unwrap_or(false),
        auto_tune: heap.auto_tune,
        world: quick.world.as_deref(),
        server: quick.server.as_deref().map(|sv| (game_version.as_str(), sv)),
        java_major: java_major_of_bin(&ready.java),
        platform: &platform,
    });
    // Токен для мода — узкий, из /launcher/mod-session; нет его — мод без входа.
    // Millida mod token: short, separate from the Microsoft account token, taken from the Millida API (/launcher/mod-session).
    let mod_token = if mods.own_mod { pre.mod_token().await } else { None };
    check_cancel()?;
    let party = mod_token.as_ref().and_then(|_| crate::engine::party_voice::bound_party());
    let env = game_env(mod_token.as_deref(), party.as_deref(), game_telemetry_enabled());
    // ── Start, then Watch (launch.rs) ───────────────────────────────────────────────────────
    start_game(
        app,
        StartSpec {
            profile,
            nick: who.nick.clone(),
            game_dir,
            args,
            env,
            java: ready.java.clone(),
            settings,
            own_mod: mods.own_mod,
            own_mod_jar: mods.own_mod_jar.clone(),
            quick_server,
            pack_watch: pack.filter(|s| s.needs_token && !s.slug.is_empty()).map(|s| s.slug),
            agent: skin.held.clone(),
        },
        &perf,
    )
    .await
}
