use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

pub const UI_TEXT_KEYS: &[&str] = &[
    "Куда сохранить",
    "Куда сохранить мир",
    "Куда сохранить изображение",
    "Куда сохранить скриншот",
    "Файл для сервера",
    "Файл java (java.exe / bin/java)",
    "Папка со сборками",
    "Папка игры Millida",
    "Своя музыка",
    "Музыка",
    "Архив мира",
    "Архив мира (.zip)",
    "Изображение",
    "Изображение PNG",
    "Скин или плащ (PNG)",
    "Свой фон лаунчера",
    "Моды и архивы",
    "Какие файлы проверить",
    "Фон",
    "Картинка",
    "Обложка сборки",
    "Сборка Minecraft",
    "Файл сборки (.mrpack или .zip)",
    "Моды",
    "Выбери моды",
    "Ресурспаки",
    "Выбери ресурспаки",
    "Дата-паки",
    "Выбери дата-паки",
    "Шейдеры",
    "Выбери шейдеры",
    "Файлы",
    "Выбери файлы",
    "Открыть лаунчер",
    "Выход",
    "Играть",
    "Играть последней сборкой",
    "Скачивается… окно закроется само",
    "Идёт звонок",
    "Вышло обновление лаунчера",
    "Откройте лаунчер, чтобы поставить версию",
    "Сессия устарела",
    "Сервер не принял вход. Откройте лаунчер, чтобы обновить его:",
    "Папка для бэкапов",
];

const MAX_TEXT_CHARS: usize = 120;

fn texts() -> &'static RwLock<HashMap<&'static str, String>> {
    static TEXTS: OnceLock<RwLock<HashMap<&'static str, String>>> = OnceLock::new();
    TEXTS.get_or_init(|| RwLock::new(HashMap::new()))
}

fn clean(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_TEXT_CHARS || trimmed.chars().any(char::is_control) {
        return None;
    }
    Some(trimmed.to_string())
}

pub fn set_ui_texts(incoming: HashMap<String, String>) -> usize {
    let mut next = HashMap::new();
    for key in UI_TEXT_KEYS {
        if let Some(text) = incoming.get(*key).map(String::as_str).and_then(clean) {
            next.insert(*key, text);
        }
    }
    let count = next.len();
    *texts().write().unwrap_or_else(|e| e.into_inner()) = next;
    count
}

pub fn ui(source: &str) -> String {
    texts()
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(source)
        .cloned()
        .unwrap_or_else(|| source.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources() -> Vec<(String, String)> {
        fn walk(dir: &std::path::Path, out: &mut Vec<(String, String)>) {
            for entry in std::fs::read_dir(dir).expect("src-tauri/src must be readable").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, out);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    let text = std::fs::read_to_string(&path).unwrap_or_default();
                    out.push((path.display().to_string(), text));
                }
            }
        }
        let mut out = Vec::new();
        walk(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
        out
    }

    #[test]
    fn every_native_text_is_known_to_the_interface() {
        let mut unknown = Vec::new();
        let needle = "ui(\"";
        for (file, text) in sources() {
            if file.ends_with("ui_text.rs") {
                continue;
            }
            for (at, _) in text.match_indices(needle) {
                let before = text[..at].chars().next_back();
                if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
                    continue;
                }
                let rest = &text[at + needle.len()..];
                let Some(end) = rest.find('"') else { continue };
                let key = &rest[..end];
                if !UI_TEXT_KEYS.contains(&key) {
                    unknown.push(format!("{file}: {key}"));
                }
            }
        }
        assert!(
            unknown.is_empty(),
            "ui(\"…\") is called with texts missing from UI_TEXT_KEYS: {unknown:?}. The interface \
             translates only the keys it is given, so such a dialog title or tray label stays Russian \
             for every player.",
        );
    }

    #[test]
    fn interface_texts_are_filtered_before_they_reach_native_ui() {
        let long = "x".repeat(MAX_TEXT_CHARS + 1);
        let cases: Vec<(&str, &str, &str, &str)> = vec![
            ("Выход", "Quit", "Quit", "a known key takes the translation"),
            ("Выход", "  ", "Выход", "an empty translation keeps the Russian source"),
            ("Выход", "a\u{0007}b", "Выход", "control characters never reach a native menu"),
            ("Выход", &long, "Выход", "an oversized label is refused"),
        ];
        for (key, value, want, why) in cases {
            let mut map = HashMap::new();
            map.insert(key.to_string(), value.to_string());
            map.insert("not a key".to_string(), "ignored".to_string());
            set_ui_texts(map);
            assert_eq!(ui(key), want, "{why}");
            assert_eq!(ui("not a key"), "not a key", "unknown keys are dropped, not stored");
        }
        set_ui_texts(HashMap::new());
    }
}
