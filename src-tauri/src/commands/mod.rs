pub mod profiles;
pub mod content;
pub mod launch;
pub mod accounts;
pub mod hosting;
pub mod system;
pub mod overlay;

/// Disk sweeps, archive work and process spawns must not run on the event loop
/// thread: a synchronous command there freezes the window until it returns.
pub(crate) async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> T + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("фоновая задача прервалась: {e}"))
}
