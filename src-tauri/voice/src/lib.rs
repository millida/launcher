//! Party voice for the launcher lobby on the Millida voice relay: the same
//! protocol, cipher and codec as the mod, so friends talking in the lobby are
//! in the same relay room the game joins later.

pub mod cipher;
pub mod client;
pub mod codec;
pub mod dsp;
pub mod jitter;
pub mod link;
pub mod party;
pub mod resample;
pub mod wire;

#[cfg(test)]
mod tests;
