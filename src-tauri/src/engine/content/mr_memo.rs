// Short memory for Modrinth version lists that cannot be had right now: a project Modrinth does not know, and a limit our proxy asked to wait out. Memory only, no disk, no network.
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// A project Modrinth answered 404 for stays absent at least this long: the
/// update check runs on every build page visit and every half hour for every
/// build, and a deleted or foreign id never starts resolving between two runs.
pub(crate) const ABSENT_TTL: Duration = Duration::from_secs(6 * 60 * 60);
const THROTTLE_DEFAULT: Duration = Duration::from_secs(60);
const THROTTLE_CAP: Duration = Duration::from_secs(600);
const ABSENT_MAX: usize = 2048;

/// A project the Modrinth version endpoint can resolve. CurseForge files are
/// recorded as `cf:<mod id>` and Millida catalogue files as `millida:<slug>`;
/// neither is a Modrinth id, and asking Modrinth for them is a 404 every time
/// that also eats the per-address limit the player's real lookups need.
pub(crate) fn is_modrinth_project(project_id: &str) -> bool {
    !project_id.is_empty() && !project_id.starts_with("cf:") && !project_id.starts_with("millida:")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Held {
    Absent(String),
    Throttled(Duration),
}

#[derive(Default)]
pub(crate) struct VersionsMemo {
    absent: HashMap<String, (Instant, String)>,
    throttled_until: Option<Instant>,
}

impl VersionsMemo {
    /// Why the request must not go out now, if it must not.
    pub(crate) fn held(&mut self, project: &str, now: Instant) -> Option<Held> {
        if let Some(until) = self.throttled_until {
            if now < until {
                return Some(Held::Throttled(until - now));
            }
            self.throttled_until = None;
        }
        match self.absent.get(project) {
            Some((until, err)) if now < *until => Some(Held::Absent(err.clone())),
            Some(_) => {
                self.absent.remove(project);
                None
            }
            None => None,
        }
    }

    pub(crate) fn note_absent(&mut self, project: &str, err: &str, now: Instant) {
        if !self.absent.contains_key(project) && self.absent.len() >= ABSENT_MAX {
            self.absent.retain(|_, (until, _)| now < *until);
            if self.absent.len() >= ABSENT_MAX {
                if let Some(first) = self.absent.iter().min_by_key(|(_, (until, _))| *until).map(|(k, _)| k.clone()) {
                    self.absent.remove(&first);
                }
            }
        }
        self.absent.insert(project.to_string(), (now + ABSENT_TTL, err.to_string()));
    }

    /// The limit is per player address and covers every project at once, so
    /// one 429 pauses all version lists, never shorter than the server asked.
    pub(crate) fn note_throttled(&mut self, asked: Option<Duration>, now: Instant) {
        let until = now + asked.unwrap_or(THROTTLE_DEFAULT).min(THROTTLE_CAP);
        if self.throttled_until.is_none_or(|current| current < until) {
            self.throttled_until = Some(until);
        }
    }
}

pub(crate) fn versions_memo<T>(f: impl FnOnce(&mut VersionsMemo, Instant) -> T) -> T {
    static MEMO: OnceLock<Mutex<VersionsMemo>> = OnceLock::new();
    let mut guard = MEMO.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    f(&mut guard, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_modrinth_ids_reach_modrinth() {
        let cases: [(&str, bool, &str); 6] = [
            ("AANobbMI", true, "id Modrinth"),
            ("sodium", true, "слаг Modrinth"),
            ("cf:238222", false, "мод CurseForge: 404 у Modrinth на каждой проверке обновлений"),
            ("millida:cosmetica", false, "вещь каталога Millida"),
            ("", false, "без источника"),
            ("cfx", true, "слаг, просто начинающийся на cf"),
        ];
        for (id, want, why) in cases {
            assert_eq!(is_modrinth_project(id), want, "{id}: {why}");
        }
    }

    #[test]
    fn absent_project_is_not_asked_again_until_ttl() {
        let mut m = VersionsMemo::default();
        let t0 = Instant::now();
        assert_eq!(m.held("gone", t0), None);
        m.note_absent("gone", "404 Not Found от x", t0);
        assert_eq!(m.held("gone", t0 + Duration::from_secs(1800)), Some(Held::Absent("404 Not Found от x".into())), "следующая проверка через полчаса не должна снова спрашивать 404");
        assert_eq!(m.held("sodium", t0), None, "404 одного проекта не трогает остальные");
        assert_eq!(m.held("gone", t0 + ABSENT_TTL), None, "после срока проект снова спрашивается");
    }

    #[test]
    fn throttle_pauses_every_project_for_retry_after() {
        let mut m = VersionsMemo::default();
        let t0 = Instant::now();
        m.note_throttled(Some(Duration::from_secs(45)), t0);
        m.note_throttled(Some(Duration::from_secs(5)), t0);
        assert_eq!(m.held("sodium", t0 + Duration::from_secs(40)), Some(Held::Throttled(Duration::from_secs(5))), "короткий срок не сокращает уже названный");
        assert_eq!(m.held("sodium", t0 + Duration::from_secs(45)), None, "после Retry-After запросы снова идут");
    }

    #[test]
    fn throttle_without_header_waits_default_and_huge_header_is_capped() {
        let mut m = VersionsMemo::default();
        let t0 = Instant::now();
        m.note_throttled(None, t0);
        assert!(m.held("a", t0 + THROTTLE_DEFAULT - Duration::from_millis(1)).is_some(), "429 без Retry-After всё равно пауза");
        let mut m = VersionsMemo::default();
        m.note_throttled(Some(Duration::from_secs(99_999)), t0);
        assert_eq!(m.held("a", t0 + THROTTLE_CAP), None, "чужой огромный срок не запирает версии до перезапуска");
    }

    #[test]
    fn absent_memory_stays_bounded() {
        let mut m = VersionsMemo::default();
        let t0 = Instant::now();
        for i in 0..(ABSENT_MAX + 10) {
            m.note_absent(&format!("p{i}"), "404", t0 + Duration::from_millis(i as u64));
        }
        assert!(m.absent.len() <= ABSENT_MAX, "память 404 ограничена по размеру");
    }
}
