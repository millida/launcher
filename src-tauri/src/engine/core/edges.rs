use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PROBE_HOST: &str = "launcher-storage.millida.net";
const PROBE_URL: &str = "https://launcher-storage.millida.net/edges.json";
const EDGES_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgRjMwRTIyQkVFMjEyQzdFOQpSV1RweHhMaXZpSU84MjByeUxMVHBUWjNDN0VrM2xsOXcrN0VubCsxd1ArTzRNb0h0THpNQjlwdwo=";
const UA: &str = concat!("MillidaLauncher/", env!("MILLIDA_VERSION"), " (+https://millida.net)");
const CACHE_FILE: &str = "edges.json";
const FORMAT: u64 = 1;

const PROBE_TRIES: u32 = 3;
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const PROBE_MAX_BYTES: usize = 512 * 1024;
const FIRST_ANSWER_WAIT: Duration = Duration::from_secs(12);
const ROUND_EVERY: Duration = Duration::from_secs(10 * 60);
const ROUND_EVERY_WHEN_DOWN: Duration = Duration::from_secs(30);
const DEMOTION: Duration = Duration::from_secs(10 * 60);
const SWITCH_GRACE: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, PartialEq)]
struct Edge {
    addrs: Vec<IpAddr>,
    hosts: Vec<String>,
    rank: u8,
}

#[derive(Clone, Debug, PartialEq)]
struct EdgeList {
    issued: u64,
    hosts: Vec<String>,
    edges: Vec<Edge>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Health {
    Pending,
    Up(Duration),
    Down,
}

#[derive(Clone, Debug)]
struct Candidate {
    ip: IpAddr,
    hosts: Vec<String>,
    rank: u8,
    health: Health,
    demoted_until: Option<Instant>,
}

impl Candidate {
    fn new(ip: IpAddr, hosts: Vec<String>, rank: u8) -> Self {
        Candidate { ip, hosts, rank, health: Health::Pending, demoted_until: None }
    }

    fn serves(&self, host: &str) -> bool {
        self.hosts.iter().any(|h| h == host)
    }

    fn usable(&self, now: Instant) -> Option<Duration> {
        match self.health {
            Health::Up(rtt) if self.demoted_until.is_none_or(|until| until <= now) => Some(rtt),
            _ => None,
        }
    }
}

#[derive(Default)]
struct State {
    loaded: bool,
    list: Option<EdgeList>,
    from_dns: Vec<IpAddr>,
    candidates: Vec<Candidate>,
    round_started: Option<Instant>,
    outstanding: usize,
    switched: HashMap<String, Instant>,
    generation: u64,
}

impl State {
    fn covers(&self, host: &str) -> bool {
        self.list.as_ref().is_some_and(|l| l.hosts.iter().any(|h| h == host))
    }

    fn ranked(&self, host: &str, now: Instant) -> Vec<IpAddr> {
        let mut usable: Vec<(u8, Duration, IpAddr)> = self
            .candidates
            .iter()
            .filter(|c| c.serves(host))
            .filter_map(|c| c.usable(now).map(|rtt| (c.rank, rtt, c.ip)))
            .collect();
        usable.sort_by_key(|(rank, rtt, _)| (*rank, *rtt));
        let mut out: Vec<IpAddr> = Vec::with_capacity(usable.len());
        for (_, _, ip) in usable {
            if !out.contains(&ip) {
                out.push(ip);
            }
        }
        out
    }

    fn any_up(&self, now: Instant) -> bool {
        self.candidates.iter().any(|c| c.usable(now).is_some())
    }

