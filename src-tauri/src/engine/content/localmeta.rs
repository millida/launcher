use crate::engine::*;
use base64::Engine as _;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

const DESC_LIMIT: usize = 600;
const ICON_LIMIT: usize = 320_000;

/// Bumped whenever the parser starts extracting a new field: cache entries are
/// keyed by (size, mtime), so without it an old cache would keep answering with
/// fields the previous version never filled in.
const META_REV: u32 = 2;

/// Metadata read from the content file itself (fabric.mod.json, mods.toml,
/// mcmod.info, pack.mcmeta): works offline and for files unknown to Modrinth.
#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct LocalMeta {
    pub kind: String,
    pub file_name: String,
    #[serde(default)] pub size: u64,
    #[serde(default)] pub mtime: u64,
    #[serde(default)] pub title: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub version: String,
    #[serde(default)] pub authors: String,
    #[serde(default)] pub icon: String,
    #[serde(default)] pub mc: String,
    #[serde(default)] pub loader: String,
    /// Loader-level identity and relations, used by the dependency resolver for
    /// files that no catalog knows.
    #[serde(default)] pub mod_id: String,
    #[serde(default)] pub provides: Vec<String>,
    #[serde(default)] pub requires: Vec<String>,
    #[serde(default)] pub breaks: Vec<String>,
    #[serde(default)] pub meta_rev: u32,
}

/// Ids the loader itself answers for: asking the user to install "minecraft" or
/// "fabricloader" as a missing dependency would be noise, not a finding.
const ENV_IDS: &[&str] = &[
    "minecraft", "java", "mcp", "forge", "neoforge", "fml", "javafml", "lowcodefml",
    "fabricloader", "fabric-loader", "quilt_loader", "quilt_base", "quilt_loader_api",
];

pub fn is_env_mod_id(id: &str) -> bool {
    let low = id.to_ascii_lowercase();
    ENV_IDS.contains(&low.as_str())
}

fn push_id(out: &mut Vec<String>, id: &str) {
    let id = id.trim();
    if id.is_empty() || is_env_mod_id(id) || out.iter().any(|x| x == id) {
        return;
    }
    out.push(id.to_string());
}

type Jar = zip::ZipArchive<std::fs::File>;

fn clean_text(s: &str, limit: usize) -> String {
    let mut plain = String::with_capacity(s.len());
    let mut it = s.chars();
    while let Some(c) = it.next() {
        if c == '§' {
            it.next();
            continue;
        }
        plain.push(c);
    }
    let joined = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() > limit {
        joined.chars().take(limit).collect::<String>() + "…"
    } else {
        joined
    }
}

fn entry_bytes(jar: &mut Jar, name: &str) -> Option<Vec<u8>> {
    let mut f = jar.by_name(name).ok()?;
    let mut b = Vec::new();
    f.read_to_end(&mut b).ok()?;
    Some(b)
}

fn entry_text(jar: &mut Jar, name: &str) -> Option<String> {
    entry_bytes(jar, name).map(|b| String::from_utf8_lossy(&b).to_string())
}

/// Some mods ship fabric.mod.json with raw newlines inside string values,
/// which strict JSON rejects; retry with those characters escaped.
fn lenient_json(text: &str) -> Option<Value> {
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return Some(v);
    }
    let mut fixed = String::with_capacity(text.len());
    let mut in_str = false;
    let mut escaped = false;
    for c in text.chars() {
        match c {
            '"' if !escaped => {
                in_str = !in_str;
                fixed.push(c);
            }
            '\\' if in_str && !escaped => {
                escaped = true;
                fixed.push(c);
                continue;
            }
            '\n' | '\r' | '\t' if in_str => fixed.push(' '),
            _ => fixed.push(c),
        }
        escaped = false;
    }
    serde_json::from_str(&fixed).ok()
}

fn names_of(v: &Value) -> String {
    let one = |x: &Value| {
        x.as_str()
            .map(str::to_string)
            .or_else(|| x["name"].as_str().map(str::to_string))
    };
    if let Some(a) = v.as_array() {
        let list: Vec<String> = a.iter().filter_map(one).collect();
        return list.join(", ");
    }
    one(v).unwrap_or_default()
}

fn icon_of(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    v.as_object()
        .map(|o| {
            let mut best: (u32, String) = (0, String::new());
            for (k, val) in o {
                let px = k.parse::<u32>().unwrap_or(0);
                if px >= best.0 {
                    if let Some(p) = val.as_str() {
                        best = (px, p.to_string());
                    }
                }
            }
            best.1
        })
        .unwrap_or_default()
}

