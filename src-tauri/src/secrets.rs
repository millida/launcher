use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, KeyInit, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock};

// Token vault. The OS keychain is not used: the binary hash changes on every
// auto-update, which makes the macOS Keychain re-prompt for a password forever.
//
//   secrets.bin - AES-256-GCM, fresh nonce per record, key name used as AAD
//   vault.key   - 32 random bytes, DPAPI-wrapped on Windows, mode 0600 elsewhere
//   cipher key  - HKDF-SHA256(vault.key + machine identifier)
//
// Binding to the machine identifier makes secrets.bin + vault.key useless when
// copied to another machine or another user account, without any prompts.

const VAULT_SALT: &[u8] = b"millida-launcher-vault-v2";
const VAULT_INFO: &[u8] = b"secrets";
const NONCE_LEN: usize = 12;

fn vault_path() -> PathBuf {
    crate::engine::data_dir().join("secrets.bin")
}

fn device_key_path() -> PathBuf {
    crate::engine::data_dir().join("vault.key")
}

fn legacy_mask_path() -> PathBuf {
    crate::engine::data_dir().join("secrets.key")
}

fn write_private(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    restrict_existing(&f)?;
    f.write_all(bytes)
}

#[cfg(unix)]
fn restrict_existing(f: &std::fs::File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    f.set_permissions(std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_existing(_f: &std::fs::File) -> std::io::Result<()> {
    Ok(())
}

/// Fails instead of overwriting, so a race for the key cannot clobber it.
fn create_new_private(path: &PathBuf, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    f.write_all(bytes)
}

#[cfg(windows)]
fn dpapi(input: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };
    let src = CRYPT_INTEGER_BLOB {
        cbData: input.len() as u32,
        pbData: input.as_ptr() as *mut u8,
    };
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if protect {
            CryptProtectData(
                &src,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        } else {
            CryptUnprotectData(
                &src,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut out,
            )
        }
    };
    if ok == 0 || out.pbData.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe {
        windows_sys::Win32::Foundation::LocalFree(out.pbData as *mut core::ffi::c_void);
    }
    Some(bytes)
}

#[cfg(target_os = "macos")]
fn machine_binding() -> Vec<u8> {
    let mut id = [0u8; 16];
    let wait = libc::timespec { tv_sec: 5, tv_nsec: 0 };
    let rc = unsafe { libc::gethostuuid(id.as_mut_ptr(), &wait) };
    if rc == 0 {
        id.to_vec()
    } else {
        Vec::new()
    }
}

#[cfg(target_os = "linux")]
fn machine_binding() -> Vec<u8> {
    for p in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        if let Ok(s) = std::fs::read_to_string(p) {
            let s = s.trim().to_string();
            if !s.is_empty() {
                return s.into_bytes();
            }
        }
    }
    Vec::new()
}

#[cfg(windows)]
fn machine_binding() -> Vec<u8> {
    Vec::new()
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut b = vec![0u8; n];
    OsRng.fill_bytes(&mut b);
    b
}

/// 32 bytes from vault.key, DPAPI-protected on Windows. A missing or corrupt
/// file yields a fresh key: existing records become unreadable and the user
/// signs in again. Resolved once per process so concurrent callers on a clean
/// install cannot each generate a different key.
fn device_key() -> Vec<u8> {
    static KEY: OnceLock<Vec<u8>> = OnceLock::new();
    KEY.get_or_init(load_device_key).clone()
}

fn unwrap_device_key(raw: &[u8]) -> Option<Vec<u8>> {
    #[cfg(windows)]
    let out = dpapi(raw, false);
    #[cfg(not(windows))]
    let out = Some(raw.to_vec());
    out.filter(|k| k.len() == 32)
}

#[cfg(unix)]
fn restrict_path(path: &PathBuf) {
    if let Ok(f) = std::fs::File::open(path) {
        let _ = restrict_existing(&f);
    }
}

