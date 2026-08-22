//! Minimal NBT that survives a round trip. `level.dat` is read to describe a
//! world and rewritten when the player renames one, so every tag the game wrote
//! has to come back out byte for byte — an unknown tag dropped on the way is a
//! world that loses its rules, its border or its data packs.

use std::io::{Read, Write};

#[derive(Clone, Debug, PartialEq)]
pub enum Nbt {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    Float(f32),
    Double(f64),
    ByteArray(Vec<u8>),
    Str(String),
    List(u8, Vec<Nbt>),
    Compound(Vec<(String, Nbt)>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Nbt {
    pub fn id(&self) -> u8 {
        match self {
            Nbt::Byte(_) => 1,
            Nbt::Short(_) => 2,
            Nbt::Int(_) => 3,
            Nbt::Long(_) => 4,
            Nbt::Float(_) => 5,
            Nbt::Double(_) => 6,
            Nbt::ByteArray(_) => 7,
            Nbt::Str(_) => 8,
            Nbt::List(..) => 9,
            Nbt::Compound(_) => 10,
            Nbt::IntArray(_) => 11,
            Nbt::LongArray(_) => 12,
        }
    }

    pub fn get(&self, key: &str) -> Option<&Nbt> {
        match self {
            Nbt::Compound(items) => items.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Nbt::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            Nbt::Byte(v) => Some(*v as i64),
            Nbt::Short(v) => Some(*v as i64),
            Nbt::Int(v) => Some(*v as i64),
            Nbt::Long(v) => Some(*v),
            _ => None,
        }
    }

    pub fn set(&mut self, key: &str, value: Nbt) {
        if let Nbt::Compound(items) = self {
            match items.iter_mut().find(|(k, _)| k == key) {
                Some(slot) => slot.1 = value,
                None => items.push((key.to_string(), value)),
            }
        }
    }
}

struct R<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> R<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.i..self.i.checked_add(n)?)?;
        self.i += n;
        Some(s)
    }
    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }
    fn i16(&mut self) -> Option<i16> {
        Some(i16::from_be_bytes(self.take(2)?.try_into().ok()?))
    }
    fn i32(&mut self) -> Option<i32> {
        Some(i32::from_be_bytes(self.take(4)?.try_into().ok()?))
    }
    fn i64(&mut self) -> Option<i64> {
        Some(i64::from_be_bytes(self.take(8)?.try_into().ok()?))
    }
    fn name(&mut self) -> Option<String> {
        let n = self.i16()?.max(0) as usize;
        Some(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    fn payload(&mut self, id: u8) -> Option<Nbt> {
        Some(match id {
            1 => Nbt::Byte(self.u8()? as i8),
            2 => Nbt::Short(self.i16()?),
            3 => Nbt::Int(self.i32()?),
            4 => Nbt::Long(self.i64()?),
            5 => Nbt::Float(f32::from_be_bytes(self.take(4)?.try_into().ok()?)),
            6 => Nbt::Double(f64::from_be_bytes(self.take(8)?.try_into().ok()?)),
            7 => {
                let n = self.i32()?.max(0) as usize;
                Nbt::ByteArray(self.take(n)?.to_vec())
            }
            8 => Nbt::Str(self.name()?),
            9 => {
                let et = self.u8()?;
                let cnt = self.i32()?.max(0) as usize;
                let mut items = Vec::with_capacity(cnt.min(1024));
                for _ in 0..cnt {
                    items.push(self.payload(et)?);
                }
                Nbt::List(et, items)
            }
            10 => {
                let mut items = vec![];
                loop {
                    let t = self.u8()?;
                    if t == 0 {
                        break;
                    }
                    let key = self.name()?;
                    items.push((key, self.payload(t)?));
                }
                Nbt::Compound(items)
            }
            11 => {
                let n = self.i32()?.max(0) as usize;
                let raw = self.take(n.checked_mul(4)?)?;
                Nbt::IntArray(raw.as_chunks::<4>().0.iter().map(|c| i32::from_be_bytes(*c)).collect())
            }
            12 => {
                let n = self.i32()?.max(0) as usize;
                let raw = self.take(n.checked_mul(8)?)?;
                Nbt::LongArray(raw.as_chunks::<8>().0.iter().map(|c| i64::from_be_bytes(*c)).collect())
            }
            _ => return None,
        })
    }
}

/// Root tag with its name, as stored in the file.
pub fn parse(bytes: &[u8]) -> Option<(String, Nbt)> {
    let mut r = R { b: bytes, i: 0 };
    if r.u8()? != 10 {
        return None;
    }
    let name = r.name()?;
    Some((name, r.payload(10)?))
}

fn put_name(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&(s.len() as u16).to_be_bytes());
    out.extend_from_slice(s.as_bytes());
}

