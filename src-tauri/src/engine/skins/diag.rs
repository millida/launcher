use crate::engine::*;
use serde_json::{json, Value};

/// Written by the mod itself on every launch it takes part in. Its absence in a
/// build that has the jar and has already been played is the one signal that
/// tells "the mod did not run" apart from "the mod ran and found nothing".
const CSL_LOG: &str = "CustomSkinLoader.log";
const GAME_LOG: &str = "logs/latest.log";
/// Rewritten by the launcher on every launch of the build: the game's own
/// output, and the only place the session agent announces itself — it prints
/// before the game logger exists, so `latest.log` never sees it.
const LAUNCHER_LOG: &str = "logs/launcher-latest.log";
const AGENT_MARK: &str = "authlib-injector";
/// The agent's banner is the first thing in that log, so its head is enough.
const LAUNCHER_LOG_HEAD: u64 = 128 * 1024;
const MAX_LOG_LINES: usize = 6;
const MAX_LINE_CHARS: usize = 200;
const MAX_BUILDS: usize = 12;
/// The agent that points the game's session calls at our Yggdrasil. On a
/// vanilla build the session is the only route a skin has.
const AGENT_JAR: &str = "authlib-injector.jar";
/// The game log runs to tens of megabytes; only its tail says anything about
/// the launch the player is complaining about.
const GAME_LOG_TAIL: u64 = 256 * 1024;
/// Lines of the game log worth showing: everything else there is the crash of
/// some other mod, and a skin report must not turn into a crash report.
const SKIN_LOG_WORDS: [&str; 6] = ["skin", "cape", "texture", "authlib", "yggdrasil", "session"];

#[derive(PartialEq, Debug, Clone, Copy)]
pub(crate) enum BuildSkin {
    Vanilla,
    Conflict,
    Off,
    Missing,
    NeverLaunched,
    ModSilent,
    ModComplains,
    Ok,
}

/// What one build is worth to the verdict: its state, and when it was last
/// played. A fault in a build nobody opens is not what keeps the player from
/// their skin today.
#[derive(PartialEq, Debug, Clone, Copy)]
pub(crate) struct BuildFacts {
    pub(crate) state: BuildSkin,
    pub(crate) played: Option<u64>,
    /// Whether the last launch of this build carried the session agent. `None`
    /// when there is no launcher log to read it from.
    pub(crate) agent: Option<bool>,
}

/// Faults worth telling the player about, in the order they outrank each other.
const BUILD_FAULTS: [(BuildSkin, &str, &str); 5] = [
    (
        BuildSkin::Conflict,
        "conflict",
        "В сборке стоит свой мод скинов — он перебивает наш. Убери его или выключи наш мод в настройках сборки.",
    ),
    (
        BuildSkin::ModSilent,
        "mod_silent",
        "Мод скинов не запускается с этой версией игры — поэтому скина и плаща в ней нет. Собери сборку на версии, где мод работает, либо играй на серверах Millida: там скин виден и без мода.",
    ),
    (
        BuildSkin::ModComplains,
        "mod_complains",
        "Мод скинов запускается, но ругается в своём журнале — смотри строки ниже.",
    ),
    (
        BuildSkin::Missing,
        "missing",
        "В сборке нет мода скинов: его убрали вручную или он не поставился. Включи мод скинов в настройках сборки.",
    ),
    (
        BuildSkin::Off,
        "off",
        "Мод скинов выключен для этой сборки — включи его в настройках сборки.",
    ),
];

impl BuildSkin {
    fn id(self) -> &'static str {
        match self {
            BuildSkin::Vanilla => "vanilla",
            BuildSkin::Conflict => "conflict",
            BuildSkin::Off => "off",
            BuildSkin::Missing => "missing",
            BuildSkin::NeverLaunched => "never_launched",
            BuildSkin::ModSilent => "mod_silent",
            BuildSkin::ModComplains => "mod_complains",
            BuildSkin::Ok => "ok",
        }
    }

    fn text(self) -> &'static str {
        match self {
            BuildSkin::Vanilla => "Ванильная сборка: скин приходит только из аккаунта, мод сюда поставить некуда",
            BuildSkin::Conflict => "В сборке уже есть свой мод скинов — он и решает, какой скин ты видишь",
            BuildSkin::Off => "Мод скинов выключен для этой сборки",
            BuildSkin::Missing => "Мода скинов нет в сборке",
            BuildSkin::NeverLaunched => "Сборку ещё ни разу не запускали — проверить нечего",
            BuildSkin::ModSilent => "Мод скинов не запустился с этой версией игры: своего журнала он не создал",
            BuildSkin::ModComplains => "Мод скинов запускался, но жалуется в журнале",
            BuildSkin::Ok => "Мод скинов на месте и отработал",
        }
    }
}

