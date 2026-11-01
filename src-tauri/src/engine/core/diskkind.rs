// Tells whether the folder the games live in sits on an SSD or a spinning disk. Only the drive's
// own answer is read (a query on the volume, `diskutil info` on macOS, the rotational flag in
// /sys on Linux); no admin rights, nothing written. The answer goes to usage statistics as one
// word, so slow launches can be told apart from slow disks.
use std::path::Path;

/// "ssd", "hdd" or "unknown".
pub fn disk_kind(path: &Path) -> &'static str {
    os::kind(path)
}

/// `Solid State:  Yes` from `diskutil info`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn kind_from_diskutil(text: &str) -> &'static str {
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        if key.trim().eq_ignore_ascii_case("solid state") {
            return match value.trim().to_ascii_lowercase().as_str() {
                "yes" => "ssd",
                "no" => "hdd",
                _ => "unknown",
            };
        }
    }
    "unknown"
}

/// Contents of /sys/dev/block/<maj>:<min>/queue/rotational.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn kind_from_rotational(flag: &str) -> &'static str {
    match flag.trim() {
        "0" => "ssd",
        "1" => "hdd",
        _ => "unknown",
    }
}

#[cfg(windows)]
mod os {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows_sys::Win32::System::Ioctl::{
        PropertyStandardQuery, StorageDeviceSeekPenaltyProperty, DEVICE_SEEK_PENALTY_DESCRIPTOR,
        IOCTL_STORAGE_QUERY_PROPERTY, STORAGE_PROPERTY_QUERY,
    };
    use windows_sys::Win32::System::IO::DeviceIoControl;

    /// `C:` out of `C:\Games\...`; network and device paths have no letter to ask about.
    fn drive_letter(path: &Path) -> Option<char> {
        let text = path.to_string_lossy();
        let mut chars = text.chars();
        let letter = chars.next()?;
        (letter.is_ascii_alphabetic() && chars.next() == Some(':')).then(|| letter.to_ascii_uppercase())
    }

    pub(super) fn kind(path: &Path) -> &'static str {
        let Some(letter) = drive_letter(path) else { return "unknown" };
        let name: Vec<u16> = std::ffi::OsString::from(format!("\\\\.\\{letter}:"))
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // Opens the volume with no access rights at all: enough to ask it about itself,
        // and it needs no administrator.
        // SAFETY: `name` is a NUL-terminated wide string that outlives the call.
        let handle = unsafe {
            CreateFileW(
                name.as_ptr(),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                std::ptr::null(),
                OPEN_EXISTING,
                0,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return "unknown";
        }
        let query = STORAGE_PROPERTY_QUERY {
            PropertyId: StorageDeviceSeekPenaltyProperty,
            QueryType: PropertyStandardQuery,
            AdditionalParameters: [0],
        };
        // SAFETY: plain-old-data structs, zeroed before the system fills them.
        let mut out: DEVICE_SEEK_PENALTY_DESCRIPTOR = unsafe { std::mem::zeroed() };
        let mut returned: u32 = 0;
        // SAFETY: the buffers are exactly the sizes passed, `handle` is open until CloseHandle.
        let ok = unsafe {
            DeviceIoControl(
                handle,
                IOCTL_STORAGE_QUERY_PROPERTY,
                &query as *const STORAGE_PROPERTY_QUERY as *const _,
                std::mem::size_of::<STORAGE_PROPERTY_QUERY>() as u32,
                &mut out as *mut DEVICE_SEEK_PENALTY_DESCRIPTOR as *mut _,
                std::mem::size_of::<DEVICE_SEEK_PENALTY_DESCRIPTOR>() as u32,
                &mut returned,
                std::ptr::null_mut(),
            )
        } != 0;
        // SAFETY: closes the handle opened above, once.
        unsafe { CloseHandle(handle) };
        match (ok, out.IncursSeekPenalty) {
            (false, _) => "unknown",
            (true, false) => "ssd",
            (true, true) => "hdd",
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn only_a_drive_letter_names_a_volume() {
            assert_eq!(drive_letter(Path::new(r"C:\Users\me\AppData")), Some('C'));
            assert_eq!(drive_letter(Path::new(r"d:\games")), Some('D'));
            assert_eq!(drive_letter(Path::new(r"\\server\share\games")), None);
            assert_eq!(drive_letter(Path::new(r"\\?\C:\games")), None);
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use std::path::Path;

    pub(super) fn kind(path: &Path) -> &'static str {
        // Starts the system tool that reports the drive behind a folder; its answer is only read.
        let out = std::process::Command::new("/usr/sbin/diskutil").arg("info").arg(path).output();
        match out {
            Ok(o) if o.status.success() => super::kind_from_diskutil(&String::from_utf8_lossy(&o.stdout)),
            _ => "unknown",
        }
    }
}

#[cfg(target_os = "linux")]
mod os {
    use std::os::unix::fs::MetadataExt;
    use std::path::Path;

    pub(super) fn kind(path: &Path) -> &'static str {
        let Ok(meta) = std::fs::metadata(path) else { return "unknown" };
        let dev = meta.dev();
        // glibc's major/minor split of st_dev.
        let major = ((dev >> 8) & 0xfff) | ((dev >> 32) & !0xfff);
        let minor = (dev & 0xff) | ((dev >> 12) & !0xff);
        let base = format!("/sys/dev/block/{major}:{minor}");
        // A partition keeps the flag on its parent disk.
        for flag in [format!("{base}/queue/rotational"), format!("{base}/../queue/rotational")] {
            if let Ok(text) = std::fs::read_to_string(flag) {
                return super::kind_from_rotational(&text);
            }
        }
        "unknown"
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
mod os {
    use std::path::Path;

    pub(super) fn kind(_path: &Path) -> &'static str {
        "unknown"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diskutil_says_solid_state_in_one_line() {
        let ssd = "   Device Node:   /dev/disk3s1s1\n   Solid State:   Yes\n   Removable Media: Fixed\n";
        let hdd = "   Solid State:   No\n";
        assert_eq!(kind_from_diskutil(ssd), "ssd");
        assert_eq!(kind_from_diskutil(hdd), "hdd");
        assert_eq!(kind_from_diskutil("   Volume Name:   Macintosh HD\n"), "unknown", "no line, no guess");
        assert_eq!(kind_from_diskutil("   Solid State:   Info not available\n"), "unknown");
    }

    #[test]
    fn the_rotational_flag_is_zero_for_ssd() {
        assert_eq!(kind_from_rotational("0\n"), "ssd");
        assert_eq!(kind_from_rotational("1\n"), "hdd");
        assert_eq!(kind_from_rotational(""), "unknown");
    }

    #[test]
    fn a_missing_folder_has_no_kind() {
        assert_eq!(disk_kind(Path::new("/definitely/not/here/millida")), "unknown");
    }
}
