fn main() {
    println!("cargo:rerun-if-env-changed=MILLIDA_MS_CLIENT_ID");
    tauri_build::build()
}