#[cfg(not(unix))]
fn restrict_path(_path: &PathBuf) {}

fn load_device_key() -> Vec<u8> {
    let path = device_key_path();
    if let Some(k) = std::fs::read(&path).ok().as_deref().and_then(unwrap_device_key) {
        restrict_path(&path);
        return k;
    }
    let fresh = random_bytes(32);
    #[cfg(windows)]
    let stored = dpapi(&fresh, true).unwrap_or_else(|| fresh.clone());
    #[cfg(not(windows))]
    let stored = fresh.clone();
    match create_new_private(&path, &stored) {
        Ok(()) => fresh,
        Err(_) => std::fs::read(&path)
            .ok()
            .as_deref()
            .and_then(unwrap_device_key)
            .unwrap_or(fresh),
    }
}

fn cipher() -> Aes256Gcm {
    static KEY: OnceLock<[u8; 32]> = OnceLock::new();
    let key = KEY.get_or_init(|| {
        let mut ikm = device_key();
        ikm.extend_from_slice(&machine_binding());
        let hk = hkdf::Hkdf::<sha2::Sha256>::new(Some(VAULT_SALT), &ikm);
        let mut key = [0u8; 32];
        if hk.expand(VAULT_INFO, &mut key).is_err() {
            key.copy_from_slice(&ikm[..32]);
        }
        key
    });
    Aes256Gcm::new_from_slice(key).expect("aes-256 key")
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

fn encrypt(key: &str, value: &str) -> Option<Value> {
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher()
        .encrypt(nonce, Payload { msg: value.as_bytes(), aad: key.as_bytes() })
        .ok()?;
    Some(serde_json::json!({ "n": to_hex(&nonce_bytes), "c": to_hex(&ct) }))
}

fn decrypt(key: &str, record: &Value) -> Option<String> {
    let nonce_bytes = from_hex(record["n"].as_str()?)?;
    if nonce_bytes.len() != NONCE_LEN {
        return None;
    }
    let ct = from_hex(record["c"].as_str()?)?;
    let plain = cipher()
        .decrypt(Nonce::from_slice(&nonce_bytes), Payload { msg: &ct, aad: key.as_bytes() })
        .ok()?;
    String::from_utf8(plain).ok()
}

/// v1 format (XOR against a mask file), kept only to migrate stored tokens to v2.
fn legacy_unscramble(key: &str, data: &[u8]) -> Option<String> {
    let m = std::fs::read(legacy_mask_path()).ok()?;
    if m.len() != 32 {
        return None;
    }
    let k: Vec<u8> = if key.is_empty() { vec![0x2A] } else { key.as_bytes().to_vec() };
    let out: Vec<u8> = data
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ m[i % m.len()] ^ k[i % k.len()].wrapping_add(i as u8))
        .collect();
    String::from_utf8(out).ok()
}

/// What the vault file on disk turned out to be.
#[derive(Debug, PartialEq)]
enum Stored {
    /// No file, or a file with nothing in it: writing a fresh vault loses nothing.
    Absent,
    V2(Map<String, Value>),
    V1(Map<String, Value>),
    /// Present but not ours to interpret: a newer `v`, or bytes we cannot parse.
    /// Its records may still be real tokens, so it must be left exactly as is.
    Foreign,
}

impl Stored {
    fn writable(&self) -> bool {
        !matches!(self, Stored::Foreign)
    }
}

/// A v1 vault is a flat map of key -> hex string and is only decryptable while
/// its XOR mask file still exists. Anything else that merely lacks `"v": 2` is
/// foreign, not v1 — the earlier revision migrated it into an empty set and
/// wrote that back, wiping every token the user had.
fn classify(text: &str, mask_present: bool) -> Stored {
    if text.trim().is_empty() {
        return Stored::Absent;
    }
    let parsed = serde_json::from_str::<Value>(text).ok().and_then(|v| v.as_object().cloned());
    let Some(raw) = parsed else { return Stored::Foreign };
    if raw.get("v").and_then(|v| v.as_u64()) == Some(2) {
        let items = raw.get("items").and_then(|v| v.as_object().cloned()).unwrap_or_default();
        return Stored::V2(items);
    }
    let looks_like_v1 = mask_present
        && !raw.is_empty()
        && !raw.contains_key("v")
        && !raw.contains_key("items")
        && raw.values().all(|v| v.as_str().is_some_and(|s| from_hex(s).is_some()));
    if looks_like_v1 { Stored::V1(raw) } else { Stored::Foreign }
}

