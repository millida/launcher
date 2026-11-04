// Patch updates of the launcher itself. A release usually changes code and a few web files; the installer is 20+ MB, the
// patch from the previous executable is a few. The manifest may offer, next to the installer, a patch from named older
// executables to the new one (zstd --patch-from, made by scripts/delta-release.mjs). The launcher hashes its own exe, takes the
// patch built from exactly that exe, applies it, and accepts the result only if the SIGNATURE OF THE RESULTING FILE
// checks out with the same key as the installer. Any failure falls back to the full installer; the offer is optional and
// older launchers never read it. Windows only: the swap renames the running exe aside and puts the new one in its place.
use super::selfupdate::Restart;
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// A reference bigger than this is not read into memory (the launcher is ~25 MB).
pub(crate) const MAX_EXE_BYTES: u64 = 96 << 20;
/// The window zstd needs for a patch against an exe of that size.
const WINDOW_LOG_MAX: u32 = 27;
/// What a staged patch result is called: `…delta.exe` marks "swap the running exe" instead of "run an installer".
pub(crate) const DELTA_SUFFIX: &str = ".delta.exe";
const PREV_SUFFIX: &str = ".millida-prev";
const NEW_SUFFIX: &str = ".millida-new";

#[derive(Clone, Debug, PartialEq)]
pub struct PatchRef {
    /// SHA-256 of the executable this patch starts from.
    pub(crate) from: String,
    pub(crate) version: String,
    pub(crate) url: String,
    pub(crate) size: u64,
    /// SHA-256 of the patch file itself (transport check; the result is checked by signature).
    pub(crate) sha256: String,
    pub(crate) mirror: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DeltaOffer {
    pub(crate) exe_size: u64,
    pub(crate) exe_sha256: String,
    /// Minisign signature of the resulting exe, as `tauri signer sign` writes it.
    pub(crate) exe_signature: String,
    pub(crate) patches: Vec<PatchRef>,
}

fn hex_ok(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn https(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some())
}

/// The `delta` object of a platform entry of the manifest. Anything unexpected makes the whole offer vanish: a patch
/// update is an optimisation, never a reason to trust a half-understood answer.
pub(crate) fn parse_offer(v: &Value) -> Option<DeltaOffer> {
    if v["v"].as_u64() != Some(1) {
        return None;
    }
    let exe = &v["exe"];
    let (size, sha, sig) = (exe["size"].as_u64()?, exe["sha256"].as_str()?, exe["signature"].as_str()?);
    if size == 0 || size > MAX_EXE_BYTES || !hex_ok(sha) || sig.trim().is_empty() || sig.len() > 4000 {
        return None;
    }
    let mut patches = Vec::new();
    for p in v["patches"].as_array()? {
        let (from, url, psize, psha) = (p["from"].as_str()?, p["url"].as_str()?, p["size"].as_u64()?, p["sha256"].as_str()?);
        if !hex_ok(from) || !hex_ok(psha) || !https(url) || psize == 0 || psize > MAX_EXE_BYTES {
            continue;
        }
        let mirror = p["mirror"].as_str().filter(|m| https(m)).map(String::from);
        patches.push(PatchRef { from: from.into(), version: p["version"].as_str().unwrap_or("").chars().take(40).collect(), url: url.into(), size: psize, sha256: psha.into(), mirror });
    }
    (!patches.is_empty()).then(|| DeltaOffer { exe_size: size, exe_sha256: sha.into(), exe_signature: sig.trim().into(), patches })
}

/// The patch that starts from exactly this executable, if the release has one.
pub(crate) fn pick<'a>(offer: &'a DeltaOffer, base_sha256: &str) -> Option<&'a PatchRef> {
    offer.patches.iter().find(|p| p.from.eq_ignore_ascii_case(base_sha256))
}

pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{:02x}", b)).collect())
}