fn versions_of(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    v.as_array()
        .map(|a| a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "))
        .unwrap_or_default()
}

/// Loader manifests spell relations three ways — {"id": "range"}, ["id"] and
/// [{"id": …, "optional": true}] — and all three mean the same list of ids.
fn id_list(v: &Value, drop_optional: bool) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    if let Some(o) = v.as_object() {
        for k in o.keys() {
            push_id(&mut out, k);
        }
        return out;
    }
    for x in v.as_array().into_iter().flatten() {
        if let Some(s) = x.as_str() {
            push_id(&mut out, s);
            continue;
        }
        if drop_optional && x["optional"].as_bool() == Some(true) {
            continue;
        }
        if let Some(s) = x["id"].as_str() {
            push_id(&mut out, s);
        }
    }
    out
}

fn read_icon(jar: &mut Jar, candidates: &[String]) -> String {
    for name in candidates {
        let name = name.trim_start_matches('/');
        if name.is_empty() {
            continue;
        }
        let Some(bytes) = entry_bytes(jar, name) else { continue };
        if bytes.len() > ICON_LIMIT || bytes.len() < 8 {
            continue;
        }
        let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            "image/png"
        } else if bytes.starts_with(&[0xFF, 0xD8]) {
            "image/jpeg"
        } else {
            continue;
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return format!("data:{};base64,{}", mime, b64);
    }
    String::new()
}

fn toml_values(text: &str) -> HashMap<String, String> {
    let mut out: HashMap<String, String> = HashMap::new();
    let mut lines = text.lines().peekable();
    while let Some(line) = lines.next() {
        let t = line.trim();
        if t.starts_with('#') || t.starts_with('[') {
            continue;
        }
        let Some(eq) = t.find('=') else { continue };
        let key = t[..eq].trim().trim_matches('"').to_string();
        if key.is_empty() || key.contains(char::is_whitespace) {
            continue;
        }
        let raw = t[eq + 1..].trim();
        let mut value = String::new();
        let mut multi = false;
        for fence in ["'''", "\"\"\""] {
            let Some(rest) = raw.strip_prefix(fence) else { continue };
            multi = true;
            match rest.find(fence) {
                Some(end) => value = rest[..end].to_string(),
                None => {
                    value = rest.to_string();
                    for next in lines.by_ref() {
                        if let Some(end) = next.find(fence) {
                            value.push('\n');
                            value.push_str(&next[..end]);
                            break;
                        }
                        value.push('\n');
                        value.push_str(next);
                    }
                }
            }
            break;
        }
        if !multi {
            let cut = raw.trim();
            value = cut
                .strip_prefix('"')
                .and_then(|r| r.rfind('"').map(|e| r[..e].to_string()))
                .or_else(|| cut.strip_prefix('\'').and_then(|r| r.rfind('\'').map(|e| r[..e].to_string())))
                .unwrap_or_else(|| cut.to_string());
        }
        if value.contains("${") {
            continue;
        }
        out.entry(key).or_insert(value);
    }
    out
}

/// `toml_values` flattens the whole file, which is enough for display fields but
/// loses which `[[dependencies.x]]` block a `modId` belongs to. Splitting on
/// header lines first keeps every block separate while reusing one value parser.
fn toml_sections(text: &str) -> Vec<(String, HashMap<String, String>)> {
    let mut chunks: Vec<(String, Vec<&str>)> = vec![(String::new(), vec![])];
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') && t.ends_with(']') {
            chunks.push((t.trim_matches(|c| c == '[' || c == ']').to_string(), vec![]));
        } else if let Some(last) = chunks.last_mut() {
            last.1.push(line);
        }
    }
    chunks.into_iter().map(|(h, body)| (h, toml_values(&body.join("\n")))).collect()
}

/// Returns (own mod id, hard dependencies, incompatible mods). Forge marks a
/// dependency with `mandatory`, NeoForge switched to `type`, and files in the
/// wild carry either — a missing marker means required in both.
fn forge_relations(text: &str) -> (String, Vec<String>, Vec<String>) {
    let mut own = String::new();
    let (mut requires, mut breaks) = (vec![], vec![]);
    for (header, kv) in toml_sections(text) {
        if header == "mods" {
            if own.is_empty() {
                own = kv.get("modId").cloned().unwrap_or_default();
            }
            continue;
        }
        if !header.starts_with("dependencies.") {
            continue;
        }
        let Some(id) = kv.get("modId") else { continue };
        let ty = kv.get("type").map(|s| s.to_ascii_lowercase()).unwrap_or_default();
        let mandatory = match kv.get("mandatory") {
            Some(v) => v.trim() == "true",
            None => ty.is_empty() || ty == "required",
        };
        if ty == "incompatible" {
            push_id(&mut breaks, id);
        } else if mandatory {
            push_id(&mut requires, id);
        }
    }
    (own, requires, breaks)
}

