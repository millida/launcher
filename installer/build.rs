fn main() {
    #[cfg(windows)]
    {
        println!("cargo:rerun-if-changed=setup.manifest");
        println!("cargo:rerun-if-changed=../src-tauri/icons/icon.ico");
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../src-tauri/icons/icon.ico");
        res.set_manifest_file("setup.manifest");
        res.set("ProductName", "Millida Launcher");
        res.set("FileDescription", "Установщик Millida Launcher");
        res.set("CompanyName", "MARKET LINK LLC");
        res.set("LegalCopyright", "© 2026 Millida (MARKET LINK LLC)");
        res.set("OriginalFilename", "MillidaLauncherSetup.exe");
        res.set_version_info(winresource::VersionInfo::FILEVERSION, 1 << 48);
        res.set_version_info(winresource::VersionInfo::PRODUCTVERSION, 1 << 48);
        res.compile().expect("не собрались ресурсы установщика");
    }
}
