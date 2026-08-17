use crate::engine::*;
use serde_json::{json, Value};

/// Written by the mod itself on every launch it takes part in. Its absence in a
/// build that has the jar and has already been played is the one signal that
/// tells "the mod did not run" apart from "the mod ran and found nothing".
const CSL_LOG: &str = "CustomSkinLoader.log";
const GAME_LOG: &str = "logs/latest.log";
const MAX_LOG_LINES: usize = 6;
const MAX_LINE_CHARS: usize = 200;
const MAX_BUILDS: usize = 12;

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

/// Lines of the mod's journal that report a failure. Everything else there is a
/// normal profile lookup, and a journal full of them says nothing is wrong.
pub(crate) fn log_problems(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines().rev() {
        let low = line.to_lowercase();
        let bad = ["error", "exception", "failed", "timeout", "refused", "not defined", "unable"]
            .iter()
            .any(|m| low.contains(m));
        if !bad {
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

fn read_text(path: &std::path::Path) -> Option<String> {
    std::fs::read(path).ok().map(|b| String::from_utf8_lossy(&b).to_string())
}

fn build_report(profile: &Profile, root: &str) -> Value {
    let dir = profile_dir(&profile.name);
    let loader = profile.loader_id();
    let modded = matches!(loader.as_str(), "fabric" | "quilt" | "forge" | "neoforge");
    let state = skin_mod_state(&profile.name);
    let cfg_dir = dir.join("CustomSkinLoader");
    let log = read_text(&cfg_dir.join(CSL_LOG));
    let problems = log.as_deref().map(log_problems).unwrap_or_default();
    let cfg: Value = std::fs::read(cfg_dir.join("CustomSkinLoader.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let cfg_root = config_root(&cfg);
    let verdict = build_state(
        modded,
        state["on"].as_bool().unwrap_or(false),
        state["present"].as_bool().unwrap_or(false),
        !state["conflict"].is_null(),
        dir.join(GAME_LOG).exists(),
        log.is_some(),
        !problems.is_empty(),
    );
    json!({
        "build": profile.name,
        "mc": profile.version,
        "loader": loader,
        "state": verdict.id(),
        "text": verdict.text(),
        "conflict": state["conflict"],
        "root": cfg_root,
        "rootStale": cfg_root.as_deref().map(|r| r != root).unwrap_or(false),
        "problems": problems,
    })
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

/// Priority of what to tell the player first: our own side, then the build they
/// actually play. A build that never ran must not outrank a real fault.
pub(crate) fn overall(server: &Value, states: &[BuildSkin], online: bool) -> (&'static str, String) {
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
    for (bad, text) in [
        (BuildSkin::Conflict, "В сборке стоит свой мод скинов — он перебивает наш. Убери его или выключи наш мод в настройках сборки."),
        (BuildSkin::ModSilent, "Мод скинов не запускается с этой версией игры — поэтому скина и плаща в ней нет. Собери сборку на версии, где мод работает, либо играй на серверах Millida: там скин виден и без мода."),
        (BuildSkin::ModComplains, "Мод скинов запускается, но ругается в своём журнале — смотри строки ниже."),
        (BuildSkin::Missing, "В сборке нет мода скинов: его убрали вручную или он не поставился. Включи мод скинов в настройках сборки."),
        (BuildSkin::Off, "Мод скинов выключен для этой сборки — включи его в настройках сборки."),
    ] {
        if states.contains(&bad) {
            return (
                match bad {
                    BuildSkin::Conflict => "conflict",
                    BuildSkin::ModSilent => "mod_silent",
                    BuildSkin::ModComplains => "mod_complains",
                    BuildSkin::Missing => "missing",
                    _ => "off",
                },
                text.into(),
            );
        }
    }
    if states.iter().all(|s| *s == BuildSkin::Vanilla) && !states.is_empty() {
        return (
            "vanilla",
            "Все твои сборки ванильные: скин в них виден только на серверах, которые спрашивают аккаунт. В одиночной игре его покажет сборка с модами.".into(),
        );
    }
    (
        "ok",
        "Скин и плащ на месте: сервер их отдаёт, мод в сборке отработал. Если в игре всё ещё старая текстура — выйди в меню и зайди в мир заново.".into(),
    )
}

/// Answers "why is my skin not in the game" without asking the player for logs.
pub async fn skin_diagnose(nick: &str, online: bool) -> Value {
    let nick = nick.trim();
    if nick.is_empty() {
        return json!({ "verdict": "offline", "text": "Не выбран аккаунт — в гардеробе некому применять скин.", "builds": [] });
    }
    let root = format!("{}/yggdrasil/csl/", MILLIDA_API);
    let server = if online { server_report(nick, &root).await } else { Value::Null };
    let profiles = load_profiles();
    let builds: Vec<Value> = profiles.iter().take(MAX_BUILDS).map(|p| build_report(p, &root)).collect();
    let states: Vec<BuildSkin> = profiles
        .iter()
        .take(MAX_BUILDS)
        .map(|p| {
            let dir = profile_dir(&p.name);
            let state = skin_mod_state(&p.name);
            let log = read_text(&dir.join("CustomSkinLoader").join(CSL_LOG));
            build_state(
                matches!(p.loader_id().as_str(), "fabric" | "quilt" | "forge" | "neoforge"),
                state["on"].as_bool().unwrap_or(false),
                state["present"].as_bool().unwrap_or(false),
                !state["conflict"].is_null(),
                dir.join(GAME_LOG).exists(),
                log.is_some(),
                log.as_deref().map(|t| !log_problems(t).is_empty()).unwrap_or(false),
            )
        })
        .collect();
    let (verdict, text) = overall(&server, &states, online);
    json!({ "nick": nick, "verdict": verdict, "text": text, "server": server, "builds": builds })
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// вход | сервер           | сборки                 | вердикт
    /// нет  | -                | -                      | offline: гардероб не доедет до игры
    /// да   | скин не применён | -                      | server: причина у нас, а не в сборке
    /// да   | ок               | мод молчит + ок        | mod_silent: сломанная сборка важнее здоровой
    /// да   | ок               | только ваниль          | vanilla
    #[test]
    fn the_first_thing_told_to_the_player_is_the_thing_that_actually_blocks_the_skin() {
        let good = json!({ "ok": true, "skin": true, "cape": true });
        let no_skin = json!({ "ok": false, "skin": false, "cape": false });
        assert_eq!(overall(&good, &[BuildSkin::Ok], false).0, "offline");
        assert_eq!(
            overall(&no_skin, &[BuildSkin::Ok], true).0,
            "server",
            "пустой профиль на нашей стороне нельзя объяснять игроку модами в его сборке"
        );
        assert_eq!(overall(&good, &[BuildSkin::Ok, BuildSkin::ModSilent], true).0, "mod_silent");
        assert_eq!(overall(&good, &[BuildSkin::Vanilla], true).0, "vanilla");
        assert_eq!(overall(&good, &[BuildSkin::Ok, BuildSkin::NeverLaunched], true).0, "ok");
    }
}
