// Backup name lookup for the launcher's HTTP client. The system resolver is always asked first;
// only when it fails (or sits silent for a few seconds) the same name is asked over HTTPS from
// public DNS servers: 1.1.1.1 (Cloudflare), 8.8.8.8 (Google), 77.88.8.8 (Yandex). That sends the
// host name we are about to connect to (api.millida.net, a Mojang or mod host) to those servers,
// and nothing else. Providers' DNS-over-HTTPS is spoken in the standard wire format (RFC 8484),
// and the answers are kept in memory for five minutes. Many providers' resolvers in the CIS drop
// names of game hosts; this is what keeps a launch from failing on "DNS error" there.
use base64::Engine as _;
use std::collections::HashMap;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const ENDPOINTS: [&str; 3] = ["https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query", "https://77.88.8.8/dns-query"];

/// How long the system resolver may stay silent before the backup is raced against it.
const PATIENCE: Duration = Duration::from_secs(3);
const DOH_TIMEOUT: Duration = Duration::from_secs(4);
const KEEP: Duration = Duration::from_secs(5 * 60);
const KEEP_MAX: usize = 256;

type Answers = HashMap<String, (Instant, Vec<IpAddr>)>;

static CACHE: Mutex<Option<Answers>> = Mutex::new(None);

fn cached(host: &str) -> Option<Vec<IpAddr>> {
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    match map.get(host) {
        Some((at, ips)) if at.elapsed() < KEEP => Some(ips.clone()),
        Some(_) => {
            map.remove(host);
            None
        }
        None => None,
    }
}

fn remember(host: &str, ips: &[IpAddr]) {
    let mut g = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(HashMap::new);
    if map.len() >= KEEP_MAX {
        map.retain(|_, (at, _)| at.elapsed() < KEEP);
        if map.len() >= KEEP_MAX {
            map.clear();
        }
    }
    map.insert(host.to_string(), (Instant::now(), ips.to_vec()));
}

/// Names worth asking public DNS about: real dotted host names. Not `localhost`, not a bare
/// label from a home network, not `.local`.
fn worth_asking(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h.contains('.') && h != "localhost" && !h.ends_with(".local") && !h.ends_with(".localhost") && h.len() <= 253
}

