// The Prepare step as a graph of tasks. Every node is its own tokio task in one JoinSet and starts
// at once; a node that needs another one's answer awaits it inside (Java waits for the version
// description, a Forge installer for Java, the client and the libraries), the rest run side by
// side. The first failure stops the launch: whoever waits for the failed node hears its error, and
// dropping the graph aborts what is still running. Each node is timed on its own and counts its own
// downloaded bytes, and its progress is one lane of the launch's progress bar (progress.rs).
use super::progress::{Board, Lane};
use crate::engine::*;
use futures::future::{BoxFuture, FutureExt, Shared};
use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Answer<T> = Shared<BoxFuture<'static, Result<T, String>>>;

tokio::task_local! {
    /// When the node in this task started its own work (after the answers it waits for).
    static WORK: Arc<Mutex<Option<Instant>>>;
}

/// Marks the start of a node's own work: what it spent waiting for other nodes before this is
/// not its time. A node that never calls it is timed from its start.
pub(crate) fn work_begins() {
    let _ = WORK.try_with(|w| {
        let mut w = w.lock().unwrap_or_else(|e| e.into_inner());
        if w.is_none() {
            *w = Some(Instant::now());
        }
    });
}

/// The answer of one node. Cloning shares the same answer; waiting for it twice costs nothing.
#[derive(Clone)]
pub(crate) struct Node<T: Clone> {
    out: Answer<T>,
}

impl<T: Clone + Send + Sync + 'static> Node<T> {
    pub(crate) async fn get(&self) -> Result<T, String> {
        self.out.clone().await
    }

    /// A node that already has its answer (a prepared plan, a value the caller had).
    pub(crate) fn ready(value: T) -> Node<T> {
        Node { out: futures::future::ready(Ok(value)).boxed().shared() }
    }

    /// A node that is not a task of its own: `fut` runs in whoever waits for it first (putting the
    /// answers of other nodes together).
    pub(crate) fn from_future<F>(fut: F) -> Node<T>
    where
        F: Future<Output = Result<T, String>> + Send + 'static,
    {
        Node { out: fut.boxed().shared() }
    }

    /// The answer if the node is done, without waiting.
    #[cfg(test)]
    pub(crate) fn peek(&self) -> Option<Result<T, String>> {
        self.out.peek().cloned()
    }
}

/// How one node went, for the launch's timings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Done {
    pub name: &'static str,
    pub stage: &'static str,
    /// From the start of the graph.
    pub began_ms: u64,
    pub ended_ms: u64,
    pub bytes: u64,
    pub ok: bool,
}

#[derive(Default)]
struct Log {
    done: Vec<Done>,
}

