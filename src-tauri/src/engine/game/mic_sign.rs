use crate::engine::*;
use std::path::{Path, PathBuf};
use std::process::Command;

// Temurin signs bin/java with the hardened runtime but without the audio-input
// entitlement, so macOS hands the game silence instead of asking for the mic.
// The managed runtime is re-signed ad hoc WITHOUT the hardened runtime: an
// unhardened process needs no entitlement for capture, JIT (MAP_JIT), foreign
// dylibs or DYLD variables, and Apple Silicon only requires that some valid
// signature exists. The entitlements are still embedded so the binary stays
// correct if the hardened flag is ever turned back on.
const MARKER: &str = ".millida-mic-signed";
const LAUNCH_BIN: &str = "Contents/Home/bin/java";
const IDENTIFIER: &str = "net.millida.launcher.java";
const ENTITLEMENTS_REV: u32 = 1;
const ENTITLEMENTS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
</plist>
"#;

type Signer = fn(&Path, &Path) -> Result<(), String>;

static SIGN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn runtime_dir_of(java: &Path, managed_root: &Path) -> Option<PathBuf> {
    let rel = java.strip_prefix(managed_root).ok()?;
    let name = rel.components().next()?.as_os_str().to_str()?;
    if name.starts_with('.') {
        return None;
    }
    let dir = managed_root.join(name);
    (dir.join(LAUNCH_BIN) == java).then_some(dir)
}

fn stamp(bin: &Path) -> Option<String> {
    let meta = std::fs::metadata(bin).ok()?;
    let mtime = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_nanos();
    Some(format!("{}:{}:{}", ENTITLEMENTS_REV, meta.len(), mtime))
}

fn already_signed(dir: &Path, bin: &Path) -> bool {
    let Some(now) = stamp(bin) else { return false };
    std::fs::read_to_string(dir.join(MARKER)).is_ok_and(|m| m.trim() == now)
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("{}: {}", path.display(), e)),
        _ => Ok(()),
    }
}

// The signed copy replaces java by rename: rewriting a signed Mach-O in place
// keeps the kernel's cached signature for that vnode and gets the next exec
// killed on Apple Silicon.
fn resign(dir: &Path, bin: &Path, managed_root: &Path, signer: Signer) -> Result<(), String> {
    let tag = unique_tag();
    let plist = managed_root.join(format!(".mic-entitlements-{}.plist", tag));
    let staged = bin.with_file_name(format!(".java-mic-{}", tag));
    std::fs::write(&plist, ENTITLEMENTS).map_err(|e| format!("{}: {}", plist.display(), e))?;
    let signed = std::fs::copy(bin, &staged)
        .map_err(|e| format!("{}: {}", staged.display(), e))
        .and_then(|_| signer(&staged, &plist))
        .and_then(|()| std::fs::rename(&staged, bin).map_err(|e| format!("{}: {}", bin.display(), e)));
    let _ = std::fs::remove_file(&plist);
    if signed.is_err() {
        let _ = std::fs::remove_file(&staged);
    }
    signed?;
    if let Some(alias) = branded_alias(bin) {
        remove_if_present(&alias)?;
    }
    let now = stamp(bin).ok_or_else(|| format!("{}: no metadata after signing", bin.display()))?;
    let marker = dir.join(MARKER);
    std::fs::write(&marker, now).map_err(|e| format!("{}: {}", marker.display(), e))
}

fn ensure_signed(java: &Path, managed_root: &Path, signer: Signer) -> Result<bool, String> {
    let Some(dir) = runtime_dir_of(java, managed_root) else { return Ok(false) };
    let _guard = SIGN_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if !java.is_file() || already_signed(&dir, java) {
        return Ok(false);
    }
    resign(&dir, java, managed_root, signer).map(|()| true)
}

