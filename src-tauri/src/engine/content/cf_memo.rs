use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const ANSWER_TTL: Duration = Duration::from_secs(120);
const FAILURE_TTL: Duration = Duration::from_secs(600);
const OUTAGE_DEFAULT: Duration = Duration::from_secs(60);
const RETRY_AFTER_CAP: Duration = Duration::from_secs(1800);
const ANSWERS_MAX: usize = 128;
const FAILURES_MAX: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProxyVerdict {
    Answered,
    KeyFailed,
    Outage(Duration),
    Ignored,
}

/// `status` is `None` when the request never got an answer.
///
/// 503 and 429 come from the backend breaker and rate limiter and concern every
/// path at once; 502/504 mean CurseForge refused this one request.
pub(crate) fn proxy_verdict(status: Option<u16>, retry_after: Option<&str>) -> ProxyVerdict {
    let wait = || {
        retry_after
            .and_then(|v| v.trim().parse::<u64>().ok())
            .map(|s| Duration::from_secs(s).min(RETRY_AFTER_CAP))
            .unwrap_or(OUTAGE_DEFAULT)
    };
    match status {
        None => ProxyVerdict::KeyFailed,
        Some(s) if (200..300).contains(&s) => ProxyVerdict::Answered,
        Some(503) | Some(429) => ProxyVerdict::Outage(wait()),
        Some(502) | Some(504) => ProxyVerdict::KeyFailed,
        Some(_) => ProxyVerdict::Ignored,
    }
}

#[derive(Default)]
pub(crate) struct ProxyMemo {
    answers: HashMap<String, (Instant, Value)>,
    failures: HashMap<String, Instant>,
    outage_until: Option<Instant>,
}

impl ProxyMemo {
    pub(crate) fn answer(&mut self, key: &str, now: Instant) -> Option<Value> {
        match self.answers.get(key) {
            Some((at, v)) if now.duration_since(*at) < ANSWER_TTL => Some(v.clone()),
            Some(_) => {
                self.answers.remove(key);
                None
            }
            None => None,
        }
    }

    pub(crate) fn remember_answer(&mut self, key: &str, value: &Value, now: Instant) {
        if !self.answers.contains_key(key) && self.answers.len() >= ANSWERS_MAX {
            self.answers.retain(|_, (at, _)| now.duration_since(*at) < ANSWER_TTL);
            if self.answers.len() >= ANSWERS_MAX {
                if let Some(oldest) = self.answers.iter().min_by_key(|(_, (at, _))| *at).map(|(k, _)| k.clone()) {
                    self.answers.remove(&oldest);
                }
            }
        }
        self.answers.insert(key.to_string(), (now, value.clone()));
    }

    /// True while the proxy should be skipped for this key and the mirror asked directly.
    pub(crate) fn proxy_skipped(&mut self, key: &str, now: Instant) -> bool {
        if self.outage_until.is_some_and(|until| now < until) {
            return true;
        }
        self.outage_until = None;
        match self.failures.get(key) {
            Some(until) if now < *until => true,
            Some(_) => {
                self.failures.remove(key);
                false
            }
            None => false,
        }
    }

    pub(crate) fn note(&mut self, key: &str, verdict: ProxyVerdict, now: Instant) {
        match verdict {
            ProxyVerdict::Answered => {
                self.failures.remove(key);
            }
            ProxyVerdict::KeyFailed => {
                if !self.failures.contains_key(key) && self.failures.len() >= FAILURES_MAX {
                    self.failures.retain(|_, until| now < *until);
                    if self.failures.len() >= FAILURES_MAX {
                        if let Some(first) = self.failures.iter().min_by_key(|(_, until)| **until).map(|(k, _)| k.clone()) {
                            self.failures.remove(&first);
                        }
                    }
                }
                self.failures.insert(key.to_string(), now + FAILURE_TTL);
            }
            ProxyVerdict::Outage(wait) => {
                let until = now + wait;
                if self.outage_until.is_none_or(|current| current < until) {
                    self.outage_until = Some(until);
                }
            }
            ProxyVerdict::Ignored => {}
        }
    }
}

/// Shared by every CurseForge call of the process: a popular pack asked by many
/// screens used to hit the failing proxy again on every one of them.
pub(crate) fn cf_memo<T>(f: impl FnOnce(&mut ProxyMemo, Instant) -> T) -> T {
    static MEMO: OnceLock<Mutex<ProxyMemo>> = OnceLock::new();
    let mut guard = MEMO.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard, Instant::now())
}