/// The switch reads the same either way, so the marker's reason is the only
/// thing that tells a player who turned the mod off.
pub(crate) fn off_text(state: BuildSkin, reason: Option<&str>) -> String {
    match (state, reason) {
        (BuildSkin::Off, Some("crash")) => {
            "Мод скинов выключен: сборка с ним упала, и лаунчер его убрал".into()
        }
        (BuildSkin::Off, Some("removed")) => {
            "Мод скинов выключен: его убрали из списка модов сборки".into()
        }
        _ => state.text().into(),
    }
}

/// Verdict for one build. `log` means the mod wrote its own journal, which it
/// only does when the game actually loaded it.
pub(crate) fn build_state(
    modded: bool,
    on: bool,
    jar: bool,
    conflict: bool,
    launched: bool,
    log: bool,
    complains: bool,
) -> BuildSkin {
    if !modded {
        return BuildSkin::Vanilla;
    }
    if conflict {
        return BuildSkin::Conflict;
    }
    if !on {
        return BuildSkin::Off;
    }
    if !jar {
        return BuildSkin::Missing;
    }
    if !launched {
        return BuildSkin::NeverLaunched;
    }
    if !log {
        return BuildSkin::ModSilent;
    }
    if complains {
        return BuildSkin::ModComplains;
    }
    BuildSkin::Ok
}

/// Lines of a journal that report a failure, newest first. `keep` narrows them
/// to the subject at hand: the mod's own journal is about nothing else, while
/// the game log is mostly about everything else.
fn failing_lines(text: &str, keep: impl Fn(&str) -> bool) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().rev() {
        let low = line.to_lowercase();
        let bad = ["error", "exception", "failed", "timeout", "refused", "not defined", "unable"]
            .iter()
            .any(|m| low.contains(m));
        if !bad || !keep(&low) {
            continue;
        }
        let trimmed: String = line.trim().chars().take(MAX_LINE_CHARS).collect();
        if trimmed.is_empty() || out.contains(&trimmed) {
            continue;
        }
        out.push(trimmed);
        if out.len() == MAX_LOG_LINES {
            break;
        }
    }
    out
}

/// Lines of the mod's journal that report a failure. Everything else there is a
/// normal profile lookup, and a journal full of them says nothing is wrong.
pub(crate) fn log_problems(text: &str) -> Vec<String> {
    failing_lines(text, |_| true)
}

/// What the game itself said about skins. On a vanilla build there is no mod
/// journal at all, so this log is the only witness to a launch that ended with
/// the player looking at Steve.
pub(crate) fn game_log_problems(text: &str) -> Vec<String> {
    failing_lines(text, |low| SKIN_LOG_WORDS.iter().any(|w| low.contains(w)))
}

/// The source list the launcher writes must name our API and point at the
/// address the game is launched against: a build carried over from another
/// account keeps the old root and quietly answers for a stranger.
pub(crate) fn config_root(cfg: &Value) -> Option<String> {
    cfg["loadlist"]
        .as_array()?
        .iter()
        .find(|s| s["type"] == "CustomSkinAPI")
        .and_then(|s| s["root"].as_str())
        .map(|s| s.to_string())
}

/// authlib-injector refuses a texture served from a host outside `skinDomains`,
/// and the game then draws Steve without a word. A leading dot in the list
/// means "and its subdomains".
pub(crate) fn domain_allowed(url: &str, domains: &[String]) -> bool {
    let Some(host) = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
    else {
        return false;
    };
    domains.iter().any(|d| match d.strip_prefix('.') {
        Some(suffix) => host == suffix || host.ends_with(&format!(".{}", suffix)),
        None => host == *d,
    })
}

fn read_text(path: &std::path::Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).to_string())
}

/// A slice of a log that fits in memory: the tail of the game log for what
/// happened last, the head of the launcher log for what happened at startup.
/// Reading either whole would pull tens of megabytes in for six lines of it.
fn read_slice(path: &std::path::Path, max: u64, tail: bool) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    if tail && len > max {
        file.seek(SeekFrom::Start(len - max)).ok()?;
    }
    let mut buf = Vec::new();
    file.take(max).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).to_string())
}