/// patch + the executable it starts from -> the new executable, written to `out`. Returns the SHA-256 of what was
/// written. The output is cut off at `limit` bytes: a patch that inflates past the declared size is not applied.
pub(crate) fn apply_patch<R: Read, W: Write>(base: &[u8], patch: R, mut out: W, limit: u64) -> Result<(u64, String), String> {
    let mut dec = zstd::stream::read::Decoder::with_dictionary(std::io::BufReader::new(patch), base).map_err(|e| format!("patch decoder: {}", e))?;
    dec.window_log_max(WINDOW_LOG_MAX).map_err(|e| format!("patch window: {}", e))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let mut total = 0u64;
    loop {
        let n = dec.read(&mut buf).map_err(|e| format!("patch does not decode: {}", e))?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limit {
            return Err("patch inflates past the declared size".into());
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
    }
    out.flush().map_err(|e| e.to_string())?;
    Ok((total, h.finalize().iter().map(|b| format!("{:02x}", b)).collect()))
}

/// Builds the new executable next to `out` from the installed one and the downloaded patch. Nothing is trusted yet:
/// the caller verifies the signature of the result before it is kept.
pub(crate) fn build_exe(current: &Path, patch: &Path, offer: &DeltaOffer, out: &Path) -> Result<(), String> {
    let meta = std::fs::metadata(current).map_err(|e| format!("{}: {}", current.display(), e))?;
    if meta.len() == 0 || meta.len() > MAX_EXE_BYTES {
        return Err("the installed exe is not a size a patch is made for".into());
    }
    let base = std::fs::read(current).map_err(|e| format!("{}: {}", current.display(), e))?;
    let reader = std::io::BufReader::new(std::fs::File::open(patch).map_err(|e| format!("{}: {}", patch.display(), e))?);
    let tmp = out.with_extension("exe.tmp");
    let result = (|| {
        let file = std::fs::File::create(&tmp).map_err(|e| format!("{}: {}", tmp.display(), e))?;
        let (written, sha) = apply_patch(&base, reader, std::io::BufWriter::new(file), offer.exe_size)?;
        if written != offer.exe_size || !sha.eq_ignore_ascii_case(&offer.exe_sha256) {
            return Err("the patched exe is not the one the release describes".to_string());
        }
        std::fs::rename(&tmp, out).map_err(|e| format!("{}: {}", out.display(), e))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

pub(crate) fn is_delta_file(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n.to_string_lossy().ends_with(DELTA_SUFFIX))
}

pub(crate) fn staged_name(version: &str) -> String {
    format!("millida-launcher-{}{}", version.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').collect::<String>(), DELTA_SUFFIX)
}

/// Puts the new executable where the old one is. Windows lets a running exe be renamed but not overwritten, so the old
/// file is moved aside first (it is deleted on the next start) and the new one takes its name. A failure at any step
/// puts the old file back: the player never ends up without a launcher.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn swap_in(staged: &Path, target: &Path) -> Result<(), String> {
    let (Some(dir), Some(name)) = (target.parent(), target.file_name()) else { return Err("the exe has no folder".into()) };
    let name = name.to_string_lossy();
    let (fresh, prev) = (dir.join(format!("{}{}", name, NEW_SUFFIX)), dir.join(format!("{}{}", name, PREV_SUFFIX)));
    let _ = std::fs::remove_file(&fresh);
    std::fs::copy(staged, &fresh).map_err(|e| format!("{}: {}", fresh.display(), e))?;
    let want = std::fs::metadata(staged).map(|m| m.len()).unwrap_or(0);
    if std::fs::metadata(&fresh).map(|m| m.len()).unwrap_or(1) != want {
        let _ = std::fs::remove_file(&fresh);
        return Err("the copy next to the exe came out another size".into());
    }
    let _ = std::fs::remove_file(&prev);
    if let Err(e) = std::fs::rename(target, &prev) {
        let _ = std::fs::remove_file(&fresh);
        return Err(format!("the running exe cannot be moved aside: {}", e));
    }
    if let Err(e) = std::fs::rename(&fresh, target) {
        let back = std::fs::rename(&prev, target);
        let _ = std::fs::remove_file(&fresh);
        return Err(match back {
            Ok(()) => format!("the new exe did not take its place: {}", e),
            Err(b) => format!("the new exe did not take its place ({}) and the old one could not be put back ({})", e, b),
        });
    }
    Ok(())
}

/// Leftovers of an earlier swap: the old exe, once nothing runs from it, and a half copy.
pub fn clean_leftovers() {
    let Ok(exe) = std::env::current_exe() else { return };
    let (Some(dir), Some(name)) = (exe.parent(), exe.file_name()) else { return };
    let name = name.to_string_lossy();
    for suffix in [PREV_SUFFIX, NEW_SUFFIX] {
        let _ = std::fs::remove_file(dir.join(format!("{}{}", name, suffix)));
    }
}

/// The relaunched copy waits for the process that started it to end: the single-instance guard would otherwise see the
/// old launcher still alive and just hand it a window request.
pub fn wait_for_parent() {
    let Some(pid) = std::env::var("MILLIDA_WAIT_PID").ok().and_then(|v| v.parse::<u32>().ok()) else { return };
    std::env::remove_var("MILLIDA_WAIT_PID");
    let pid = sysinfo::Pid::from_u32(pid);
    let mut sys = sysinfo::System::new();
    for _ in 0..150 {
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
        if sys.process(pid).is_none() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// The arguments of the new copy after a patch install: none when the window should open, the login flag when it
/// should stay in the tray.
#[cfg_attr(not(windows), allow(dead_code))]
fn relaunch_args(restart: Restart) -> Vec<&'static str> {
    match restart {
        Restart::Tray => vec![super::selfupdate::TRAY_START_ARG],
        Restart::No | Restart::Show => Vec::new(),
    }
}

/// Swaps the running exe for the staged one and, when asked, starts it. `true` = the caller must end this process.
#[cfg(windows)]
pub(crate) fn install(staged: &Path, restart: Restart) -> Result<bool, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    swap_in(staged, &exe)?;
    if restart != Restart::No {
        // A copy that comes up in the tray must not be told to show its window.
        if restart == Restart::Show {
            let _ = super::selfupdate::mark_show_after_update();
        }
        let mut cmd = std::process::Command::new(&exe);
        cmd.args(relaunch_args(restart));
        cmd.env("MILLIDA_WAIT_PID", std::process::id().to_string());
        super::proc::quiet(&mut cmd);
        cmd.spawn().map_err(|e| format!("the new copy did not start: {}", e))?;
    }
    Ok(true)
}

#[cfg(not(windows))]
pub(crate) fn install(_staged: &Path, _restart: Restart) -> Result<bool, String> {
    Err("patch updates are for Windows".into())
}

/// Whether this build can take a patch at all: Windows, the exe in a folder the player can write to.
pub(crate) fn eligible() -> bool {
    if !cfg!(windows) {
        return false;
    }
    let Ok(exe) = std::env::current_exe() else { return false };
    let Some(dir) = exe.parent() else { return false };
    let probe: PathBuf = dir.join(format!(".millida-write-probe-{}", std::process::id()));
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("millida-selfdelta-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Two "executables" of a few megabytes where the second is the first with edits in the middle and a shifted tail,
    /// which is what a rebuild does to a binary.
    fn exes() -> (Vec<u8>, Vec<u8>) {
        let old: Vec<u8> = (0..3_000_000u32).map(|i| (i.wrapping_mul(2654435761) >> 11) as u8).collect();
        let mut new = old[..1_200_000].to_vec();
        new.extend_from_slice(b"a freshly compiled function, a few hundred bytes of new code");
        new.extend_from_slice(&old[1_200_000..2_000_000]);
        new.extend(std::iter::repeat_n(7u8, 5000));
        new.extend_from_slice(&old[2_000_000..]);
        (old, new)
    }

    /// What `zstd -19 --long=27 --patch-from=old new` produces: the old file is the reference prefix of the frame.
    fn make_patch(old: &[u8], new: &[u8]) -> Vec<u8> {
        use zstd::zstd_safe::{CCtx, CParameter};
        let mut cctx = CCtx::create();
        cctx.set_parameter(CParameter::CompressionLevel(19)).unwrap();
        cctx.set_parameter(CParameter::WindowLog(27)).unwrap();
        cctx.set_parameter(CParameter::EnableLongDistanceMatching(true)).unwrap();
        cctx.ref_prefix(old).unwrap();
        let mut out = vec![0u8; zstd::zstd_safe::compress_bound(new.len())];
        let n = cctx.compress2(&mut out, new).unwrap();
        out.truncate(n);
        out
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{:02x}", b)).collect()
    }

    fn offer_for(old: &[u8], new: &[u8], patch: &[u8]) -> DeltaOffer {
        DeltaOffer {
            exe_size: new.len() as u64,
            exe_sha256: sha(new),
            exe_signature: "sig".into(),
            patches: vec![PatchRef { from: sha(old), version: "2.0.1".into(), url: "https://x/y.zst".into(), size: patch.len() as u64, sha256: sha(patch), mirror: None }],
        }
    }

    /// old exe + patch -> the new exe, byte for byte, and much smaller than the exe itself
    #[test]
    fn a_patch_turns_the_installed_exe_into_the_new_one() {
        let (old, new) = exes();
        let patch = make_patch(&old, &new);
        assert!(patch.len() < new.len() / 20, "the patch must be a small part of the exe: {} of {}", patch.len(), new.len());
        let dir = scratch("apply");
        let (cur, p, out) = (dir.join("old.exe"), dir.join("p.zst"), dir.join("new.exe"));
        std::fs::write(&cur, &old).unwrap();
        std::fs::write(&p, &patch).unwrap();
        build_exe(&cur, &p, &offer_for(&old, &new, &patch), &out).unwrap();
        assert_eq!(std::fs::read(&out).unwrap(), new);
        assert!(!dir.join("new.exe.tmp").exists());
    }

    /// a patch made against another exe, a damaged patch and an exe that is not the described one -> refused, nothing kept
    #[test]
    fn a_wrong_base_or_damaged_patch_never_leaves_an_exe() {
        let (old, new) = exes();
        let patch = make_patch(&old, &new);
        let dir = scratch("refuse");
        let out = dir.join("new.exe");
        let p = dir.join("p.zst");

        // another installed exe than the patch was made for
        let mut other = old.clone();
        other[10] ^= 1;
        let cur = dir.join("other.exe");
        std::fs::write(&cur, &other).unwrap();
        std::fs::write(&p, &patch).unwrap();
        assert!(build_exe(&cur, &p, &offer_for(&old, &new, &patch), &out).is_err(), "a patch applied to another base must not pass");
        assert!(!out.exists() && !dir.join("new.exe.tmp").exists());

        // a patch with a flipped byte
        let mut bad = patch.clone();
        let mid = bad.len() / 2;
        bad[mid] ^= 0xff;
        std::fs::write(&p, &bad).unwrap();
        std::fs::write(&cur, &old).unwrap();
        assert!(build_exe(&cur, &p, &offer_for(&old, &new, &patch), &out).is_err());
        assert!(!out.exists());

        // the release describes a different result than the patch gives
        std::fs::write(&p, &patch).unwrap();
        let mut lying = offer_for(&old, &new, &patch);
        lying.exe_sha256 = "0".repeat(64);
        assert!(build_exe(&cur, &p, &lying, &out).unwrap_err().contains("not the one"));
        assert!(!out.exists());

        // an output longer than declared is cut off
        let mut short = offer_for(&old, &new, &patch);
        short.exe_size = 1000;
        assert!(build_exe(&cur, &p, &short, &out).unwrap_err().contains("past"));
    }

    /// manifest object -> offer; every malformed piece is dropped
    #[test]
    fn the_manifest_offer_is_read_strictly() {
        let good = "a".repeat(64);
        let doc = serde_json::json!({
            "v": 1,
            "exe": { "size": 1000, "sha256": good, "signature": "c2ln" },
            "patches": [
                { "from": good, "version": "2.0.1", "url": "https://launcher-storage.millida.net/d/1.zst", "size": 10, "sha256": good, "mirror": "https://github.com/x/1.zst" },
                { "from": "short", "url": "https://x/2.zst", "size": 10, "sha256": good },
                { "from": good, "url": "http://x/3.zst", "size": 10, "sha256": good },
                { "from": good, "url": "https://x/4.zst", "size": 0, "sha256": good }
            ]
        });
        let offer = parse_offer(&doc).expect("a good offer parses");
        assert_eq!(offer.patches.len(), 1, "only the well-formed patch stays");
        assert_eq!(offer.patches[0].mirror.as_deref(), Some("https://github.com/x/1.zst"));
        assert!(pick(&offer, &good).is_some());
        assert!(pick(&offer, &"b".repeat(64)).is_none(), "no patch for an exe the release does not know");

        for (why, doc) in [
            ("an unknown version", serde_json::json!({ "v": 2, "exe": doc["exe"], "patches": doc["patches"] })),
            ("no exe", serde_json::json!({ "v": 1, "patches": doc["patches"] })),
            ("an exe with no signature", serde_json::json!({ "v": 1, "exe": { "size": 1000, "sha256": good, "signature": " " }, "patches": doc["patches"] })),
            ("an exe of a silly size", serde_json::json!({ "v": 1, "exe": { "size": u64::MAX, "sha256": good, "signature": "c2ln" }, "patches": doc["patches"] })),
            ("no usable patch", serde_json::json!({ "v": 1, "exe": doc["exe"], "patches": [] })),
        ] {
            assert!(parse_offer(&doc).is_none(), "{why}");
        }
    }

    /// swap: the new exe takes the old name, the old one stays aside, and a failure puts everything back
    #[test]
    fn the_swap_keeps_the_old_exe_aside_and_rolls_back_on_failure() {
        let dir = scratch("swap");
        let (target, staged) = (dir.join("millida-launcher.exe"), dir.join("staged.delta.exe"));
        std::fs::write(&target, b"old exe").unwrap();
        std::fs::write(&staged, b"new exe, longer").unwrap();
        swap_in(&staged, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new exe, longer");
        assert_eq!(std::fs::read(dir.join("millida-launcher.exe.millida-prev")).unwrap(), b"old exe");
        assert!(!dir.join("millida-launcher.exe.millida-new").exists());

        // a second swap replaces the leftover aside
        std::fs::write(&staged, b"third").unwrap();
        swap_in(&staged, &target).unwrap();
        assert_eq!(std::fs::read(dir.join("millida-launcher.exe.millida-prev")).unwrap(), b"new exe, longer");

        // nothing staged: the running exe is untouched
        let before = std::fs::read(&target).unwrap();
        assert!(swap_in(&dir.join("missing.delta.exe"), &target).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), before, "a failed swap leaves the launcher as it was");
    }

    #[test]
    fn staged_files_are_recognised_by_their_name() {
        assert!(is_delta_file(Path::new("/x/updates/millida-launcher-2.0.9.delta.exe")));
        assert!(!is_delta_file(Path::new("/x/updates/Millida-Launcher_2.0.9_x64-setup.exe")));
        assert_eq!(staged_name("2.0.9"), "millida-launcher-2.0.9.delta.exe");
        let odd = staged_name("../2.0\\9");
        assert!(!odd.contains('/') && !odd.contains('\\') && odd.ends_with(DELTA_SUFFIX), "no path pieces get into the name: {odd}");
    }
}
