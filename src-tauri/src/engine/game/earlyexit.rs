// The game closed right after start: builds a clear message for the player and a short reason for the statistics.
// The home folder in the text is replaced with "~". Tokens are not cut out separately (a JVM log usually has none).
//! Игра вышла сразу после старта: что сказать игроку и что отправить в
//! телеметрию. Телеметрия хранит 120 символов, и в 1.0.115 их целиком съедали
//! строки `[authlib-injector] [INFO] Logging file: …` — настоящая причина
//! («Unrecognized option: -p») стояла ниже и не доезжала (25.09.2026).

use crate::engine::mask_home;
use std::path::{Path, PathBuf};

/// Убирает файл аргументов при любом выходе из запуска, в том числе по ошибке
/// и после повторного старта: в нём ключ подписи сборки.
pub(crate) struct ArgfileGuard(pub(crate) Option<PathBuf>);

impl Drop for ArgfileGuard {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            super::drop_argfile_later(p);
        }
    }
}

/// Сколько строк лога показываем под сводкой.
const TAIL_LINES: usize = 20;
/// Сколько ключевых строк ставим в сводку.
const KEY_LINES: usize = 2;

/// Шум, который JVM и агент печатают при каждом старте.
fn is_noise(line: &str) -> bool {
    let t = line.trim();
    if t.is_empty() || t == "#" {
        return true;
    }
    let low = t.to_ascii_lowercase();
    low.starts_with("[authlib-injector] [info]")
        || low.starts_with("[authlib-injector] [debug]")
        || low.starts_with("picked up java_tool_options")
        || low.starts_with("picked up _java_options")
}

const KEY_MARKERS: [&str; 10] = [
    "error",
    "exception",
    "unrecognized",
    "could not",
    "cannot",
    "failed",
    "fatal",
    "invalid",
    "not supported",
    "unsupported",
];

fn is_key(line: &str) -> bool {
    let low = line.to_ascii_lowercase();
    // «Error: Could not create the Java Virtual Machine.» и «A fatal exception
    // has occurred» — следствие, а не причина: они всегда идут следом.
    if low.contains("could not create the java virtual machine") || low.contains("a fatal exception has occurred") {
        return false;
    }
    KEY_MARKERS.iter().any(|m| low.contains(m))
}

/// Код выхода по-человечески. Отрицательный код на Windows — это NTSTATUS,
/// и в десятичном виде (-1073741819) его не узнать: 0xC0000005 узнают все.
pub(crate) fn exit_code_text(code: Option<i32>) -> (String, Option<&'static str>) {
    let Some(c) = code else { return ("без кода".into(), None) };
    if c >= 0 {
        return (c.to_string(), None);
    }
    let hex = format!("0x{:08X}", c as u32);
    let what = match c as u32 {
        0xC000_0005 => Some("нарушение доступа к памяти — обнови драйвер видеокарты и проверь, не мешает ли антивирус"),
        0xC000_0135 | 0xC000_007B => Some("не найдена системная библиотека — поставь Microsoft Visual C++ Redistributable"),
        0xC000_0142 => Some("библиотека не запустилась — перезагрузи компьютер и проверь антивирус"),
        0xC000_00FD => Some("переполнение стека"),
        0xC000_0409 => Some("аварийное завершение — обнови драйвер видеокарты"),
        0xC000_0017 | 0xC000_012D => Some("не хватило памяти — закрой лишние программы или уменьши память игре"),
        _ => None,
    };
    (hex, what)
}

/// Сводка первой строкой, полный хвост лога — ниже. Сводка: код и одна-две
/// строки с ошибкой; домашняя папка свёрнута в `~`.
pub(crate) fn early_exit_message(code: Option<i32>, log: &str) -> String {
    let lines: Vec<&str> = log.lines().filter(|l| !is_noise(l)).collect();
    let tail: Vec<&str> = lines.iter().rev().take(TAIL_LINES).rev().copied().collect();
    let mut key: Vec<&str> = vec![];
    for (i, l) in lines.iter().enumerate() {
        if key.len() >= KEY_LINES {
            break;
        }
        if !is_key(l) {
            continue;
        }
        key.push(l);
        // «Error occurred during initialization of VM» — только заголовок,
        // причина на следующей строке («Multiple garbage collectors selected»).
        if l.to_ascii_lowercase().contains("error occurred during initialization") {
            if let Some(next) = lines.get(i + 1).filter(|n| !is_key(n)) {
                key.push(next);
            }
        }
    }
    if key.is_empty() {
        key = tail.iter().rev().take(1).copied().collect();
    }
    let (code, what) = exit_code_text(code);
    let head = match what {
        Some(w) => format!("Игра не запустилась (код {} — {})", code, w),
        None => format!("Игра не запустилась (код {})", code),
    };
    let summary = key.iter().map(|l| l.trim()).collect::<Vec<_>>().join(" | ");
    let mut out = if summary.is_empty() { format!("{}.", head) } else { format!("{}: {}", head, summary) };
    if !tail.is_empty() {
        out.push('\n');
        out.push_str(&tail.join("\n"));
    }
    mask_home(&out)
}

