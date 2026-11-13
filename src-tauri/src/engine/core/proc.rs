// Child processes: hides the black console window on Windows, and runs a child that has to stop when the launch is cancelled.
use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::time::Duration;

/// On Windows every `Command::new` pops up a console window without
/// CREATE_NO_WINDOW.
pub(crate) fn quiet(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// The AppImage runtime points LD_LIBRARY_PATH, PATH, GTK and GStreamer paths
/// into its own mount, which holds Ubuntu 22.04 libraries such as readline 8.1.
/// A host program started with them (gamemoderun and other wrappers are bash
/// scripts) loads those instead of its own and dies before running, e.g. Arch's
/// bash with "undefined symbol: rl_trim_arg_from_keyseq".
fn appimage_leftovers(appdir: &str, vars: impl IntoIterator<Item = (String, String)>) -> Vec<(String, Option<String>)> {
    let root = appdir.trim_end_matches('/');
    if root.is_empty() {
        return Vec::new();
    }
    let mount_prefix = format!("{root}/");
    let inside = |entry: &str| entry == root || entry.starts_with(&mount_prefix);
    vars.into_iter()
        .filter(|(_, value)| value.split(':').any(inside))
        .map(|(name, value)| {
            let host: Vec<&str> = value.split(':').filter(|entry| !entry.is_empty() && !inside(entry)).collect();
            let restored = (!host.is_empty()).then(|| host.join(":"));
            (name, restored)
        })
        .collect()
}

pub(crate) fn outside_appimage(cmd: &mut Command) -> &mut Command {
    if !cfg!(target_os = "linux") {
        return cmd;
    }
    let Ok(appdir) = std::env::var("APPDIR") else { return cmd };
    let vars = std::env::vars_os().filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)));
    for (name, restored) in appimage_leftovers(&appdir, vars) {
        match restored {
            Some(value) => cmd.env(name, value),
            None => cmd.env_remove(name),
        };
    }
    cmd
}

/// How a child that may be told to stop ended.
#[derive(Debug)]
pub(crate) enum Ran {
    Done(Output),
    /// `stopped()` said so: the child (and, where the system allows, what it started) was killed and reaped.
    Stopped,
}

const WATCH_EVERY: Duration = Duration::from_millis(100);

/// Ends the child and what it started. A loader installer starts a JVM per processor; killing only the installer would
/// leave the one that is writing the libraries running under the next launch.
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &child.id().to_string(), "/T", "/F"]);
        quiet(&mut cmd);
        let _ = cmd.stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// `Command::output`, except that it looks every 100 ms whether it should stop waiting: then the child is killed and
/// reaped before this returns, so nothing of it is left writing to the folders the next start will use.
pub(crate) fn output_unless_stopped(cmd: &mut Command, stopped: impl Fn() -> bool) -> std::io::Result<Ran> {
    let mut child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let err = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if stopped() {
            kill_tree(&mut child);
            break None;
        }
        std::thread::sleep(WATCH_EVERY);
    };
    let (stdout, stderr) = (out.join().unwrap_or_default(), err.join().unwrap_or_default());
    Ok(match status {
        Some(status) => Ran::Done(Output { status, stdout, stderr }),
        None => Ran::Stopped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;

    /// A command that sits for half a minute unless somebody ends it.
    fn long_sleep() -> Command {
        if cfg!(windows) {
            let mut c = Command::new("ping");
            c.args(["-n", "30", "127.0.0.1"]);
            c
        } else {
            let mut c = Command::new("sleep");
            c.arg("30");
            c
        }
    }

    /// A cancel ends the wait within a moment: the child is killed, not waited out, and nothing is left behind.
    #[test]
    fn a_stop_kills_the_child_instead_of_waiting_for_it() {
        let stop = AtomicBool::new(false);
        let began = Instant::now();
        let ran = std::thread::scope(|s| {
            s.spawn(|| {
                std::thread::sleep(Duration::from_millis(250));
                stop.store(true, Ordering::SeqCst);
            });
            output_unless_stopped(&mut long_sleep(), || stop.load(Ordering::SeqCst))
        })
        .expect("the command starts");
        assert!(matches!(ran, Ran::Stopped), "a stopped child gives no output: {ran:?}");
        assert!(began.elapsed() < Duration::from_secs(10), "it took {:?}: the child was waited for", began.elapsed());
    }

    fn leftovers(appdir: &str, vars: &[(&str, &str)]) -> Vec<(String, Option<String>)> {
        appimage_leftovers(appdir, vars.iter().map(|(k, v)| (k.to_string(), v.to_string())))
    }

    #[test]
    fn host_programs_get_the_environment_without_the_appimage_mount() {
        let mount = "/tmp/.mount_MillidAbC";
        let got = leftovers(
            mount,
            &[
                ("LD_LIBRARY_PATH", "/tmp/.mount_MillidAbC/usr/lib/:/tmp/.mount_MillidAbC/lib64/:"),
                ("PATH", "/tmp/.mount_MillidAbC/usr/bin/:/usr/local/bin:/usr/bin"),
                ("XDG_DATA_DIRS", "/tmp/.mount_MillidAbC/usr/share:/usr/share:/usr/local/share"),
                ("GST_PLUGIN_SCANNER_1_0", "/tmp/.mount_MillidAbC/usr/lib/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"),
                ("APPDIR", mount),
                ("APPIMAGE", "/home/p/Apps/Millida-Launcher.AppImage"),
                ("HOME", "/home/p"),
                ("MANPATH", "/tmp/.mount_MillidAbCdef/share"),
            ],
        );
        let want: Vec<(String, Option<String>)> = vec![
            ("LD_LIBRARY_PATH".into(), None),
            ("PATH".into(), Some("/usr/local/bin:/usr/bin".into())),
            ("XDG_DATA_DIRS".into(), Some("/usr/share:/usr/local/share".into())),
            ("GST_PLUGIN_SCANNER_1_0".into(), None),
            ("APPDIR".into(), None),
        ];
        assert_eq!(got, want);
    }

    #[test]
    fn nothing_changes_without_a_mount() {
        assert!(leftovers("", &[("PATH", "/usr/bin")]).is_empty());
        assert!(leftovers("/", &[("PATH", "/usr/bin")]).is_empty());
    }

    /// Without a stop it is the usual `output`: exit status and both streams.
    #[test]
    fn without_a_stop_the_output_is_the_childs() {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.args(["/C", "echo hello"]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", "echo hello; echo oops >&2; exit 3"]);
            c
        };
        match output_unless_stopped(&mut cmd, || false).expect("the command starts") {
            Ran::Done(out) => {
                assert!(String::from_utf8_lossy(&out.stdout).contains("hello"));
                if !cfg!(windows) {
                    assert_eq!(out.status.code(), Some(3));
                    assert!(String::from_utf8_lossy(&out.stderr).contains("oops"));
                }
            }
            Ran::Stopped => panic!("nothing asked to stop"),
        }
    }
}
