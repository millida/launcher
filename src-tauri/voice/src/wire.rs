//! Packet bodies of the Simple Voice Chat protocol, compatibility 20, plus the
//! Millida relay extensions. Byte layout of Minecraft's FriendlyByteBuf:
//! big-endian numbers, varint lengths, a UUID as two longs. A port of the
//! mod's `core/voice/wire/VoiceBuffer.java` and `VoicePacket.java`.

pub type Uuid = [u8; 16];

pub const MIC: u8 = 0x1;
pub const PLAYER_SOUND: u8 = 0x2;
pub const GROUP_SOUND: u8 = 0x3;
pub const AUTHENTICATE: u8 = 0x5;
pub const AUTHENTICATE_ACK: u8 = 0x6;
pub const PING: u8 = 0x7;
pub const KEEP_ALIVE: u8 = 0x8;
pub const CONNECTION_CHECK: u8 = 0x9;
pub const CONNECTION_CHECK_ACK: u8 = 0xA;
pub const POSITION: u8 = 0x40;
pub const ROSTER: u8 = 0x41;
pub const COOKIE: u8 = 0x42;
pub const COOKIE_ECHO: u8 = 0x43;

pub const MAX_OPUS_BYTES: usize = 1275;
pub const MAX_CATEGORY_CHARS: usize = 16;
pub const MAX_DIMENSION_CHARS: usize = 256;
pub const MAX_ROSTER: usize = 4096;
pub const SECRET_BYTES: usize = 16;
pub const COOKIE_BYTES: usize = 8;

const WHISPER_FLAG: u8 = 0x1;
const CATEGORY_FLAG: u8 = 0x2;
pub const POSITION_DISABLED: u8 = 0x1;

#[derive(Debug, Clone, PartialEq)]
pub enum Packet {
    Mic { opus: Vec<u8>, sequence: i64, whispering: bool },
    PlayerSound { channel: Uuid, sender: Uuid, opus: Vec<u8>, sequence: i64, distance: f32, whispering: bool },
    GroupSound { channel: Uuid, sender: Uuid, opus: Vec<u8>, sequence: i64 },
    Authenticate { player: Uuid, secret: [u8; SECRET_BYTES] },
    AuthenticateAck,
    Ping { id: Uuid, timestamp: i64 },
    KeepAlive,
    ConnectionCheck,
    ConnectionCheckAck,
    Position { dimension: String, x: f64, y: f64, z: f64, flags: u8 },
    Roster(Vec<(Uuid, bool)>),
    Cookie([u8; COOKIE_BYTES]),
    CookieEcho([u8; COOKIE_BYTES]),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Malformed(pub &'static str);

impl std::fmt::Display for Malformed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}

#[derive(Default)]
pub struct Writer {
    pub bytes: Vec<u8>,
}

impl Writer {
    pub fn byte(&mut self, v: u8) -> &mut Self {
        self.bytes.push(v);
        self
    }

    pub fn boolean(&mut self, v: bool) -> &mut Self {
        self.byte(u8::from(v))
    }

    pub fn long(&mut self, v: i64) -> &mut Self {
        self.bytes.extend_from_slice(&v.to_be_bytes());
        self
    }

    pub fn float(&mut self, v: f32) -> &mut Self {
        self.bytes.extend_from_slice(&v.to_bits().to_be_bytes());
        self
    }

    pub fn double(&mut self, v: f64) -> &mut Self {
        self.bytes.extend_from_slice(&v.to_bits().to_be_bytes());
        self
    }

    pub fn varint(&mut self, v: i32) -> &mut Self {
        let mut rest = v as u32;
        while rest & !0x7F != 0 {
            self.bytes.push(((rest & 0x7F) | 0x80) as u8);
            rest >>= 7;
        }
        self.bytes.push(rest as u8);
        self
    }

    pub fn raw(&mut self, v: &[u8]) -> &mut Self {
        self.bytes.extend_from_slice(v);
        self
    }

    pub fn byte_array(&mut self, v: &[u8]) -> &mut Self {
        self.varint(v.len() as i32).raw(v)
    }
}

pub struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Reader { data, pos: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    pub fn take(&mut self, n: usize) -> Result<&'a [u8], Malformed> {
        if self.remaining() < n {
            return Err(Malformed("unexpected end of packet"));
        }
        let out = &self.data[self.pos..self.pos + n];
        self.pos += n;
        Ok(out)
    }

