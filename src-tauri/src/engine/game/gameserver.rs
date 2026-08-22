use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const DEFAULT_PORT: u16 = 25565;

/// Where the player actually is right now, as told by the game itself.
///
/// The launch arguments only carry the server the player clicked in the
/// launcher; everything after that — the Multiplayer menu, a direct connect, a
/// hub sending the player to another network — happens inside the game, so the
/// address is read from the client log instead.
#[derive(Debug, PartialEq)]
pub(crate) enum ServerHop {
    Joined(String),
    Left,
}

pub(crate) type ServerSlot = Arc<Mutex<Option<String>>>;

pub(crate) fn current_server(slot: &ServerSlot) -> Option<String> {
    slot.lock().ok().and_then(|v| v.clone())
}

/// Address as a playtime key: the same server typed as `Play.Example.RU:25565`
/// and reported by the game as `play.example.ru, 25565` must land on one entry.
pub(crate) fn canon_addr(addr: &str) -> String {
    let addr = addr.trim().trim_end_matches('.');
    let (host, port) = match addr.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() && !h.ends_with(']') => match p.parse::<u16>() {
            Ok(p) => (h, p),
            Err(_) => (addr, DEFAULT_PORT),
        },
        _ => (addr, DEFAULT_PORT),
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    if port == DEFAULT_PORT { host } else { format!("{}:{}", host, port) }
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 255
        && !host.contains(char::is_whitespace)
        && host.chars().any(|c| c.is_ascii_alphanumeric())
}

pub(crate) fn hop_from_log(line: &str) -> Option<ServerHop> {
    if line.contains("Starting integrated minecraft server") {
        return Some(ServerHop::Left);
    }
    let at = line.find("Connecting to ")?;
    let prefix = &line[..at];
    if !(prefix.is_empty() || prefix.ends_with("]: ")) {
        return None;
    }
    let (host, port) = line[at + "Connecting to ".len()..].trim_end().split_once(", ")?;
    let host = host.trim();
    let port: u16 = port.trim().parse().ok()?;
    if !valid_host(host) {
        return None;
    }
    Some(ServerHop::Joined(canon_addr(&format!("{}:{}", host, port))))
}

/// The view keeps its own idea of the session (Discord activity, the presence
/// heartbeat that pays for playtime), so a hop is announced as it happens
/// instead of being discovered when the game exits. An empty address means the
/// player is in the menu or in a single-player world.
pub(crate) fn track_server_hop(line: &str, slot: &ServerSlot, app: &AppHandle) {
    let next = match hop_from_log(line) {
        Some(ServerHop::Joined(addr)) => Some(addr),
        Some(ServerHop::Left) => None,
        None => return,
    };
    let changed = match slot.lock() {
        Ok(mut cur) => {
            if *cur == next {
                false
            } else {
                *cur = next.clone();
                true
            }
        }
        Err(_) => false,
    };
    if changed {
        let _ = app.emit("game-server", next.unwrap_or_default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Вход -> вердикт. Каждый кейс закреплён за реальным форматом клиентского
    /// лога или за строкой, которую мод не должен выдать за вход на сервер.
    #[test]
    fn log_lines_map_to_hops() {
        let cases: Vec<(&str, Option<ServerHop>)> = vec![
            (
                "[15:04:05] [Render thread/INFO]: Connecting to migosmc.net, 25565",
                Some(ServerHop::Joined("migosmc.net".into())),
            ),
            (
                "[15:04:05] [Client thread/INFO]: Connecting to Play.Example.RU, 25577",
                Some(ServerHop::Joined("play.example.ru:25577".into())),
            ),
            (
                "[15:04:05] [Render thread/INFO]: Starting integrated minecraft server version 1.20.1",
                Some(ServerHop::Left),
            ),
            ("[15:04:05] [main/INFO]: Connecting to database, retrying", None),
            ("[15:04:05] [main/INFO]: Connecting to , 25565", None),
            ("mod says: Connecting to evil.example, 25565", None),
            ("[15:04:05] [Render thread/INFO]: Connecting to host, port", None),
        ];
        for (line, want) in cases {
            assert_eq!(hop_from_log(line), want, "строка лога разобрана неверно: {}", line);
        }
    }

    #[test]
    fn canon_addr_merges_case_and_default_port() {
        assert_eq!(canon_addr("MigosMc.net"), "migosmc.net");
        assert_eq!(canon_addr("MigosMc.net:25565"), "migosmc.net");
        assert_eq!(canon_addr("mc.example.ru:25577"), "mc.example.ru:25577");
        assert_eq!(
            canon_addr("mc.example.ru:notaport"),
            "mc.example.ru:notaport",
            "порт-мусор остаётся частью ключа, иначе два разных адреса схлопнутся в один"
        );
    }
}