pub(crate) struct Graph {
    tasks: tokio::task::JoinSet<()>,
    born: Instant,
    log: Arc<Mutex<Log>>,
    board: Option<Arc<Board>>,
    perf: Option<super::super::launch_perf::LaunchPerf>,
    /// Every node speaks into a lane whose bar goes nowhere: work the window must not hear of.
    silent: bool,
}

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Graph {
    /// `board` draws the progress of the nodes as one bar; `perf` gets each node's time and bytes.
    pub(crate) fn new(board: Option<Arc<Board>>, perf: Option<super::super::launch_perf::LaunchPerf>) -> Graph {
        Graph { tasks: tokio::task::JoinSet::new(), born: Instant::now(), log: Arc::default(), board, perf, silent: false }
    }

    /// A graph whose progress messages reach no window (the lobby preparing a build: a launch
    /// started meanwhile must not show its words).
    pub(crate) fn silent() -> Graph {
        let board = Board::new(Arc::new(|_: &str, _: f32, _: &str| {}), 0.0, 100.0);
        Graph { silent: true, ..Graph::new(Some(board), None) }
    }

    /// Starts `fut` as node `name`. Its time goes to the telemetry `stage`; `lane` is the range of
    /// the old progress numbers this work used to report in (for example 15-45 for the
    /// libraries), so that its own progress messages become its share of the bar.
    pub(crate) fn spawn<T, F>(&mut self, name: &'static str, stage: &'static str, lane: Option<(f32, f32)>, fut: F) -> Node<T>
    where
        T: Clone + Send + Sync + 'static,
        F: Future<Output = Result<T, String>> + Send + 'static,
    {
        let (tx, rx) = tokio::sync::oneshot::channel::<Result<T, String>>();
        let lane: Option<Lane> = match (&self.board, lane) {
            (Some(board), Some(range)) => Some(board.lane(range)),
            (Some(board), None) if self.silent => Some(board.lane((0.0, 100.0))),
            _ => None,
        };
        let log = self.log.clone();
        let perf = self.perf.clone();
        let born = self.born;
        let task = async move {
            let spawned = Instant::now();
            let mark: Arc<Mutex<Option<Instant>>> = Arc::default();
            let meter = Arc::new(AtomicU64::new(0));
            let work = WORK.scope(mark.clone(), metered(meter.clone(), fut));
            let out = match &lane {
                Some(l) => l.clone().run(work).await,
                None => work.await,
            };
            let ended = born.elapsed();
            let own = (*mark.lock().unwrap_or_else(|e| e.into_inner())).unwrap_or(spawned);
            let began = own.saturating_duration_since(born);
            let bytes = meter.load(Ordering::Relaxed);
            if let Some(l) = &lane {
                l.finish();
            }
            if let Some(p) = &perf {
                p.add(stage, ended.saturating_sub(began), bytes);
            }
            locked(&log).done.push(Done { name, stage, began_ms: ms(began), ended_ms: ms(ended), bytes, ok: out.is_ok() });
            let _ = tx.send(out);
        };
        // The node belongs to the launch running here: it sees the same cancel flag.
        self.tasks.spawn(carry_launch(task));
        // No answer at all: the step was stopped with the launch, or it broke.
        let out = async move {
            rx.await.unwrap_or_else(|_| {
                if !cancelled() {
                    eprintln!("[launch] step {} ended without an answer", name);
                }
                Err(if cancelled() { LAUNCH_CANCELLED.to_string() } else { "Нет ответа — попробуй ещё раз".to_string() })
            })
        }
        .boxed()
        .shared();
        Node { out }
    }

    /// The nodes that finished, in the order they did.
    pub(crate) fn done(&self) -> Vec<Done> {
        let mut d = locked(&self.log).done.clone();
        d.sort_by_key(|x| x.ended_ms);
        d
    }

    /// Time since the graph was made.
    pub(crate) fn elapsed(&self) -> Duration {
        self.born.elapsed()
    }
}

