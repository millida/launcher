//! servers.dat, the in-game server list. Unlike level.dat it is uncompressed
//! NBT: the root Compound holds a "servers" list of Compound{name,ip,...}.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerRecord {
    pub name: String,
    pub ip: String,
    /// Raw NBT of the tags the launcher does not understand (icon, hidden,
    /// acceptTextures, ...), carried through verbatim so rewriting the file to
    /// pin one server does not strip what the game put there.
    pub extra: Vec<u8>,
}

impl ServerRecord {
    pub fn new(name: &str, ip: &str) -> Self {
        Self { name: name.to_string(), ip: ip.to_string(), extra: vec![] }
    }
}

pub fn read_servers(b: &[u8]) -> Vec<ServerRecord> {
    let mut r = Reader { b, i: 0 };
    let mut out = vec![];
    // Root: TAG_Compound followed by its name.
    if r.u8() != Some(10) { return out; }
    if r.skip_name().is_none() { return out; }
    loop {
        match r.u8() {
            Some(0) | None => break,
            Some(id) => {
                let name = r.str();
                if id == 9 && name.as_deref() == Some("servers") {
                    // TAG_List payload: element type, then element count.
                    let et = r.u8();
                    let cnt = r.i32().unwrap_or(0);
                    if et != Some(10) { return out; }
                    for _ in 0..cnt.max(0) {
                        if let Some(s) = read_server_compound(&mut r) { out.push(s); }
                        else { return out; }
                    }
                } else if r.skip(id).is_none() {
                    break;
                }
            }
        }
    }
    out
}

fn read_server_compound(r: &mut Reader) -> Option<ServerRecord> {
    let mut rec = ServerRecord::new("", "");
    loop {
        let start = r.i;
        match r.u8()? {
            0 => break,
            8 => {
                let key = r.str()?;
                let val = r.str()?;
                match key.as_str() {
                    "name" => rec.name = val,
                    "ip" => rec.ip = val,
                    _ => rec.extra.extend_from_slice(r.slice(start)?),
                }
            }
            // Every tag carries a name before its payload, including the byte
            // flags vanilla writes (acceptTextures, hidden). Skipping straight
            // to the payload misaligns the reader for the whole rest of the
            // file, and the launcher rewrites servers.dat from what it read.
            id => {
                r.skip_name()?;
                r.skip(id)?;
                rec.extra.extend_from_slice(r.slice(start)?);
            }
        }
    }
    Some(rec)
}

/// The first entry becomes the first slot in the in-game list.
pub fn write_servers(list: &[ServerRecord]) -> Vec<u8> {
    let mut o = vec![];
    o.push(10u8);
    put_str_raw(&mut o, "");
    o.push(9u8);
    put_str_raw(&mut o, "servers");
    o.push(10u8);
    o.extend_from_slice(&(list.len() as i32).to_be_bytes());
    for rec in list {
        o.push(8u8); put_str_raw(&mut o, "name"); put_str_raw(&mut o, &rec.name);
        o.push(8u8); put_str_raw(&mut o, "ip"); put_str_raw(&mut o, &rec.ip);
        o.extend_from_slice(&rec.extra);
        o.push(0u8);
    }
    o.push(0u8);
    o
}

fn put_str_raw(o: &mut Vec<u8>, s: &str) {
    o.extend_from_slice(&(s.len() as u16).to_be_bytes());
    o.extend_from_slice(s.as_bytes());
}

struct Reader<'a> { b: &'a [u8], i: usize }