    fn array<const N: usize>(&mut self) -> Result<[u8; N], Malformed> {
        let mut out = [0u8; N];
        out.copy_from_slice(self.take(N)?);
        Ok(out)
    }

    pub fn byte(&mut self) -> Result<u8, Malformed> {
        Ok(self.take(1)?[0])
    }

    pub fn boolean(&mut self) -> Result<bool, Malformed> {
        Ok(self.byte()? != 0)
    }

    pub fn long(&mut self) -> Result<i64, Malformed> {
        Ok(i64::from_be_bytes(self.array()?))
    }

    pub fn float(&mut self) -> Result<f32, Malformed> {
        Ok(f32::from_bits(u32::from_be_bytes(self.array()?)))
    }

    pub fn double(&mut self) -> Result<f64, Malformed> {
        Ok(f64::from_bits(u64::from_be_bytes(self.array()?)))
    }

    pub fn uuid(&mut self) -> Result<Uuid, Malformed> {
        self.array()
    }

    pub fn varint(&mut self) -> Result<i32, Malformed> {
        let mut value: u32 = 0;
        for shift in (0..35).step_by(7) {
            let part = self.byte()?;
            value |= u32::from(part & 0x7F) << shift;
            if part & 0x80 == 0 {
                return Ok(value as i32);
            }
        }
        Err(Malformed("varint longer than 5 bytes"))
    }

    pub fn byte_array(&mut self, max: usize) -> Result<Vec<u8>, Malformed> {
        let len = self.varint()?;
        let len = usize::try_from(len).map_err(|_| Malformed("negative length"))?;
        if len > max {
            return Err(Malformed("byte array too long"));
        }
        Ok(self.take(len)?.to_vec())
    }

    pub fn utf(&mut self, max_chars: usize) -> Result<String, Malformed> {
        let len = self.varint()?;
        let len = usize::try_from(len).map_err(|_| Malformed("negative length"))?;
        if len > max_chars * 3 {
            return Err(Malformed("string too long"));
        }
        let text = std::str::from_utf8(self.take(len)?).map_err(|_| Malformed("string is not utf-8"))?;
        if text.encode_utf16().count() > max_chars {
            return Err(Malformed("string too long"));
        }
        Ok(text.to_string())
    }
}