/// A standard DNS query for the A records of `host` (id 0, recursion desired).
pub(crate) fn build_query(host: &str) -> Option<Vec<u8>> {
    let mut out = vec![0, 0, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
    for label in host.trim_end_matches('.').split('.') {
        if label.is_empty() || label.len() > 63 || !label.is_ascii() {
            return None;
        }
        out.push(label.len() as u8);
        out.extend_from_slice(label.as_bytes());
    }
    out.push(0);
    out.extend_from_slice(&[0, 1, 0, 1]); // type A, class IN
    Some(out)
}

/// Skips one (possibly compressed) name; returns where the next field starts.
fn skip_name(msg: &[u8], mut at: usize) -> Option<usize> {
    for _ in 0..128 {
        let len = *msg.get(at)? as usize;
        match len {
            0 => return Some(at + 1),
            l if l & 0xc0 == 0xc0 => return (at + 2 <= msg.len()).then_some(at + 2),
            l if l & 0xc0 != 0 => return None,
            l => at += 1 + l,
        }
    }
    None
}

/// The IPv4 addresses in the answer section of a DNS response. Anything malformed gives an
/// empty list rather than a panic: the bytes come from the network.
pub(crate) fn parse_answers(msg: &[u8]) -> Vec<IpAddr> {
    let mut found = Vec::new();
    let Some(header) = msg.get(..12) else { return found };
    let rcode = header[3] & 0x0f;
    let questions = u16::from_be_bytes([header[4], header[5]]) as usize;
    let answers = u16::from_be_bytes([header[6], header[7]]) as usize;
    if rcode != 0 {
        return found;
    }
    let mut at = 12;
    for _ in 0..questions {
        let Some(next) = skip_name(msg, at) else { return found };
        at = next + 4;
    }
    for _ in 0..answers.min(64) {
        let Some(next) = skip_name(msg, at) else { return found };
        let Some(fixed) = msg.get(next..next + 10) else { return found };
        let kind = u16::from_be_bytes([fixed[0], fixed[1]]);
        let len = u16::from_be_bytes([fixed[8], fixed[9]]) as usize;
        let data = next + 10;
        let Some(rdata) = msg.get(data..data + len) else { return found };
        if kind == 1 && len == 4 {
            found.push(IpAddr::from([rdata[0], rdata[1], rdata[2], rdata[3]]));
        }
        at = data + len;
    }
    found
}

fn doh_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(DOH_TIMEOUT)
            .tls_built_in_webpki_certs(true)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

async fn ask(endpoint: &str, query: &[u8]) -> Result<Vec<IpAddr>, String> {
    let url = format!("{}?dns={}", endpoint, base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(query));
    // The request goes to a public DNS server by its IP address, so it needs no name lookup itself.
    let resp = doh_client()
        .get(&url)
        .header("accept", "application/dns-message")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("{} → {}", endpoint, resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let ips = parse_answers(&bytes);
    if ips.is_empty() {
        return Err(format!("{}: no addresses", endpoint));
    }
    Ok(ips)
}

/// All three providers at once; the first usable answer wins.
async fn doh_race(host: String) -> Result<Vec<IpAddr>, String> {
    let query = build_query(&host).ok_or_else(|| format!("name {} cannot be asked about", host))?;
    let asks = ENDPOINTS.iter().map(|e| Box::pin(ask(e, &query)));
    let first = futures::future::select_ok(asks).await;
    first.map(|(ips, _rest)| ips)
}

async fn system_lookup(host: String) -> Result<Vec<IpAddr>, String> {
    tokio::net::lookup_host((host.as_str(), 0))
        .await
        .map(|it| it.map(|sa| sa.ip()).collect())
        .map_err(|e| e.to_string())
}

/// The lookup policy, with both sources passed in so it can be tested without a network.
pub(crate) async fn resolve_with<S, SF, D, DF>(
    host: &str,
    system: S,
    doh: D,
    patience: Duration,
) -> Result<Vec<IpAddr>, String>
where
    S: FnOnce(String) -> SF,
    SF: Future<Output = Result<Vec<IpAddr>, String>>,
    D: FnOnce(String) -> DF,
    DF: Future<Output = Result<Vec<IpAddr>, String>>,
{
    if !worth_asking(host) {
        return system(host.to_string()).await;
    }
    // A name the system could not resolve a moment ago is served from here first: waiting for
    // the system's failure again would cost seconds on every new connection.
    if let Some(ips) = cached(host) {
        return Ok(ips);
    }
    let sys = system(host.to_string());
    tokio::pin!(sys);
    let failure = tokio::select! {
        r = &mut sys => match r {
            Ok(ips) if !ips.is_empty() => return Ok(ips),
            Ok(_) => "name did not resolve".to_string(),
            Err(e) => e,
        },
        _ = tokio::time::sleep(patience) => {
            // The system is slow, not failed: both run, whichever answers first is used.
            let backup = doh(host.to_string());
            tokio::pin!(backup);
            tokio::select! {
                r = &mut sys => match r {
                    Ok(ips) if !ips.is_empty() => return Ok(ips),
                    other => match backup.await {
                        Ok(ips) => {
                            remember(host, &ips);
                            return Ok(ips);
                        }
                        Err(_) => return other.and_then(|_| Err("name did not resolve".to_string())),
                    },
                },
                r = &mut backup => match r {
                    Ok(ips) => {
                        remember(host, &ips);
                        return Ok(ips);
                    }
                    Err(_) => return sys.await,
                },
            }
        }
    };
    match doh(host.to_string()).await {
        Ok(ips) => {
            remember(host, &ips);
            Ok(ips)
        }
        // The system's own failure is the one worth reading (and classifying).
        Err(_) => Err(failure),
    }
}

/// Plugged into the HTTP client as its name resolver.
pub(crate) struct FallbackDns;

impl reqwest::dns::Resolve for FallbackDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let ips = resolve_with(&host, system_lookup, doh_race, PATIENCE)
                .await
                .map_err(|e| Box::new(std::io::Error::other(e)) as Box<dyn std::error::Error + Send + Sync>)?;
            let addrs: reqwest::dns::Addrs = Box::new(ips.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

pub(crate) fn resolver() -> Arc<FallbackDns> {
    Arc::new(FallbackDns)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn ip(a: u8, b: u8, c: u8, d: u8) -> IpAddr {
        IpAddr::from([a, b, c, d])
    }

    #[test]
    fn the_query_is_the_standard_wire_format() {
        let q = build_query("millida.net").unwrap();
        let text = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&q);
        assert_eq!(text, "AAABAAABAAAAAAAAB21pbGxpZGEDbmV0AAABAAE", "same bytes the public servers answered in the probe");
        assert!(build_query("bad..name").is_none());
        assert!(build_query(&format!("{}.net", "a".repeat(64))).is_none(), "a label over 63 bytes is not a name");
        assert!(build_query("имя.рф").is_none(), "only ASCII names go on the wire as they are");
    }

    /// A response as a public server sends it: a CNAME first, then the addresses, names
    /// compressed to pointers.
    fn response(rcode: u8, with_cname: bool) -> Vec<u8> {
        let mut m = vec![0, 0, 0x81, 0x80 | rcode, 0, 1, 0, if with_cname { 3 } else { 2 }, 0, 0, 0, 0];
        m.extend_from_slice(&[7, b'm', b'i', b'l', b'l', b'i', b'd', b'a', 3, b'n', b'e', b't', 0, 0, 1, 0, 1]);
        if with_cname {
            // CNAME www -> millida.net, rdata is a pointer to the question name
            m.extend_from_slice(&[0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 1, 0x2c, 0, 2, 0xc0, 0x0c]);
        }
        for last in [150u8, 85] {
            m.extend_from_slice(&[0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 1, 0x2c, 0, 4, 83, 171, 245, last]);
        }
        m
    }

    #[test]
    fn answers_give_the_addresses_and_skip_other_records() {
        assert_eq!(parse_answers(&response(0, false)), vec![ip(83, 171, 245, 150), ip(83, 171, 245, 85)]);
        assert_eq!(
            parse_answers(&response(0, true)),
            vec![ip(83, 171, 245, 150), ip(83, 171, 245, 85)],
            "a CNAME ahead of the addresses is stepped over"
        );
        assert!(parse_answers(&response(3, false)).is_empty(), "NXDOMAIN has no addresses");
    }

    #[test]
    fn bytes_from_the_network_never_panic() {
        assert!(parse_answers(&[]).is_empty());
        assert!(parse_answers(&[0; 11]).is_empty());
        let mut loopy = vec![0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
        loopy.extend_from_slice(&[0xc0, 0x0c, 0, 1, 0, 1]); // question name points at itself
        assert!(parse_answers(&loopy).is_empty());
        let mut cut = response(0, false);
        cut.truncate(cut.len() - 3);
        assert_eq!(parse_answers(&cut), vec![ip(83, 171, 245, 150)], "a cut tail keeps what was whole");
    }

    #[test]
    fn only_real_host_names_go_to_public_dns() {
        for good in ["api.millida.net", "piston-meta.mojang.com", "cdn.modrinth.com."] {
            assert!(worth_asking(good), "{good}");
        }
        for bad in ["localhost", "printer", "nas.local", "foo.localhost", ""] {
            assert!(!worth_asking(bad), "{bad:?}");
        }
    }

    #[tokio::test]
    async fn a_working_system_resolver_never_touches_public_dns() {
        let asked = Arc::new(AtomicUsize::new(0));
        let a = asked.clone();
        let got = resolve_with(
            "ok.example.test",
            |_| async { Ok(vec![ip(10, 0, 0, 1)]) },
            move |_| {
                a.fetch_add(1, Ordering::Relaxed);
                async { Ok(vec![ip(9, 9, 9, 9)]) }
            },
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(got, Ok(vec![ip(10, 0, 0, 1)]));
        assert_eq!(asked.load(Ordering::Relaxed), 0, "the backup is a reserve, not a habit");
    }

    #[tokio::test]
    async fn a_failed_system_lookup_is_retried_over_https_and_remembered() {
        let sys_calls = Arc::new(AtomicUsize::new(0));
        let doh_calls = Arc::new(AtomicUsize::new(0));
        let (s, d) = (sys_calls.clone(), doh_calls.clone());
        let got = resolve_with(
            "blocked.example.test",
            move |_| {
                s.fetch_add(1, Ordering::Relaxed);
                async { Err("failed to lookup address information".to_string()) }
            },
            move |_| {
                d.fetch_add(1, Ordering::Relaxed);
                async { Ok(vec![ip(83, 171, 245, 150)]) }
            },
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(got, Ok(vec![ip(83, 171, 245, 150)]));
        let again = resolve_with(
            "blocked.example.test",
            |_| async { Err("failed to lookup address information".to_string()) },
            |_| async { Err("must not be asked again".to_string()) },
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(again, Ok(vec![ip(83, 171, 245, 150)]), "the second connection is served from memory");
        assert_eq!((sys_calls.load(Ordering::Relaxed), doh_calls.load(Ordering::Relaxed)), (1, 1));
    }

    #[tokio::test]
    async fn when_both_fail_the_system_error_is_what_the_player_reads() {
        let got = resolve_with(
            "dead.example.test",
            |_| async { Err("failed to lookup address information: No such host is known".to_string()) },
            |_| async { Err("все серверы молчат".to_string()) },
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(got, Err("failed to lookup address information: No such host is known".to_string()));
    }

    #[tokio::test]
    async fn a_silent_system_resolver_is_raced_by_the_backup() {
        let started = Instant::now();
        let got = resolve_with(
            "slow.example.test",
            |_| async {
                tokio::time::sleep(Duration::from_secs(30)).await;
                Ok(vec![ip(1, 1, 1, 1)])
            },
            |_| async { Ok(vec![ip(2, 2, 2, 2)]) },
            Duration::from_millis(80),
        )
        .await;
        assert_eq!(got, Ok(vec![ip(2, 2, 2, 2)]));
        assert!(started.elapsed() < Duration::from_secs(5), "the backup answered while the system was still silent");
    }

    #[tokio::test]
    async fn local_names_stay_with_the_system() {
        let got = resolve_with(
            "localhost",
            |_| async { Ok(vec![ip(127, 0, 0, 1)]) },
            |_| async { Err("must not be asked".to_string()) },
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(got, Ok(vec![ip(127, 0, 0, 1)]));
    }
}
