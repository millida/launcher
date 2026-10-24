// Build templates: a build's game version, loader, settings, catalogue mods and options.txt saved under a name, to start new builds from.
// Kept in build-templates.json in the launcher data folder. Mods are re-downloaded from Modrinth and CurseForge by id when a template is used.
use crate::engine::*;
use tauri::AppHandle;

const TEMPLATES_FILE: &str = "build-templates.json";
const MAX_TEMPLATES: usize = 30;
const MAX_NAME: usize = 48;
const MAX_OPTIONS_BYTES: u64 = 64 * 1024;
const KINDS: [&str; 4] = ["mod", "resourcepack", "shader", "datapack"];
/// Settings a template carries; paths and per-machine choices stay behind.
const SETTINGS_KEYS: [&str; 7] = ["jvmArgs", "ramMb", "javaMajor", "javaVendor", "gpu", "width", "height"];

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateItem {
    pub kind: String,
    pub source: String,
    pub project_id: String,
    pub version_id: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildTemplate {
    pub id: String,
    pub name: String,
    pub version: String,
    pub loader: String,
    #[serde(default)]
    pub loader_version: Option<String>,
    #[serde(default)]
    pub settings: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub items: Vec<TemplateItem>,
    #[serde(default)]
    pub options: String,
    #[serde(default)]
    pub created: u64,
}

fn path() -> std::path::PathBuf {
    data_dir().join(TEMPLATES_FILE)
}

static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn list_build_templates() -> Vec<BuildTemplate> {
    std::fs::read(path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn save_all(all: &[BuildTemplate]) -> Result<(), String> {
    write_json_atomic(&path(), all).map_err(|e| format!("Не удалось сохранить шаблон: {}", e))
}

/// The catalogue a manifest entry can be fetched from again, by id.
pub(crate) fn item_of(e: &ContentEntry) -> Option<TemplateItem> {
    if !KINDS.contains(&e.kind.as_str()) || e.project_id.is_empty() || e.project_id.starts_with("millida:") {
        return None;
    }
    let (source, project) = match e.project_id.strip_prefix("cf:") {
        Some(id) => ("curseforge", id.to_string()),
        None => ("modrinth", e.project_id.clone()),
    };
    Some(TemplateItem { kind: e.kind.clone(), source: source.into(), project_id: project, version_id: e.version_id.clone() })
}

fn clean_name(name: &str, fallback: &str) -> String {
    let n: String = name.chars().filter(|c| !c.is_control()).take(MAX_NAME).collect::<String>().trim().to_string();
    if n.is_empty() { fallback.chars().take(MAX_NAME).collect() } else { n }
}

pub fn save_build_template(profile: &str, name: &str) -> Result<BuildTemplate, String> {
    let prof = load_profiles().into_iter().find(|p| p.name == profile).ok_or("Сборка не найдена — открой список сборок заново")?;
    refuse_protected(profile)?;
    let settings = profile_settings(profile);
    let mut kept = serde_json::Map::new();
    for k in SETTINGS_KEYS {
        if let Some(v) = settings.get(k).filter(|v| !v.is_null()) {
            kept.insert(k.into(), v.clone());
        }
    }
    let pdir = profile_dir(profile);
    let enabled = |e: &ContentEntry| pdir.join(content_dir(&e.kind)).join(&e.file_name).is_file();
    let items: Vec<TemplateItem> = load_content_manifest(profile).iter().filter(|e| enabled(e)).filter_map(item_of).collect();
    let options = std::fs::metadata(pdir.join("options.txt"))
        .ok()
        .filter(|m| m.len() <= MAX_OPTIONS_BYTES)
        .and_then(|_| std::fs::read_to_string(pdir.join("options.txt")).ok())
        .unwrap_or_default();
    let created = now_secs();
    let tpl = BuildTemplate {
        id: format!("t{}", created),
        name: clean_name(name, profile),
        version: prof.version.clone(),
        loader: prof.loader_id(),
        loader_version: prof.loader_version.clone(),
        settings: kept,
        items,
        options,
        created,
    };
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = list_build_templates();
    all.retain(|t| t.name != tpl.name);
    if all.len() >= MAX_TEMPLATES {
        return Err(format!("Шаблонов уже {} — удали ненужный", MAX_TEMPLATES));
    }
    all.insert(0, tpl.clone());
    save_all(&all)?;
    Ok(tpl)
}

pub fn delete_build_template(id: &str) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = list_build_templates();
    all.retain(|t| t.id != id);
    save_all(&all)
}

/// The template file may have been edited by hand: settings pass the same
/// checks as when the player types them.
fn safe_settings(s: &serde_json::Map<String, serde_json::Value>) -> serde_json::Map<String, serde_json::Value> {
    let mut out = serde_json::Map::new();
    for (k, v) in s {
        let ok = match k.as_str() {
            "jvmArgs" => v.as_str().is_some_and(|a| rejected_jvm_arg(a).is_none()),
            "javaMajor" => v.as_u64().is_some_and(|m| JAVA_MAJORS.contains(&m)),
            "javaVendor" => v.as_str().and_then(JavaVendor::parse).is_some(),
            "ramMb" => v.as_u64().is_some_and(|m| (512..=65536).contains(&m)),
            "gpu" => v.as_str().is_some(),
            "width" | "height" => v.as_u64().is_some_and(|n| n <= 16384),
            _ => false,
        };
        if ok {
            out.insert(k.clone(), v.clone());
        }
    }
    out
}

/// Fills a freshly created build from a template: settings and options.txt
/// first, then the catalogue files by their exact versions.
pub async fn apply_build_template(app: AppHandle, id: String, profile: String) -> Result<DepReport, String> {
    let tpl = list_build_templates().into_iter().find(|t| t.id == id).ok_or("Шаблон не найден — его удалили")?;
    if !load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена — открой список сборок заново".into());
    }
    merge_settings(&profile, safe_settings(&tpl.settings));
    if !tpl.options.is_empty() {
        let pdir = profile_dir(&profile);
        std::fs::create_dir_all(&pdir).map_err(|e| e.to_string())?;
        std::fs::write(pdir.join("options.txt"), tpl.options.as_bytes()).map_err(|e| format!("Не удалось записать настройки игры: {}", e))?;
    }
    let mut report = DepReport::default();
    for kind in KINDS {
        let items: Vec<PlanItem> = tpl
            .items
            .iter()
            .filter(|i| i.kind == kind)
            .map(|i| PlanItem { source: i.source.clone(), project_id: i.project_id.clone(), version_id: i.version_id.clone() })
            .collect();
        if items.is_empty() {
            continue;
        }
        let r = install_dep_items(app.clone(), profile.clone(), kind.to_string(), items).await?;
        report.installed.extend(r.installed);
        report.failed.extend(r.failed);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(kind: &str, pid: &str) -> ContentEntry {
        ContentEntry { kind: kind.into(), file_name: "a.jar".into(), project_id: pid.into(), version_id: "v1".into(), ..Default::default() }
    }

    /// (installed file) -> what the template keeps to fetch again.
    #[test]
    fn only_refetchable_files_enter_a_template() {
        assert_eq!(item_of(&entry("mod", "AANobbMI")).map(|i| i.source), Some("modrinth".into()), "a Modrinth mod is fetched by id");
        assert_eq!(item_of(&entry("mod", "cf:238222")).map(|i| (i.source, i.project_id)), Some(("curseforge".into(), "238222".into())), "a CurseForge mod keeps its numeric id");
        assert!(item_of(&entry("mod", "")).is_none(), "a hand-added jar has nothing to fetch it by");
        assert!(item_of(&entry("mod", "millida:pack")).is_none(), "a catalogue pack file needs its own access check");
        assert!(item_of(&entry("world", "cf:1")).is_none(), "worlds are not part of a template");
    }

    #[test]
    fn hand_edited_settings_are_checked_again() {
        let mut s = serde_json::Map::new();
        s.insert("jvmArgs".into(), serde_json::json!("-javaagent:evil.jar"));
        s.insert("ramMb".into(), serde_json::json!(4096));
        s.insert("javaPath".into(), serde_json::json!("C:/evil/java.exe"));
        let out = safe_settings(&s);
        assert!(!out.contains_key("jvmArgs"), "an agent flag must not reach the JVM through a template");
        assert!(!out.contains_key("javaPath"), "a path to a program is never carried");
        assert_eq!(out.get("ramMb"), Some(&serde_json::json!(4096)), "ordinary memory passes");
    }
}