/// Приметы рантайма, у которого не хватает частей: JVM даже не начинает
/// работу. Лечится только переустановкой Java.
pub(crate) fn broken_runtime(log: &str) -> bool {
    let low = log.to_ascii_lowercase();
    [
        "could not find java.dll",
        "could not find java se runtime environment",
        "error: missing `server' jvm",
        "error: could not open `",
        "error loading: ",
        "java/lang/noclassdeffounderror: java/lang/object",
        "failed setting boot class path",
    ]
    .iter()
    .any(|m| low.contains(m))
}

/// Файла Java нет: рантайм удалил антивирус или чистильщик — ставим заново.
pub(crate) fn spawn_missing(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::NotFound || matches!(e.raw_os_error(), Some(2) | Some(3))
}

/// Запуск запретили или файл занят: чаще всего антивирус проверяет java.exe,
/// и через пару секунд он его отпускает.
pub(crate) fn spawn_blocked(e: &std::io::Error) -> bool {
    e.kind() == std::io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5) | Some(32) | Some(225))
}

/// Resident engines by process name. Third-party products come first: Defender
/// keeps MsMpEng running in passive mode next to them, so it is named only alone.
const ANTIVIRUS_PROCESSES: [(&str, &str); 19] = [
    ("avp.exe", "Kaspersky"),
    ("avpui.exe", "Kaspersky"),
    ("ekrn.exe", "ESET"),
    ("avastsvc.exe", "Avast"),
    ("avgsvc.exe", "AVG"),
    ("bdservicehost.exe", "Bitdefender"),
    ("vsserv.exe", "Bitdefender"),
    ("mcshield.exe", "McAfee"),
    ("mfemms.exe", "McAfee"),
    ("nortonsecurity.exe", "Norton"),
    ("360tray.exe", "360 Total Security"),
    ("dwservice.exe", "Dr.Web"),
    ("spideragent.exe", "Dr.Web"),
    ("avguard.exe", "Avira"),
    ("sophoshealth.exe", "Sophos"),
    ("mbamservice.exe", "Malwarebytes"),
    ("psanhost.exe", "Panda"),
    ("coreserviceshell.exe", "Trend Micro"),
    ("msmpeng.exe", "Microsoft Defender"),
];

pub(crate) fn antivirus_from_processes<'a>(names: impl Iterator<Item = &'a str> + Clone) -> Option<&'static str> {
    ANTIVIRUS_PROCESSES.iter().find_map(|(exe, product)| {
        names.clone().any(|n| n.eq_ignore_ascii_case(exe)).then_some(*product)
    })
}

/// Which antivirus is running, to name it in the advice. Only asked on a failed start.
pub(crate) fn running_antivirus() -> Option<&'static str> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let names: Vec<String> = sys.processes().values().map(|p| p.name().to_string_lossy().into_owned()).collect();
    antivirus_from_processes(names.iter().map(String::as_str))
}

/// Error 225 is Windows saying the file was flagged as a virus, not a plain denial.
pub(crate) fn spawn_flagged_as_virus(e: &std::io::Error) -> bool {
    e.raw_os_error() == Some(225)
}

pub(crate) fn antivirus_hint(e: &std::io::Error, av: Option<&str>) -> String {
    let denied = e.kind() == std::io::ErrorKind::PermissionDenied || matches!(e.raw_os_error(), Some(5) | Some(225));
    let busy = e.raw_os_error() == Some(32);
    let missing = spawn_missing(e);
    match (av, spawn_flagged_as_virus(e), denied, busy, missing) {
        (Some(name), true, _, _, _) => format!(". Антивирус {} принял Java за угрозу и заблокировал. Верни файл из карантина и добавь папку лаунчера в исключения {}", name, name),
        (None, true, _, _, _) => ". Антивирус принял Java за угрозу и заблокировал. Верни файл из карантина и добавь папку лаунчера в исключения антивируса".into(),
        (Some(name), _, true, _, _) => format!(". Java не дал запустить антивирус {} — добавь папку лаунчера в его исключения и запусти ещё раз", name),
        (None, _, true, _, _) => ". Java не дал запустить антивирус — добавь папку лаунчера в его исключения и запусти ещё раз".into(),
        (_, _, _, true, _) => ". Файл Java занят другой программой (чаще всего антивирусом) — подожди минуту и запусти ещё раз".into(),
        (Some(name), _, _, _, true) => format!(". Файл Java пропал сразу после установки — его удаляет антивирус {}. Верни файл из карантина и добавь папку лаунчера в исключения", name),
        _ => String::new(),
    }
}