pub(crate) fn cf_memo_key(path: &str, q: &[(String, String)]) -> String {
    let mut key = path.to_string();
    for (k, v) in q {
        key.push('&');
        key.push_str(k);
        key.push('=');
        key.push_str(v);
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verdict_table() {
        let cases: [(Option<u16>, Option<&str>, ProxyVerdict, &str); 9] = [
            (Some(200), None, ProxyVerdict::Answered, "успех снимает память о сбое"),
            (Some(502), None, ProxyVerdict::KeyFailed, "CurseForge режет адрес прокси: 96% ответов, запомнить по ключу"),
            (Some(504), None, ProxyVerdict::KeyFailed, "таймаут CurseForge за прокси"),
            (None, None, ProxyVerdict::KeyFailed, "нет ответа вовсе"),
            (Some(503), Some("120"), ProxyVerdict::Outage(Duration::from_secs(120)), "предохранитель сервера назвал срок"),
            (Some(503), None, ProxyVerdict::Outage(OUTAGE_DEFAULT), "503 без срока всё равно пауза для всех путей"),
            (Some(429), Some("99999"), ProxyVerdict::Outage(RETRY_AFTER_CAP), "чужой огромный срок не запирает прокси навсегда"),
            (Some(429), Some("Wed, 21 Oct 2026 07:28:00 GMT"), ProxyVerdict::Outage(OUTAGE_DEFAULT), "дата вместо секунд"),
            (Some(404), None, ProxyVerdict::Ignored, "404 — ответ про путь, а не сбой прокси"),
        ];
        for (status, retry, want, why) in cases {
            assert_eq!(proxy_verdict(status, retry), want, "{why}");
        }
    }

    #[test]
    fn failed_key_skips_proxy_until_ttl_then_retries() {
        let mut m = ProxyMemo::default();
        let t0 = Instant::now();
        m.note("v1/mods/1/files/2", ProxyVerdict::KeyFailed, t0);
        assert!(m.proxy_skipped("v1/mods/1/files/2", t0 + Duration::from_secs(5)), "сразу после 502 тот же запрос не должен снова идти в прокси");
        assert!(!m.proxy_skipped("v1/mods/3", t0), "сбой одного ключа не трогает остальные");
        assert!(!m.proxy_skipped("v1/mods/1/files/2", t0 + FAILURE_TTL), "по истечении срока прокси снова пробуется, иначе он не вернётся до перезапуска");
    }

    #[test]
    fn outage_skips_every_key_and_keeps_the_longest_wait() {
        let mut m = ProxyMemo::default();
        let t0 = Instant::now();
        m.note("a", ProxyVerdict::Outage(Duration::from_secs(300)), t0);
        m.note("b", ProxyVerdict::Outage(Duration::from_secs(10)), t0);
        assert!(m.proxy_skipped("c", t0 + Duration::from_secs(200)), "Retry-After от предохранителя касается всех путей, короткий срок не должен его сократить");
        assert!(!m.proxy_skipped("c", t0 + Duration::from_secs(301)), "после срока прокси снова доступен");
    }

    #[test]
    fn answers_expire_and_stay_bounded() {
        let mut m = ProxyMemo::default();
        let t0 = Instant::now();
        let v = serde_json::json!({ "data": 1 });
        m.remember_answer("k", &v, t0);
        assert_eq!(m.answer("k", t0 + Duration::from_secs(1)), Some(v.clone()), "свежий ответ отдаётся из памяти");
        assert_eq!(m.answer("k", t0 + ANSWER_TTL), None, "старый ответ не должен жить дольше срока");
        for i in 0..(ANSWERS_MAX + 10) {
            m.remember_answer(&format!("k{i}"), &v, t0 + Duration::from_millis(i as u64));
        }
        assert!(m.answers.len() <= ANSWERS_MAX, "память ответов ограничена, иначе листание каталога растит её без конца");
        assert!(m.answer("k0", t0 + Duration::from_secs(1)).is_none(), "вытесняется самый старый ответ");
    }

    #[test]
    fn failures_stay_bounded() {
        let mut m = ProxyMemo::default();
        let t0 = Instant::now();
        for i in 0..(FAILURES_MAX + 10) {
            m.note(&format!("k{i}"), ProxyVerdict::KeyFailed, t0 + Duration::from_millis(i as u64));
        }
        assert!(m.failures.len() <= FAILURES_MAX, "память сбоев ограничена по размеру");
    }

    #[test]
    fn key_includes_query() {
        let q = vec![("slug".to_string(), "a".to_string())];
        assert_ne!(cf_memo_key("v1/mods/search", &q), cf_memo_key("v1/mods/search", &[]), "разные запросы поиска не должны делить ответ");
    }
}