/// When the build was last played. The game rewrites `logs/latest.log` on every
/// launch, so its timestamp is the launcher's own record of "the build the
/// player is actually in".
fn played_at(dir: &std::path::Path) -> Option<u64> {
    std::fs::metadata(dir.join(GAME_LOG))
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

fn build_report(profile: &Profile, root: &str) -> (Value, BuildFacts) {
    let dir = profile_dir(&profile.name);
    let loader = profile.loader_id();
    let modded = matches!(loader.as_str(), "fabric" | "quilt" | "forge" | "neoforge");
    let state = skin_mod_state(&profile.name);
    let cfg_dir = dir.join("CustomSkinLoader");
    let log = read_text(&cfg_dir.join(CSL_LOG));
    // Only the mod's own journal decides whether the mod complains: a stray
    // error from the game log would blame it for someone else's failure.
    let mod_problems = log.as_deref().map(log_problems).unwrap_or_default();
    let cfg: Value = std::fs::read(cfg_dir.join("CustomSkinLoader.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let cfg_root = config_root(&cfg);
    let played = played_at(&dir);
    let verdict = build_state(
        modded,
        state["on"].as_bool().unwrap_or(false),
        state["present"].as_bool().unwrap_or(false),
        !state["conflict"].is_null(),
        played.is_some(),
        log.is_some(),
        !mod_problems.is_empty(),
    );
    let off_reason = skin_mod_off_reason(&profile.name);
    // The launcher log holds the startup of the last launch, the game log the
    // rest of it: a skin that never arrived leaves its reason in one of the two.
    let launcher_log = read_slice(&dir.join(LAUNCHER_LOG), LAUNCHER_LOG_HEAD, false);
    let agent = launcher_log.as_deref().map(|t| t.to_lowercase().contains(AGENT_MARK));
    let mut problems = mod_problems;
    for source in [
        read_slice(&dir.join(GAME_LOG), GAME_LOG_TAIL, true),
        launcher_log,
    ] {
        for line in source.as_deref().map(game_log_problems).unwrap_or_default() {
            if problems.len() >= MAX_LOG_LINES {
                break;
            }
            if !problems.contains(&line) {
                problems.push(line);
            }
        }
    }
    (
        json!({
            "build": profile.name,
            "mc": profile.version,
            "loader": loader,
            "state": verdict.id(),
            "text": off_text(verdict, off_reason.as_deref()),
            "conflict": state["conflict"],
            "offReason": off_reason,
            "playedAt": played,
            "agentSeen": agent,
            "root": cfg_root,
            "rootStale": cfg_root.as_deref().map(|r| r != root).unwrap_or(false),
            "problems": problems,
        }),
        BuildFacts { state: verdict, played, agent },
    )
}

async fn texture_ok(url: &str) -> bool {
    let Ok(resp) = client().get(url).send().await else { return false };
    resp.status().is_success()
        && resp.headers().get("content-type").and_then(|v| v.to_str().ok())
            .map(|t| t.contains("image"))
            .unwrap_or(false)
}

/// What our own side answers for this nickname: the profile the mod asks for and
/// the two textures it then downloads.
async fn server_report(nick: &str, root: &str) -> Value {
    let url = format!("{}{}", root, nick);
    let profile = match get_json(&url).await {
        Ok(v) => v,
        Err(e) => {
            return json!({ "ok": false, "reason": format!("профиль скина не отдаётся: {}", e) });
        }
    };
    let skin = profile["skins"]["default"].as_str().or_else(|| profile["skins"]["slim"].as_str());
    let cape = profile["cape"].as_str().filter(|s| !s.is_empty());
    let texture_url = |id: &str| format!("{}textures/{}", root, id);
    let skin_ok = match skin {
        Some(id) => texture_ok(&texture_url(id)).await,
        None => false,
    };
    let cape_ok = match cape {
        Some(id) => texture_ok(&texture_url(id)).await,
        None => true,
    };
    json!({
        "ok": skin.is_some() && skin_ok && cape_ok,
        "skin": skin.is_some(),
        "cape": cape.is_some(),
        "skinReadable": skin_ok,
        "capeReadable": cape_ok,
    })
}

/// The other route a skin takes, and the only one a vanilla build has: the
/// agent that redirects the session, the profile our Yggdrasil signs, and the
/// texture the game then downloads by itself. Every link here is one the
/// wardrobe cannot see, and the report used to check none of them — a player on
/// a vanilla build was told "всё в порядке" while the game drew Steve.
async fn session_report(nick: &str) -> Value {
    let agent = data_dir().join("agents").join(AGENT_JAR).exists();
    let meta = get_json(&format!("{}/yggdrasil", MILLIDA_API)).await.unwrap_or(Value::Null);
    let domains: Vec<String> = meta["skinDomains"]
        .as_array()
        .map(|a| a.iter().filter_map(|d| d.as_str()).map(|d| d.to_ascii_lowercase()).collect())
        .unwrap_or_default();
    let uuid = post_json(
        &format!("{}/yggdrasil/api/profiles/minecraft", MILLIDA_API),
        &json!([nick]),
    )
    .await
    .ok()
    .and_then(|v| v.as_array().and_then(|a| a.first()).and_then(|p| p["id"].as_str().map(String::from)));
    let Some(uuid) = uuid else {
        return json!({ "agent": agent, "profile": false, "ok": false });
    };
    // `unsigned=false` is what the game asks for, and 1.20.5 and newer drop a
    // textures property that comes back without the signature.
    let profile = get_json(&format!(
        "{}/yggdrasil/sessionserver/session/minecraft/profile/{}?unsigned=false",
        MILLIDA_API, uuid
    ))
    .await
    .unwrap_or(Value::Null);
    let prop = profile["properties"]
        .as_array()
        .and_then(|a| a.iter().find(|p| p["name"] == "textures").cloned())
        .unwrap_or(Value::Null);
    let signed = prop["signature"].as_str().map(|s| !s.is_empty()).unwrap_or(false);
    let payload: Value = prop["value"]
        .as_str()
        .and_then(b64_decode)
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let skin_url = payload["textures"]["SKIN"]["url"].as_str().map(String::from);
    let domain_ok = skin_url.as_deref().map(|u| domain_allowed(u, &domains)).unwrap_or(false);
    let readable = match skin_url.as_deref() {
        Some(u) => texture_ok(u).await,
        None => false,
    };
    json!({
        "agent": agent,
        "profile": !profile["id"].is_null(),
        "signed": signed,
        "skin": skin_url.is_some(),
        "cape": payload["textures"]["CAPE"]["url"].is_string(),
        "domainOk": domain_ok,
        "textureOk": readable,
        "ok": agent && signed && skin_url.is_some() && domain_ok && readable,
    })
}

/// The first broken link of the account route, if any. Order follows the route
/// itself: an agent that never downloaded makes every later answer irrelevant.
pub(crate) fn session_fault(s: &Value) -> Option<(&'static str, &'static str)> {
    if s.is_null() || s["ok"].as_bool().unwrap_or(false) {
        return None;
    }
    let no = |k: &str| !s[k].as_bool().unwrap_or(false);
    if no("agent") {
        return Some((
            "agent",
            "Файл входа в игру (authlib-injector) не скачался — игра запускается без сессии Millida, а вместе с ней пропадает и скин. Проверь интернет и запусти сборку ещё раз.",
        ));
    }
    if no("profile") {
        return Some((
            "session",
            "Наш сервер сессий не отдаёт профиль этого ника — именно оттуда игра берёт скин. Это на нашей стороне, уже смотрим.",
        ));
    }
    if no("skin") {
        return Some((
            "session",
            "В сессии аккаунта нет скина — открой гардероб и нажми «Применить».",
        ));
    }
    if no("signed") {
        return Some((
            "session",
            "Профиль сессии приходит без подписи, а Minecraft 1.20.5 и новее такие текстуры не принимает. Это на нашей стороне, уже смотрим.",
        ));
    }
    if no("domainOk") {
        return Some((
            "session",
            "Адрес текстуры скина не в списке доменов нашего Yggdrasil — игра откажется её качать. Это на нашей стороне, уже смотрим.",
        ));
    }
    Some((
        "session",
        "Текстура скина не открывается по своему адресу — её может резать провайдер, антивирус или VPN. Попробуй другую сеть.",
    ))
}

fn build_fault(state: BuildSkin) -> Option<(&'static str, &'static str)> {
    BUILD_FAULTS.iter().find(|(bad, _, _)| *bad == state).map(|(_, id, text)| (*id, *text))
}

/// Priority of what to tell the player first: our own side, then the account
/// route, then the build they actually play. A build that never ran — or one
/// they last opened days ago — must not outrank the build they are in right
/// now: a switched-off mod in an idle build used to answer for a skin missing
/// somewhere else entirely.
pub(crate) fn overall(
    server: &Value,
    session: &Value,
    builds: &[BuildFacts],
    online: bool,
) -> (&'static str, String) {
    if !online {
        return (
            "offline",
            "Вход Millida не выполнен — скин из гардероба игре брать неоткуда. Войди в аккаунт в лаунчере.".into(),
        );
    }
    if !server["ok"].as_bool().unwrap_or(false) {
        let text = if server["skin"].as_bool() == Some(false) {
            "В твоём профиле нет применённого скина — открой гардероб и нажми «Применить»."
        } else {
            "Текстуры скина сейчас не отдаются нашим сервером — это на нашей стороне, уже смотрим."
        };
        return ("server", text.into());
    }
    if let Some((id, text)) = session_fault(session) {
        return (id, text.into());
    }
    let played: Vec<&BuildFacts> = builds.iter().filter(|b| b.played.is_some()).collect();
    let active: Option<BuildFacts> = played.iter().max_by_key(|b| b.played).map(|b| **b);
    if let Some((id, text)) = active.map(|b| b.state).and_then(build_fault) {
        return (id, text.into());
    }
    // A vanilla build has no second route: if the agent did not announce itself
    // in the last launch, the game ran without our session and the skin had
    // nowhere to come from — whatever the wardrobe and the server say.
    if active.map(|b| b.state) == Some(BuildSkin::Vanilla) && active.and_then(|b| b.agent) == Some(false) {
        return (
            "agent",
            "Последний запуск этой сборки прошёл без сессии Millida — в журнале нет строки входа, а ванильной сборке скин брать больше неоткуда. Так бывает, когда сборку запускают лицензией Microsoft или когда лаунчер ушёл в офлайн-режим: выбери аккаунт Millida и запусти сборку заново.".into(),
        );
    }
    // Nothing has been launched yet: then any build may be the one the player is
    // asking about, and a switched-off mod is still worth saying out loud.
    if active.is_none() {
        for (bad, id, text) in BUILD_FAULTS {
            if builds.iter().any(|b| b.state == bad) {
                return (id, text.into());
            }
        }
    }
    // The build in front of the player is healthy, so a fault elsewhere is a
    // footnote, not the answer: it used to be the answer, and a mod switched off
    // in an idle build explained away a skin missing in the active one.
    let elsewhere = if played.iter().any(|b| build_fault(b.state).is_some()) {
        " В другой сборке мод скинов не в порядке — смотри список ниже."
    } else {
        ""
    };
    if active.map(|b| b.state) == Some(BuildSkin::Vanilla)
        || (!builds.is_empty() && builds.iter().all(|b| b.state == BuildSkin::Vanilla))
    {
        return (
            "vanilla",
            format!("Скин на месте и приходит из аккаунта — ванильной сборке мод для этого не нужен. Если в игре всё ещё Стив, выйди в главное меню и зайди в мир заново; на чужом сервере в офлайн-режиме скин подставляет сам сервер, и наш там не появится.{}", elsewhere),
        );
    }
    (
        "ok",
        format!("Скин и плащ на месте: сервер их отдаёт, мод в сборке отработал. Если в игре всё ещё старая текстура — выйди в меню и зайди в мир заново.{}", elsewhere),
    )
}

/// Answers "why is my skin not in the game" without asking the player for logs.
pub async fn skin_diagnose(nick: &str, online: bool) -> Value {
    let nick = nick.trim();
    if nick.is_empty() {
        return json!({ "verdict": "offline", "text": "Не выбран аккаунт — в гардеробе некому применять скин.", "builds": [] });
    }
    let root = format!("{}/yggdrasil/csl/", MILLIDA_API);
    let (server, session) = if online {
        tokio::join!(server_report(nick, &root), session_report(nick))
    } else {
        (Value::Null, Value::Null)
    };
    let profiles = load_profiles();
    let reports: Vec<(Value, BuildFacts)> =
        profiles.iter().take(MAX_BUILDS).map(|p| build_report(p, &root)).collect();
    let facts: Vec<BuildFacts> = reports.iter().map(|(_, f)| *f).collect();
    let builds: Vec<Value> = reports.into_iter().map(|(v, _)| v).collect();
    let (verdict, text) = overall(&server, &session, &facts, online);
    json!({ "nick": nick, "verdict": verdict, "text": text, "server": server, "session": session, "builds": builds })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(state: BuildSkin, played: Option<u64>) -> BuildFacts {
        BuildFacts { state, played, agent: Some(true) }
    }

    /// modded | on | jar | conflict | launched | log | complains | verdict
    /// нет    | -  | -   | -        | -        | -   | -         | ваниль: мод ставить некуда
    /// да     | да | да  | да       | да       | да  | нет       | конфликт важнее всего остального
    /// да     | да | да  | нет      | да       | нет | нет       | мод не загрузился этой версией игры
    /// да     | да | да  | нет      | нет      | нет | нет       | сборку не запускали — не вина мода
    #[test]
    fn a_mod_that_left_no_journal_after_a_launch_is_the_one_that_did_not_run() {
        assert_eq!(build_state(false, true, true, false, true, true, false), BuildSkin::Vanilla);
        assert_eq!(
            build_state(true, true, true, true, true, true, false),
            BuildSkin::Conflict,
            "чужой мод скинов решает за наш, и это надо сказать раньше всех прочих придирок"
        );
        assert_eq!(
            build_state(true, true, true, false, true, false, false),
            BuildSkin::ModSilent,
            "игра запускалась, jar на месте, а журнала мода нет — мод не загрузился, и это ровно тот случай, когда игрок не видит скина без единой ошибки на экране"
        );
        assert_eq!(
            build_state(true, true, true, false, false, false, false),
            BuildSkin::NeverLaunched,
            "не запускавшаяся сборка не должна выглядеть как поломка"
        );
        assert_eq!(build_state(true, true, false, false, true, false, false), BuildSkin::Missing);
        assert_eq!(build_state(true, false, true, false, true, true, false), BuildSkin::Off);
        assert_eq!(build_state(true, true, true, false, true, true, true), BuildSkin::ModComplains);
        assert_eq!(build_state(true, true, true, false, true, true, false), BuildSkin::Ok);
    }

    #[test]
    fn only_failing_lines_of_the_mod_journal_are_kept() {
        let log = "[INFO] Loading profile arar1995\n\
                   [ERROR] Failed to get profile from Millida: timeout\n\
                   [INFO] Cache expired\n\
                   [ERROR] Failed to get profile from Millida: timeout\n";
        let p = log_problems(log);
        assert_eq!(p.len(), 1, "повтор одной и той же строки не делает диагноз убедительнее, а вытесняет другие");
        assert!(p[0].contains("timeout"));
        assert!(
            log_problems("[INFO] Loading profile arar1995\n[INFO] Done\n").is_empty(),
            "спокойный журнал обязан читаться как «всё хорошо», иначе диагностика всегда кого-то обвиняет"
        );
    }

    /// строка игрового журнала                                   | берём | почему закреплено
    /// [ERROR] Couldn't load skin ...                             | да    | ровно то, ради чего лог и читают
    /// [ERROR] Failed to verify textures payload signature        | да    | подпись профиля — путь аккаунта
    /// [ERROR] Exception loading blockstate for jei:...           | нет   | чужой мод, к скину отношения нет
    /// [INFO] Setting user: D1V1N3K0PROT0G3N                      | нет   | не ошибка
    #[test]
    fn the_game_log_is_read_only_for_what_it_says_about_skins() {
        let log = "[12:00:00] [Render thread/INFO]: Setting user: D1V1N3K0PROT0G3N\n\
                   [12:00:01] [Render thread/ERROR]: Exception loading blockstate for jei:button\n\
                   [12:00:02] [Render thread/ERROR]: Couldn't load skin https://cdn.millida.trade/launcher/skins/a.png\n\
                   [12:00:03] [Render thread/ERROR]: Failed to verify textures payload signature\n";
        let p = game_log_problems(log);
        assert_eq!(
            p.len(),
            2,
            "в отчёт о скине не должны попадать падения посторонних модов: иначе поддержка читает чужой краш вместо причины"
        );
        assert!(p.iter().any(|l| l.contains("Couldn't load skin")));
        assert!(p.iter().any(|l| l.contains("signature")));
    }

    #[test]
    fn the_api_source_of_the_written_config_is_readable_back() {
        let cfg = json!({ "loadlist": [
            { "name": "Millida", "type": "CustomSkinAPI", "root": "https://api.millida.net/v2/yggdrasil/csl/" },
            { "name": "GameProfile", "type": "GameProfile" }
        ]});
        assert_eq!(config_root(&cfg).as_deref(), Some("https://api.millida.net/v2/yggdrasil/csl/"));
        assert_eq!(config_root(&json!({ "loadlist": [] })), None);
        assert_eq!(config_root(&Value::Null), None);
    }

    /// адрес текстуры                          | список          | вердикт | почему закреплено
    /// https://cdn.millida.trade/x.png         | .millida.trade  | ок      | наше хранилище — поддомен
    /// https://millida.trade/x.png             | .millida.trade  | ок      | точка покрывает и сам домен
    /// https://millida.net.evil.com/x.png      | .millida.net    | нет     | суффикс, а не «содержит»
    /// https://cdn.example.org/x.png           | .millida.trade  | нет     | чужой хост игра не откроет
    #[test]
    fn a_texture_host_outside_skin_domains_is_a_skin_the_game_will_never_draw() {
        let list = [".millida.trade".to_string(), "millida.net".to_string()];
        assert!(domain_allowed("https://cdn.millida.trade/launcher/skins/a.png", &list));
        assert!(domain_allowed("https://millida.trade/a.png", &list));
        assert!(domain_allowed("https://millida.net/a.png", &list));
        assert!(
            !domain_allowed("https://millida.net.evil.com/a.png", &list),
            "запись без точки обязана совпадать целиком, иначе белый список пропускает чужой домен с нашим именем внутри"
        );
        assert!(!domain_allowed("https://cdn.example.org/a.png", &list));
        assert!(!domain_allowed("не ссылка", &list));
    }

    /// отчёт сессии                    | вердикт | почему закреплено
    /// всё сошлось                     | нет     | путь аккаунта исправен
    /// агента нет                      | agent   | игра уйдёт в офлайн, скина не будет ни в одной сборке
    /// профиль без подписи             | session | 1.20.5+ молча выбрасывает такие текстуры
    /// хост текстуры вне skinDomains   | session | authlib-injector откажется её качать
    #[test]
    fn the_account_route_names_its_own_broken_link() {
        let good = json!({ "agent": true, "profile": true, "signed": true, "skin": true, "domainOk": true, "textureOk": true, "ok": true });
        assert_eq!(session_fault(&good), None);
        assert_eq!(session_fault(&Value::Null), None, "офлайн-проверка не должна выдумывать поломку");
        let no_agent = json!({ "agent": false, "profile": true, "signed": true, "skin": true, "domainOk": true, "textureOk": true, "ok": false });
        assert_eq!(session_fault(&no_agent).map(|(id, _)| id), Some("agent"));
        let unsigned = json!({ "agent": true, "profile": true, "signed": false, "skin": true, "domainOk": true, "textureOk": true, "ok": false });
        assert!(
            session_fault(&unsigned).map(|(_, t)| t.contains("подписи")).unwrap_or(false),
            "профиль без подписи — это не «попробуй ещё раз», а причина, по которой игра рисует Стива"
        );
        let bad_host = json!({ "agent": true, "profile": true, "signed": true, "skin": true, "domainOk": false, "textureOk": true, "ok": false });
        assert!(session_fault(&bad_host).map(|(_, t)| t.contains("доменов")).unwrap_or(false));
    }

    /// вход | сервер           | сессия | сборки                        | вердикт
    /// нет  | -                | -      | -                             | offline: гардероб не доедет до игры
    /// да   | скин не применён | -      | -                             | server: причина у нас, а не в сборке
    /// да   | ок               | ок     | мод молчит + ок               | mod_silent: сломанная сборка важнее здоровой
    /// да   | ок               | ок     | ваниль сегодня + forge вчера  | vanilla: отвечает та сборка, в которой играют
    /// да   | ок               | ок     | только ваниль                 | vanilla
    #[test]
    fn the_first_thing_told_to_the_player_is_the_thing_that_actually_blocks_the_skin() {
        let good = json!({ "ok": true, "skin": true, "cape": true });
        let no_skin = json!({ "ok": false, "skin": false, "cape": false });
        let live = json!({ "agent": true, "profile": true, "signed": true, "skin": true, "domainOk": true, "textureOk": true, "ok": true });
        let played = |s| facts(s, Some(100));
        assert_eq!(overall(&good, &live, &[played(BuildSkin::Ok)], false).0, "offline");
        assert_eq!(
            overall(&no_skin, &live, &[played(BuildSkin::Ok)], true).0,
            "server",
            "пустой профиль на нашей стороне нельзя объяснять игроку модами в его сборке"
        );
        assert_eq!(
            overall(&good, &live, &[played(BuildSkin::Ok), played(BuildSkin::ModSilent)], true).0,
            "mod_silent"
        );
        assert_eq!(overall(&good, &live, &[played(BuildSkin::Vanilla)], true).0, "vanilla");
        assert_eq!(
            overall(&good, &live, &[played(BuildSkin::Ok), facts(BuildSkin::NeverLaunched, None)], true).0,
            "ok"
        );
        let dead_session = json!({ "agent": false, "profile": true, "signed": true, "skin": true, "domainOk": true, "textureOk": true, "ok": false });
        assert_eq!(
            overall(&good, &dead_session, &[played(BuildSkin::Vanilla)], true).0,
            "agent",
            "на ванильной сборке сессия — единственный путь скина, и её обрыв важнее любого состояния сборок"
        );
    }

    /// Тикет D1V1N3K0PROT0G3N (28.08.2026): игрок десять раз подряд запускал
    /// ванильную сборку, а вердикт пришёл из forge-сборки, которую он в тот день
    /// открывал один раз задолго до этого — и советовал включить мод там.
    #[test]
    fn the_build_the_player_is_in_answers_before_the_one_they_left_yesterday() {
        let good = json!({ "ok": true, "skin": true, "cape": true });
        let live = json!({ "agent": true, "profile": true, "signed": true, "skin": true, "domainOk": true, "textureOk": true, "ok": true });
        let today = facts(BuildSkin::Vanilla, Some(1_756_400_000));
        let yesterday = facts(BuildSkin::Off, Some(1_756_300_000));
        let (verdict, text) = overall(&good, &live, &[yesterday, today], true);
        assert_eq!(
            verdict, "vanilla",
            "выключенный мод в отложенной сборке не объясняет отсутствие скина в той, где игрок сидит сейчас"
        );
        assert!(
            text.contains("В другой сборке"),
            "замолчать поломку соседней сборки тоже нельзя — про неё говорится отдельной строкой, а не вместо вердикта"
        );
        let never = facts(BuildSkin::Off, None);
        assert_eq!(
            overall(&good, &live, &[never, today], true).0,
            "vanilla",
            "сборка, которую ни разу не запускали, не может быть причиной чего бы то ни было"
        );
        assert_eq!(
            overall(&good, &live, &[facts(BuildSkin::Off, Some(1_756_400_000)), facts(BuildSkin::Vanilla, Some(1_756_300_000))], true).0,
            "off",
            "если сейчас играют именно в сборке с выключенным модом — вердикт обязан остаться прежним"
        );
    }

    /// сборка | журнал запуска     | вердикт | почему закреплено
    /// ваниль | агента не видно    | agent   | игра шла без сессии, скину взяться неоткуда
    /// ваниль | агент отметился    | vanilla | путь аккаунта отработал
    /// ваниль | журнала нет        | vanilla | улик нет — обвинять нечем
    #[test]
    fn a_vanilla_launch_that_carried_no_session_agent_is_named_as_such() {
        let good = json!({ "ok": true, "skin": true, "cape": true });
        let live = json!({ "agent": true, "profile": true, "signed": true, "skin": true, "domainOk": true, "textureOk": true, "ok": true });
        let vanilla = |agent| BuildFacts { state: BuildSkin::Vanilla, played: Some(10), agent };
        assert_eq!(
            overall(&good, &live, &[vanilla(Some(false))], true).0,
            "agent",
            "гардероб и сервер могут быть исправны, а игра всё равно запустилась офлайн — на ванили это и есть причина"
        );
        assert_eq!(overall(&good, &live, &[vanilla(Some(true))], true).0, "vanilla");
        assert_eq!(
            overall(&good, &live, &[vanilla(None)], true).0,
            "vanilla",
            "без журнала запуска утверждать, что сессии не было, нельзя"
        );
    }

    /// состояние | маркер   | что читает игрок
    /// off       | crash    | мод выключил лаунчер после падения сборки
    /// off       | removed  | мод убрали из списка модов
    /// off       | off      | переключатель в настройках сборки
    #[test]
    fn a_mod_the_launcher_switched_off_itself_says_so() {
        assert!(off_text(BuildSkin::Off, Some("crash")).contains("упала"));
        assert!(off_text(BuildSkin::Off, Some("removed")).contains("убрали"));
        assert_eq!(
            off_text(BuildSkin::Off, Some("off")),
            BuildSkin::Off.text(),
            "выключенный вручную мод не нуждается в оправданиях"
        );
        assert_eq!(off_text(BuildSkin::Ok, Some("crash")), BuildSkin::Ok.text());
    }
}