/// Old Forge lists dependencies as "jei@[1.0,)"; only the id part is an id.
fn mcmod_ids(v: &Value) -> Vec<String> {
    let mut out = vec![];
    for x in v.as_array().into_iter().flatten() {
        let Some(s) = x.as_str() else { continue };
        push_id(&mut out, s.split(['@', '[', '(', ':']).next().unwrap_or(s));
    }
    out
}

fn pack_description(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_string();
    }
    if let Some(a) = v.as_array() {
        return a.iter().map(pack_description).collect::<Vec<_>>().join("");
    }
    if v.is_object() {
        let mut s = v["text"].as_str().unwrap_or("").to_string();
        if let Some(extra) = v["extra"].as_array() {
            for e in extra {
                s.push_str(&pack_description(e));
            }
        }
        return s;
    }
    String::new()
}

fn from_fabric(jar: &mut Jar, meta: &mut LocalMeta, quilt: bool) -> bool {
    let file = if quilt { "quilt.mod.json" } else { "fabric.mod.json" };
    let Some(text) = entry_text(jar, file) else { return false };
    let Some(v) = lenient_json(&text) else { return false };
    let root = if quilt { v["quilt_loader"]["metadata"].clone() } else { v.clone() };
    let id = if quilt {
        v["quilt_loader"]["id"].as_str().unwrap_or("").to_string()
    } else {
        v["id"].as_str().unwrap_or("").to_string()
    };
    meta.loader = if quilt { "quilt".into() } else { "fabric".into() };
    meta.title = clean_text(root["name"].as_str().unwrap_or(&id), 90);
    meta.description = clean_text(root["description"].as_str().unwrap_or(""), DESC_LIMIT);
    meta.version = clean_text(
        if quilt { v["quilt_loader"]["version"].as_str().unwrap_or("") } else { v["version"].as_str().unwrap_or("") },
        40,
    );
    let authors = if quilt { names_of(&root["contributors"]) } else { names_of(&v["authors"]) };
    meta.authors = clean_text(&authors, 120);
    meta.mc = clean_text(
        &versions_of(if quilt { &v["quilt_loader"]["depends"] } else { &v["depends"]["minecraft"] }),
        60,
    );
    meta.mod_id = id.clone();
    let (depends, breaks, provides) = if quilt {
        (&v["quilt_loader"]["depends"], &v["quilt_loader"]["breaks"], &v["quilt_loader"]["provides"])
    } else {
        (&v["depends"], &v["breaks"], &v["provides"])
    };
    meta.requires = id_list(depends, true);
    meta.breaks = id_list(breaks, false);
    meta.provides = id_list(provides, false);
    let mut icons = vec![icon_of(&root["icon"])];
    if !id.is_empty() {
        icons.push(format!("assets/{}/icon.png", id));
    }
    meta.icon = read_icon(jar, &icons);
    true
}

fn from_forge(jar: &mut Jar, meta: &mut LocalMeta) -> bool {
    let neo = entry_text(jar, "META-INF/neoforge.mods.toml");
    let is_neo = neo.is_some();
    let Some(text) = neo.or_else(|| entry_text(jar, "META-INF/mods.toml")) else { return false };
    let kv = toml_values(&text);
    meta.loader = if is_neo || text.to_lowercase().contains("neoforge") { "neoforge".into() } else { "forge".into() };
    meta.title = clean_text(kv.get("displayName").map(String::as_str).unwrap_or(""), 90);
    meta.description = clean_text(kv.get("description").map(String::as_str).unwrap_or(""), DESC_LIMIT);
    meta.version = clean_text(kv.get("version").map(String::as_str).unwrap_or(""), 40);
    meta.authors = clean_text(kv.get("authors").map(String::as_str).unwrap_or(""), 120);
    let (own, requires, breaks) = forge_relations(&text);
    meta.mod_id = own;
    meta.requires = requires;
    meta.breaks = breaks;
    let mut icons: Vec<String> = vec![];
    if let Some(logo) = kv.get("logoFile") {
        icons.push(logo.clone());
    }
    if let Some(id) = kv.get("modId") {
        icons.push(format!("assets/{}/icon.png", id));
    }
    meta.icon = read_icon(jar, &icons);
    true
}

