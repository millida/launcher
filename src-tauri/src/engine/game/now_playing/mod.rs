//! What plays on the computer, handed to the Millida mod's Dynamic Island over
//! a loopback WebSocket. The contract is millida-mod/docs/media.md.

mod cover;
mod protocol;
mod server;
#[cfg(target_os = "linux")]
mod mpris;
#[cfg(windows)]
mod smtc;

#[cfg(target_os = "linux")]
use mpris as platform;
#[cfg(windows)]
use smtc as platform;

use protocol::{Command, NowPlaying};
use std::sync::{Arc, Mutex, Weak};
use tokio::sync::watch;

pub const PORT_ENV: &str = "MILLIDA_MEDIA_PORT";
pub const KEY_ENV: &str = "MILLIDA_MEDIA_KEY";

pub(crate) type Reading = Option<Arc<NowPlaying>>;

pub(crate) enum Control {
    Command(Command),
    Stop,
}

type Controller = Box<dyn Fn(Control) + Send + Sync>;

/// One reader of the system media session, shared by every running game and
/// stopped when the last of them exits.
pub(crate) struct Hub {
    state: watch::Receiver<Reading>,
    control: Controller,
}

static HUB: Mutex<Weak<Hub>> = Mutex::new(Weak::new());

impl Hub {
    #[cfg(any(windows, target_os = "linux"))]
    fn shared() -> Option<Arc<Hub>> {
        let mut slot = HUB.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(hub) = slot.upgrade() {
            return Some(hub);
        }
        let (publish, state) = watch::channel(None);
        let control = platform::spawn(publish)?;
        let hub = Arc::new(Hub { state, control });
        *slot = Arc::downgrade(&hub);
        Some(hub)
    }

    #[cfg(not(any(windows, target_os = "linux")))]
    fn shared() -> Option<Arc<Hub>> {
        None
    }

    pub(crate) fn state(&self) -> watch::Receiver<Reading> {
        self.state.clone()
    }

    pub(crate) fn command(&self, command: Command) {
        (self.control)(Control::Command(command));
    }
}

impl Drop for Hub {
    fn drop(&mut self) {
        (self.control)(Control::Stop);
    }
}

/// The socket one game talks to. Dropping it closes the socket and, with the
/// last game gone, stops reading the media session.
pub struct MediaLink {
    port: u16,
    key: String,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl MediaLink {
    pub fn start() -> Option<MediaLink> {
        let hub = Hub::shared()?;
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).ok()?;
        listener.set_nonblocking(true).ok()?;
        let port = listener.local_addr().ok()?.port();
        let key = protocol::new_key();
        let task = tauri::async_runtime::spawn(server::serve(listener, key.clone(), hub));
        Some(MediaLink { port, key, task })
    }

    pub fn apply(&self, cmd: &mut std::process::Command) {
        cmd.env(PORT_ENV, self.port.to_string()).env(KEY_ENV, &self.key);
    }
}

impl Drop for MediaLink {
    fn drop(&mut self) {
        self.task.abort();
    }
}