/// «Запуск Java: причина — путь», и для запрета — что с этим делать.
pub(crate) fn spawn_failure(e: &std::io::Error, java: &Path) -> String {
    let needs_av = spawn_blocked(e) || spawn_missing(e);
    let av = if needs_av { running_antivirus() } else { None };
    format!("Запуск Java: {} — {}{}", e, mask_home(&java.to_string_lossy()), antivirus_hint(e, av))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_error_comes_first_not_agent_noise() {
        let log = "[authlib-injector] [INFO] Logging file: C:\\Users\\User\\AppData\\Roaming\\net.millida.launcher\\logs\\authlib.log\n\
                   [authlib-injector] [INFO] Version: 1.2.5\n\
                   \n\
                   Unrecognized option: -p\n\
                   Error: Could not create the Java Virtual Machine.\n\
                   Error: A fatal exception has occurred. Program will exit.\n";
        let msg = early_exit_message(Some(1), log);
        let first = msg.lines().next().unwrap();
        assert_eq!(first, "Игра не запустилась (код 1): Unrecognized option: -p", "{msg}");
        assert!(!msg.contains("[authlib-injector] [INFO]"), "шум агента не уезжает даже в хвост: {msg}");
        assert!(msg.contains("Could not create the Java Virtual Machine"), "полный хвост остаётся для экрана");
    }

    #[test]
    fn windows_status_is_shown_in_hex_with_advice() {
        let msg = early_exit_message(Some(-1073741819), "");
        assert!(msg.starts_with("Игра не запустилась (код 0xC0000005 — нарушение доступа к памяти"), "{msg}");
        assert_eq!(exit_code_text(Some(1)).0, "1");
        assert_eq!(exit_code_text(None).0, "без кода");
    }

    #[test]
    fn summary_fits_the_telemetry_budget() {
        let log = "Error occurred during initialization of VM\nMultiple garbage collectors selected\n";
        let first = early_exit_message(Some(1), log).lines().next().unwrap().to_string();
        assert_eq!(
            first,
            "Игра не запустилась (код 1): Error occurred during initialization of VM | Multiple garbage collectors selected"
        );
        let log = "Error: VM option 'G1NewSizePercent' is experimental and must be enabled via -XX:+UnlockExperimentalVMOptions.\n";
        let first = early_exit_message(Some(1), log);
        assert!(first.starts_with("Игра не запустилась (код 1): Error: VM option 'G1NewSizePercent'"), "{first}");
    }

    #[test]
    fn broken_runtime_is_recognised() {
        assert!(broken_runtime("Error: could not find java.dll\nError: Could not find Java SE Runtime Environment."));
        assert!(!broken_runtime("Unrecognized option: -p"));
    }

    #[test]
    fn denied_spawn_says_what_to_do() {
        let e = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        let msg = spawn_failure(&e, Path::new("/x/java/21/bin/java"));
        assert!(msg.starts_with("Запуск Java: "), "{msg}");
        assert!(msg.contains("/x/java/21/bin/java"), "путь говорит, чья это Java: {msg}");
        assert!(msg.contains("исключения"), "{msg}");
        assert!(spawn_blocked(&e));
        assert!(!spawn_missing(&e), "запрет — не повод качать Java заново");
        assert!(spawn_missing(&std::io::Error::from(std::io::ErrorKind::NotFound)));
    }

    #[test]
    fn the_running_antivirus_is_named_in_the_advice() {
        let cases: [(&[&str], Option<&str>, &str); 4] = [
            (&["explorer.exe", "MsMpEng.exe"], Some("Microsoft Defender"), "Defender alone is the one to blame"),
            (&["MsMpEng.exe", "avp.exe"], Some("Kaspersky"), "a third-party engine wins over passive Defender"),
            (&["EKRN.EXE"], Some("ESET"), "process names compare without case"),
            (&["chrome.exe"], None, "no known engine, no guess"),
        ];
        for (procs, want, why) in cases {
            assert_eq!(antivirus_from_processes(procs.iter().copied()), want, "{why}");
        }
        let flagged = std::io::Error::from_raw_os_error(225);
        assert!(antivirus_hint(&flagged, Some("ESET")).contains("ESET принял Java за угрозу"), "error 225 must say the file was flagged, not just denied");
        let gone = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert!(antivirus_hint(&gone, None).is_empty(), "a missing file with no antivirus running must not accuse one");
    }
}