fn from_mcmod_info(jar: &mut Jar, meta: &mut LocalMeta) -> bool {
    let Some(text) = entry_text(jar, "mcmod.info") else { return false };
    let Some(v) = lenient_json(&text) else { return false };
    let first = v.as_array().and_then(|a| a.first().cloned()).unwrap_or(v);
    meta.loader = "forge".into();
    meta.title = clean_text(first["name"].as_str().unwrap_or(""), 90);
    meta.description = clean_text(first["description"].as_str().unwrap_or(""), DESC_LIMIT);
    meta.version = clean_text(first["version"].as_str().unwrap_or(""), 40);
    meta.authors = clean_text(&names_of(&first["authorList"]), 120);
    meta.mc = clean_text(first["mcversion"].as_str().unwrap_or(""), 60);
    meta.mod_id = first["modid"].as_str().unwrap_or("").to_string();
    meta.requires = mcmod_ids(&first["requiredMods"]);
    if meta.requires.is_empty() {
        meta.requires = mcmod_ids(&first["dependencies"]);
    }
    let mut icons: Vec<String> = vec![];
    if let Some(logo) = first["logoFile"].as_str() {
        icons.push(logo.to_string());
    }
    meta.icon = read_icon(jar, &icons);
    true
}

fn from_pack(jar: &mut Jar, meta: &mut LocalMeta) -> bool {
    let Some(text) = entry_text(jar, "pack.mcmeta") else { return false };
    let Some(v) = lenient_json(&text) else { return false };
    meta.description = clean_text(&pack_description(&v["pack"]["description"]), DESC_LIMIT);
    meta.icon = read_icon(jar, &["pack.png".to_string()]);
    true
}

/// Shader packs are plain zips without a manifest, so fall back to a cover
/// image and a readable name derived from the file name.
fn from_shader(jar: &mut Jar, meta: &mut LocalMeta) -> bool {
    let candidates: Vec<String> = jar
        .file_names()
        .filter(|n| {
            let low = n.to_lowercase();
            low.ends_with("pack.png") || low.ends_with("shader.png") || low.ends_with("thumbnail.png")
        })
        .map(str::to_string)
        .take(4)
        .collect();
    if candidates.is_empty() {
        return false;
    }
    meta.icon = read_icon(jar, &candidates);
    !meta.icon.is_empty()
}

fn title_from_file(name: &str) -> String {
    let base = name
        .trim_end_matches(".disabled")
        .trim_end_matches(".jar")
        .trim_end_matches(".zip")
        .trim_end_matches(".litemod");
    let cut = base
        .split(['+'])
        .next()
        .unwrap_or(base)
        .rsplit_once('-')
        .filter(|(head, tail)| !head.is_empty() && tail.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|(head, _)| head.to_string())
        .unwrap_or_else(|| base.to_string());
    clean_text(&cut.replace(['_', '.'], " "), 90)
}

pub fn read_file_meta(path: &Path, kind: &str, file_name: &str) -> LocalMeta {
    let mut meta = LocalMeta {
        kind: kind.to_string(),
        file_name: file_name.to_string(),
        meta_rev: META_REV,
        ..Default::default()
    };
    if let Ok(md) = std::fs::metadata(path) {
        meta.size = md.len();
        meta.mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
    }
    if let Ok(f) = std::fs::File::open(path) {
        if let Ok(mut jar) = zip::ZipArchive::new(f) {
            let parsed = from_fabric(&mut jar, &mut meta, false)
                || from_fabric(&mut jar, &mut meta, true)
                || from_forge(&mut jar, &mut meta)
                || from_mcmod_info(&mut jar, &mut meta)
                || from_pack(&mut jar, &mut meta);
            if !parsed {
                from_shader(&mut jar, &mut meta);
            }
        }
    }
    if meta.title.is_empty() {
        meta.title = title_from_file(file_name);
    }
    meta
}

fn local_meta_path(profile: &str) -> PathBuf { profile_dir(profile).join("millida-local-meta.json") }