    fn rebuild(&mut self) {
        let mut next: Vec<Candidate> = Vec::new();
        let mut place = |ip: IpAddr, hosts: Vec<String>, rank: u8, old: &[Candidate]| {
            if let Some(existing) = next.iter_mut().find(|c| c.ip == ip) {
                existing.rank = existing.rank.min(rank);
                for h in hosts {
                    if !existing.hosts.contains(&h) {
                        existing.hosts.push(h);
                    }
                }
                return;
            }
            let mut fresh = Candidate::new(ip, hosts, rank);
            if let Some(prev) = old.iter().find(|c| c.ip == ip) {
                fresh.health = prev.health;
                fresh.demoted_until = prev.demoted_until;
            }
            next.push(fresh);
        };
        if let Some(list) = &self.list {
            for edge in &list.edges {
                let hosts = if edge.hosts.is_empty() { list.hosts.clone() } else { edge.hosts.clone() };
                for ip in &edge.addrs {
                    place(*ip, hosts.clone(), edge.rank, &self.candidates);
                }
            }
        }
        for ip in &self.from_dns {
            place(*ip, vec![PROBE_HOST.to_string()], u8::MAX, &self.candidates);
        }
        self.candidates = next;
    }

    fn adopt(&mut self, list: EdgeList) -> bool {
        if self.list.as_ref().is_some_and(|known| known.issued >= list.issued) {
            return false;
        }
        self.list = Some(list);
        self.rebuild();
        true
    }

    fn unprobed(&self) -> Vec<IpAddr> {
        self.candidates.iter().filter(|c| c.health == Health::Pending).map(|c| c.ip).collect()
    }

    fn record(&mut self, ip: IpAddr, health: Health) {
        for c in self.candidates.iter_mut().filter(|c| c.ip == ip) {
            c.health = health;
        }
    }

    fn round_due(&self, now: Instant) -> bool {
        if self.outstanding > 0 {
            return false;
        }
        let every = if self.any_up(now) { ROUND_EVERY } else { ROUND_EVERY_WHEN_DOWN };
        self.round_started.is_none_or(|at| now.duration_since(at) >= every)
    }

    fn report_failure(&mut self, host: &str, now: Instant) -> bool {
        if !self.covers(host) {
            return false;
        }
        if self.switched.get(host).is_some_and(|at| now.duration_since(*at) < SWITCH_GRACE) {
            return false;
        }
        let Some(head) = self.ranked(host, now).first().copied() else { return false };
        for c in self.candidates.iter_mut().filter(|c| c.ip == head) {
            c.demoted_until = Some(now + DEMOTION);
        }
        self.switched.insert(host.to_string(), now);
        self.generation += 1;
        true
    }
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::default()));
static CHANGED: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn public_addr(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.octets()[0] == 0
                || (v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64))
        }
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().is_some())
        }
    }
}

fn strings(v: &serde_json::Value, what: &str) -> Result<Vec<String>, String> {
    v.as_array()
        .ok_or_else(|| format!("{} is not a list", what))?
        .iter()
        .map(|s| s.as_str().map(str::to_string).ok_or_else(|| format!("{} holds a non-string", what)))
        .collect()
}

fn decode_b64_text(b64: &str) -> Option<String> {
    use base64::Engine as _;
    let raw = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    String::from_utf8(raw).ok()
}

fn signature_ok(text: &str, sig_b64: &str, pubkey_b64: &str) -> bool {
    use minisign_verify::{PublicKey, Signature};
    let Some(key) = decode_b64_text(pubkey_b64).and_then(|k| PublicKey::decode(k.trim()).ok()) else { return false };
    let Some(sig) = decode_b64_text(sig_b64).and_then(|s| Signature::decode(s.trim()).ok()) else { return false };
    key.verify(text.as_bytes(), &sig, false).is_ok()
}

