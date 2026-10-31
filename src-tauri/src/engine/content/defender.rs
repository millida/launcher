use std::path::Path;

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum AvVerdict {
    Clean,
    Threat(String),
    Unavailable(String),
}

const SCAN_LIMIT: std::time::Duration = std::time::Duration::from_secs(90);

/// MpCmdRun exit codes: 0 means nothing was found, 2 means a threat was found;
/// anything else is Defender being off, replaced by another antivirus, or failing.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn read_scan(code: Option<i32>, stdout: &str) -> AvVerdict {
    match code {
        Some(0) => AvVerdict::Clean,
        Some(2) => {
            let name = stdout
                .lines()
                .find_map(|l| {
                    let (key, value) = l.split_once(':')?;
                    (key.trim().eq_ignore_ascii_case("threat")).then(|| value.trim().to_string())
                })
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| "угроза без названия".into());
            AvVerdict::Threat(name)
        }
        Some(n) => AvVerdict::Unavailable(format!("Антивирус Windows не проверил файл (код {n})")),
        None => AvVerdict::Unavailable("Антивирус Windows не ответил вовремя".into()),
    }
}

#[cfg(windows)]
pub(crate) fn scan_file(path: &Path) -> AvVerdict {
    use crate::engine::{output_unless_stopped, quiet, Ran};
    let Some(root) = std::env::var_os("ProgramFiles") else {
        return AvVerdict::Unavailable("Антивирус Windows не найден".into());
    };
    let exe = Path::new(&root).join("Windows Defender").join("MpCmdRun.exe");
    if !exe.is_file() {
        return AvVerdict::Unavailable("Антивирус Windows не найден".into());
    }
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("-Scan").arg("-ScanType").arg("3").arg("-File").arg(path).arg("-DisableRemediation");
    quiet(&mut cmd);
    let deadline = std::time::Instant::now() + SCAN_LIMIT;
    match output_unless_stopped(&mut cmd, || std::time::Instant::now() > deadline) {
        Ok(Ran::Done(out)) => read_scan(out.status.code(), &String::from_utf8_lossy(&out.stdout)),
        Ok(Ran::Stopped) => read_scan(None, ""),
        Err(e) => AvVerdict::Unavailable(format!("Антивирус Windows не запустился: {e}")),
    }
}

#[cfg(not(windows))]
pub(crate) fn scan_file(_path: &Path) -> AvVerdict {
    let _ = SCAN_LIMIT;
    AvVerdict::Unavailable("Системный антивирус здесь не подключён".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_map_to_what_the_player_is_told() {
        let cases: [(Option<i32>, &str, AvVerdict, &str); 5] = [
            (Some(0), "", AvVerdict::Clean, "0 is a finished scan with nothing found"),
            (
                Some(2),
                "Scanning C:\\x.jar found 1 threats.\nThreat                  : Trojan:Java/Fractureiser.A\nResources               : 1 total",
                AvVerdict::Threat("Trojan:Java/Fractureiser.A".into()),
                "2 is a threat and its name must reach the player, not a bare 'dangerous'",
            ),
            (
                Some(2),
                "found 1 threats.",
                AvVerdict::Threat("угроза без названия".into()),
                "a threat without a parsable name is still a threat, never clean",
            ),
            (
                Some(-2147024893),
                "",
                AvVerdict::Unavailable("Антивирус Windows не проверил файл (код -2147024893)".into()),
                "Defender off or replaced by another antivirus must not read as clean",
            ),
            (None, "", AvVerdict::Unavailable("Антивирус Windows не ответил вовремя".into()), "a timed-out scan is not a clean scan"),
        ];
        for (code, out, want, why) in cases {
            assert_eq!(read_scan(code, out), want, "{why}");
        }
    }
}
