// Uninstall report: the Windows uninstaller runs the launcher with --report-uninstall, and it sends only the install id to api.millida.net/v2/launcher/uninstall.
// Nothing is sent when usage statistics are turned off. The id is the same random UUID the telemetry already uses (see TELEMETRY.md).
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const REPORT_UNINSTALL_ARG: &str = "--report-uninstall";
const UNINSTALL_URL: &str = "https://api.millida.net/v2/launcher/uninstall";
/// The uninstaller waits for this process, and a person clicking "Uninstall"
/// must never sit behind a dead network.
const REPORT_BUDGET: Duration = Duration::from_secs(5);
const INSTALL_ID_MAX: usize = 64;

/// The install id lives in the webview's localStorage, which the uninstaller
/// cannot read, so the UI mirrors it here.
fn install_id_file() -> PathBuf {
    super::data_dir().join("install-id")
}

fn valid_install_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= INSTALL_ID_MAX && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn uninstall_report_requested() -> bool {
    std::env::args().skip(1).any(|a| a == REPORT_UNINSTALL_ARG)
}

pub fn remember_install_id(id: &str) -> Result<(), String> {
    remember_install_id_at(&install_id_file(), id)
}

fn remember_install_id_at(file: &Path, id: &str) -> Result<(), String> {
    if !valid_install_id(id) {
        return Err("Неверный идентификатор установки".into());
    }
    if std::fs::read_to_string(file).is_ok_and(|cur| cur == id) {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Идентификатор установки не сохранился: {}", e))?;
    }
    std::fs::write(file, id).map_err(|e| format!("Идентификатор установки не сохранился: {}", e))
}

/// The id the UI mirrored here; the core's own telemetry (process samples) uses it.
pub fn stored_install_id_value() -> Option<String> {
    stored_install_id(&install_id_file())
}

fn stored_install_id(file: &Path) -> Option<String> {
    let id = std::fs::read_to_string(file).ok()?;
    let id = id.trim();
    valid_install_id(id).then(|| id.to_string())
}

/// Best effort by design: the uninstall goes on whether the report lands or not,
/// and there is no window left to show a failure in.
pub fn report_uninstall() {
    if !super::game_telemetry_enabled() {
        return;
    }
    let Some(install_id) = stored_install_id(&install_id_file()) else { return };
    let body = serde_json::json!({ "installId": install_id });
    tauri::async_runtime::block_on(async move {
        let sent = super::client().post(UNINSTALL_URL).timeout(REPORT_BUDGET).json(&body).send().await;
        if let Err(e) = sent {
            eprintln!("uninstall report not sent: {}", super::net_err(&e));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_id_validation() {
        let cases: &[(&str, bool, &str)] = &[
            ("3f1c2a9e-7b4d-4e0a-9c1f-2b6d8e0a1c3f", true, "crypto.randomUUID, the normal case"),
            ("ilq8x2k9m3lq8x2k9m3", true, "the UI fallback id when randomUUID is missing"),
            ("", false, "an empty file must not be reported as an install"),
            ("../../etc/passwd", false, "the file is written from IPC, path pieces must not pass"),
            ("a b", false, "spaces mean the file was edited or corrupted"),
            (&"a".repeat(65), false, "the server column holds 64 characters"),
        ];
        for (id, expected, why) in cases {
            assert_eq!(valid_install_id(id), *expected, "install id {id:?}: {why}");
        }
    }

    #[test]
    fn remembered_id_is_read_back_and_bad_ids_are_refused() {
        let dir = std::env::temp_dir().join(format!("millida-uninstall-report-{}", std::process::id()));
        let file = dir.join("install-id");
        let id = "3f1c2a9e-7b4d-4e0a-9c1f-2b6d8e0a1c3f";
        remember_install_id_at(&file, id).expect("a valid id must be stored");
        assert_eq!(
            stored_install_id(&file).as_deref(),
            Some(id),
            "the uninstaller reads this file; if it differs from the UI id the uninstall lands on a ghost install"
        );
        assert!(
            remember_install_id_at(&file, "../x").is_err(),
            "an invalid id from the webview must be refused, not written"
        );
        assert_eq!(stored_install_id(&file).as_deref(), Some(id), "a refused write must keep the previous id");
        std::fs::remove_dir_all(&dir).ok();
    }
}