fn read_stored() -> Stored {
    let Ok(bytes) = std::fs::read(vault_path()) else { return Stored::Absent };
    let Ok(text) = String::from_utf8(bytes) else { return Stored::Foreign };
    classify(&text, legacy_mask_path().exists())
}

/// Secret commands run concurrently on Tauri's thread pool; without a shared
/// lock two read-modify-write cycles over the single vault file lose writes.
fn vault_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let m = LOCK.get_or_init(|| Mutex::new(()));
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Written via a temp file so an interrupted write cannot truncate the vault.
fn write_items(items: &Map<String, Value>) {
    let doc = serde_json::json!({ "v": 2, "items": Value::Object(items.clone()) });
    let Ok(s) = serde_json::to_string(&doc) else { return };
    let path = vault_path();
    let tmp = path.with_extension("bin.tmp");
    if write_private(&tmp, s.as_bytes()).is_err() {
        let _ = write_private(&path, s.as_bytes());
        return;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = write_private(&path, s.as_bytes());
        let _ = std::fs::remove_file(&tmp);
    }
}

fn migrate_v1(raw: &Map<String, Value>) -> Map<String, Value> {
    let mut migrated = Map::new();
    for (k, v) in raw.iter() {
        let Some(hex) = v.as_str() else { continue };
        let Some(bytes) = from_hex(hex) else { continue };
        let Some(plain) = legacy_unscramble(k, &bytes) else { continue };
        if let Some(rec) = encrypt(k, &plain) {
            migrated.insert(k.clone(), rec);
        }
    }
    write_items(&migrated);
    let _ = std::fs::remove_file(legacy_mask_path());
    migrated
}

struct Vault {
    items: Map<String, Value>,
    writable: bool,
}

/// v2 records. A v1 file is read once, re-encrypted, and its mask removed; a
/// foreign file yields no records and forbids writing, so nothing is lost when
/// an older build meets a vault it does not understand.
fn items() -> Vault {
    let stored = read_stored();
    let writable = stored.writable();
    let items = match stored {
        Stored::Absent | Stored::Foreign => Map::new(),
        Stored::V2(items) => items,
        Stored::V1(raw) => migrate_v1(&raw),
    };
    Vault { items, writable }
}

const FOREIGN_VAULT: &str =
    "хранилище секретов повреждено или создано другой версией лаунчера — удали secrets.bin, чтобы войти заново";

pub fn set(key: &str, value: &str) -> Result<(), String> {
    if key.is_empty() {
        return Err("empty key".into());
    }
    let _guard = vault_lock();
    let mut vault = items();
    if !vault.writable {
        return Err(FOREIGN_VAULT.into());
    }
    let rec = encrypt(key, value).ok_or("не удалось зашифровать секрет")?;
    vault.items.insert(key.to_string(), rec);
    write_items(&vault.items);
    Ok(())
}

pub fn get(key: &str) -> Option<String> {
    let _guard = vault_lock();
    decrypt(key, items().items.get(key)?)
}

/// A foreign vault holds nothing this build can read, so signing out succeeds
/// without touching the file: failing a sign-out would be worse than a no-op.
pub fn delete(key: &str) -> Result<(), String> {
    let _guard = vault_lock();
    let mut vault = items();
    if vault.items.remove(key).is_some() && vault.writable {
        write_items(&vault.items);
    }
    Ok(())
}

