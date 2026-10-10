use super::protocol::{self, FrameError};
use super::{Hub, Reading};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinSet;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HEAD: usize = 8 * 1024;
const PULSE: Duration = Duration::from_secs(5);
const CLOSE_NORMAL: u16 = 1000;
const CLOSE_PROTOCOL: u16 = 1002;
const CLOSE_UNSUPPORTED: u16 = 1003;
const CLOSE_TOO_BIG: u16 = 1009;
const CLOSE_REPLACED: u16 = 4000;

enum Incoming {
    Text(String),
    Ping(Vec<u8>),
    Close(u16),
}

pub(super) async fn serve(listener: std::net::TcpListener, key: String, hub: Arc<Hub>) {
    let Ok(listener) = TcpListener::from_std(listener) else { return };
    let key = Arc::new(key);
    let (generation, _) = watch::channel(0u64);
    let generation = Arc::new(generation);
    let mut sessions = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => match accepted {
                Ok((stream, peer)) if peer.ip().is_loopback() => {
                    sessions.spawn(session(stream, key.clone(), hub.clone(), generation.clone()));
                }
                Ok(_) => {}
                Err(_) => tokio::time::sleep(Duration::from_millis(200)).await,
            },
            Some(_) = sessions.join_next(), if !sessions.is_empty() => {}
        }
    }
}

async fn read_head(stream: &mut TcpStream) -> Option<String> {
    let mut head = Vec::with_capacity(512);
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= MAX_HEAD || stream.read(&mut byte).await.ok()? == 0 {
            return None;
        }
        head.push(byte[0]);
    }
    String::from_utf8(head).ok()
}

async fn session(mut stream: TcpStream, key: Arc<String>, hub: Arc<Hub>, generation: Arc<watch::Sender<u64>>) {
    let Ok(Some(head)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, read_head(&mut stream)).await else { return };
    let accept = match protocol::check_upgrade(&head, &key) {
        Ok(accept) => accept,
        Err(refusal) => {
            let _ = stream.write_all(protocol::refusal(&refusal).as_bytes()).await;
            return;
        }
    };
    if stream.write_all(protocol::switching(&accept).as_bytes()).await.is_err() {
        return;
    }
    let _ = stream.set_nodelay(true);
    let mut mine = 0u64;
    generation.send_modify(|g| {
        *g += 1;
        mine = *g;
    });
    let mut replaced = generation.subscribe();
    let (read, mut write) = stream.into_split();
    let (incoming_tx, mut incoming) = mpsc::channel(16);
    let reader = tokio::spawn(read_frames(read, incoming_tx));
    let mut state = hub.state();
    let mut state_alive = true;
    let mut sent_covers = HashSet::new();
    let mut pulse = tokio::time::interval(PULSE);
    pulse.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let close = loop {
        let send = tokio::select! {
            _ = pulse.tick() => true,
            changed = state.changed(), if state_alive => {
                state_alive = changed.is_ok();
                if state_alive {
                    pulse.reset();
                }
                state_alive
            }
            _ = replaced.changed() => {
                if *replaced.borrow_and_update() != mine {
                    break Some(CLOSE_REPLACED);
                }
                false
            }
            frame = incoming.recv() => match frame {
                Some(Incoming::Text(text)) => {
                    if let Some(command) = protocol::parse_command(&text) {
                        hub.command(command);
                    }
                    false
                }
                Some(Incoming::Ping(payload)) => {
                    if write.write_all(&protocol::frame(protocol::OP_PONG, &payload)).await.is_err() {
                        break None;
                    }
                    false
                }
                Some(Incoming::Close(code)) => break Some(code),
                None => break None,
            },
        };
        if send {
            let reading: Reading = state.borrow_and_update().clone();
            if send_state(&mut write, reading, &mut sent_covers).await.is_err() {
                break None;
            }
        }
    };
    if let Some(code) = close {
        let _ = write.write_all(&protocol::close_frame(code)).await;
        let _ = write.shutdown().await;
    }
    reader.abort();
}

