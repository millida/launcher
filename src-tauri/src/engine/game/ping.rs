// Minecraft Server List Ping (1.7+): handshake, status request, status JSON.
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(serde::Serialize)]
pub struct PingResult {
    pub online: i64,
    pub max: i64,
    pub motd: String,
    pub version: String,
    pub favicon: Option<String>,
    pub ms: u64,
}

fn write_varint(buf: &mut Vec<u8>, mut v: i32) {
    loop {
        let mut b = (v & 0x7f) as u8;
        v = ((v as u32) >> 7) as i32;
        if v != 0 {
            b |= 0x80;
        }
        buf.push(b);
        if v == 0 {
            break;
        }
    }
}

fn read_varint<R: Read>(r: &mut R) -> std::io::Result<i32> {
    let mut num = 0i32;
    let mut shift = 0;
    loop {
        let mut b = [0u8; 1];
        r.read_exact(&mut b)?;
        num |= ((b[0] & 0x7f) as i32) << shift;
        if b[0] & 0x80 == 0 {
            break;
        }
        shift += 7;
        if shift >= 35 {
            break;
        }
    }
    Ok(num)
}

// The MOTD is either a plain string or a chat component {text, extra:[...]}.
fn motd_text(v: &serde_json::Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    let mut out = String::new();
    if let Some(t) = v["text"].as_str() {
        out.push_str(t);
    }
    if let Some(arr) = v["extra"].as_array() {
        for e in arr {
            out.push_str(&motd_text(e));
        }
    }
    // Strip legacy formatting codes (section sign plus one character).
    out.chars()
        .collect::<Vec<_>>()
        .split(|c| *c == '§')
        .enumerate()
        .map(|(i, part)| if i == 0 { part.iter().collect::<String>() } else { part.iter().skip(1).collect::<String>() })
        .collect::<Vec<_>>()
        .join("")
}

pub fn ping(addr: &str) -> Result<PingResult, String> {
    let (host, port) = match addr.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse::<u16>().unwrap_or(25565)),
        None => (addr.to_string(), 25565),
    };
    let sock = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("не удалось разрешить адрес")?;
    let start = std::time::Instant::now();
    let mut s = TcpStream::connect_timeout(&sock, Duration::from_secs(4)).map_err(|e| e.to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(4))).ok();
    s.set_write_timeout(Some(Duration::from_secs(4))).ok();

    // Handshake (next state = 1 = status)
    let mut data = Vec::new();
    write_varint(&mut data, 0x00);
    write_varint(&mut data, -1);
    write_varint(&mut data, host.len() as i32);
    data.extend_from_slice(host.as_bytes());
    data.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut data, 1);
    let mut pkt = Vec::new();
    write_varint(&mut pkt, data.len() as i32);
    pkt.extend_from_slice(&data);
    s.write_all(&pkt).map_err(|e| e.to_string())?;

    // Status request: empty packet 0x00.
    let mut req = Vec::new();
    write_varint(&mut req, 0x00);
    let mut pkt2 = Vec::new();
    write_varint(&mut pkt2, req.len() as i32);
    pkt2.extend_from_slice(&req);
    s.write_all(&pkt2).map_err(|e| e.to_string())?;

    // Response: packet length, packet id, JSON length, JSON.
    let _len = read_varint(&mut s).map_err(|e| e.to_string())?;
    let _pid = read_varint(&mut s).map_err(|e| e.to_string())?;
    let jlen = read_varint(&mut s).map_err(|e| e.to_string())? as usize;
    if jlen == 0 || jlen > 2_000_000 {
        return Err("некорректный ответ".into());
    }
    let mut json = vec![0u8; jlen];
    s.read_exact(&mut json).map_err(|e| e.to_string())?;
    let ms = start.elapsed().as_millis() as u64;
    let v: serde_json::Value = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    Ok(PingResult {
        online: v["players"]["online"].as_i64().unwrap_or(0),
        max: v["players"]["max"].as_i64().unwrap_or(0),
        version: v["version"]["name"].as_str().unwrap_or("").to_string(),
        motd: motd_text(&v["description"]),
        favicon: v["favicon"].as_str().map(|s| s.to_string()),
        ms,
    })
}
