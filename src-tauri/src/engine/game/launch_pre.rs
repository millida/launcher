// The network checks that come with pressing Play: the access check of a paid build, the launch key,
// the card of a catalogue build, the session token of our mod, the description of our skin server and
// the kill-switch list. They all talk to api.millida.net (the skin server and CDN for the last two),
// send nothing but what they always sent, and used to run one after another before the game started.
// Here they start together with the install and the launch waits for an answer only at the point
// where it needs it. Nothing is written to disk here.
use super::launch_guard::spawn_in_launch;
use crate::engine::*;
use serde_json::Value;
use std::future::Future;

/// How long the launch waits for the card of a catalogue build before it uses the stored answer.
const PACK_MOD_GRACE: std::time::Duration = std::time::Duration::from_millis(400);

/// A task that belongs to the launch. If the launch ends before its answer is read (an error,
/// a cancel), the task is stopped with it.
pub(crate) struct Job<T> {
    handle: Option<tokio::task::JoinHandle<T>>,
}

impl<T: Send + 'static> Job<T> {
    fn spawn<F: Future<Output = T> + Send + 'static>(fut: F) -> Job<T> {
        Job { handle: Some(spawn_in_launch(fut)) }
    }

    fn finished(&self) -> bool {
        self.handle.as_ref().is_none_or(|h| h.is_finished())
    }

    /// Resolves when the task is done. Safe to drop from a `select!` and call again.
    async fn done(&mut self) -> Option<T> {
        let h = self.handle.as_mut()?;
        let out = h.await;
        self.handle = None;
        out.ok()
    }

    /// The answer, or None if the task died. Waiting time that is real (the task was not done
    /// yet) is charged to the `net` stage of the launch.
    pub(crate) async fn answer(mut self) -> Option<T> {
        if self.finished() {
            self.done().await
        } else {
            super::launch_perf::detour("net", self.done()).await
        }
    }
}

impl<T> Job<T> {
    /// Lets the task finish on its own after the launch has stopped caring for its answer.
    fn detach(&mut self) {
        self.handle = None;
    }
}

impl<T> Drop for Job<T> {
    fn drop(&mut self) {
        if let Some(h) = &self.handle {
            h.abort();
        }
    }
}

/// What the page's skin server and the agent for it came to.
pub(crate) enum Ygg {
    Ready(GameAgent, Value),
    /// The agent is in place, the server did not describe itself.
    NoReply(String),
    /// The agent jar could not be put in place.
    NoAgent(String),
}

pub(crate) async fn prepare_skin_server(url: String) -> Ygg {
    match ensure_authlib_injector().await.and_then(|jar| agent_for_game(&jar)) {
        // One GET to the Millida skin server for its description (cached, see authlib.rs). The
        // password and the Microsoft token are not sent there.
        Ok(agent) => match yggdrasil_meta(&url).await {
            Ok(meta) => Ygg::Ready(agent, meta),
            Err(e) => Ygg::NoReply(e),
        },
        Err(e) => Ygg::NoAgent(e),
    }
}

/// Which checks a launch starts up front. Plain data, so the plan can be tested on its own.
#[derive(Debug, PartialEq, Eq, Default, Clone)]
pub(crate) struct Plan {
    /// Catalogue slug whose subscription is checked before the game starts.
    pub gate: Option<String>,
    /// Slug of a paid pack that needs its launch key.
    pub token: Option<String>,
    /// Slug of a catalogue pack whose card says whether our mod goes in.
    pub pack_mod: Option<String>,
    /// The session token our mod takes into the game.
    pub mod_token: bool,
    /// Address of the skin server to describe.
    pub skin_server: Option<String>,
    /// The kill-switch list for our mod.
    pub kill_switch: bool,
}

/// `pack`: slug and "needs a launch key" of the catalogue build that brings its own game files.
pub(crate) fn plan(
    settings: &Value,
    pack: Option<(&str, bool)>,
    yggdrasil: &str,
    loader: &str,
    mod_wanted: bool,
    gate_allowed_lately: &dyn Fn(&str) -> bool,
) -> Plan {
    let needs_key = pack.is_some_and(|(_, needs)| needs);
    let modded = matches!(loader, "fabric" | "quilt" | "forge" | "neoforge");
    // A build that brings its own game gets our mod only if its card said so last time; a card
    // that says so for the first time is read later and the token is then fetched in line.
    let mod_for_pack = pack.is_none() || settings[PACK_MILLIDA_MOD_KEY].as_bool() == Some(true);
    let wants_mod = modded && mod_wanted && mod_for_pack;
    Plan {
        gate: if needs_key { None } else { launch_gate_slug(settings).filter(|slug| !gate_allowed_lately(slug)) },
        token: pack.filter(|(_, needs)| *needs).map(|(slug, _)| slug.to_string()),
        pack_mod: pack.map(|(slug, _)| slug.to_string()),
        mod_token: wants_mod,
        skin_server: (!yggdrasil.is_empty()).then(|| yggdrasil.to_string()),
        kill_switch: wants_mod,
    }
}

