// Notices in the game log that a server refused the player's session (an expired or revoked Minecraft
// token), so the launcher can offer to renew the sign-in and join the same server again. Reads log lines only.
use super::gameserver::{hop_from_log, ServerHop};

/// Lowercased fragments of what authlib and the client print when `joinServer` is refused.
const MARKERS: [&str; 5] = [
    "invalidcredentialsexception",
    "loginfailedinfo.invalidsession",
    "invalid session (try restarting your game",
    "failed to verify username",
    "you are not logged into your minecraft account",
];

/// The Russian client prints the same refusals translated. They are matched inline: these are
/// log texts to recognise, not launcher texts to translate.
fn russian_refusal(low: &str) -> bool {
    low.contains("недействительная сессия")
        || low.contains("вы не вошли в свой аккаунт minecraft")
        || low.contains("не удалось проверить имя пользователя")
}

#[derive(Default)]
pub(crate) struct KickWatch {
    server: Option<String>,
    fired: bool,
}

impl KickWatch {
    /// The server the refusal came from, once per connection attempt. A new "Connecting to"
    /// line arms it again: the player may have renewed the session and retried.
    pub(crate) fn feed(&mut self, line: &str) -> Option<String> {
        match hop_from_log(line) {
            Some(ServerHop::Joined(addr)) => {
                self.server = Some(addr);
                self.fired = false;
                return None;
            }
            Some(ServerHop::Left) => {
                self.server = None;
                return None;
            }
            None => {}
        }
        if self.fired || self.server.is_none() {
            return None;
        }
        let low = line.to_lowercase();
        if !MARKERS.iter().any(|m| low.contains(m)) && !russian_refusal(&low) {
            return None;
        }
        self.fired = true;
        self.server.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::KickWatch;

    #[test]
    fn a_refused_session_is_reported_once_per_attempt() {
        let mut w = KickWatch::default();
        let steps: [(&str, Option<&str>, &str); 6] = [
            ("[12:00:00] [Render thread/WARN]: Failed to verify username", None, "no server yet: a single-player line is not a kick"),
            ("[12:00:01] [Server Connector #1/INFO]: Connecting to play.example.net, 25565", None, "the attempt is remembered"),
            (
                "[12:00:02] [Netty Client IO #0/ERROR]: com.mojang.authlib.exceptions.InvalidCredentialsException: Invalid token",
                Some("play.example.net"),
                "authlib refused the token",
            ),
            ("[12:00:02] [Render thread/INFO]: Недействительная сессия", None, "the same attempt is not reported twice"),
            ("[12:01:00] [Server Connector #2/INFO]: Connecting to play.example.net, 25565", None, "a retry arms the watch again"),
            ("[12:01:01] [Render thread/INFO]: Вы не вошли в свой аккаунт Minecraft", Some("play.example.net"), "Russian client text"),
        ];
        for (line, want, why) in steps {
            assert_eq!(w.feed(line).as_deref(), want, "{why}");
        }
    }
}