fn ms(d: Duration) -> u64 {
    d.as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    /// Two independent half-second nodes and a third that needs both take about a second when they
    /// overlap, and about a second and a half one after another: the graph must give the first.
    #[tokio::test]
    async fn independent_nodes_overlap_and_a_dependent_one_waits_for_both() {
        let mut g = Graph::new(None, None);
        let a: Node<u32> = g.spawn("a", "libs", None, async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            Ok(1)
        });
        let b: Node<u32> = g.spawn("b", "assets", None, async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            Ok(2)
        });
        let (a2, b2) = (a.clone(), b.clone());
        let c: Node<u32> = g.spawn("c", "loader", None, async move {
            let x = a2.get().await?;
            let y = b2.get().await?;
            tokio::time::sleep(Duration::from_millis(100)).await;
            Ok(x + y)
        });
        let t = Instant::now();
        assert_eq!(c.get().await, Ok(3));
        let took = t.elapsed();
        assert!(took < Duration::from_millis(580), "a and b ran side by side: {took:?}");
        assert!(took >= Duration::from_millis(400), "c waited for them: {took:?}");
        let done = g.done();
        assert_eq!(done.last().map(|d| d.name), Some("c"), "{done:?}");
        // Waiting for an answer twice does not run the node twice.
        assert_eq!(a.get().await, Ok(1));
    }

    /// The first failure is what the launch hears, and a node still going is stopped with the graph.
    #[tokio::test]
    async fn a_failure_reaches_the_waiters_and_the_rest_is_stopped_with_the_graph() {
        let finished = Arc::new(AtomicUsize::new(0));
        let mut g = Graph::new(None, None);
        let f = finished.clone();
        let slow: Node<()> = g.spawn("slow", "assets", None, async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            f.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        let bad: Node<()> = g.spawn("bad", "client", None, async { Err::<(), String>("клиент не скачался".into()) });
        let b2 = bad.clone();
        let after: Node<()> = g.spawn("after", "loader", None, async move { b2.get().await });
        let both = futures::future::try_join(slow.get(), after.get()).await;
        assert_eq!(both, Err("клиент не скачался".to_string()));
        drop(g);
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(finished.load(Ordering::SeqCst), 0, "the slow node was aborted with the graph");
        assert!(matches!(slow.peek(), Some(Err(_)) | None), "and never reports success");
    }

    /// A node is timed from where its own work begins, not from when it started waiting for the
    /// answers it needs: the libraries do not get the version description's time.
    #[tokio::test]
    async fn a_node_waiting_for_another_is_not_charged_for_the_wait() {
        let perf = super::super::super::launch_perf::LaunchPerf::new(0);
        let mut g = Graph::new(None, Some(perf.clone()));
        let meta: Node<()> = g.spawn("meta", "client", None, async {
            tokio::time::sleep(Duration::from_millis(250)).await;
            Ok(())
        });
        let m = meta.clone();
        let libs: Node<()> = g.spawn("libs", "libs", None, async move {
            m.get().await?;
            work_begins();
            tokio::time::sleep(Duration::from_millis(50)).await;
            Ok(())
        });
        libs.get().await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        let libs_ms = perf.snapshot().get("libs").map(|s| s.ms).unwrap_or(0);
        assert!((40..200).contains(&libs_ms), "the libraries' own 50 ms, not the 300 ms of waiting: {libs_ms}");
    }

    /// The lobby's preparation runs in a silent graph: what its steps say never reaches the window.
    #[tokio::test]
    async fn a_silent_graph_keeps_its_steps_quiet() {
        let mut g = Graph::silent();
        let said: Node<bool> = g.spawn("meta", "client", None, async { Ok(super::super::progress::lane_emit("files", 5.0, "Читаем манифест версий…")) });
        assert_eq!(said.get().await, Ok(true), "taken by a lane that goes nowhere");
        let mut g = Graph::new(None, None);
        let said: Node<bool> = g.spawn("meta", "client", None, async { Ok(super::super::progress::lane_emit("files", 5.0, "x")) });
        assert_eq!(said.get().await, Ok(false), "a launch's own step without a lane speaks to the window as before");
    }

    /// Every node counts the bytes it downloaded itself, even while others download next to it.
    #[tokio::test]
    async fn each_node_counts_its_own_bytes() {
        let mut g = Graph::new(None, None);
        let a: Node<()> = g.spawn("a", "libs", None, async {
            for _ in 0..3 {
                count_downloaded(1000);
                tokio::task::yield_now().await;
            }
            Ok(())
        });
        let b: Node<()> = g.spawn("b", "assets", None, async {
            for _ in 0..5 {
                count_downloaded(10);
                tokio::task::yield_now().await;
            }
            Ok(())
        });
        let _ = futures::future::try_join(a.get(), b.get()).await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        let done = g.done();
        let bytes = |n: &str| done.iter().find(|d| d.name == n).map(|d| d.bytes);
        assert_eq!(bytes("a"), Some(3000));
        assert_eq!(bytes("b"), Some(50));
    }

    /// Mock HTTP: a client jar and a library from a local server, named by a version description
    /// node. Both are fetched side by side once the description is there, checked by their sha1 and
    /// put into a temporary folder; a file that fails its sum fails its node.
    #[tokio::test]
    async fn the_install_nodes_fetch_side_by_side_from_a_mock_server() {
        use sha1::{Digest, Sha1};
        let client = vec![7u8; 64 * 1024];
        let library = vec![9u8; 48 * 1024];
        let sum = |b: &[u8]| format!("{:x}", Sha1::digest(b));
        let server = mock::Server::start(vec![
            ("/client.jar", client.clone(), Duration::from_millis(250)),
            ("/lib.jar", library.clone(), Duration::from_millis(250)),
            ("/bad.jar", vec![1u8; 100], Duration::ZERO),
        ])
        .await;
        let dir = std::env::temp_dir().join(format!("millida-graph-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let version = serde_json::json!({
            "client": {"url": server.url("/client.jar"), "sha1": sum(&client), "size": client.len()},
            "lib": {"url": server.url("/lib.jar"), "sha1": sum(&library), "size": library.len()},
        });

        let mut g = Graph::new(None, None);
        let meta: Node<Arc<serde_json::Value>> = Node::ready(Arc::new(version));
        let fetch = |g: &mut Graph, name: &'static str, key: &'static str, dest: std::path::PathBuf| {
            let meta = meta.clone();
            g.spawn(name, "libs", None, async move {
                let v = meta.get().await?;
                let f = &v[key];
                // download_checked, not download_verify: the latter shares files through the
                // player's own store, which a test must not touch.
                download_checked(f["url"].as_str().unwrap(), &dest, f["sha1"].as_str().map(Sum::Sha1), f["size"].as_u64()).await
            })
        };
        let a: Node<()> = fetch(&mut g, "client", "client", dir.join("client.jar"));
        let b: Node<()> = fetch(&mut g, "lib", "lib", dir.join("lib.jar"));
        let t = Instant::now();
        futures::future::try_join(a.get(), b.get()).await.expect("both files arrive");
        assert!(t.elapsed() < Duration::from_millis(480), "the two downloads overlapped: {:?}", t.elapsed());
        assert_eq!(std::fs::read(dir.join("client.jar")).unwrap(), client);
        assert_eq!(std::fs::read(dir.join("lib.jar")).unwrap(), library);
        let done = g.done();
        assert!(done.iter().all(|d| d.ok), "{done:?}");
        assert!(done.iter().map(|d| d.bytes).sum::<u64>() >= (client.len() + library.len()) as u64, "{done:?}");

        let mut g = Graph::new(None, None);
        let url = server.url("/bad.jar");
        let dest = dir.join("bad.jar");
        let wrong = "0".repeat(40);
        let bad: Node<()> = g.spawn("bad", "libs", None, async move { download_checked(&url, &dest, Some(Sum::Sha1(&wrong)), Some(100)).await });
        assert!(bad.get().await.is_err(), "a file that fails its sum fails the node");
        let _ = std::fs::remove_dir_all(&dir);
    }

    pub(super) mod mock {
        use std::time::Duration;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        /// A tiny HTTP server: fixed bodies by path, each after its own delay.
        pub(crate) struct Server {
            addr: std::net::SocketAddr,
        }

        impl Server {
            pub(crate) async fn start(routes: Vec<(&'static str, Vec<u8>, Duration)>) -> Server {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let addr = listener.local_addr().unwrap();
                let routes = std::sync::Arc::new(routes);
                tokio::spawn(async move {
                    loop {
                        let Ok((mut sock, _)) = listener.accept().await else { return };
                        let routes = routes.clone();
                        tokio::spawn(async move {
                            let mut buf = vec![0u8; 4096];
                            let n = sock.read(&mut buf).await.unwrap_or(0);
                            let head = String::from_utf8_lossy(&buf[..n]).to_string();
                            let path = head.split_whitespace().nth(1).unwrap_or("/").to_string();
                            let route = routes.iter().find(|(p, _, _)| *p == path);
                            let Some((_, body, delay)) = route else {
                                let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                                return;
                            };
                            tokio::time::sleep(*delay).await;
                            let head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                            let _ = sock.write_all(head.as_bytes()).await;
                            let _ = sock.write_all(body).await;
                            let _ = sock.shutdown().await;
                        });
                    }
                });
                Server { addr }
            }

            pub(crate) fn url(&self, path: &str) -> String {
                format!("http://{}{}", self.addr, path)
            }
        }
    }
}