fn put_payload(out: &mut Vec<u8>, tag: &Nbt) {
    match tag {
        Nbt::Byte(v) => out.push(*v as u8),
        Nbt::Short(v) => out.extend_from_slice(&v.to_be_bytes()),
        Nbt::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
        Nbt::Long(v) => out.extend_from_slice(&v.to_be_bytes()),
        Nbt::Float(v) => out.extend_from_slice(&v.to_be_bytes()),
        Nbt::Double(v) => out.extend_from_slice(&v.to_be_bytes()),
        Nbt::ByteArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            out.extend_from_slice(v);
        }
        Nbt::Str(v) => put_name(out, v),
        Nbt::List(et, items) => {
            // An empty list keeps the element type the game wrote: the reader on
            // the other side may well care which kind of list it is.
            out.push(*et);
            out.extend_from_slice(&(items.len() as i32).to_be_bytes());
            for it in items {
                put_payload(out, it);
            }
        }
        Nbt::Compound(items) => {
            for (k, v) in items {
                out.push(v.id());
                put_name(out, k);
                put_payload(out, v);
            }
            out.push(0);
        }
        Nbt::IntArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            for x in v {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
        Nbt::LongArray(v) => {
            out.extend_from_slice(&(v.len() as i32).to_be_bytes());
            for x in v {
                out.extend_from_slice(&x.to_be_bytes());
            }
        }
    }
}

pub fn write(root_name: &str, root: &Nbt) -> Vec<u8> {
    let mut out = vec![root.id()];
    put_name(&mut out, root_name);
    put_payload(&mut out, root);
    out
}

/// level.dat is gzip-compressed NBT; a few third-party tools leave it plain, so
/// a file without the gzip magic is read as-is rather than rejected.
pub fn read_gzip(bytes: &[u8]) -> Option<(String, Nbt)> {
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(bytes).read_to_end(&mut out).ok()?;
        return parse(&out);
    }
    parse(bytes)
}

pub fn write_gzip(root_name: &str, root: &Nbt) -> Option<Vec<u8>> {
    let raw = write(root_name, root);
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(&raw).ok()?;
    enc.finish().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Nbt {
        Nbt::Compound(vec![(
            "Data".into(),
            Nbt::Compound(vec![
                ("LevelName".into(), Nbt::Str("Мой мир".into())),
                ("GameType".into(), Nbt::Int(0)),
                ("hardcore".into(), Nbt::Byte(1)),
                ("LastPlayed".into(), Nbt::Long(1_700_000_000_000)),
                ("BorderSize".into(), Nbt::Double(59_999_968.0)),
                ("ServerBrands".into(), Nbt::List(8, vec![Nbt::Str("vanilla".into())])),
                ("DragonFight".into(), Nbt::Compound(vec![("Gateways".into(), Nbt::IntArray(vec![1, 2, 3]))])),
                ("Seed".into(), Nbt::LongArray(vec![-42])),
                ("Raw".into(), Nbt::ByteArray(vec![1, 2, 3, 4])),
                ("Empty".into(), Nbt::List(10, vec![])),
            ]),
        )])
    }

    /// Renaming a world rewrites the whole file. Anything this parser cannot
    /// carry back out is a rule, a border or a data-pack list the player loses.
    #[test]
    fn every_tag_survives_a_round_trip() {
        let root = sample();
        let bytes = write("", &root);
        let (name, back) = parse(&bytes).expect("собственный вывод обязан читаться");
        assert_eq!(name, "");
        assert_eq!(back, root, "тег потерялся или изменился при перезаписи level.dat");
    }

    #[test]
    fn gzip_round_trip_matches_the_plain_one() {
        let root = sample();
        let packed = write_gzip("", &root).expect("gzip должен собраться");
        assert!(packed.starts_with(&[0x1f, 0x8b]), "level.dat пишется сжатым — игра ждёт gzip");
        let (_, back) = read_gzip(&packed).expect("свой gzip обязан читаться");
        assert_eq!(back, root);
    }

    #[test]
    fn plain_nbt_is_read_too() {
        let root = sample();
        let (_, back) = read_gzip(&write("", &root)).expect("несжатый level.dat встречается у сторонних утилит");
        assert_eq!(back, root);
    }

    #[test]
    fn garbage_yields_nothing_instead_of_panicking() {
        for junk in [vec![], vec![10u8], vec![10, 0, 5], vec![1, 2, 3, 4, 5]] {
            assert!(parse(&junk).is_none(), "битый level.dat должен читаться как «нет данных», а не падать");
        }
    }
}
