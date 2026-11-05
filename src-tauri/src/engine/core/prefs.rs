// Small UI settings in one file in the launcher data folder. Key and value length are limited. No network, no secrets.
use std::collections::BTreeMap;
use std::sync::Mutex;

use super::paths::{data_dir, write_json_atomic};

pub type UiPrefs = BTreeMap<String, String>;

const MAX_KEYS: usize = 128;
const MAX_KEY_LEN: usize = 48;
const MAX_VALUE_LEN: usize = 256;
const ACCOUNTS_BACKUP: &str = "m-accounts-backup";
const MAX_ACCOUNTS_BACKUP_LEN: usize = 16 * 1024;

// Read-modify-write of one shared file: two settings changed at the same moment
// would otherwise drop one of them.
static LOCK: Mutex<()> = Mutex::new(());

fn file() -> std::path::PathBuf {
    data_dir().join("ui-prefs.json")
}

fn valid(key: &str, value: &str) -> bool {
    !key.is_empty()
        && key.len() <= MAX_KEY_LEN
        && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && value.len() <= if key == ACCOUNTS_BACKUP { MAX_ACCOUNTS_BACKUP_LEN } else { MAX_VALUE_LEN }
}

/// Names the game accounts of this device: it neither goes to the cloud nor comes back from it.
pub fn device_only_pref(key: &str) -> bool {
    key == ACCOUNTS_BACKUP
}

pub fn cloud_prefs() -> UiPrefs {
    let mut prefs = ui_prefs();
    prefs.retain(|key, _| !device_only_pref(key));
    prefs
}

fn read() -> UiPrefs {
    std::fs::read_to_string(file())
        .ok()
        .and_then(|t| serde_json::from_str::<UiPrefs>(&t).ok())
        .map(|m| m.into_iter().filter(|(k, v)| valid(k, v)).collect())
        .unwrap_or_default()
}

pub fn ui_prefs() -> UiPrefs {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read()
}

pub fn ui_pref(key: &str) -> Option<String> {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read().get(key).cloned()
}

pub fn set_ui_pref(key: String, value: String) -> Result<(), String> {
    if !valid(&key, &value) {
        return Err("недопустимое имя или значение настройки".into());
    }
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut map = read();
    if map.len() >= MAX_KEYS && !map.contains_key(&key) {
        return Err("превышено число сохранённых настроек".into());
    }
    map.insert(key, value);
    write_json_atomic(&file(), &map)
}

#[cfg(test)]
mod tests {
    use super::{device_only_pref, valid, MAX_ACCOUNTS_BACKUP_LEN};

    /// key and value size -> verdict. The account list is the one value longer than a setting: at
    /// 256 bytes its copy was refused for most players and an older copy stayed on disk.
    #[test]
    fn only_the_account_list_may_be_longer_than_a_setting() {
        let cases: [(&str, usize, bool, &str); 4] = [
            ("m-accounts-backup", 4096, true, "several accounts with uuids must fit"),
            ("m-accounts-backup", MAX_ACCOUNTS_BACKUP_LEN + 1, false, "it is still not a data store"),
            ("m-mus-vol", 257, false, "the longer limit belongs to one key"),
            ("m-mus-vol", 256, true, "ordinary settings keep their limit"),
        ];
        for (key, len, want, why) in cases {
            assert_eq!(valid(key, &"v".repeat(len)), want, "{key} at {len} bytes: {why}");
        }
    }

    #[test]
    fn the_account_list_stays_on_this_device() {
        assert!(device_only_pref("m-accounts-backup"), "nicks and uuids of game accounts must not reach the cloud snapshot");
        assert!(!device_only_pref("m-accent"), "ordinary settings still sync between devices");
    }

    /// input -> verdict. Keys and values arrive from the webview, so the
    /// settings file must accept neither arbitrary names nor unbounded data.
    #[test]
    fn only_short_slug_keys_are_accepted() {
        let cases: [(&str, &str, bool); 8] = [
            ("m-mus-vol", "40", true),
            ("m-sound-mode", "all", true),
            ("", "40", false),
            ("M-MUS-VOL", "40", false),
            ("m_mus_vol", "40", false),
            ("../../escape", "40", false),
            ("m-mus-vol-but-way-too-long-to-be-a-real-setting-name", "40", false),
            ("m-mus-vol", "x", true),
        ];
        for (key, value, want) in cases {
            assert_eq!(
                valid(key, value),
                want,
                "key {key:?} with value {value:?} must be {}: setting names come from the webview, \
                 and anything but a short kebab-case slug means something is writing keys the \
                 frontend never declared",
                if want { "accepted" } else { "rejected" },
            );
        }
        let long = "v".repeat(257);
        assert!(
            !valid("m-mus-vol", &long),
            "a {}-byte value must be rejected: the settings file is not a data store",
            long.len(),
        );
    }
}
