use millida_launcher_lib::engine;
use std::io::Read;

#[test]
fn export_mrpack_roundtrip() {
    let profile = "millida-test-export-xyz";
    let _ = std::fs::remove_dir_all(engine::profile_dir(profile));
    std::fs::create_dir_all(engine::profile_dir(profile).join("mods")).unwrap();
    std::fs::create_dir_all(engine::profile_dir(profile).join("config")).unwrap();

    std::fs::write(engine::profile_dir(profile).join("mods/sodium.jar"), b"fake-jar-bytes").unwrap();
    std::fs::write(engine::profile_dir(profile).join("config/custom.toml"), b"a=1").unwrap();

    engine::save_content_manifest(profile, &[engine::ContentEntry {
        kind: "mod".into(),
        file_name: "sodium.jar".into(),
        project_id: "AABBCCDD".into(),
        version_id: "v123".into(),
        version_number: "0.5.8".into(),
        title: "Sodium".into(),
        icon_url: String::new(),
        description: String::new(),
        author: String::new(),
        download_url: "https://cdn.modrinth.com/data/AABBCCDD/versions/v123/sodium.jar".into(),
        sha1: "1111111111111111111111111111111111111111".into(),
        sha512: "2222".into(),
        file_size: 13,
    }]);

    let out = engine::data_dir().join("tmp").join("test-export.mrpack");
    let _ = std::fs::remove_file(&out);
    let res = engine::export_mrpack(
        profile.into(),
        out.to_string_lossy().to_string(),
        "Тестовая сборка".into(),
        "2.0.0".into(),
        "описание".into(),
    ).expect("export must succeed");
    assert!(std::path::Path::new(&res).exists(), "mrpack file created");

    let f = std::fs::File::open(&out).unwrap();
    let mut zip = zip::ZipArchive::new(f).unwrap();
    let mut names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
    names.sort();
    assert!(names.iter().any(|n| n == "modrinth.index.json"), "index present, got {:?}", names);
    assert!(names.iter().any(|n| n == "overrides/config/custom.toml"), "unknown file → overrides, got {:?}", names);
    assert!(!names.iter().any(|n| n == "overrides/mods/sodium.jar"), "known file must NOT be in overrides");

    let mut idx_s = String::new();
    zip.by_name("modrinth.index.json").unwrap().read_to_string(&mut idx_s).unwrap();
    let idx: serde_json::Value = serde_json::from_str(&idx_s).unwrap();
    assert_eq!(idx["versionId"], "2.0.0");
    assert!(idx["dependencies"]["fabric-loader"].is_null(), "vanilla profile → no loader dep");
    let files = idx["files"].as_array().unwrap();
    assert_eq!(files.len(), 1, "one known file in index");
    assert_eq!(files[0]["path"], "mods/sodium.jar");
    assert_eq!(files[0]["hashes"]["sha1"], "1111111111111111111111111111111111111111");
    assert_eq!(files[0]["downloads"][0], "https://cdn.modrinth.com/data/AABBCCDD/versions/v123/sodium.jar");

    let _ = std::fs::remove_dir_all(engine::profile_dir(profile));
    let _ = std::fs::remove_file(&out);
}
