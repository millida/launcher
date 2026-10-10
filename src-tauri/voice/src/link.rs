//! The relay side of the mod's `net/VoiceConnection.java` as a pure state
//! machine: ticket, Authenticate until both AuthenticateAck and Cookie,
//! CookieEcho before every ConnectionCheck until its Ack, then KeepAlive echo,
//! Ping every 5 s, resync after three silent keepalive intervals. Time comes in
//! as milliseconds and datagrams go out as return values, so every step is
//! testable without a socket.

use crate::cipher::{client_datagram, open_server, ticket_datagram, VoiceCipher};
use crate::wire::{Packet, Uuid, COOKIE_BYTES, SECRET_BYTES};

pub const RESEND_MILLIS: u64 = 1000;
pub const MAX_TICKET_SENDS: u32 = 10;
pub const MAX_HANDSHAKE_SENDS: u32 = 20;
pub const MISSED_KEEPALIVES: u64 = 10;
pub const RELAY_RESYNC_KEEPALIVES: u64 = 3;
pub const PING_MILLIS: u64 = 5000;

pub struct Session {
    pub player: Uuid,
    pub secret: [u8; SECRET_BYTES],
    pub ticket: Vec<u8>,
    pub keep_alive_millis: u64,
    cipher: VoiceCipher,
}

impl Session {
    pub fn new(player: Uuid, secret: [u8; SECRET_BYTES], ticket: Vec<u8>, keep_alive_millis: u64) -> Self {
        Session { player, secret, ticket, keep_alive_millis: keep_alive_millis.max(1), cipher: VoiceCipher::new(&secret) }
    }