pub fn load_local_meta(profile: &str) -> Vec<LocalMeta> {
    std::fs::read(local_meta_path(profile))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_local_meta(profile: &str, all: &[LocalMeta]) {
    if let Some(p) = local_meta_path(profile).parent() {
        std::fs::create_dir_all(p).ok();
    }
    write_json_quiet(&local_meta_path(profile), all);
}

fn content_files(profile: &str, kind: &str) -> Vec<(String, PathBuf)> {
    let dir = profile_dir(profile).join(content_dir(kind));
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(&dir) else { return out };
    for e in rd.flatten() {
        let path = e.path();
        if !path.is_file() {
            continue;
        }
        let raw = e.file_name().to_string_lossy().to_string();
        let name = raw.strip_suffix(".disabled").unwrap_or(&raw).to_string();
        if !(name.ends_with(".jar") || name.ends_with(".zip") || name.ends_with(".litemod")) {
            continue;
        }
        out.push((name, path));
    }
    out
}

/// Results are cached per file until its size or mtime changes.
pub fn scan_local_meta(profile: &str, kind: &str, force: bool) -> Vec<LocalMeta> {
    let cached = load_local_meta(profile);
    let files = content_files(profile, kind);
    let mut fresh: Vec<LocalMeta> = vec![];
    for (name, path) in &files {
        let md = std::fs::metadata(path).ok();
        let size = md.as_ref().map(|m| m.len()).unwrap_or(0);
        let mtime = md
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let hit = cached.iter().find(|c| {
            c.kind == kind && &c.file_name == name && c.size == size && c.mtime == mtime && c.meta_rev == META_REV
        });
        match hit {
            Some(c) if !force => fresh.push(c.clone()),
            _ => fresh.push(read_file_meta(path, kind, name)),
        }
    }
    let mut all: Vec<LocalMeta> = cached.into_iter().filter(|c| c.kind != kind).collect();
    all.extend(fresh.iter().cloned());
    save_local_meta(profile, &all);
    fresh
}

pub fn local_meta_map(profile: &str, kind: &str) -> HashMap<String, LocalMeta> {
    load_local_meta(profile)
        .into_iter()
        .filter(|m| m.kind == kind)
        .map(|m| (m.file_name.clone(), m))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn make_jar(path: &Path, entries: &[(&str, &[u8])]) {
        let f = std::fs::File::create(path).unwrap();
        let mut w = zip::ZipWriter::new(f);
        for (name, body) in entries {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(body).unwrap();
        }
        w.finish().unwrap();
    }

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join("millida-meta-test");
        std::fs::create_dir_all(&p).unwrap();
        p.join(name)
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4];

    #[test]
    fn fabric_mod_gives_title_description_and_icon() {
        let jar = tmp("fabric.jar");
        make_jar(
            &jar,
            &[
                (
                    "fabric.mod.json",
                    br#"{"id":"sodium","version":"0.6.0","name":"Sodium","description":"Fast\nrenderer","authors":["JellySquid"],"icon":"assets/sodium/icon.png","depends":{"minecraft":["1.21","1.21.1"]}}"#,
                ),
                ("assets/sodium/icon.png", PNG),
            ],
        );
        let m = read_file_meta(&jar, "mod", "sodium.jar");
        assert_eq!(m.title, "Sodium");
        assert_eq!(m.description, "Fast renderer");
        assert_eq!(m.version, "0.6.0");
        assert_eq!(m.authors, "JellySquid");
        assert_eq!(m.mc, "1.21, 1.21.1");
        assert_eq!(m.loader, "fabric");
        assert!(m.icon.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn forge_toml_multiline_description_is_read() {
        let jar = tmp("forge.jar");
        make_jar(
            &jar,
            &[(
                "META-INF/mods.toml",
                br#"modLoader="javafml"
[[mods]]
modId="jei"
displayName="Just Enough Items"
version="${file.jarVersion}"
authors="mezz"
logoFile="logo.png"
description='''
Item and recipe
viewing mod.
'''
"#,
            ), ("logo.png", PNG)],
        );
        let m = read_file_meta(&jar, "mod", "jei.jar");
        assert_eq!(m.title, "Just Enough Items");
        assert_eq!(m.description, "Item and recipe viewing mod.");
        assert_eq!(m.authors, "mezz");
        assert_eq!(m.version, "");
        assert_eq!(m.loader, "forge");
        assert!(m.icon.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn resourcepack_description_comes_from_pack_mcmeta() {
        let zip = tmp("pack.zip");
        make_jar(
            &zip,
            &[
                ("pack.mcmeta", r#"{"pack":{"pack_format":34,"description":"§aFaithful 32x"}}"#.as_bytes()),
                ("pack.png", PNG),
            ],
        );
        let m = read_file_meta(&zip, "resourcepack", "Faithful32x.zip");
        assert_eq!(m.description, "Faithful 32x");
        assert_eq!(m.title, "Faithful32x");
        assert!(m.icon.starts_with("data:image/png;base64,"));
    }

    /// The resolver only ever sees what this parser extracts: a dependency it
    /// misses is a build that starts and crashes with no warning shown.
    #[test]
    fn fabric_relations_are_read_and_environment_ids_dropped() {
        let jar = tmp("fabric-deps.jar");
        make_jar(
            &jar,
            &[(
                "fabric.mod.json",
                br#"{"id":"rei","version":"14.0","name":"REI","provides":["roughlyenoughitems"],
                     "depends":{"minecraft":"1.21","java":">=17","cloth-config":"*","architectury":"*"},
                     "breaks":{"jei":"*"}}"#,
            )],
        );
        let m = read_file_meta(&jar, "mod", "rei.jar");
        assert_eq!(m.mod_id, "rei");
        assert_eq!(m.provides, vec!["roughlyenoughitems".to_string()]);
        let mut requires = m.requires.clone();
        requires.sort();
        assert_eq!(requires, vec!["architectury".to_string(), "cloth-config".to_string()],
            "minecraft and java are answered by the loader, not by a mod the user must install");
        assert_eq!(m.breaks, vec!["jei".to_string()]);
    }

    #[test]
    fn quilt_relations_come_from_the_loader_block() {
        let jar = tmp("quilt-deps.jar");
        make_jar(
            &jar,
            &[(
                "quilt.mod.json",
                br#"{"quilt_loader":{"id":"modmenu","version":"9.0","metadata":{"name":"Mod Menu"},
                     "depends":[{"id":"quilt_base","versions":"*"},{"id":"cloth-config","versions":"*"},
                                {"id":"sodium","versions":"*","optional":true}],
                     "breaks":[{"id":"oldmenu"}]}}"#,
            )],
        );
        let m = read_file_meta(&jar, "mod", "modmenu.jar");
        assert_eq!(m.mod_id, "modmenu");
        assert_eq!(m.requires, vec!["cloth-config".to_string()],
            "an optional dependency must never be reported as missing");
        assert_eq!(m.breaks, vec!["oldmenu".to_string()]);
    }

    /// Forge marks a dependency with `mandatory`, NeoForge with `type`, and both
    /// spellings live side by side in the wild.
    #[test]
    fn forge_dependency_blocks_keep_their_own_mod_ids() {
        let jar = tmp("forge-deps.jar");
        make_jar(
            &jar,
            &[(
                "META-INF/mods.toml",
                br#"modLoader="javafml"
[[mods]]
modId="jei"
displayName="Just Enough Items"
[[dependencies.jei]]
modId="forge"
mandatory=true
[[dependencies.jei]]
modId="architectury"
mandatory=true
[[dependencies.jei]]
modId="sodium"
mandatory=false
[[dependencies.jei]]
modId="rei"
type="incompatible"
"#,
            )],
        );
        let m = read_file_meta(&jar, "mod", "jei.jar");
        assert_eq!(m.mod_id, "jei", "the id must come from [[mods]], not from a dependency block");
        assert_eq!(m.requires, vec!["architectury".to_string()]);
        assert_eq!(m.breaks, vec!["rei".to_string()]);
    }

    #[test]
    fn mcmod_info_dependencies_lose_their_version_ranges() {
        let jar = tmp("legacy-deps.jar");
        make_jar(
            &jar,
            &[(
                "mcmod.info",
                br#"[{"modid":"oldmod","name":"Old Mod","requiredMods":["forge@[14.0,)","cofhcore@[1.0,)"]}]"#,
            )],
        );
        let m = read_file_meta(&jar, "mod", "old.jar");
        assert_eq!(m.mod_id, "oldmod");
        assert_eq!(m.requires, vec!["cofhcore".to_string()]);
    }

    #[test]
    fn unknown_file_falls_back_to_readable_name() {
        let jar = tmp("plain.jar");
        make_jar(&jar, &[("nothing.txt", b"x")]);
        let m = read_file_meta(&jar, "mod", "CustomSkinLoader_Fabric-14.22.jar");
        assert_eq!(m.title, "CustomSkinLoader Fabric");
        assert!(m.description.is_empty());
    }
}
