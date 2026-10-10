use sha2::{Digest, Sha256};

use crate::wire::Uuid;

/// The id a party room knows an account by, derived exactly as trade-api does
/// (`voice-party.ts`, `partyVoicePlayerUuid`): the launcher maps the senders it
/// hears back to party members with it, and the game joins under the same id.
pub fn party_voice_player(account_id: &str) -> Uuid {
    let digest = Sha256::digest(format!("party-player|v1|{account_id}").as_bytes());
    let mut id = [0u8; 16];
    id.copy_from_slice(&digest[..16]);
    id[6] = (id[6] & 0x0f) | 0x40;
    id[8] = (id[8] & 0x3f) | 0x80;
    id
}

/// Same rule as the `party` field of `POST /voice/ticket`.
pub fn valid_party_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
