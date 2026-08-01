//! servers.dat, the in-game server list. Unlike level.dat it is uncompressed
//! NBT: the root Compound holds a "servers" list of Compound{name,ip,...}.
//! Only name/ip are written back; icons and flags are cosmetic and dropped.

/// Unknown tags are skipped wholesale (icon, hidden, acceptTextures, ...).
pub fn read_servers(b: &[u8]) -> Vec<(String, String)> {
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

fn read_server_compound(r: &mut Reader) -> Option<(String, String)> {
    let mut name = String::new();
    let mut ip = String::new();
    loop {
        match r.u8()? {
            0 => break,
            8 => {
                let key = r.str()?;
                let val = r.str()?;
                if key == "name" { name = val; } else if key == "ip" { ip = val; }
            }
            id => { r.skip(id)?; }
        }
    }
    Some((name, ip))
}

/// The first entry becomes the first slot in the in-game list.
pub fn write_servers(list: &[(String, String)]) -> Vec<u8> {
    let mut o = vec![];
    o.push(10u8);
    put_str_raw(&mut o, "");
    o.push(9u8);
    put_str_raw(&mut o, "servers");
    o.push(10u8);
    o.extend_from_slice(&(list.len() as i32).to_be_bytes());
    for (name, ip) in list {
        o.push(8u8); put_str_raw(&mut o, "name"); put_str_raw(&mut o, name);
        o.push(8u8); put_str_raw(&mut o, "ip"); put_str_raw(&mut o, ip);
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
            ("Мой сервер".to_string(), "play.example.net".to_string()),
            ("Second".to_string(), "1.2.3.4:25565".to_string()),
        ];
        let bytes = write_servers(&list);
        let back = read_servers(&bytes);
        assert_eq!(back, list);
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
        assert_eq!(back, vec![("S".to_string(), "ip1".to_string())]);
    }

    #[test]
    fn empty_on_garbage() {
        assert!(read_servers(&[1, 2, 3]).is_empty());
    }
}