impl<'a> Reader<'a> {
    fn u8(&mut self) -> Option<u8> { let v = *self.b.get(self.i)?; self.i += 1; Some(v) }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let s = self.b.get(self.i..self.i + n)?; self.i += n; Some(s)
    }
    fn u16(&mut self) -> Option<u16> { Some(u16::from_be_bytes(self.take(2)?.try_into().ok()?)) }
    fn i32(&mut self) -> Option<i32> { Some(i32::from_be_bytes(self.take(4)?.try_into().ok()?)) }
    fn skip_name(&mut self) -> Option<()> { let n = self.u16()? as usize; self.take(n)?; Some(()) }
    /// Bytes consumed since `start`, i.e. one whole tag with its name and payload.
    fn slice(&self, start: usize) -> Option<&'a [u8]> { self.b.get(start..self.i) }
    fn str(&mut self) -> Option<String> {
        let n = self.u16()? as usize;
        Some(String::from_utf8_lossy(self.take(n)?).into_owned())
    }
    /// Skips the payload of a tag of the given NBT type id.
    fn skip(&mut self, id: u8) -> Option<()> {
        match id {
            1 => { self.take(1)?; }
            2 => { self.take(2)?; }
            3 | 5 => { self.take(4)?; }
            4 | 6 => { self.take(8)?; }
            7 => { let n = self.i32()?.max(0) as usize; self.take(n)?; }
            8 => { let n = self.u16()? as usize; self.take(n)?; }
            9 => {
                let et = self.u8()?; let cnt = self.i32()?.max(0);
                for _ in 0..cnt { self.skip(et)?; }
            }
            10 => {
                loop {
                    let t = self.u8()?;
                    if t == 0 { break; }
                    self.skip_name()?;
                    self.skip(t)?;
                }
            }
            11 => { let n = self.i32()?.max(0) as usize; self.take(n * 4)?; }
            12 => { let n = self.i32()?.max(0) as usize; self.take(n * 8)?; }
            _ => return None,
        }
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let list = vec![
            ServerRecord::new("Мой сервер", "play.example.net"),
            ServerRecord::new("Second", "1.2.3.4:25565"),
        ];
        let bytes = write_servers(&list);
        let back = read_servers(&bytes);
        assert_eq!(back, list);
    }

    /// Pinning rewrites the whole file. Icons and flags the game wrote must
    /// survive that trip, otherwise every launch quietly resets them.
    #[test]
    fn keeps_unknown_tags_through_a_rewrite() {
        let mut o = vec![10u8];
        super::put_str_raw(&mut o, "");
        o.push(9); super::put_str_raw(&mut o, "servers");
        o.push(10); o.extend_from_slice(&1i32.to_be_bytes());
        o.push(8); super::put_str_raw(&mut o, "name"); super::put_str_raw(&mut o, "S");
        o.push(8); super::put_str_raw(&mut o, "ip"); super::put_str_raw(&mut o, "ip1");
        o.push(8); super::put_str_raw(&mut o, "icon"); super::put_str_raw(&mut o, "BASE64DATA");
        o.push(1); super::put_str_raw(&mut o, "hidden"); o.push(1);
        o.push(0); o.push(0);

        let first = read_servers(&o);
        assert!(!first[0].extra.is_empty(), "иконка и флаг не сохранены при чтении");
        let second = read_servers(&write_servers(&first));
        assert_eq!(second, first, "перезапись servers.dat потеряла иконку или флаг сервера");
    }

    #[test]
    fn skips_extra_tags() {
        let mut o = vec![10u8];
        super::put_str_raw(&mut o, "");
        o.push(9); super::put_str_raw(&mut o, "servers");
        o.push(10); o.extend_from_slice(&1i32.to_be_bytes());
        o.push(8); super::put_str_raw(&mut o, "name"); super::put_str_raw(&mut o, "S");
        o.push(8); super::put_str_raw(&mut o, "ip"); super::put_str_raw(&mut o, "ip1");
        o.push(8); super::put_str_raw(&mut o, "icon"); super::put_str_raw(&mut o, "BASE64DATA");
        o.push(1); super::put_str_raw(&mut o, "hidden"); o.push(0);
        o.push(0); o.push(0);
        let back = read_servers(&o);
        assert_eq!(back.len(), 1);
        assert_eq!((back[0].name.as_str(), back[0].ip.as_str()), ("S", "ip1"));
    }

    /// Vanilla writes non-string tags (acceptTextures, hidden) inside a server
    /// entry, and every tag carries a name before its payload. Losing that name
    /// misaligns the reader for the rest of the file: entries after it vanish,
    /// and the launcher, which rewrites servers.dat on every launch, saves the
    /// truncated list back - the player re-adds their servers each session.
    #[test]
    fn keeps_entries_after_one_with_a_byte_tag() {
        let mut o = vec![10u8];
        super::put_str_raw(&mut o, "");
        o.push(9);
        super::put_str_raw(&mut o, "servers");
        o.push(10);
        o.extend_from_slice(&2i32.to_be_bytes());
        o.push(8); super::put_str_raw(&mut o, "name"); super::put_str_raw(&mut o, "First");
        o.push(8); super::put_str_raw(&mut o, "ip"); super::put_str_raw(&mut o, "one.example.net");
        o.push(1); super::put_str_raw(&mut o, "acceptTextures"); o.push(1);
        o.push(0);
        o.push(8); super::put_str_raw(&mut o, "name"); super::put_str_raw(&mut o, "Second");
        o.push(8); super::put_str_raw(&mut o, "ip"); super::put_str_raw(&mut o, "two.example.net");
        o.push(0);
        o.push(0);

        let back = read_servers(&o);
        assert_eq!(
            back.iter().map(|s| (s.name.as_str(), s.ip.as_str())).collect::<Vec<_>>(),
            vec![("First", "one.example.net"), ("Second", "two.example.net")],
            "запись с байтовым тегом съела остаток списка — игрок теряет свои серверы"
        );
    }

    #[test]
    fn empty_on_garbage() {
        assert!(read_servers(&[1, 2, 3]).is_empty());
    }
}
