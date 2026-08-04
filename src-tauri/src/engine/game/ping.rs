// Minecraft Server List Ping (1.7+): handshake, status request, status JSON.
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

use crate::engine::host_is_local;

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

const LOCAL_REFUSED: &str = "локальные и домашние адреса лаунчер не проверяет";

/// A bracketed IPv6 literal has to be split before the last colon is taken for
/// a port, otherwise `[::1]:25565` and `::1` both end up as garbage hosts.
fn split_host_port(addr: &str) -> (String, u16) {
    if let Some((host, tail)) = addr.strip_prefix('[').and_then(|rest| rest.split_once(']')) {
        let port = tail.strip_prefix(':').and_then(|p| p.parse().ok()).unwrap_or(25565);
        return (host.to_string(), port);
    }
    match addr.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => (h.to_string(), p.parse().unwrap_or(25565)),
        _ => (addr.to_string(), 25565),
    }
}

pub fn ping(addr: &str) -> Result<PingResult, String> {
    let (host, port) = split_host_port(addr);
    // The webview picks the address, so without this the command is a probe for
    // the local machine, the LAN and cloud metadata. The literal host is judged
    // before any resolution, so a machine without IPv6 still refuses `::1`
    // instead of failing with a lookup error.
    if host_is_local(&host) {
        return Err(LOCAL_REFUSED.into());
    }
    let sock = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .next()
        .ok_or("не удалось разрешить адрес")?;
    // The address a name resolved to is judged too, so DNS rebinding gains
    // nothing.
    if host_is_local(&sock.ip().to_string()) {
        return Err(LOCAL_REFUSED.into());
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// address -> verdict. The webview reaches this command directly, so a ping
    /// must never turn into a port scan of the user's machine or LAN.
    #[test]
    fn local_targets_are_refused_before_any_connect() {
        let cases = [
            ("127.0.0.1:22", "loopback exposes services bound to the user's machine"),
            ("localhost:8080", "loopback by name is the same target"),
            ("192.168.1.1:80", "private ranges expose the user's router"),
            ("169.254.169.254:80", "link-local is where cloud metadata lives"),
            ("[::1]:25565", "IPv6 loopback must be refused too"),
            ("::1", "a bare IPv6 literal must not be mangled into a port"),
            ("[fd00::1]:25565", "unique local IPv6 is the user's own network"),
        ];
        for (addr, why) in cases {
            let err = match ping(addr) {
                Ok(_) => panic!("{addr} was pinged instead of refused: {why}"),
                Err(e) => e,
            };
            assert!(
                err.contains("локальные"),
                "{addr} failed with «{err}» instead of the local-address refusal: {why}",
            );
        }
    }
}