fn parse(bytes: &[u8], pubkey_b64: &str, now: u64) -> Result<EdgeList, String> {
    let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| format!("edge list is not JSON: {}", e))?;
    if v["format"].as_u64() != Some(FORMAT) {
        return Err("edge list has an unknown format".into());
    }
    let issued = v["issued"].as_u64().ok_or("edge list has no issue time")?;
    let expires = v["expires"].as_u64().ok_or("edge list has no expiry")?;
    let hosts = strings(&v["hosts"], "hosts")?;
    let raw_edges = v["edges"].as_array().ok_or("edge list has no edges")?;
    let mut text = format!("millida-edges-v1\nissued={}\nexpires={}\n", issued, expires);
    for h in &hosts {
        text.push_str(&format!("host={}\n", h));
    }
    let mut edges = Vec::with_capacity(raw_edges.len());
    for raw in raw_edges {
        let id = raw["id"].as_str().ok_or("edge without id")?;
        let addrs = strings(&raw["addrs"], "addrs")?;
        let edge_hosts = strings(&raw["hosts"], "edge hosts")?;
        let rank = raw["rank"].as_u64().filter(|r| *r <= 9).ok_or_else(|| format!("{}: rank is not 0..9", id))?;
        text.push_str(&format!("edge={}|{}|{}|{}\n", id, addrs.join(","), edge_hosts.join(","), rank));
        let parsed = addrs
            .iter()
            .map(|a| a.parse::<IpAddr>().map_err(|_| format!("{}: {} is not an address", id, a)))
            .collect::<Result<Vec<_>, _>>()?;
        edges.push(Edge { addrs: parsed, hosts: edge_hosts, rank: rank as u8 });
    }
    let sig = v["signature"].as_str().ok_or("edge list is not signed")?;
    if !signature_ok(&text, sig, pubkey_b64) {
        return Err("edge list signature does not match".into());
    }
    if expires <= now {
        return Err("edge list has expired".into());
    }
    for edge in &mut edges {
        edge.addrs.retain(public_addr);
        edge.hosts.retain(|h| hosts.contains(h));
    }
    edges.retain(|e| !e.addrs.is_empty());
    if edges.is_empty() || hosts.is_empty() {
        return Err("edge list names no usable edge".into());
    }
    Ok(EdgeList { issued, hosts, edges })
}

fn cache_path() -> std::path::PathBuf {
    super::paths::data_dir().join(CACHE_FILE)
}

fn load_cached(st: &mut State) {
    if st.loaded {
        return;
    }
    st.loaded = true;
    let Ok(bytes) = std::fs::read(cache_path()) else { return };
    if let Ok(list) = parse(&bytes, EDGES_PUBKEY, unix_now()) {
        st.adopt(list);
    }
}

fn probe_client_with(ip: IpAddr, native_roots: bool) -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .user_agent(UA)
        .resolve(PROBE_HOST, SocketAddr::new(ip, 443))
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(PROBE_TIMEOUT)
        .timeout(PROBE_TIMEOUT)
        .tls_built_in_webpki_certs(true)
        .tls_built_in_native_certs(native_roots)
        .build()
}

fn probe_client(ip: IpAddr) -> Result<reqwest::Client, String> {
    probe_client_with(ip, true).or_else(|_| probe_client_with(ip, false)).map_err(|e| e.to_string())
}

async fn probe_once(client: &reqwest::Client) -> Result<(Vec<u8>, Duration), String> {
    let started = Instant::now();
    let resp = client
        .get(PROBE_URL)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("edge answered {}", resp.status()));
    }
    let body = super::http::read_capped(resp, PROBE_MAX_BYTES).await?;
    Ok((body, started.elapsed()))
}

struct Answer {
    list: EdgeList,
    rtt: Duration,
    body: Vec<u8>,
}

