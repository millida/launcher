// System notifications from the core, for when there is no window to show a toast in.
// Windows: a regular toast under the app's own AppUserModelID (the NSIS installer puts it
// on the Start menu shortcut). Other systems: nothing yet. No network, no disk.

/// The installer stamps the bundle identifier on the shortcuts as their AppUserModelID.
#[cfg(target_os = "windows")]
const AUMID: &str = "net.millida.launcher";

/// A toast under an id that has no Start menu shortcut (a portable or winget install, a deleted
/// shortcut) is dropped silently. Registering the id with a display name under the user's own
/// classes makes Windows accept toasts for it without a shortcut. Written at most once per run,
/// into HKCU only; the installer's shortcut keeps working as before.
#[cfg(target_os = "windows")]
fn register_aumid() {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let key = windows_registry::CURRENT_USER.create(format!(r"Software\Classes\AppUserModelId\{AUMID}"));
        if let Err(e) = key.and_then(|k| k.set_string("DisplayName", "Millida Launcher")) {
            eprintln!("[notify] the notification id was not registered: {e}");
        }
    });
}

#[cfg(any(target_os = "windows", test))]
fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

#[cfg(any(target_os = "windows", test))]
fn toast_xml(title: &str, body: &str) -> String {
    format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        escape(title),
        escape(body)
    )
}

#[cfg(target_os = "windows")]
pub fn show(title: &str, body: &str) {
    let xml = toast_xml(title, body);
    register_aumid();
    // WinRT needs an initialized apartment; a short-lived thread of its own keeps
    // the async runtime's threads untouched.
    std::thread::spawn(move || {
        use windows::core::HSTRING;
        use windows::Data::Xml::Dom::XmlDocument;
        use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        // unsafe: COM apartment for this thread only.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let shown = (|| -> windows::core::Result<()> {
            let doc = XmlDocument::new()?;
            doc.LoadXml(&HSTRING::from(xml.as_str()))?;
            let toast = ToastNotification::CreateToastNotification(&doc)?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))?.Show(&toast)
        })();
        if let Err(e) = shown {
            eprintln!("[notify] toast was not shown: {e}");
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn show(_title: &str, _body: &str) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toast_text_cannot_break_the_xml() {
        let xml = toast_xml("Версия <2.0> & «новая»", "a\"b'c");
        assert!(xml.contains("Версия &lt;2.0&gt; &amp; «новая»"), "текст из сети не должен ломать разметку уведомления");
        assert!(xml.contains("a&quot;b&apos;c"));
    }
}