pub(crate) struct Preflight {
    gate: Option<Job<Result<(), String>>>,
    token: Option<Job<Result<Vec<String>, String>>>,
    pack_mod: Option<Job<(bool, bool)>>,
    mod_token: Option<Job<Option<String>>>,
    skin: Option<Job<Ygg>>,
    kill: Option<KillPrefetch>,
    /// What was started, for the plan of the launch.
    pub(crate) planned: Plan,
}

/// The skin server's job and the address it was started for.
pub(crate) type SkinJob = (String, Job<Ygg>);

impl Preflight {
    /// `yggdrasil`: the skin server of the account as far as it is known now. A Millida account
    /// whose session is still being issued names ours: the description is asked for at once, and
    /// thrown away if the session does not come.
    pub(crate) fn start(
        profile: &str,
        settings: &Value,
        pack: Option<&PackLaunch>,
        yggdrasil: &str,
        loader: &str,
    ) -> Preflight {
        let plan = plan(
            settings,
            pack.map(|p| (p.slug.as_str(), p.needs_token)),
            yggdrasil,
            loader,
            millida_mod_wanted(profile),
            &gate_recently_allowed,
        );
        let planned = plan.clone();
        Preflight {
            planned,
            gate: plan.gate.map(|slug| Job::spawn(async move { pack_launch_gate(&slug).await })),
            token: plan.token.map(|slug| Job::spawn(async move { pack_launch_token(&slug).await })),
            pack_mod: plan.pack_mod.map(|slug| {
                let profile = profile.to_string();
                Job::spawn(async move { pack_millida_mod(&profile, &slug).await })
            }),
            mod_token: plan.mod_token.then(|| Job::spawn(async { mod_session_token().await })),
            skin: plan.skin_server.map(|url| Job::spawn(prepare_skin_server(url))),
            kill: plan.kill_switch.then(KillPrefetch::start),
        }
    }

    #[cfg(test)]
    fn empty() -> Preflight {
        Preflight { gate: None, token: None, pack_mod: None, mod_token: None, skin: None, kill: None, planned: Plan::default() }
    }

    /// The access check, for a node of the launch graph to wait on.
    pub(crate) fn take_gate(&mut self) -> Option<Job<Result<(), String>>> {
        self.gate.take()
    }

    /// The paid pack's launch key.
    pub(crate) fn take_token(&mut self) -> Option<Job<Result<Vec<String>, String>>> {
        self.token.take()
    }

    /// The card of a catalogue build (does our mod go in).
    pub(crate) fn take_pack_mod(&mut self) -> Option<Job<(bool, bool)>> {
        self.pack_mod.take()
    }

    /// The skin server's description, with the address it was asked of.
    pub(crate) fn take_skin(&mut self) -> Option<SkinJob> {
        let url = self.planned.skin_server.clone()?;
        self.skin.take().map(|job| (url, job))
    }

    /// Whether the card of a catalogue build lets our mod in. The card is asked for from the start
    /// of the launch; if it has not answered by the time the launch needs the answer, the launch
    /// goes on with what the last launch stored and the request finishes in the background, so a
    /// change on the card reaches the build one launch later instead of holding this one.
    #[cfg(test)]
    pub(crate) async fn pack_mod(&mut self, profile: &str, slug: &str) -> (bool, bool) {
        pack_mod_answer(self.pack_mod.take(), profile, slug).await
    }

    pub(crate) async fn mod_token(&mut self) -> Option<String> {
        match self.mod_token.take() {
            Some(job) => match job.answer().await {
                Some(done) => done,
                None => mod_session_token().await,
            },
            None => mod_session_token().await,
        }
    }

    pub(crate) fn take_kill_prefetch(&mut self) -> KillPrefetch {
        self.kill.take().unwrap_or_else(KillPrefetch::none)
    }
}