    fn seal(&self, packet: &Packet) -> Vec<u8> {
        client_datagram(&self.player, packet, &self.cipher)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lost {
    /// The relay stopped answering: restarted and forgot us, a network change,
    /// or another client (the game) took the same player id over.
    Timeout,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Event {
    Connected,
    Sound { sender: Uuid, sequence: i64, opus: Vec<u8> },
    Roster(Vec<(Uuid, bool)>),
    RoundTrip(u64),
}

pub struct Link {
    session: Session,
    joining: Option<Session>,
    handshaking: bool,
    acknowledged: bool,
    connected: bool,
    cookie: Option<[u8; COOKIE_BYTES]>,
    last_keep_alive: u64,
    ticket_sends: u32,
    next_ticket: u64,
    auth_sends: u32,
    next_auth: u64,
    check_sends: u32,
    next_check: u64,
    next_ping: u64,
    ping_id: Uuid,
}

impl Link {
    pub fn new(session: Session, ping_id: Uuid, now: u64) -> Self {
        let mut link = Link {
            session,
            joining: None,
            handshaking: false,
            acknowledged: false,
            connected: false,
            cookie: None,
            last_keep_alive: 0,
            ticket_sends: 0,
            next_ticket: 0,
            auth_sends: 0,
            next_auth: 0,
            check_sends: 0,
            next_check: 0,
            next_ping: 0,
            ping_id,
        };
        link.handshake(None, now);
        link
    }

    pub fn connected(&self) -> bool {
        self.connected
    }

    pub fn player(&self) -> Uuid {
        self.session.player
    }

    /// A renewed ticket: the relay rebinds the player to the new secret on the
    /// same socket, audio keeps flowing under the old one until the Ack.
    pub fn renew(&mut self, next: Session, now: u64) {
        self.handshake(Some(next), now);
    }

    fn target(&self) -> &Session {
        self.joining.as_ref().unwrap_or(&self.session)
    }

    /// A resync of the live session keeps the cookie: a relay that still knows
    /// the address answers Authenticate with the ack alone.
    fn handshake(&mut self, next: Option<Session>, now: u64) {
        let resync = next.is_none() && self.connected;
        if next.is_some() {
            self.joining = next;
        }
        self.handshaking = true;
        self.acknowledged = false;
        if !resync {
            self.cookie = None;
        }
        self.ticket_sends = 0;
        self.next_ticket = now;
        self.auth_sends = 0;
        self.next_auth = now;
        self.check_sends = 0;
        self.next_check = now;
    }

    fn authenticated(&self) -> bool {
        self.acknowledged && self.cookie.is_some()
    }

    /// Sends while the session is up; `None` when the packet must be dropped.
    pub fn seal(&self, packet: &Packet) -> Option<Vec<u8>> {
        self.connected.then(|| self.session.seal(packet))
    }

    /// Timers. Pushes datagrams to `out`; `Err` once the link is over.
    pub fn poll(&mut self, now: u64, out: &mut Vec<Vec<u8>>) -> Result<(), Lost> {
        if self.handshaking {
            return self.handshake_step(now, out);
        }
        let keep_alive = self.session.keep_alive_millis;
        if self.last_keep_alive > 0 && now.saturating_sub(self.last_keep_alive) > keep_alive * MISSED_KEEPALIVES {
            return Err(Lost::Timeout);
        }
        if self.last_keep_alive > 0 && now.saturating_sub(self.last_keep_alive) > keep_alive * RELAY_RESYNC_KEEPALIVES {
            self.last_keep_alive = 0;
            self.handshake(None, now);
            return self.handshake_step(now, out);
        }
        if now >= self.next_ping {
            out.push(self.session.seal(&Packet::Ping { id: self.ping_id, timestamp: now as i64 }));
            self.next_ping = now + PING_MILLIS;
        }
        Ok(())
    }

    fn handshake_step(&mut self, now: u64, out: &mut Vec<Vec<u8>>) -> Result<(), Lost> {
        if !self.authenticated() {
            if now >= self.next_ticket {
                if self.ticket_sends >= MAX_TICKET_SENDS {
                    return Err(Lost::Timeout);
                }
                if let Ok(d) = ticket_datagram(&self.target().ticket) {
                    out.push(d);
                }
                self.ticket_sends += 1;
                self.next_ticket = now + RESEND_MILLIS;
            }
            if now >= self.next_auth {
                if self.auth_sends >= MAX_HANDSHAKE_SENDS {
                    return Err(Lost::Timeout);
                }
                let target = self.target();
                out.push(target.seal(&Packet::Authenticate { player: target.player, secret: target.secret }));
                self.auth_sends += 1;
                self.next_auth = now + RESEND_MILLIS;
            }
            return Ok(());
        }
        if now >= self.next_check {
            if self.check_sends >= MAX_HANDSHAKE_SENDS {
                return Err(Lost::Timeout);
            }
            self.send_check(now, out);
        }
        Ok(())
    }

    /// Incoming datagrams open under the secret being confirmed or the one still in use.
    fn open(&self, data: &[u8]) -> Option<Packet> {
        if let Some(joining) = &self.joining {
            if let Some(p) = open_server(data, &joining.cipher) {
                return Some(p);
            }
        }
        open_server(data, &self.session.cipher)
    }

    pub fn receive(&mut self, data: &[u8], now: u64, out: &mut Vec<Vec<u8>>, events: &mut Vec<Event>) {
        let Some(packet) = self.open(data) else { return };
        match packet {
            Packet::AuthenticateAck => {
                if self.handshaking && !self.acknowledged {
                    self.acknowledged = true;
                    self.after_authenticated(now, out);
                }
            }
            Packet::Cookie(value) => {
                if self.handshaking {
                    let changed = self.cookie != Some(value);
                    self.cookie = Some(value);
                    if changed {
                        self.after_authenticated(now, out);
                    }
                }
            }
            Packet::ConnectionCheckAck => {
                if self.handshaking && self.authenticated() {
                    self.handshaking = false;
                    if let Some(next) = self.joining.take() {
                        self.session = next;
                    }
                    self.last_keep_alive = now;
                    let first = !self.connected;
                    self.connected = true;
                    if first {
                        events.push(Event::Connected);
                    }
                }
            }
            Packet::KeepAlive => {
                self.last_keep_alive = now;
                out.push(self.session.seal(&Packet::KeepAlive));
            }
            Packet::Ping { timestamp, .. } => {
                if timestamp > 0 && (timestamp as u64) <= now {
                    events.push(Event::RoundTrip(now - timestamp as u64));
                }
            }
            Packet::GroupSound { sender, opus, sequence, .. } | Packet::PlayerSound { sender, opus, sequence, .. } => {
                if self.connected {
                    events.push(Event::Sound { sender, sequence, opus });
                }
            }
            Packet::Roster(entries) => events.push(Event::Roster(entries)),
            _ => {}
        }
    }

    /// The relay drops ConnectionCheck until it has the echo, so the echo goes
    /// the moment both halves are in.
    fn after_authenticated(&mut self, now: u64, out: &mut Vec<Vec<u8>>) {
        if self.authenticated() {
            self.check_sends = 0;
            self.send_check(now, out);
        }
    }

    fn send_check(&mut self, now: u64, out: &mut Vec<Vec<u8>>) {
        let cookie = self.cookie.unwrap_or_default();
        let target = self.target();
        out.push(target.seal(&Packet::CookieEcho(cookie)));
        out.push(target.seal(&Packet::ConnectionCheck));
        self.check_sends += 1;
        self.next_check = now + RESEND_MILLIS;
    }
}
