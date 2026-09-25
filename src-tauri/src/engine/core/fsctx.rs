//! Ошибки файловой системы с контекстом и повторы для Windows.
//!
//! Голое «Отказано в доступе. (os error 5)» пришло от 177 игроков за две недели
//! (телеметрия 25.09.2026), и по нему не понять, что именно не дали: папку
//! Java, лог, файл версии. Здесь к ошибке приклеивается этап и путь — с домашней
//! папкой, свёрнутой в `~`, чтобы в телеметрию не уезжало имя пользователя.

use std::path::Path;
use std::time::Duration;

/// Домашняя папка в тексте заменяется на `~` во всех трёх написаниях: как есть,
/// с прямыми и с обратными слэшами.
pub(crate) fn mask_home_in(text: &str, home: Option<&str>) -> String {
    let mut out = text.to_string();
    if let Some(h) = home.map(|h| h.trim_end_matches(['/', '\\'])).filter(|h| h.len() > 1) {
        let mut variants = vec![h.to_string(), h.replace('\\', "/"), h.replace('/', "\\")];
        variants.dedup();
        for v in variants {
            out = out.replace(&v, "~");
        }
    }
    out
}

pub(crate) fn mask_home(text: &str) -> String {
    let home = dirs::home_dir().map(|h| h.to_string_lossy().into_owned());
    mask_home_in(text, home.as_deref())
}

/// Ошибку держит чужой процесс: антивирус проверяет свежий файл, индексатор
/// читает папку, запущенная игра держит свою Java.
pub(crate) fn is_locked_error(e: &std::io::Error) -> bool {
    matches!(e.raw_os_error(), Some(5) | Some(32) | Some(33) | Some(145))
        || e.kind() == std::io::ErrorKind::PermissionDenied
        || e.kind() == std::io::ErrorKind::DirectoryNotEmpty
}

/// «Этап: причина — путь». Причина первой: телеметрия хранит 120 символов, и
/// длинный путь в начале съедал бы самое важное.
pub(crate) fn io_fail(stage: &str, path: &Path, e: &std::io::Error) -> String {
    let hint = if cfg!(target_os = "windows") && is_locked_error(e) {
        " (файл занят или заблокирован — закрой игру и добавь папку лаунчера в исключения антивируса)"
    } else {
        ""
    };
    format!("{}: {} — {}{}", stage, e, mask_home(&path.to_string_lossy()), hint)
}

/// Паузы между попытками: антивирус отпускает свежераспакованные файлы за
/// доли секунды, индексатор — за пару секунд.
const RETRY_PAUSES_MS: [u64; 4] = [150, 400, 1000, 2000];

/// Удаляет папку целиком, повторяя, пока её держат. `true` — папки больше нет.
pub(crate) async fn remove_dir_retrying(dir: &Path) -> bool {
    for pause in std::iter::once(0).chain(RETRY_PAUSES_MS) {
        if pause > 0 {
            tokio::time::sleep(Duration::from_millis(pause)).await;
        }
        match std::fs::remove_dir_all(dir) {
            Ok(()) => return true,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return true,
            Err(_) => {}
        }
    }
    !dir.exists()
}

/// Переименование с повторами: на Windows оно отказывает, пока хоть один файл
/// внутри открыт чужим процессом.
pub(crate) async fn rename_retrying(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut last = None;
    for pause in std::iter::once(0).chain(RETRY_PAUSES_MS) {
        if pause > 0 {
            tokio::time::sleep(Duration::from_millis(pause)).await;
        }
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if is_locked_error(&e) => last = Some(e),
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap_or_else(|| std::io::Error::other("rename failed")))
}

/// Короткая метка для имени временной папки: pid + наносекунды + счётчик.
pub(crate) fn unique_tag() -> String {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!("{:x}{:x}{:x}", std::process::id(), t, n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn home_is_masked_in_every_spelling() {
        let home = Some("C:\\Users\\Иван");
        for (raw, want) in [
            ("C:\\Users\\Иван\\AppData\\x", "~\\AppData\\x"),
            ("C:/Users/Иван/AppData/x", "~/AppData/x"),
            ("D:\\Games\\x", "D:\\Games\\x"),
        ] {
            assert_eq!(mask_home_in(raw, home), want, "{raw}: имя пользователя не должно уйти в телеметрию");
        }
        assert_eq!(mask_home_in("/", Some("/")), "/", "корень как домашняя папка не маскирует весь текст");
    }

    #[test]
    fn failure_names_stage_cause_and_path() {
        let e = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let home = dirs::home_dir().unwrap_or_default();
        let msg = io_fail("Лог запуска", &home.join("x").join("launcher-latest.log"), &e);
        assert!(msg.starts_with("Лог запуска: "), "этап идёт первым: {msg}");
        assert!(msg.contains("~"), "домашняя папка свёрнута: {msg}");
        assert!(!msg.contains(&*home.to_string_lossy()) || home.as_os_str().len() <= 1, "полный путь не утёк: {msg}");
    }

    #[tokio::test]
    async fn stale_dir_is_removed_and_renamed_into_place() {
        let root = std::env::temp_dir().join(format!("millida-fsctx-{}", unique_tag()));
        let from = root.join("a");
        let to = root.join("b");
        std::fs::create_dir_all(from.join("bin")).unwrap();
        std::fs::write(from.join("bin/x"), b"x").unwrap();
        rename_retrying(&from, &to).await.unwrap();
        assert!(to.join("bin/x").exists());
        assert!(remove_dir_retrying(&to).await);
        assert!(remove_dir_retrying(&to).await, "отсутствующая папка — это успех");
        let _ = std::fs::remove_dir_all(&root);
    }
}
