#![cfg_attr(windows, windows_subsystem = "windows")]

mod install;
mod manifest;
#[cfg(windows)]
mod ui;

#[cfg(not(windows))]
fn main() {
    eprintln!("Установщик Millida Launcher работает только на Windows");
    std::process::exit(1);
}

#[cfg(windows)]
fn main() {
    let lock = single_instance();
    if matches!(lock, Instance::AlreadyRunning) {
        ui::raise_existing();
        return;
    }
    install::sweep_stale();

    let outcome = ui::run(|report| {
        let workspace = install::Workspace::create()?;
        let client = install::client()?;

        report.status("Ищем последнюю версию…");
        let build = install::fetch_build(&client)?;

        report.status(format!("Скачиваем Millida Launcher {}…", build.version));
        let payload = workspace.file("millida-launcher-setup.exe");
        install::download(&client, &build.url, &payload, |done, total| report.progress(done, total))?;

        report.status("Проверяем подпись…");
        install::verify(&payload, &build.signature)?;

        report.status("Устанавливаем…");
        install::run_installer(&payload, workspace.path())
    });

    match outcome {
        Some(Ok(())) => {}
        Some(Err(reason)) => {
            ui::fail(&format!(
                "Не удалось установить Millida Launcher.\n\n{}\n\nПроверьте подключение к интернету и антивирус, затем запустите установщик ещё раз. \
Если не помогает — скачайте полный установщик на странице millida.net/launcher.",
                reason
            ));
            std::process::exit(1);
        }
        // The window was closed before the work finished. Quietly, but not a success.
        None => std::process::exit(1),
    }
}

#[cfg(windows)]
enum Instance {
    Held(#[allow(dead_code)] InstanceLock),
    AlreadyRunning,
    Unknown,
}

#[cfg(windows)]
struct InstanceLock(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl Drop for InstanceLock {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

/// Two copies would race over the same temporary files and hand two installers
/// to NSIS at once. A mutex that could not be created at all is not a second
/// copy: refusing to start there would look like the installer doing nothing.
#[cfg(windows)]
fn single_instance() -> Instance {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::System::Threading::CreateMutexW;

    let name = ui::wide("Local\\MillidaLauncherSetup");
    let handle = unsafe { CreateMutexW(std::ptr::null(), 1, name.as_ptr()) };
    if handle.is_null() {
        return Instance::Unknown;
    }
    if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        unsafe { CloseHandle(handle) };
        return Instance::AlreadyRunning;
    }
    Instance::Held(InstanceLock(handle))
}