async fn send_state<W: AsyncWrite + Unpin>(
    write: &mut W,
    reading: Reading,
    sent_covers: &mut HashSet<String>,
) -> std::io::Result<()> {
    let now = Instant::now();
    if let Some(cover) = reading.as_ref().and_then(|r| r.cover.clone()) {
        if sent_covers.insert(cover.key.clone()) {
            send_text(write, &protocol::cover_message(&cover)).await?;
        }
    }
    send_text(write, &protocol::state_message(reading.as_deref(), now)).await
}

async fn send_text<W: AsyncWrite + Unpin>(write: &mut W, text: &str) -> std::io::Result<()> {
    write.write_all(&protocol::frame(protocol::OP_TEXT, text.as_bytes())).await
}

async fn read_frames<R: AsyncRead + Unpin>(mut read: R, out: mpsc::Sender<Incoming>) {
    let verdict = loop {
        match read_frame(&mut read).await {
            Ok(Some(incoming)) => {
                let closing = matches!(incoming, Incoming::Close(_));
                if out.send(incoming).await.is_err() || closing {
                    return;
                }
            }
            Ok(None) => {}
            Err(Some(code)) => break code,
            Err(None) => return,
        }
    };
    let _ = out.send(Incoming::Close(verdict)).await;
}

/// `Err(Some(code))` closes with that code, `Err(None)` means the socket is gone.
async fn read_frame<R: AsyncRead + Unpin>(read: &mut R) -> Result<Option<Incoming>, Option<u16>> {
    let mut start = [0u8; 2];
    read.read_exact(&mut start).await.map_err(|_| None)?;
    let head = protocol::frame_head(start[0], start[1]).map_err(|e| Some(close_code(&e)))?;
    let mut extended = vec![0u8; head.extra];
    read.read_exact(&mut extended).await.map_err(|_| None)?;
    let length = protocol::frame_length(&head, &extended).map_err(|e| Some(close_code(&e)))?;
    let mut mask = [0u8; 4];
    read.read_exact(&mut mask).await.map_err(|_| None)?;
    let mut payload = vec![0u8; length];
    read.read_exact(&mut payload).await.map_err(|_| None)?;
    protocol::unmask(mask, &mut payload);
    match head.opcode {
        protocol::OP_TEXT if head.fin => String::from_utf8(payload).map(|t| Some(Incoming::Text(t))).map_err(|_| Some(CLOSE_PROTOCOL)),
        protocol::OP_TEXT | 0x0 => Err(Some(CLOSE_PROTOCOL)),
        protocol::OP_PING => Ok(Some(Incoming::Ping(payload))),
        protocol::OP_PONG => Ok(None),
        protocol::OP_CLOSE => Ok(Some(Incoming::Close(CLOSE_NORMAL))),
        _ => Err(Some(CLOSE_UNSUPPORTED)),
    }
}

fn close_code(error: &FrameError) -> u16 {
    match error {
        FrameError::TooBig => CLOSE_TOO_BIG,
        FrameError::Reserved | FrameError::Unmasked | FrameError::Control => CLOSE_PROTOCOL,
    }
}

#[cfg(test)]
mod tests {
    use super::super::protocol::{Command, Cover, NowPlaying};
    use super::super::{Control, Hub};
    use super::*;
    use std::sync::Mutex;

    const KEY: &str = "aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11";

    async fn start(reading: Reading) -> (u16, Arc<Mutex<Vec<Command>>>, watch::Sender<Reading>) {
        let commands = Arc::new(Mutex::new(Vec::new()));
        let seen = commands.clone();
        let (publish, state) = watch::channel(reading);
        let hub = Arc::new(Hub {
            state,
            control: Box::new(move |control| {
                if let Control::Command(c) = control {
                    seen.lock().unwrap().push(c);
                }
            }),
        });
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(serve(listener, KEY.to_string(), hub));
        (port, commands, publish)
    }