impl Packet {
    pub fn kind(&self) -> u8 {
        match self {
            Packet::Mic { .. } => MIC,
            Packet::PlayerSound { .. } => PLAYER_SOUND,
            Packet::GroupSound { .. } => GROUP_SOUND,
            Packet::Authenticate { .. } => AUTHENTICATE,
            Packet::AuthenticateAck => AUTHENTICATE_ACK,
            Packet::Ping { .. } => PING,
            Packet::KeepAlive => KEEP_ALIVE,
            Packet::ConnectionCheck => CONNECTION_CHECK,
            Packet::ConnectionCheckAck => CONNECTION_CHECK_ACK,
            Packet::Position { .. } => POSITION,
            Packet::Roster(_) => ROSTER,
            Packet::Cookie(_) => COOKIE,
            Packet::CookieEcho(_) => COOKIE_ECHO,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut w = Writer::default();
        w.byte(self.kind());
        match self {
            Packet::Mic { opus, sequence, whispering } => {
                w.byte_array(opus).long(*sequence).boolean(*whispering);
            }
            Packet::PlayerSound { channel, sender, opus, sequence, distance, whispering } => {
                w.raw(channel).raw(sender).byte_array(opus).long(*sequence).float(*distance);
                w.byte(if *whispering { WHISPER_FLAG } else { 0 });
            }
            Packet::GroupSound { channel, sender, opus, sequence } => {
                w.raw(channel).raw(sender).byte_array(opus).long(*sequence).byte(0);
            }
            Packet::Authenticate { player, secret } => {
                w.raw(player).raw(secret);
            }
            Packet::Ping { id, timestamp } => {
                w.raw(id).long(*timestamp);
            }
            Packet::Position { dimension, x, y, z, flags } => {
                w.byte_array(dimension.as_bytes()).double(*x).double(*y).double(*z).byte(*flags);
            }
            Packet::Roster(entries) => {
                w.varint(entries.len() as i32);
                for (player, disabled) in entries {
                    w.raw(player).boolean(*disabled);
                }
            }
            Packet::Cookie(value) | Packet::CookieEcho(value) => {
                w.raw(value);
            }
            Packet::AuthenticateAck | Packet::KeepAlive | Packet::ConnectionCheck | Packet::ConnectionCheckAck => {}
        }
        w.bytes
    }

    /// `Ok(None)` for a type this client does not know, as the mod does.
    pub fn decode(plain: &[u8]) -> Result<Option<Packet>, Malformed> {
        let mut r = Reader::new(plain);
        let kind = r.byte()?;
        let packet = match kind {
            MIC => {
                let opus = r.byte_array(MAX_OPUS_BYTES)?;
                let sequence = r.long()?;
                Packet::Mic { opus, sequence, whispering: r.boolean()? }
            }
            PLAYER_SOUND => {
                let channel = r.uuid()?;
                let sender = r.uuid()?;
                let opus = r.byte_array(MAX_OPUS_BYTES)?;
                let sequence = r.long()?;
                let distance = r.float()?;
                let flags = r.byte()?;
                skip_category(&mut r, flags)?;
                Packet::PlayerSound { channel, sender, opus, sequence, distance, whispering: flags & WHISPER_FLAG != 0 }
            }
            GROUP_SOUND => {
                let channel = r.uuid()?;
                let sender = r.uuid()?;
                let opus = r.byte_array(MAX_OPUS_BYTES)?;
                let sequence = r.long()?;
                let flags = r.byte()?;
                skip_category(&mut r, flags)?;
                Packet::GroupSound { channel, sender, opus, sequence }
            }
            AUTHENTICATE => {
                let player = r.uuid()?;
                Packet::Authenticate { player, secret: r.array()? }
            }
            AUTHENTICATE_ACK => Packet::AuthenticateAck,
            PING => {
                let id = r.uuid()?;
                Packet::Ping { id, timestamp: r.long()? }
            }
            KEEP_ALIVE => Packet::KeepAlive,
            CONNECTION_CHECK => Packet::ConnectionCheck,
            CONNECTION_CHECK_ACK => Packet::ConnectionCheckAck,
            POSITION => {
                let dimension = r.utf(MAX_DIMENSION_CHARS)?;
                let x = r.double()?;
                let y = r.double()?;
                let z = r.double()?;
                let flags = if r.remaining() > 0 { r.byte()? } else { 0 };
                Packet::Position { dimension, x, y, z, flags }
            }
            ROSTER => {
                let count = usize::try_from(r.varint()?).map_err(|_| Malformed("negative roster"))?;
                if count > MAX_ROSTER {
                    return Err(Malformed("roster too long"));
                }
                let mut entries = Vec::with_capacity(count);
                for _ in 0..count {
                    let player = r.uuid()?;
                    entries.push((player, r.boolean()?));
                }
                Packet::Roster(entries)
            }
            COOKIE | COOKIE_ECHO => {
                let value: [u8; COOKIE_BYTES] = r.array()?;
                if r.remaining() != 0 {
                    return Err(Malformed("cookie longer than 8 bytes"));
                }
                if kind == COOKIE {
                    Packet::Cookie(value)
                } else {
                    Packet::CookieEcho(value)
                }
            }
            _ => return Ok(None),
        };
        Ok(Some(packet))
    }
}

fn skip_category(r: &mut Reader<'_>, flags: u8) -> Result<(), Malformed> {
    if flags & CATEGORY_FLAG != 0 {
        r.utf(MAX_CATEGORY_CHARS)?;
    }
    Ok(())
}

pub fn parse_uuid(text: &str) -> Option<Uuid> {
    let hex: String = text.trim().chars().filter(|c| *c != '-').collect();
    if hex.len() != 32 || text.trim().len() != 36 {
        return None;
    }
    let mut out = [0u8; 16];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = u8::from_str_radix(hex.get(i * 2..i * 2 + 2)?, 16).ok()?;
    }
    Some(out)
}

pub fn uuid_text(id: &Uuid) -> String {
    let hex: String = id.iter().map(|b| format!("{b:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32])
}