fn codesign(bin: &Path, entitlements: &Path) -> Result<(), String> {
    let _ = quiet(&mut Command::new("/usr/bin/xattr"))
        .args(["-d", "com.apple.quarantine"])
        .arg(bin)
        .output();
    let out = quiet(&mut Command::new("/usr/bin/codesign"))
        .args(["--force", "--sign", "-", "--identifier", IDENTIFIER, "--entitlements"])
        .arg(entitlements)
        .arg(bin)
        .output()
        .map_err(|e| format!("codesign: {}", e))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("codesign {}: {}", out.status, String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Never fails the launch: without the signature the game still runs, only the
/// voice chat stays silent.
pub(crate) async fn grant_java_microphone(java: &Path) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let java = java.to_path_buf();
    let root = data_dir().join("java");
    match tokio::task::spawn_blocking(move || ensure_signed(&java, &root, codesign)).await {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => eprintln!("[java] microphone entitlement not applied, voice chat may record silence: {}", e),
        Err(e) => eprintln!("[java] microphone entitlement task failed: {}", e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_sign(bin: &Path, entitlements: &Path) -> Result<(), String> {
        let plist = std::fs::read_to_string(entitlements).map_err(|e| e.to_string())?;
        assert!(
            plist.contains("com.apple.security.device.audio-input") && plist.contains("com.apple.security.cs.allow-jit"),
            "the entitlements handed to codesign lost audio-input or allow-jit: the mic stays silent or the JIT dies"
        );
        let mut bytes = std::fs::read(bin).map_err(|e| e.to_string())?;
        bytes.extend_from_slice(b"+adhoc");
        std::fs::write(bin, bytes).map_err(|e| e.to_string())
    }

    fn failing_sign(_: &Path, _: &Path) -> Result<(), String> {
        Err("codesign exited 1".into())
    }

    fn runtime(root: &Path, name: &str) -> PathBuf {
        let bin = root.join(name).join(LAUNCH_BIN);
        std::fs::create_dir_all(bin.parent().unwrap()).unwrap();
        std::fs::write(&bin, b"temurin-hardened").unwrap();
        bin
    }

    fn fresh_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join("millida-mic-sign").join(name);
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn only_the_managed_launch_binary_is_signed() {
        let root = Path::new("/data/java");
        let cases: [(&str, bool, &str); 6] = [
            ("/data/java/21/Contents/Home/bin/java", true, "the binary the game starts from"),
            ("/data/java/21~ab12/Contents/Home/bin/java", true, "a fallback runtime dir is still ours"),
            ("/data/java/8-x64/Contents/Home/bin/java", true, "the Rosetta Java 8 from Azul needs the mic too"),
            ("/data/java/.21-new-ab/Contents/Home/bin/java", false, "staging dirs are half-unpacked and get swept"),
            ("/Library/Java/JavaVirtualMachines/jdk/Contents/Home/bin/java", false, "a system JDK belongs to the user, not to us"),
            ("/data/java/21/Contents/Home/bin/jspawnhelper", false, "only the launched executable needs entitlements"),
        ];
        for (path, want, why) in cases {
            assert_eq!(runtime_dir_of(Path::new(path), root).is_some(), want, "{path}: {why}");
        }
    }

    #[test]
    fn signs_once_and_again_only_after_the_runtime_changes() {
        let root = fresh_root("lifecycle");
        let bin = runtime(&root, "21");
        let alias = branded_alias(&bin).unwrap();
        std::fs::write(&alias, b"temurin-hardened").unwrap();

        assert!(ensure_signed(&bin, &root, fake_sign).unwrap(), "a fresh Temurin runtime must be re-signed");
        assert_eq!(std::fs::read(&bin).unwrap(), b"temurin-hardened+adhoc", "the signed copy must replace java");
        assert!(!alias.exists(), "the branded copy kept the hardened signature: the game would still record silence");
        assert!(root.join("21").join(MARKER).exists(), "without the marker every launch would re-sign");

        assert!(!ensure_signed(&bin, &root, fake_sign).unwrap(), "a signed runtime with a valid marker is left alone");
        assert_eq!(std::fs::read(&bin).unwrap(), b"temurin-hardened+adhoc", "every launch re-signed java again");

        std::fs::write(&bin, b"temurin-hardened-updated").unwrap();
        assert!(ensure_signed(&bin, &root, fake_sign).unwrap(), "a replaced java must invalidate the marker");

        std::fs::remove_dir_all(root.join("21")).unwrap();
        let bin = runtime(&root, "21");
        assert!(ensure_signed(&bin, &root, fake_sign).unwrap(), "a reinstalled runtime dir starts without the marker");

        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(".mic-entitlements"))
            .collect();
        assert!(leftovers.is_empty(), "temporary entitlement plists must be removed: {leftovers:?}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn a_failed_signature_leaves_java_intact_and_retries_later() {
        let root = fresh_root("failure");
        let bin = runtime(&root, "17");

        assert!(ensure_signed(&bin, &root, failing_sign).is_err(), "the failure must reach the log");
        assert_eq!(std::fs::read(&bin).unwrap(), b"temurin-hardened", "a failed signing must not touch the working java");
        assert!(!root.join("17").join(MARKER).exists(), "a marker after a failure would hide the problem forever");
        let staged: Vec<_> = std::fs::read_dir(bin.parent().unwrap())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(".java-mic-"))
            .collect();
        assert!(staged.is_empty(), "the staged copy must be cleaned up on failure");

        assert!(ensure_signed(&bin, &root, fake_sign).unwrap(), "the next launch must try again");
        std::fs::remove_dir_all(&root).ok();
    }
}