pub fn set_many(pairs: Vec<(String, String)>) -> Result<(), String> {
    let _guard = vault_lock();
    let mut vault = items();
    if !vault.writable {
        return Err(FOREIGN_VAULT.into());
    }
    for (key, value) in pairs {
        if key.is_empty() {
            continue;
        }
        let rec = encrypt(&key, &value).ok_or("не удалось зашифровать секрет")?;
        vault.items.insert(key, rec);
    }
    write_items(&vault.items);
    Ok(())
}

/// Existence only: the frontend is told which sessions are stored, never their
/// values.
pub fn present(keys: &[String]) -> HashMap<String, bool> {
    let _guard = vault_lock();
    let all = items().items;
    keys.iter()
        .map(|k| {
            let ok = all.get(k).and_then(|rec| decrypt(k, rec)).is_some_and(|v| !v.is_empty());
            (k.clone(), ok)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_aad_binding() {
        let rec = encrypt("millida", "token-value").expect("encrypt");
        assert_eq!(decrypt("millida", &rec).as_deref(), Some("token-value"));
        assert!(decrypt("mc", &rec).is_none());
    }

    #[test]
    fn ciphertext_differs_between_writes() {
        let a = encrypt("millida", "same").expect("encrypt");
        let b = encrypt("millida", "same").expect("encrypt");
        assert_ne!(a["c"], b["c"]);
    }

    #[test]
    fn vault_file_verdicts() {
        // (file contents, mask file present, expected verdict, why this case exists)
        let cases: &[(&str, bool, Stored, &str)] = &[
            ("", false, Stored::Absent, "an empty file holds nothing that could be lost"),
            ("   \n", false, Stored::Absent, "a whitespace-only file is equally empty"),
            (
                r#"{"v":2,"items":{}}"#,
                false,
                Stored::V2(Map::new()),
                "the current format must keep loading",
            ),
            (
                r#"{"mc":"0a0b"}"#,
                true,
                Stored::V1(
                    serde_json::from_str::<Map<String, Value>>(r#"{"mc":"0a0b"}"#).expect("map"),
                ),
                "a flat hex map plus its XOR mask is the real v1 layout and must migrate",
            ),
            (
                r#"{"mc":"0a0b"}"#,
                false,
                Stored::Foreign,
                "without the mask a v1 file cannot be decrypted, so migrating it would \
                 write an empty vault over live tokens",
            ),
            (
                r#"{"v":3,"items":{"mc":{"n":"00","c":"00"}}}"#,
                true,
                Stored::Foreign,
                "a newer version written by a newer build must survive a downgrade",
            ),
            (
                r#"{"mc":{"n":"00","c":"00"}}"#,
                true,
                Stored::Foreign,
                "v2-shaped records without the version header are not v1 hex strings",
            ),
            (
                r#"{"mc":"zz"}"#,
                true,
                Stored::Foreign,
                "non-hex values are not a v1 payload",
            ),
            ("{ broken", true, Stored::Foreign, "unparsable bytes may still be a damaged real vault"),
            ("[1,2,3]", true, Stored::Foreign, "a non-object document is not a vault at all"),
        ];

        for (text, mask, expected, why) in cases {
            let verdict = classify(text, *mask);
            assert_eq!(
                verdict, *expected,
                "classify({text:?}, mask_present={mask}) returned {verdict:?}. \
                 Reason this case is pinned: {why}",
            );
        }
    }

    #[test]
    fn unknown_version_is_never_overwritten() {
        let future = classify(r#"{"v":9,"items":{"millida":{"n":"00","c":"00"}}}"#, false);
        assert_eq!(future, Stored::Foreign);
        assert!(
            !future.writable(),
            "a vault this build cannot read must also be unwritable: the earlier revision \
             migrated it into an empty set and saved that, destroying the user's tokens",
        );
        assert!(
            classify(r#"{"v":2,"items":{}}"#, false).writable(),
            "a vault we do understand must stay writable",
        );
    }
}
