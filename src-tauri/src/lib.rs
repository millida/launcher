use tauri::Manager;

pub mod engine;
mod discord;
mod secrets;
mod commands;
pub mod tray;
mod overlay;
mod mic;
mod display;

/// Directories the webview may read through `asset://`: the media files it
/// plays and shows plus the images a theme pack ships, nothing else. The token
/// vault (`secrets.bin`, `vault.key`) sits directly under `data_dir()` and
/// imported files land in `game_root()/profiles/...`, so neither root may ever
/// be granted — an XSS would read the vault and any copied file straight out of
/// the scope. Skins, capes and head avatars need no grant at all: they reach
/// the UI as data URLs. Screenshots are granted per file when the webview asks
/// for the list (see `commands::profiles::list_screenshots`).
pub fn asset_dirs() -> Vec<std::path::PathBuf> {
    let data = engine::data_dir();
    vec![data.join("wallpaper"), data.join("music"), data.join("sounds"), data.join("themes")]
}

pub fn allow_assets(app: &tauri::AppHandle) {
    let scope = app.asset_protocol_scope();
    for dir in asset_dirs() {
        std::fs::create_dir_all(&dir).ok();
        let _ = scope.allow_directory(&dir, true);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // Portable builds never run an installer, so the deep link scheme is
            // registered at startup as well.
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }
            engine::install_panic_hook(env!("CARGO_PKG_VERSION").to_string());
            allow_assets(app.handle());
            tray::init(app.handle());
            engine::arm_selfheal(app.handle());
            engine::arm_dialogs(app.handle());
            if let Some(w) = app.get_webview_window("main") {
                mic::allow_microphone(&w);
            }
            display::watch(app.handle());
            overlay::rebind_hotkey(app.handle());
            if let Ok(mode) = std::env::var("MILLIDA_AUTOTEST") {
                let h = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let existing = std::env::var("MILLIDA_AUTOTEST_PROFILE").ok()
                        .and_then(|n| engine::load_profiles().into_iter().find(|p| p.name == n));
                    let (name, version) = match existing {
                        Some(p) => (p.name.clone(), p.version.clone()),
                        None => {
                            let loader = if mode == "1" { "vanilla".to_string() } else { mode.clone() };
                            let name = format!("test-{}", loader);
                            let version = std::env::var("MILLIDA_AUTOTEST_VERSION").unwrap_or_else(|_| "1.21.4".into());
                            let mut all = engine::load_profiles();
                            all.retain(|p| p.name != name);
                            all.insert(0, engine::Profile{ name: name.clone(), version: version.clone(), fabric: loader=="fabric", loader: Some(loader.clone()), loader_version: None, icon: None });
                            let _ = engine::save_profiles(&all);
                            (name, version)
                        }
                    };
                    let started = std::time::Instant::now();
                    match engine::install_and_launch_in(h, version, "Grash".into(), false, 0, name, engine::Auth::default()).await {
                        Ok(_) => eprintln!("[AUTOTEST] OK: game started in {} ms", started.elapsed().as_millis()),
                        Err(e) => eprintln!("[AUTOTEST] FAIL: {}", e),
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::content::core_version,
            commands::system::app_version,
            commands::system::device_specs,
            commands::system::read_crashes,
            commands::system::clear_crashes,
            commands::launch::launch_game,
            commands::content::install_mod,
            commands::content::list_versions,
            commands::content::list_loader_versions,
            commands::profiles::list_profiles,
            commands::profiles::create_profile,
            commands::profiles::launch_profile,
            commands::profiles::install_modpack,
            commands::profiles::install_modpack_version,
            commands::profiles::cf_install_modpack,
            commands::system::open_url,
            commands::launch::cancel_launch,
            commands::launch::stop_game,
            commands::launch::running_games,
            commands::system::game_dir,
            commands::system::set_game_dir,
            commands::system::pick_game_dir,
            commands::system::open_game_folder,
            commands::system::pick_wallpaper,
            commands::system::pick_texture,
            commands::system::music_tracks,
            commands::system::open_music_folder,
            commands::system::download_mc_music,
            commands::system::ui_sounds,
            commands::system::download_ui_sounds,
            commands::content::list_mods,
            commands::content::toggle_mod,
            commands::content::delete_mod,
            commands::profiles::delete_profile,
            commands::profiles::rename_profile,
            commands::profiles::set_profile_loader,
            commands::profiles::open_profile_folder,
            commands::accounts::discord_presence,
            commands::accounts::discord_status,
            commands::accounts::discord_reconnect,
            commands::accounts::discord_clear,
            commands::content::install_content,
            commands::content::list_content,
            commands::content::dep_plan,
            commands::content::install_dep_items,
            commands::content::audit_deps,
            commands::content::scan_content_local,
            commands::content::scan_content,
            commands::content::toggle_content,
            commands::content::delete_content,
            commands::launch::list_logs,
            commands::launch::read_log,
            commands::profiles::duplicate_profile,
            commands::profiles::save_profile_settings,
            commands::profiles::set_profile_java_major,
            commands::profiles::load_profile_settings,
            commands::profiles::set_profile_gpu,
            commands::profiles::gpu_switch_supported,
            commands::profiles::skin_mod_state,
            commands::profiles::set_skin_mod,
            commands::profiles::fps_boost_state,
            commands::profiles::set_fps_boost,
            commands::profiles::scan_imports,
            commands::profiles::import_instance,
            commands::profiles::import_pack_file,
            commands::accounts::ms_device_start,
            commands::accounts::ms_device_poll,
            commands::accounts::ms_session_commit,
            commands::accounts::ms_session_refresh,
            commands::accounts::ms_session_validate,
            commands::accounts::ms_session_forget,
            commands::accounts::mc_textures,
            commands::accounts::ms_profile,
            commands::accounts::ms_set_cape,
            commands::accounts::ms_upload_skin,
            commands::accounts::ms_reset_skin,
            commands::launch::list_worlds,
            commands::launch::list_servers,
            commands::launch::add_server,
            commands::launch::remove_server,
            commands::launch::pin_server_dat,
            commands::launch::quick_play,
            commands::profiles::set_profile_icon,
            commands::profiles::pick_profile_cover,
            commands::profiles::clear_profile_cover,
            commands::content::check_updates,
            commands::content::update_content,
            commands::content::update_all,
            commands::content::add_local_file,
            commands::content::pick_content_files,
            commands::content::export_mrpack,
            commands::content::install_version,
            commands::content::cf_search,
            commands::content::cf_install,
            commands::content::cf_project,
            commands::content::cf_files,
            commands::content::cf_install_world,
            commands::content::list_world_installs,
            commands::content::active_installs,
            commands::content::cancel_install,
            commands::launch::delete_world,
            commands::launch::detect_java,
            commands::launch::test_java,
            commands::launch::pick_java_path,
            commands::launch::default_java,
            commands::launch::set_default_java,
            commands::launch::java_majors,
            commands::launch::download_java_runtime,
            commands::launch::list_java_runtimes,
            commands::launch::remove_java_runtime,
            commands::launch::get_playtime,
            commands::launch::get_play_stats,
            commands::launch::label_server,
            commands::launch::share_log,
            commands::launch::backup_world,
            commands::launch::list_backups,
            commands::profiles::open_screenshots,
            commands::profiles::count_screenshots,
            commands::profiles::set_profile_group,
            commands::profiles::get_profile_groups,
            commands::profiles::modpack_versions,
            commands::profiles::update_modpack,
            commands::profiles::modpack_info,
            commands::profiles::list_screenshots,
            commands::accounts::millida_api,
            commands::accounts::millida_login_poll,
            commands::accounts::millida_logout,
            commands::accounts::session_status,
            commands::accounts::set_local_skin,
            commands::accounts::skin_diagnose,
            commands::accounts::list_textures,
            commands::accounts::save_texture,
            commands::accounts::fetch_texture,
            commands::accounts::export_png,
            commands::accounts::delete_texture,
            commands::accounts::set_texture_slim,
            commands::accounts::rename_texture,
            commands::accounts::head_avatar,
            commands::hosting::host_console_start,
            commands::hosting::host_console_stop,
            commands::hosting::host_download,
            commands::hosting::host_upload,
            commands::launch::ping_server,
            commands::launch::repair_profile,
            commands::system::cache_size,
            commands::system::clear_cache,
            commands::system::is_flatpak,
            commands::system::update_fallback_check,
            commands::system::update_fallback_stage,
            commands::system::update_fallback_run,
            commands::system::frontend_ready,
            commands::system::tray_available,
            commands::system::hide_to_tray,
            commands::system::show_from_tray,
            commands::system::set_restore_on_exit,
            commands::system::ui_prefs,
            commands::system::set_ui_pref,
            commands::overlay::overlay_state,
            commands::overlay::overlay_set_enabled,
            commands::overlay::overlay_set_hotkey,
            commands::overlay::overlay_notify,
            commands::overlay::overlay_hide,
            commands::themes::list_themes,
            commands::themes::read_theme,
            commands::themes::import_theme,
            commands::themes::delete_theme,
            commands::themes::open_themes_folder,
            commands::themes::export_theme,
            commands::themes::save_theme,
            commands::themes::add_theme_asset,
            commands::themes::catalog_themes,
            commands::themes::catalog_my_themes,
            commands::themes::catalog_install_theme,
            commands::themes::catalog_theme_installed,
            commands::themes::catalog_publish_theme,
            commands::themes::catalog_unpublish_theme,
            commands::themes::catalog_like_theme,
            commands::system::dedupe_scan,
            commands::system::dedupe_run,
            commands::system::dedupe_gc,
            commands::content::scan_mod_safety,
            commands::content::quarantine_mods,
            commands::launch::world_details,
            commands::launch::rename_world,
            commands::launch::duplicate_world,
            commands::launch::export_world,
            commands::launch::import_world,
            commands::launch::restore_world_backup,
            commands::launch::delete_world_backup,
            commands::launch::open_world_folder,
            commands::launch::apply_crash_fix,
            commands::launch::tune_profile,
            commands::launch::set_auto_tune,
            commands::profiles::screenshot_gallery,
            commands::profiles::delete_screenshot,
            commands::profiles::save_screenshot_as,
            commands::profiles::share_screenshot,
            commands::profiles::share_profile,
            commands::profiles::unshare_profile,
            commands::profiles::pack_preview,
            commands::profiles::install_shared_pack,
            commands::profiles::cloud_status,
            commands::profiles::cloud_push,
            commands::profiles::cloud_pull,
            commands::profiles::cloud_forget
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    /// Every permission the main window is allowed to hold. Adding an entry here
    /// is a deliberate act: read the failure message in `capabilities_are_pinned`
    /// before touching this list.
    const ALLOWED_PERMISSIONS: &[&str] = &[
        "core:event:allow-listen",
        "core:event:allow-unlisten",
        "core:window:allow-minimize",
        "core:window:allow-toggle-maximize",
        "core:window:allow-internal-toggle-maximize",
        "core:window:allow-close",
        "core:window:allow-destroy",
        "core:window:allow-start-dragging",
        "updater:allow-check",
        "updater:allow-download",
        "updater:allow-install",
        "deep-link:allow-get-current",
        "clipboard-manager:allow-write-text",
        "process:allow-restart",
        "process:allow-exit",
    ];

    /// Namespaces that only ever exist to move secret material around. A Tauri
    /// command carrying one of these in its name is reachable from JavaScript,
    /// so it hands the vault to anyone who lands an XSS in the webview.
    const VAULT_NOUNS: &[&str] = &["secret", "vault", "keyring", "keychain", "credential"];

    /// Accessors that turn a token-shaped name into a read/write of the vault.
    /// `token` alone is fine (`ms_token_expiry`), `token_get` is not.
    const TOKEN_ACCESSORS: &[&str] =
        &["get", "read", "all", "many", "list", "dump", "export", "copy", "reveal", "show"];

    fn capabilities_json() -> serde_json::Value {
        let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json"));
        serde_json::from_str(raw).expect("capabilities/default.json must be valid JSON")
    }

    /// The overlay is a second window over a running game. It holds no window
    /// controls and no plugin access on purpose: everything it can do goes
    /// through the app's own commands, which the core validates itself.
    const OVERLAY_PERMISSIONS: &[&str] = &["core:event:allow-listen", "core:event:allow-unlisten"];

    fn overlay_capabilities_json() -> serde_json::Value {
        let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/overlay.json"));
        serde_json::from_str(raw).expect("capabilities/overlay.json must be valid JSON")
    }

    #[test]
    fn overlay_capabilities_are_pinned() {
        let caps = overlay_capabilities_json();
        let actual: Vec<String> = caps["permissions"]
            .as_array()
            .expect("capabilities/overlay.json must contain a \"permissions\" array")
            .iter()
            .map(|p| p.as_str().expect("permissions must be plain strings").to_string())
            .collect();
        assert_eq!(
            actual, OVERLAY_PERMISSIONS,
            "the overlay window's permission set changed. It sits on top of the game and is the              easiest window to reach, so anything granted here should be argued for first."
        );
        let windows: Vec<String> = caps["windows"]
            .as_array()
            .expect("capabilities/overlay.json must name its windows")
            .iter()
            .map(|w| w.as_str().unwrap_or_default().to_string())
            .collect();
        assert_eq!(windows, vec!["overlay".to_string()], "this capability must not reach the main window");
    }

    fn registered_commands() -> Vec<String> {
        let src = include_str!("lib.rs");
        let start = src
            .find("generate_handler![")
            .expect("lib.rs must register its commands through tauri::generate_handler!");
        let body = &src[start + "generate_handler![".len()..];
        let end = body
            .find(']')
            .expect("the generate_handler! list must be closed with ']'");
        body[..end]
            .split(',')
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with("//"))
            .filter_map(|path| path.rsplit("::").next())
            .map(str::to_string)
            .collect()
    }

    fn looks_like_vault_access(command: &str) -> bool {
        let name = command.to_ascii_lowercase();
        if VAULT_NOUNS.iter().any(|noun| name.contains(noun)) {
            return true;
        }
        name.contains("token") && TOKEN_ACCESSORS.iter().any(|verb| name.contains(verb))
    }

    #[test]
    fn capabilities_are_pinned() {
        let caps = capabilities_json();
        let actual: Vec<String> = caps["permissions"]
            .as_array()
            .expect("capabilities/default.json must contain a \"permissions\" array")
            .iter()
            .map(|p| {
                p.as_str()
                    .expect("permissions must be plain strings, not scoped objects")
                    .to_string()
            })
            .collect();

        let added: Vec<&String> =
            actual.iter().filter(|p| !ALLOWED_PERMISSIONS.contains(&p.as_str())).collect();
        let removed: Vec<&&str> = ALLOWED_PERMISSIONS
            .iter()
            .filter(|p| !actual.iter().any(|a| a == *p))
            .collect();

        assert!(
            added.is_empty(),
            "capabilities/default.json grants permissions that this test does not know about: \
             {added:?}. The main window deliberately lists individual permissions instead of \
             `core:default`, because every permission the webview holds is reachable from \
             JavaScript — an XSS in the webview inherits the whole set. If the new permission is \
             genuinely needed, add it to ALLOWED_PERMISSIONS in src/lib.rs together with the \
             reason it is needed; do not widen the file back to `core:default`.",
        );
        assert!(
            removed.is_empty(),
            "capabilities/default.json no longer grants {removed:?}, which this test still expects. \
             Dropping a permission is fine and welcome — just delete it from ALLOWED_PERMISSIONS in \
             src/lib.rs so the pinned list keeps describing reality.",
        );
    }

    #[test]
    fn capabilities_never_use_the_default_permission_set() {
        let caps = capabilities_json();
        let raw = caps["permissions"].to_string();
        assert!(
            !raw.contains("core:default"),
            "capabilities/default.json pulls in `core:default`, which re-enables the full core \
             command surface (window, path, app, resources, webview) for the frontend. The window \
             is expected to hold only the {} permissions it actually uses.",
            ALLOWED_PERMISSIONS.len(),
        );
    }

    #[test]
    fn no_command_exposes_the_secret_vault() {
        let leaking: Vec<String> =
            registered_commands().into_iter().filter(|c| looks_like_vault_access(c)).collect();
        assert!(
            leaking.is_empty(),
            "these Tauri commands look like direct access to the secret vault: {leaking:?}. \
             Anything in generate_handler! can be invoked from the webview, so such a command \
             lets any XSS read or overwrite stored tokens. Secrets must stay inside Rust: expose \
             a command that performs the authenticated action (see millida_api_auth) instead of \
             one that returns the secret value.",
        );
    }

    #[test]
    fn command_list_is_actually_parsed() {
        let commands = registered_commands();
        assert!(
            commands.len() > 50,
            "only {} commands were parsed out of generate_handler! in lib.rs, which means the \
             parser in registered_commands() no longer matches the source layout — \
             no_command_exposes_the_secret_vault would then pass without checking anything.",
            commands.len(),
        );
        assert!(
            commands.iter().any(|c| c == "app_version"),
            "the well-known command `app_version` is missing from the parsed list, so \
             registered_commands() is reading the wrong text.",
        );
    }

    #[test]
    fn vault_access_heuristic_catches_the_removed_commands() {
        for name in ["secret_get", "secret_get_many", "secret_set", "secret_delete", "vault_dump", "get_keyring_entry", "token_get_all"] {
            assert!(
                looks_like_vault_access(name),
                "the heuristic must flag `{name}`; otherwise no_command_exposes_the_secret_vault \
                 would let it back into generate_handler! unnoticed.",
            );
        }
        for name in ["app_version", "millida_api", "ms_session_refresh", "list_profiles", "head_avatar"] {
            assert!(
                !looks_like_vault_access(name),
                "the heuristic flags the legitimate command `{name}`; it is too broad and would \
                 block ordinary work.",
            );
        }
    }

    fn app_config() -> serde_json::Value {
        let raw = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tauri.conf.json"));
        serde_json::from_str::<serde_json::Value>(raw)
            .expect("tauri.conf.json must stay valid JSON")["app"]
            .clone()
    }

    #[test]
    fn webview_cannot_reach_the_ipc_bridge_globally() {
        assert_eq!(
            app_config()["withGlobalTauri"],
            serde_json::Value::Bool(false),
            "withGlobalTauri exposes the whole IPC bridge as window.__TAURI__, so any injected \
             script reaches every command. The frontend imports what it needs from @tauri-apps \
             packages instead.",
        );
    }

    #[test]
    fn csp_still_blocks_injected_and_remote_scripts() {
        let csp = app_config()["security"]["csp"].clone();
        let list = |key: &str| -> Vec<String> {
            csp[key]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        };
        let scripts = list("script-src");
        assert_eq!(
            scripts,
            vec!["'self'".to_string()],
            "script-src must stay exactly 'self': 'unsafe-inline' or 'unsafe-eval' would let \
             injected markup run, and a remote origin would let it be loaded from the network.",
        );
        for key in ["object-src", "frame-src", "frame-ancestors", "form-action"] {
            assert_eq!(
                list(key),
                vec!["'none'".to_string()],
                "{key} must stay 'none'; widening it reopens a path for embedded or exfiltrating \
                 content.",
            );
        }
        assert_eq!(
            list("base-uri"),
            vec!["'self'".to_string()],
            "base-uri must stay 'self', otherwise injected markup can retarget every relative URL.",
        );
    }

    #[test]
    fn asset_protocol_scope_is_granted_at_runtime_only() {
        let scope = app_config()["security"]["assetProtocol"]["scope"].clone();
        assert_eq!(
            scope,
            serde_json::json!([]),
            "the static asset scope must stay empty. Runtime grants (see allow_assets) cover \
             media directories only; a wildcard such as $HOME/** would let an XSS read the whole \
             home directory.",
        );
    }

    /// directory -> verdict. The vault lives directly under data_dir() and
    /// imports land under game_root(), so granting either root to `asset://`
    /// hands the webview the tokens and every copied file.
    #[test]
    fn asset_dirs_never_include_a_vault_or_game_root() {
        let data = crate::engine::data_dir();
        let forbidden = [data.clone(), crate::engine::game_root(), data.join("..")];
        for dir in crate::asset_dirs() {
            for bad in &forbidden {
                assert_ne!(
                    &dir, bad,
                    "{} is served over asset://; secrets.bin, vault.key and imported files sit \
                     under it and would become readable from the webview.",
                    dir.display(),
                );
            }
            assert!(
                dir.starts_with(&data),
                "{} is outside data_dir(); the asset scope must not reach arbitrary paths.",
                dir.display(),
            );
        }
    }
}