async fn probe(ip: IpAddr) -> Result<Answer, String> {
    let client = probe_client(ip)?;
    let mut last = String::new();
    for _ in 0..PROBE_TRIES {
        match probe_once(&client).await {
            Ok((body, rtt)) => {
                let list = parse(&body, EDGES_PUBKEY, unix_now())?;
                return Ok(Answer { list, rtt, body });
            }
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn spawn_probe(st: &mut State, ip: IpAddr) {
    st.outstanding += 1;
    tokio::spawn(async move {
        let outcome = probe(ip).await;
        let keep = {
            let mut st = state();
            st.outstanding = st.outstanding.saturating_sub(1);
            match outcome {
                Ok(answer) => {
                    st.record(ip, Health::Up(answer.rtt));
                    if st.adopt(answer.list) {
                        for next in st.unprobed() {
                            spawn_probe(&mut st, next);
                        }
                        Some(answer.body)
                    } else {
                        None
                    }
                }
                Err(_) => {
                    st.record(ip, Health::Down);
                    None
                }
            }
        };
        CHANGED.notify_waiters();
        if let Some(body) = keep {
            let _ = tokio::task::spawn_blocking(move || super::paths::write_bytes_atomic(&cache_path(), &body)).await;
        }
    });
}

fn start_round_if_due() {
    let mut st = state();
    load_cached(&mut st);
    let now = Instant::now();
    if !st.round_due(now) {
        return;
    }
    st.round_started = Some(now);
    for c in st.candidates.iter_mut().filter(|c| c.health == Health::Down) {
        c.health = Health::Pending;
    }
    for ip in st.candidates.iter().map(|c| c.ip).collect::<Vec<_>>() {
        spawn_probe(&mut st, ip);
    }
    st.outstanding += 1;
    tokio::spawn(async {
        let found = super::doh::lookup(PROBE_HOST).await.unwrap_or_default();
        {
            let mut st = state();
            st.outstanding = st.outstanding.saturating_sub(1);
            let fresh: Vec<IpAddr> = found.into_iter().filter(|ip| !st.from_dns.contains(ip)).collect();
            if !fresh.is_empty() {
                st.from_dns.extend(fresh);
                st.rebuild();
                for ip in st.unprobed() {
                    spawn_probe(&mut st, ip);
                }
            }
        }
        CHANGED.notify_waiters();
    });
}

pub(crate) async fn order(host: &str) -> Vec<IpAddr> {
    start_round_if_due();
    let deadline = tokio::time::Instant::now() + FIRST_ANSWER_WAIT;
    loop {
        let notified = CHANGED.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let (ranked, waiting) = {
            let st = state();
            if !st.covers(host) {
                return Vec::new();
            }
            (st.ranked(host, Instant::now()), st.outstanding > 0)
        };
        if !ranked.is_empty() || !waiting {
            return ranked;
        }
        if tokio::time::timeout_at(deadline, notified).await.is_err() {
            return Vec::new();
        }
    }
}

pub(crate) fn edge_failure(url: &str) {
    let Some(host) = url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase())) else {
        return;
    };
    state().report_failure(&host, Instant::now());
}

pub(crate) fn generation() -> u64 {
    state().generation
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXkgNEFBMDFBQUMwQzM3MEZFMQpSV1RoRHpjTXJCcWdTczZFWGZyWCtnRGNTcnBaTGYwbXh3enRWY0VhWVI0VDAvdjVjcDN3a0M4RQo=";
    const SIGNED: &str = r#"{"format":1,"issued":1795266978,"expires":4948866978,"hosts":["api.millida.net","launcher-storage.millida.net"],"edges":[{"id":"alpha","addrs":["192.0.2.10","192.0.2.11"],"hosts":[],"rank":0},{"id":"beta","addrs":["198.51.100.7"],"hosts":["launcher-storage.millida.net"],"rank":0},{"id":"spare","addrs":["203.0.113.9"],"hosts":[],"rank":1}],"signature":"dW50cnVzdGVkIGNvbW1lbnQ6IG1pbGxpZGEgZWRnZSBsaXN0ClJVVGhEemNNckJxZ1NnODc4TERkT2dJSXdUc3hCWUJYL1duK3o5a3JqRit2ZnpETnNtMXlBRERubGZFaEw3SVlWemV3QXZhOXRYbmQzakZLekhwNW8wRGRHMStCNEdxTjN3dz0KdHJ1c3RlZCBjb21tZW50OiB0aW1lc3RhbXA6MTc5NTI2Njk3OAlmaWxlOmVkZ2VzLmpzb24KTE5RcjlUTEFlcCtFa1Mxd0RrK25SemhrK0RnVkRGZytiMEV4THNoQTJqWUZaQ2I5dUdUckgyRXVHcGpkMWdKNmJRQlBMRXZRcU9WWUNiTkRFdDNZQ0E9PQo="}"#;
    const NOW: u64 = 1795266800;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn signed_list() -> EdgeList {
        parse(SIGNED.as_bytes(), TEST_PUBKEY, NOW).expect("the fixture is signed by the test key")
    }

    #[test]
    fn a_list_signed_by_the_key_is_accepted_with_its_edges() {
        let list = signed_list();
        assert_eq!(list.issued, 1795266978);
        assert_eq!(list.hosts, vec!["api.millida.net", "launcher-storage.millida.net"]);
        assert_eq!(list.edges.len(), 3);
        assert_eq!(list.edges[2].rank, 1);
        assert_eq!(list.edges[0].addrs, vec![ip("192.0.2.10"), ip("192.0.2.11")]);
        assert_eq!(list.edges[1].hosts, vec!["launcher-storage.millida.net"]);
    }

    #[test]
    fn a_changed_or_foreign_list_is_refused() {
        let cases: [(String, &str, u64, &str); 7] = [
            (SIGNED.replace("192.0.2.10", "192.0.2.99"), TEST_PUBKEY, NOW, "an address swapped after signing"),
            (SIGNED.replace("\"hosts\":[]", "\"hosts\":[\"api.millida.net\"]"), TEST_PUBKEY, NOW, "an edge's hosts changed after signing"),
            (SIGNED.replace("4948866978", "4948866979"), TEST_PUBKEY, NOW, "the expiry stretched after signing"),
            (SIGNED.replace("\"rank\":1", "\"rank\":0"), TEST_PUBKEY, NOW, "a spare edge promoted after signing"),
            (SIGNED.to_string(), EDGES_PUBKEY, NOW, "signed by another key than the one built in"),
            (SIGNED.to_string(), TEST_PUBKEY, 4948866978, "the list has expired"),
            (SIGNED.replace("\"format\":1", "\"format\":2"), TEST_PUBKEY, NOW, "a format this build does not know"),
        ];
        for (body, key, now, why) in cases {
            assert!(parse(body.as_bytes(), key, now).is_err(), "{} must not be accepted", why);
        }
    }

    #[test]
    fn padding_outside_the_signature_does_not_matter() {
        let padded = SIGNED.replacen('{', "{\"pad\":\"AAAA\",", 1);
        assert!(parse(padded.as_bytes(), TEST_PUBKEY, NOW).is_ok(), "the probe file is padded to catch cuts after 16 KB");
    }

    #[test]
    fn only_public_addresses_are_ever_dialled() {
        let cases = [
            ("192.0.2.10", true, "public"),
            ("2001:db8::1", true, "public v6"),
            ("10.1.2.3", false, "private"),
            ("192.168.0.1", false, "home network"),
            ("127.0.0.1", false, "loopback"),
            ("100.100.1.1", false, "carrier NAT"),
            ("169.254.0.1", false, "link local"),
            ("0.0.0.0", false, "unspecified"),
            ("::1", false, "v6 loopback"),
            ("fd00::1", false, "v6 unique local"),
            ("fe80::1", false, "v6 link local"),
            ("::ffff:10.0.0.1", false, "mapped v4 hides a private address"),
        ];
        for (addr, want, why) in cases {
            assert_eq!(public_addr(&ip(addr)), want, "{} ({})", addr, why);
        }
    }

    fn ready_state() -> State {
        let mut st = State::default();
        assert!(st.adopt(signed_list()));
        st.record(ip("192.0.2.10"), Health::Up(Duration::from_millis(300)));
        st.record(ip("192.0.2.11"), Health::Up(Duration::from_millis(80)));
        st.record(ip("198.51.100.7"), Health::Up(Duration::from_millis(20)));
        st.record(ip("203.0.113.9"), Health::Up(Duration::from_millis(5)));
        st
    }

    #[test]
    fn the_fastest_edge_serving_the_host_goes_first() {
        let st = ready_state();
        let now = Instant::now();
        assert_eq!(
            st.ranked("launcher-storage.millida.net", now),
            vec![ip("198.51.100.7"), ip("192.0.2.11"), ip("192.0.2.10"), ip("203.0.113.9")],
            "ordered by rank, then by the probe time: a faster spare still waits its turn"
        );
        assert_eq!(
            st.ranked("api.millida.net", now),
            vec![ip("192.0.2.11"), ip("192.0.2.10"), ip("203.0.113.9")],
            "an edge that does not serve the host is never pinned to it"
        );
        assert!(st.ranked("id.millida.net", now).is_empty(), "a host outside the list keeps normal DNS");
        assert!(!st.covers("id.millida.net"));
    }

    #[test]
    fn down_and_pending_edges_are_skipped() {
        let mut st = ready_state();
        st.record(ip("192.0.2.11"), Health::Down);
        st.record(ip("192.0.2.10"), Health::Pending);
        assert_eq!(st.ranked("api.millida.net", Instant::now()), vec![ip("203.0.113.9")], "the spare takes over");
        st.record(ip("203.0.113.9"), Health::Down);
        assert!(st.ranked("api.millida.net", Instant::now()).is_empty(), "nothing usable falls back to DNS");
    }

    #[test]
    fn a_failure_moves_the_host_to_the_next_edge_once_per_grace() {
        let mut st = ready_state();
        let now = Instant::now();
        let before = st.generation;
        assert!(st.report_failure("api.millida.net", now));
        assert_eq!(st.ranked("api.millida.net", now), vec![ip("192.0.2.10"), ip("203.0.113.9")], "the failing head is set aside");
        assert_eq!(st.generation, before + 1, "the pool is rebuilt so old sockets to the bad edge are dropped");
        assert!(
            !st.report_failure("api.millida.net", now + Duration::from_secs(5)),
            "late failures of requests started on the old edge do not punish the new one"
        );
        assert!(st.report_failure("api.millida.net", now + SWITCH_GRACE + Duration::from_secs(1)));
        assert_eq!(st.ranked("api.millida.net", now + SWITCH_GRACE + Duration::from_secs(1)), vec![ip("203.0.113.9")]);
        assert_eq!(
            st.ranked("api.millida.net", now + DEMOTION + SWITCH_GRACE + Duration::from_secs(2)).len(),
            3,
            "a demotion expires"
        );
        assert!(!st.report_failure("id.millida.net", now), "hosts outside the list are left alone");
    }

    #[test]
    fn an_older_list_does_not_replace_a_newer_one_and_health_survives_a_new_list() {
        let mut st = ready_state();
        let mut older = signed_list();
        older.issued -= 1;
        assert!(!st.adopt(older), "a replayed older list is ignored");
        let mut newer = signed_list();
        newer.issued += 1;
        newer.edges.pop();
        assert!(st.adopt(newer));
        assert_eq!(st.candidates.len(), 3, "an edge removed from the list is dropped");
        assert_eq!(st.ranked("api.millida.net", Instant::now()).len(), 2, "known health is kept");
    }

    #[test]
    fn dns_answers_only_serve_the_probe() {
        let mut st = State::default();
        st.from_dns.push(ip("203.0.113.5"));
        st.rebuild();
        assert_eq!(st.candidates.len(), 1);
        assert!(st.candidates[0].serves(PROBE_HOST));
        assert!(!st.candidates[0].serves("api.millida.net"), "an address from DNS is only trusted to deliver the list");
    }

    #[test]
    fn rounds_repeat_sooner_while_nothing_answers() {
        let mut st = ready_state();
        let now = Instant::now();
        st.round_started = Some(now);
        assert!(!st.round_due(now + ROUND_EVERY_WHEN_DOWN));
        assert!(st.round_due(now + ROUND_EVERY));
        for addr in ["192.0.2.10", "192.0.2.11", "198.51.100.7", "203.0.113.9"] {
            st.record(ip(addr), Health::Down);
        }
        assert!(st.round_due(now + ROUND_EVERY_WHEN_DOWN));
        st.outstanding = 1;
        assert!(!st.round_due(now + ROUND_EVERY), "one round at a time");
    }
}
