use std::fs;

/// Команды, которые нужны оверлею поверх игры (аудит 24.09.2026, S-01).
/// Список собран по коду окна: src/screens/Overlay.tsx, OverlayChat и то, что
/// они импортируют (чат друзей, сессия, аватары, акцент). Всё остальное оверлею
/// недоступно, даже если в нём окажется чужой скрипт.
const OVERLAY_COMMANDS: &[&str] = &[
    "overlay_state",
    "overlay_hide",
    "overlay_ready",
    "overlay_hit_areas",
    "overlay_open",
    "session_status",
    "millida_api",
    "head_avatar",
    "open_url",
    "ui_prefs",
];

/// Те же правила разбора, что и в тесте registered_commands (src/lib.rs):
/// список generate_handler! — единственный источник имён команд.
fn registered_commands(src: &str) -> Vec<String> {
    let start = src
        .find("generate_handler![")
        .expect("lib.rs must register its commands through tauri::generate_handler!");
    let body = &src[start + "generate_handler![".len()..];
    let end = body.find(']').expect("the generate_handler! list must be closed with ']'");
    body[..end]
        .lines()
        .map(|l| l.split("//").next().unwrap_or(""))
        .flat_map(|l| l.split(','))
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.rsplit("::").next())
        .map(str::to_string)
        .collect()
}

fn permission(cmd: &str) -> String {
    format!("\"allow-{}\"", cmd.replace('_', "-"))
}

fn set(identifier: &str, description: &str, cmds: &[String]) -> String {
    let list: Vec<String> = cmds.iter().map(|c| format!("  {}", permission(c))).collect();
    format!(
        "[[set]]\nidentifier = \"{identifier}\"\ndescription = \"{description}\"\npermissions = [\n{}\n]\n",
        list.join(",\n")
    )
}

fn main() {
    println!("cargo:rerun-if-env-changed=MILLIDA_MS_CLIENT_ID");
    println!("cargo:rerun-if-changed=src/lib.rs");

    let src = fs::read_to_string("src/lib.rs").expect("src/lib.rs");
    let all = registered_commands(&src);
    let overlay: Vec<String> = OVERLAY_COMMANDS.iter().map(|c| c.to_string()).collect();
    for c in &overlay {
        assert!(all.contains(c), "OVERLAY_COMMANDS names {c}, but lib.rs does not register it");
    }

    // Файл генерируется из lib.rs: руками не править.
    let toml = format!(
        "# Сгенерировано build.rs из generate_handler! в src/lib.rs. Руками не править.\n\n{}\n{}",
        set("main-commands", "Все команды ядра — только для главного окна", &all),
        set("overlay-commands", "Команды, которые нужны оверлею поверх игры", &overlay),
    );
    fs::create_dir_all("permissions").expect("permissions dir");
    let path = "permissions/app-commands.toml";
    if fs::read_to_string(path).ok().as_deref() != Some(toml.as_str()) {
        fs::write(path, &toml).expect("write permissions/app-commands.toml");
    }

    let names: &'static [&'static str] =
        Box::leak(all.into_iter().map(|c| &*Box::leak(c.into_boxed_str())).collect::<Vec<_>>().into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(names)),
    )
    .expect("tauri_build failed");
}