/// The access check's verdict, for the node of the launch graph that carries it: an explicit
/// refusal fails the launch, even while the install is still going (the graph stops with its first
/// failure); a check that broke or did not answer lets it go — not knowing never costs a paying
/// player their game.
pub(crate) async fn gate_verdict(job: Job<Result<(), String>>) -> Result<(), String> {
    match job.answer().await {
        Some(Err(refusal)) => Err(refusal),
        _ => Ok(()),
    }
}

/// `Preflight::pack_mod` for a job taken out of it (a node of the launch graph).
pub(crate) async fn pack_mod_answer(job: Option<Job<(bool, bool)>>, profile: &str, slug: &str) -> (bool, bool) {
    let Some(mut job) = job else { return pack_millida_mod(profile, slug).await };
    if !job.finished() {
        let waited = super::launch_perf::detour("net", tokio::time::timeout(PACK_MOD_GRACE, job.done())).await;
        match waited {
            Ok(Some(done)) => return done,
            Ok(None) => return pack_millida_mod(profile, slug).await,
            Err(_) => {
                job.detach();
                let stored = profile_settings(profile);
                return (millida_mod_opt_in(None, &stored), stored[PACK_MILLIDA_MOD_KEY].as_bool().unwrap_or(false));
            }
        }
    }
    match job.done().await {
        Some(done) => done,
        None => pack_millida_mod(profile, slug).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    fn sample() -> Plan {
        Plan::default()
    }

    /// (settings, pack as (slug, needs key), skin server, loader, mod wanted) -> plan, why pinned
    #[test]
    #[allow(clippy::type_complexity)]
    fn the_plan_starts_exactly_the_checks_a_launch_needs() {
        let own = json!({"catalogPackSlug": "oneblock-metalabs"});
        let cases: Vec<(Value, Option<(&str, bool)>, &str, &str, bool, Plan, &str)> = vec![
            (
                json!({}),
                None,
                "",
                "vanilla",
                true,
                sample(),
                "a plain vanilla build with no account has nothing to check",
            ),
            (
                json!({}),
                None,
                "https://api.millida.net/v2/yggdrasil",
                "fabric",
                true,
                Plan {
                    skin_server: Some("https://api.millida.net/v2/yggdrasil".into()),
                    mod_token: true,
                    kill_switch: true,
                    ..sample()
                },
                "a modded build with a Millida account: skin server, mod token and the list",
            ),
            (
                json!({}),
                None,
                "",
                "fabric",
                false,
                sample(),
                "our mod switched off in settings: no token, no list",
            ),
            (
                own.clone(),
                None,
                "",
                "forge",
                true,
                Plan { gate: Some("oneblock-metalabs".into()), mod_token: true, kill_switch: true, ..sample() },
                "a catalogue build installed as an ordinary profile gets the access check",
            ),
            (
                own.clone(),
                Some(("oneblock-metalabs", true)),
                "",
                "fabric",
                true,
                Plan { token: Some("oneblock-metalabs".into()), pack_mod: Some("oneblock-metalabs".into()), ..sample() },
                "a paid pack takes its key instead of the access check, and our mod only if its card said yes before",
            ),
            (
                json!({"catalogPackSlug": "oneblock-metalabs", "catalogPackMillidaMod": true}),
                Some(("oneblock-metalabs", false)),
                "",
                "fabric",
                true,
                Plan {
                    gate: Some("oneblock-metalabs".into()),
                    pack_mod: Some("oneblock-metalabs".into()),
                    mod_token: true,
                    kill_switch: true,
                    ..sample()
                },
                "a free pack whose card opted into the mod last time",
            ),
            (
                json!({"catalogPackSlug": "../etc"}),
                None,
                "",
                "vanilla",
                true,
                sample(),
                "a slug that is not shaped like ours never reaches a request path",
            ),
        ];
        for (settings, pack, ygg, loader, wanted, want, why) in cases {
            assert_eq!(plan(&settings, pack, ygg, loader, wanted, &|_| false), want, "{why}");
        }
    }

    #[test]
    fn a_recent_yes_spares_the_access_check_of_a_catalogue_build() {
        let settings = json!({"catalogPackSlug": "oneblock-metalabs"});
        let asked = plan(&settings, None, "", "vanilla", false, &|_| false);
        assert_eq!(asked.gate.as_deref(), Some("oneblock-metalabs"));
        let spared = plan(&settings, None, "", "vanilla", false, &|slug| slug == "oneblock-metalabs");
        assert_eq!(spared.gate, None, "the same build, answered yes a minute ago, starts without the round trip");
        let other = plan(&settings, None, "", "vanilla", false, &|slug| slug == "another-pack");
        assert_eq!(other.gate.as_deref(), Some("oneblock-metalabs"), "another pack's yes is not this one's");
    }

    #[tokio::test]
    async fn a_card_that_answers_in_time_decides_and_a_slow_one_leaves_the_stored_answer() {
        let mut pre = Preflight::empty();
        pre.pack_mod = Some(Job::spawn(async { (true, false) }));
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(pre.pack_mod("perf-test-no-such-build", "slug").await, (true, false), "an answer that is already there is used");

        let mut pre = Preflight::empty();
        let finished = Arc::new(AtomicBool::new(false));
        let flag = finished.clone();
        pre.pack_mod = Some(Job::spawn(async move {
            tokio::time::sleep(Duration::from_millis(900)).await;
            flag.store(true, Ordering::Relaxed);
            (true, true)
        }));
        let started = std::time::Instant::now();
        let got = pre.pack_mod("perf-test-no-such-build", "slug").await;
        assert!(started.elapsed() < Duration::from_millis(800), "the launch does not wait out a slow card");
        assert_eq!(got, (false, false), "no answer stored for this build: the mod stays out");
        drop(pre);
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert!(finished.load(Ordering::Relaxed), "and the request still finishes, so the next launch knows");
    }

    #[tokio::test]
    async fn a_job_dropped_with_the_launch_is_stopped() {
        let ran_on = Arc::new(AtomicBool::new(false));
        let flag = ran_on.clone();
        let job = Job::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            flag.store(true, Ordering::Relaxed);
        });
        drop(job);
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert!(!ran_on.load(Ordering::Relaxed), "a check nobody will read does not keep running");
    }

    fn gate_after(ms: u64, verdict: Result<(), String>) -> Job<Result<(), String>> {
        Job::spawn(async move {
            tokio::time::sleep(Duration::from_millis(ms)).await;
            verdict
        })
    }

    /// The install and the access check as two nodes of the launch graph, waited for together the
    /// way the launch does.
    async fn launch_with(gate: Job<Result<(), String>>, work: impl Future<Output = Result<u32, String>> + Send + 'static) -> Result<u32, String> {
        use super::super::pipeline::graph::Graph;
        let mut g = Graph::new(None, None);
        let gate = g.spawn("gate", "net", None, gate_verdict(gate));
        let work = g.spawn("install", "libs", None, work);
        futures::future::try_join(work.get(), gate.get()).await.map(|(n, ())| n)
    }

    #[tokio::test]
    async fn a_refusal_stops_the_launch_even_while_the_install_is_still_running() {
        let started = std::time::Instant::now();
        let got = launch_with(gate_after(30, Err("доступ закрыт".into())), async {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok(1)
        })
        .await;
        assert_eq!(got, Err("доступ закрыт".into()));
        assert!(started.elapsed() < Duration::from_secs(3), "nobody downloads for minutes first");
    }

    #[tokio::test]
    async fn an_install_that_ends_first_still_hears_the_refusal_before_the_game() {
        let got = launch_with(gate_after(150, Err("доступ закрыт".into())), async { Ok(7) }).await;
        assert_eq!(got, Err("доступ закрыт".into()), "the refusal still stops the launch before the game");
    }

    #[tokio::test]
    async fn an_allowed_gate_or_a_dead_one_never_blocks() {
        let got = launch_with(gate_after(10, Ok(())), async {
            tokio::time::sleep(Duration::from_millis(80)).await;
            Ok(1)
        })
        .await;
        assert_eq!(got, Ok(1), "a gate that said yes in the middle lets the work finish");
        let got = launch_with(Job::spawn(async { panic!("the check itself broke") }), async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            Ok(2)
        })
        .await;
        assert_eq!(got, Ok(2), "not knowing never costs a paying player their game");
    }

    #[tokio::test]
    async fn an_error_of_the_install_is_returned_and_the_gate_is_not_awaited() {
        let started = std::time::Instant::now();
        let got = launch_with(gate_after(10_000, Ok(())), async { Err("нет сети".to_string()) }).await;
        assert_eq!(got, Err("нет сети".to_string()));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
}