    async fn connect(port: u16, auth: &str) -> (TcpStream, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        let request = format!(
            "GET /media HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n{}\r\n",
            auth
        );
        stream.write_all(request.as_bytes()).await.unwrap();
        let head = read_head(&mut stream).await.unwrap_or_default();
        (stream, head)
    }

    async fn next_text(stream: &mut TcpStream) -> String {
        let mut start = [0u8; 2];
        stream.read_exact(&mut start).await.unwrap();
        let length = match start[1] {
            126 => {
                let mut ext = [0u8; 2];
                stream.read_exact(&mut ext).await.unwrap();
                u16::from_be_bytes(ext) as usize
            }
            n => n as usize,
        };
        let mut payload = vec![0u8; length];
        stream.read_exact(&mut payload).await.unwrap();
        String::from_utf8(payload).unwrap()
    }

    fn masked_text(text: &str) -> Vec<u8> {
        let mask = [7u8, 1, 9, 3];
        let mut payload = text.as_bytes().to_vec();
        protocol::unmask(mask, &mut payload);
        let mut frame = vec![0x81, 0x80 | payload.len() as u8];
        frame.extend_from_slice(&mask);
        frame.extend_from_slice(&payload);
        frame
    }

    fn track() -> Reading {
        Some(Arc::new(NowPlaying {
            title: "Song".into(),
            artist: "Band".into(),
            app: "Spotify".into(),
            position_ms: 1000,
            duration_ms: 9000,
            playing: false,
            sampled: Instant::now(),
            cover: Some(Arc::new(Cover { key: "k1".into(), size: 1, argb: vec![255, 0, 0, 0] })),
        }))
    }

    #[tokio::test]
    async fn without_the_key_nothing_is_said() {
        let (port, _, _) = start(track()).await;
        let (mut stream, head) = connect(port, "").await;
        assert!(head.starts_with("HTTP/1.1 401"), "a process without the key must be refused: {}", head);
        let mut rest = Vec::new();
        let _ = stream.read_to_end(&mut rest).await;
        assert!(rest.is_empty(), "a refused connection must not see the track");
    }

    #[tokio::test]
    async fn the_game_gets_cover_then_state_and_sends_commands() {
        let (port, commands, publish) = start(track()).await;
        let (mut stream, head) = connect(port, &format!("Authorization: Bearer {}\r\n", KEY)).await;
        assert!(head.starts_with("HTTP/1.1 101"), "the right key upgrades: {}", head);
        assert!(next_text(&mut stream).await.contains("\"type\":\"cover\""), "the cover goes before the state that names it");
        assert!(next_text(&mut stream).await.contains("\"title\":\"Song\""));
        publish.send_replace(None);
        assert!(next_text(&mut stream).await.contains("\"title\":\"\""), "a change is pushed, not waited for the pulse");
        publish.send_replace(track());
        assert!(next_text(&mut stream).await.contains("\"title\":\"Song\""), "a cover already sent is not sent again");
        stream.write_all(&masked_text(r#"{"type":"command","command":"next"}"#)).await.unwrap();
        for _ in 0..50 {
            if !commands.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(*commands.lock().unwrap(), vec![Command::Next], "island buttons must reach the player");
    }

    #[tokio::test]
    async fn a_new_game_connection_replaces_the_old() {
        let (port, _, _) = start(None).await;
        let auth = format!("Authorization: Bearer {}\r\n", KEY);
        let (mut first, _) = connect(port, &auth).await;
        next_text(&mut first).await;
        let (mut second, _) = connect(port, &auth).await;
        next_text(&mut second).await;
        let mut start = [0u8; 2];
        first.read_exact(&mut start).await.unwrap();
        assert_eq!(start[0], 0x88, "the old connection is closed, only one game listens at a time");
    }
}
