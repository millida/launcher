// Entry point: calls run() from lib.rs right away. The attribute below only hides the black console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    millida_launcher_lib::run()
}
