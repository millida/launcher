//! Datagram framing and the per-session AES-128-GCM seal, as in the mod's
//! `VoiceCipher.java` and `VoiceDatagrams.java`: client to relay is magic,
//! player UUID, byte array of iv||ciphertext||tag; relay to client drops the
//! UUID. The ticket is the one plain-text frame.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes128Gcm, Nonce};

use crate::wire::{Malformed, Packet, Reader, Uuid, Writer, SECRET_BYTES};

pub const MAGIC: u8 = 0xFF;
pub const TICKET_MAGIC: u8 = 0xFE;
pub const MAX_PAYLOAD: usize = 2048;
pub const MAX_TICKET: usize = 1024;
pub const IV_BYTES: usize = 12;

pub struct VoiceCipher {
    aead: Aes128Gcm,
}

impl VoiceCipher {
    pub fn new(secret: &[u8; SECRET_BYTES]) -> Self {
        VoiceCipher { aead: Aes128Gcm::new(secret.into()) }
    }

    pub fn seal(&self, plain: &[u8]) -> Vec<u8> {
        let nonce = Aes128Gcm::generate_nonce(&mut OsRng);
        let sealed = self
            .aead
            .encrypt(&nonce, plain)
            .unwrap_or_else(|_| unreachable!("AES-GCM encryption of a bounded buffer cannot fail"));
        let mut out = Vec::with_capacity(IV_BYTES + sealed.len());
        out.extend_from_slice(&nonce);
        out.extend_from_slice(&sealed);
        out
    }

    pub fn open(&self, payload: &[u8]) -> Option<Vec<u8>> {
        if payload.len() <= IV_BYTES {
            return None;
        }
        let (iv, body) = payload.split_at(IV_BYTES);
        self.aead.decrypt(Nonce::from_slice(iv), body).ok()
    }
}

pub fn client_datagram(player: &Uuid, packet: &Packet, cipher: &VoiceCipher) -> Vec<u8> {
    let mut w = Writer::default();
    w.byte(MAGIC).raw(player).byte_array(&cipher.seal(&packet.encode()));
    w.bytes
}

pub fn server_datagram(packet: &Packet, cipher: &VoiceCipher) -> Vec<u8> {
    let mut w = Writer::default();
    w.byte(MAGIC).byte_array(&cipher.seal(&packet.encode()));
    w.bytes
}

pub fn ticket_datagram(ticket: &[u8]) -> Result<Vec<u8>, Malformed> {
    if ticket.is_empty() || ticket.len() > MAX_TICKET {
        return Err(Malformed("ticket must be 1..1024 bytes"));
    }
    let mut out = Vec::with_capacity(1 + ticket.len());
    out.push(TICKET_MAGIC);
    out.extend_from_slice(ticket);
    Ok(out)
}

/// A relay datagram, or `None` when it is not ours, broken or sealed with another key.
pub fn open_server(data: &[u8], cipher: &VoiceCipher) -> Option<Packet> {
    let mut r = Reader::new(data);
    if r.byte().ok()? != MAGIC {
        return None;
    }
    let sealed = r.byte_array(MAX_PAYLOAD).ok()?;
    Packet::decode(&cipher.open(&sealed)?).ok()?
}

/// Relay side of [`client_datagram`], for tests.
pub fn open_client(data: &[u8], cipher: &VoiceCipher) -> Option<(Uuid, Packet)> {
    let mut r = Reader::new(data);
    if r.byte().ok()? != MAGIC {
        return None;
    }
    let player = r.uuid().ok()?;
    let sealed = r.byte_array(MAX_PAYLOAD).ok()?;
    Some((player, Packet::decode(&cipher.open(&sealed)?).ok()??))
}
