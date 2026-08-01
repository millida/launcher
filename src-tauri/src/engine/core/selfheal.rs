use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use super::paths::{data_dir, is_flatpak, write_json_atomic};
use super::selfupdate::{fallback_latest, fallback_stage, is_newer, run_installer};

// Native recovery path: the normal updater runs inside the webview, so a broken
// webview leaves no way to update. The core watches for a startup signal from
// the frontend and, if it never arrives, fetches and verifies the signed
// manifest itself without any JS involved.

// Must exceed the slowest frontend boot: firing on a healthy launcher is worse
// than a missed recovery.
const BOOT_GRACE: Duration = Duration::from_secs(25);
const MAX_ATTEMPTS: u32 = 3;
const DOWNLOAD_PAGE: &str = "https://millida.net/launcher";
const DOWNLOAD_BUTTON: &str = "Скачать";

static FRONTEND_UP: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct HealState {
    version: String,
    attempts: u32,
    last: u64,
}

fn state_file() -> std::path::PathBuf {
    data_dir().join("selfheal.json")
}

fn load_state(version: &str) -> HealState {
    let st: HealState = std::fs::read_to_string(state_file())
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    // The counter is version-scoped: a new build starts from zero.
    if st.version == version {
        st
    } else {
        HealState { version: version.to_string(), ..Default::default() }
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Called once the frontend runs its own code; also resets the attempt counter.
pub fn mark_frontend_ready() {
    FRONTEND_UP.store(true, Ordering::SeqCst);
    let _ = std::fs::remove_file(state_file());
}

fn frontend_ready() -> bool {
    FRONTEND_UP.load(Ordering::SeqCst)
}

pub fn arm_selfheal(app: &AppHandle) {
    // Flatpak updates itself; in dev the frontend is served by Vite; autotests
    // never open the frontend at all.
    if is_flatpak() || cfg!(debug_assertions) || std::env::var_os("MILLIDA_AUTOTEST").is_some() {
        return;
    }
    if std::env::var_os("MILLIDA_NO_SELFHEAL").is_some() {
        return;
    }
    #[cfg(target_os = "macos")]
    super::selfupdate::sweep_retired_bundles();

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BOOT_GRACE).await;
        if frontend_ready() {
            return;
        }
        match heal(&app).await {
            // The installer needs this process gone: otherwise it hits locked
            // files and on unix the new copy never starts.
            Ok(true) => app.exit(0),
            Ok(false) => {}
            Err(e) => offer_manual_download(&e).await,
        }
    });
}

async fn heal(app: &AppHandle) -> Result<bool, String> {
    let version = app.package_info().version.to_string();
    let mut st = load_state(&version);
    if st.attempts >= MAX_ATTEMPTS {
        return Err(format!(
            "лаунчер {} не запускается, и переустановка это не вылечила ({} попытки)",
            version, st.attempts
        ));
    }

    let upd = fallback_latest(app).await?.ok_or_else(|| "обновление недоступно".to_string())?;
    // Reinstalling the same version is allowed once: it repairs a corrupted
    // install but cannot fix a broken release.
    if !is_newer(&upd.version, &version) && st.attempts > 0 {
        return Err(format!("на сервере обновлений та же версия {}", upd.version));
    }

    // Persisted before installing so the next boot knows this attempt happened
    // even if the launcher fails to open again.
    st.attempts += 1;
    st.last = now();
    let _ = write_json_atomic(&state_file(), &st);

    let file = fallback_stage(app, &upd).await?;
    // The frontend may have come up while the download ran; never replace the
    // binary under a working session.
    if frontend_ready() {
        return Ok(false);
    }
    run_installer(&file)
}

/// Last resort when recovery failed: a native system dialog, since the webview
/// is exactly what is broken.
async fn offer_manual_download(reason: &str) {
    let text = format!(
        "Лаунчер не смог открыться и не сумел обновиться сам ({}).\n\nСкачай свежую версию с сайта и поставь поверх — сборки, миры и аккаунты останутся на месте.",
        reason
    );
    let answer = rfd::AsyncMessageDialog::new()
        .set_title("Millida Launcher")
        .set_description(&text)
        .set_level(rfd::MessageLevel::Error)
        .set_buttons(rfd::MessageButtons::OkCancelCustom(DOWNLOAD_BUTTON.into(), "Закрыть".into()))
        .show()
        .await;
    let go = match &answer {
        rfd::MessageDialogResult::Ok => true,
        rfd::MessageDialogResult::Custom(b) => b == DOWNLOAD_BUTTON,
        _ => false,
    };
    if go {
        let _ = crate::engine::open_external(DOWNLOAD_PAGE);
    }
}
