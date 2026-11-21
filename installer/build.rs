fn main() {
    // The icon and the manifest (Common Controls v6: TaskDialogIndirect lives only there) are compiled
    // by winresource, which runs on a Windows host. A cross build from another host used to skip them
    // without a word and ship a setup that failed at start; now it stops here instead.
    let for_windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    #[cfg(not(windows))]
    if for_windows {
        panic!("the Windows setup must be built on a Windows host: its manifest and icon are compiled there");
    }
    #[cfg(windows)]
    if for_windows {
        println!("cargo:rerun-if-changed=setup.manifest");
        println!("cargo:rerun-if-changed=../src-tauri/icons/icon.ico");
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../src-tauri/icons/icon.ico");
        res.set_manifest_file("setup.manifest");
        res.set("ProductName", "Millida Launcher");
        res.set("FileDescription", "Установщик Millida Launcher");
        res.set("CompanyName", "Roman Babaskin");
        res.set("LegalCopyright", "© 2026 Millida (Roman Babaskin)");
        res.set("OriginalFilename", "MillidaLauncherSetup.exe");
        res.set_version_info(winresource::VersionInfo::FILEVERSION, 1 << 48);
        res.set_version_info(winresource::VersionInfo::PRODUCTVERSION, 1 << 48);
        res.compile().expect("не собрались ресурсы установщика");
        static_vcruntime();
    }
}

/// vcruntime goes inside the exe. With the default dynamic runtime the stub imported VCRUNTIME140.dll and on a PC
/// without the Visual C++ Redistributable died before main with «VCRUNTIME140.dll not found» (report 14.11.2026).
/// Link arguments rather than `+crt-static`: the public build sets RUSTFLAGS, which would override a
/// .cargo/config.toml. The UCRT stays dynamic: every Windows 10 and later has it. The same trick as
/// tauri-build's static_vcruntime.rs (from github.com/ChrisDenton/static_vcruntime).
#[cfg(windows)]
fn static_vcruntime() {
    use std::io::Write;
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc") {
        return;
    }
    if std::env::var("CARGO_CFG_TARGET_FEATURE").is_ok_and(|f| f.split(',').any(|x| x == "crt-static")) {
        return;
    }
    // rustc hard-codes msvcrt.lib: an (almost) empty library of that name in OUT_DIR takes its place.
    let machine: &[u8] = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("x86_64") => &[0x64, 0x86],
        Ok("x86") => &[0x4C, 0x01],
        _ => return,
    };
    let bytes: &[u8] = &[
        1, 0, 94, 3, 96, 98, 60, 0, 0, 0, 1, 0, 0, 0, 0, 0, 132, 1, 46, 100, 114, 101, 99, 116, 118, 101, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 16, 0, 46, 100, 114, 101, 99,
        116, 118, 101, 0, 0, 0, 0, 1, 0, 0, 0, 3, 0, 4, 0, 0, 0,
    ];
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR");
    let path = std::path::Path::new(&out_dir).join("msvcrt.lib");
    if let Ok(mut f) = std::fs::OpenOptions::new().write(true).create_new(true).open(path) {
        f.write_all(machine).expect("msvcrt.lib");
        f.write_all(bytes).expect("msvcrt.lib");
    }
    println!("cargo:rustc-link-search=native={out_dir}");
    for lib in ["libvcruntimed.lib", "vcruntime.lib", "vcruntimed.lib", "libcmtd.lib", "msvcrt.lib", "msvcrtd.lib", "libucrt.lib", "libucrtd.lib"] {
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:{lib}");
    }
    for lib in ["libcmt.lib", "libvcruntime.lib", "ucrt.lib"] {
        println!("cargo:rustc-link-arg=/DEFAULTLIB:{lib}");
    }
}
