use crate::engine::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;

/// A pack of 300 mods would otherwise walk the whole catalog graph on every
/// install; the resolver stops early and says so instead of hanging.
const MAX_NODES: usize = 80;

/// One project the resolver decided about: what would be installed, from where,
/// and why it came up. `problem` is non-empty when nothing fits the build.
#[derive(Clone, Default, serde::Serialize)]
pub struct DepNode {
    pub source: String,
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    pub icon: String,
    pub version_number: String,
    pub file_name: String,
    pub size: u64,
    pub relation: String,
    pub required_by: String,
    pub problem: String,
}

#[derive(Clone, Default, serde::Serialize)]
pub struct DepConflict {
    pub title: String,
    pub file_name: String,
    pub with: String,
    pub reason: String,
}

/// The answer to "what happens if I install this": everything that would be
/// pulled in, everything optional, and everything already in the build that
/// would fight it. Nothing here touches disk.
#[derive(Default, serde::Serialize)]
pub struct DepPlan {
    pub title: String,
    pub version_number: String,
    /// Non-empty when the project itself has nothing for this build; the caller
    /// falls back to the existing "install anyway?" confirmation.
    pub mismatch: String,
    pub required: Vec<DepNode>,
    pub optional: Vec<DepNode>,
    pub missing: Vec<DepNode>,
    pub conflicts: Vec<DepConflict>,
    pub truncated: bool,
}

#[derive(Clone, Default, serde::Deserialize)]
pub struct PlanItem {
    pub source: String,
    pub project_id: String,
    #[serde(default)] pub version_id: String,
}

#[derive(Default, serde::Serialize)]
pub struct DepReport {
    pub installed: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Clone, Default, serde::Serialize)]
pub struct AuditIssue {
    /// missing | conflict | version | loader
    pub kind: String,
    pub title: String,
    pub detail: String,
    pub file_name: String,
    /// Present when the launcher knows what to install to close the issue.
    pub fix: Option<DepNode>,
}

#[derive(Default, serde::Serialize)]
pub struct DepAudit {
    pub checked: u32,
    pub issues: Vec<AuditIssue>,
}

#[derive(Clone)]
pub(crate) struct RawDep {
    pub source: String,
    pub project_id: String,
    pub version_id: String,
    pub relation: String,
}

pub(crate) struct Ctx {
    pub profile: String,
    pub kind: String,
    pub game_version: String,
    pub loader_id: String,
    pub loaders: Vec<String>,
}

pub(crate) fn ctx_of(profile: &str, kind: &str) -> Ctx {
    let prof = load_profiles().into_iter().find(|p| p.name == profile);
    let loader_id = prof.as_ref().map(|p| p.loader_id()).unwrap_or_else(|| "vanilla".into());
    Ctx {
        profile: profile.to_string(),
        kind: kind.to_string(),
        game_version: prof.map(|p| p.version).unwrap_or_default(),
        loaders: modrinth_loaders(&loader_id, kind),
        loader_id,
    }
}

/// Modrinth spells the relation out; anything else (embedded libraries, tools)
/// is already inside the jar and must not become an install of its own.
pub(crate) fn mr_relation(t: &str) -> &'static str {
    match t {
        "required" => "required",
        "optional" => "optional",
        "incompatible" => "incompatible",
        _ => "skip",
    }
}

/// CurseForge relationType: 1 embedded, 2 optional, 3 required, 4 tool,
/// 5 incompatible, 6 include.
pub(crate) fn cf_relation(t: u64) -> &'static str {
    match t {
        3 => "required",
        2 => "optional",
        5 => "incompatible",
        _ => "skip",
    }
}

pub(crate) fn mr_deps(version: &Value) -> Vec<RawDep> {
    let mut out = vec![];
    for d in version["dependencies"].as_array().into_iter().flatten() {
        let relation = mr_relation(d["dependency_type"].as_str().unwrap_or(""));
        if relation == "skip" {
            continue;
        }
        let pid = d["project_id"].as_str().unwrap_or("").to_string();
        if pid.is_empty() {
            continue;
        }
        out.push(RawDep {
            source: "modrinth".into(),
            project_id: pid,
            version_id: d["version_id"].as_str().unwrap_or("").to_string(),
            relation: relation.into(),
        });
    }
    out
}

pub(crate) fn cf_deps(file: &Value) -> Vec<RawDep> {
    let mut out = vec![];
    for d in file["dependencies"].as_array().into_iter().flatten() {
        let relation = cf_relation(d["relationType"].as_u64().unwrap_or(0));
        if relation == "skip" {
            continue;
        }
        let Some(id) = d["modId"].as_u64() else { continue };
        out.push(RawDep {
            source: "curseforge".into(),
            project_id: format!("cf:{}", id),
            version_id: String::new(),
            relation: relation.into(),
        });
    }
    out
}

fn cf_mod_id(project_id: &str) -> Option<u32> {
    project_id.strip_prefix("cf:").and_then(|s| s.parse().ok())
}

/// Titles are the only bridge between the two catalogs: the same mod carries
/// different ids on Modrinth and CurseForge, so "Sodium" installed from one must
/// not be offered again by the other.
fn norm_title(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

#[derive(Default)]
pub(crate) struct Installed {
    ids: HashSet<String>,
    titles: HashSet<String>,
    pub mod_ids: HashSet<String>,
}

impl Installed {
    pub(crate) fn has(&self, project_id: &str, title: &str) -> bool {
        if !project_id.is_empty() && self.ids.contains(project_id) {
            return true;
        }
        if !project_id.is_empty() && self.mod_ids.contains(project_id) {
            return true;
        }
        let t = norm_title(title);
        !t.is_empty() && self.titles.contains(&t)
    }
}

pub(crate) fn installed_index(profile: &str) -> Installed {
    let mut idx = Installed::default();
    for e in load_content_manifest(profile) {
        if e.kind != "mod" {
            continue;
        }
        if !e.project_id.is_empty() {
            idx.ids.insert(e.project_id);
        }
        let t = norm_title(&e.title);
        if !t.is_empty() {
            idx.titles.insert(t);
        }
    }
    for m in local_meta_map(profile, "mod").into_values() {
        let t = norm_title(&m.title);
        if !t.is_empty() {
            idx.titles.insert(t);
        }
        if !m.mod_id.is_empty() {
            idx.mod_ids.insert(m.mod_id);
        }
        for p in m.provides {
            idx.mod_ids.insert(p);
        }
    }
    idx
}

struct Pick {
    node: DepNode,
    deps: Vec<RawDep>,
    raw: Value,
}

fn mr_node(project_id: &str, meta: &MetaTriple, version: &Value) -> DepNode {
    let file = version["files"]
        .as_array()
        .and_then(|fs| fs.iter().find(|f| f["primary"] == true).or_else(|| fs.first()))
        .cloned()
        .unwrap_or_default();
    DepNode {
        source: "modrinth".into(),
        project_id: if meta.0.is_empty() { project_id.to_string() } else { meta.0.clone() },
        version_id: version["id"].as_str().unwrap_or("").to_string(),
        title: if meta.1.is_empty() { project_id.to_string() } else { meta.1.clone() },
        icon: meta.2.clone(),
        version_number: version["version_number"].as_str().unwrap_or("").to_string(),
        file_name: file["filename"].as_str().unwrap_or("").to_string(),
        size: file["size"].as_u64().unwrap_or(0),
        ..Default::default()
    }
}

async fn pick_modrinth(ctx: &Ctx, project_id: &str, version_id: &str) -> Result<Pick, String> {
    let pinned = if version_id.is_empty() {
        None
    } else {
        get_json(&format!("https://api.modrinth.com/v2/version/{}", version_id))
            .await
            .ok()
            .filter(|v| version_fits(v, &ctx.game_version, &ctx.loaders))
    };
    let version = match pinned {
        Some(v) => v,
        None => best_version(project_id, &ctx.game_version, &ctx.loaders).await?,
    };
    let meta = fetch_project_meta(project_id).await;
    Ok(Pick { node: mr_node(project_id, &meta, &version), deps: mr_deps(&version), raw: version })
}

async fn pick_curseforge(ctx: &Ctx, mod_id: u32, file_id: Option<u64>) -> Result<Pick, String> {
    let file = match file_id {
        Some(fid) => cf_get(&format!("v1/mods/{}/files/{}", mod_id, fid), &[]).await?["data"].clone(),
        None => {
            let lt = if ctx.kind == "mod" { cf_loader_type(&ctx.loader_id) } else { 0 };
            cf_files_for(mod_id, &ctx.game_version, lt)
                .await?
                .into_iter()
                .next()
                .ok_or_else(|| {
                    format!("нет файла под {} на CurseForge", if ctx.game_version.is_empty() { "эту сборку" } else { &ctx.game_version })
                })?
        }
    };
    let (title, icon) = match cf_get(&format!("v1/mods/{}", mod_id), &[]).await {
        Ok(j) => (
            j["data"]["name"].as_str().unwrap_or("").to_string(),
            j["data"]["logo"]["thumbnailUrl"].as_str().unwrap_or("").to_string(),
        ),
        Err(_) => (String::new(), String::new()),
    };
    let node = DepNode {
        source: "curseforge".into(),
        project_id: format!("cf:{}", mod_id),
        version_id: file["id"].as_u64().unwrap_or(0).to_string(),
        title: if title.is_empty() { format!("CurseForge #{}", mod_id) } else { title },
        icon,
        version_number: file["displayName"].as_str().unwrap_or("").to_string(),
        file_name: file["fileName"].as_str().unwrap_or("").to_string(),
        size: file["fileLength"].as_u64().unwrap_or(0),
        ..Default::default()
    };
    Ok(Pick { node, deps: cf_deps(&file), raw: file })
}

async fn pick_any(ctx: &Ctx, source: &str, project_id: &str, version_id: &str) -> Result<Pick, String> {
    match cf_mod_id(project_id) {
        Some(id) => pick_curseforge(ctx, id, version_id.parse().ok()).await,
        None if source == "curseforge" => match project_id.parse::<u32>() {
            Ok(id) => pick_curseforge(ctx, id, version_id.parse().ok()).await,
            Err(_) => Err("непонятный проект CurseForge".into()),
        },
        None => pick_modrinth(ctx, project_id, version_id).await,
    }
}

async fn install_pick(ctx: &Ctx, p: &Pick) -> Result<String, String> {
    match cf_mod_id(&p.node.project_id) {
        Some(id) => cf_install_file(&ctx.profile, &ctx.kind, id, &p.raw).await,
        None => install_project_version(&ctx.profile, &ctx.kind, &p.node.project_id, &p.raw).await,
    }
}

/// Walks the graph without touching disk. `seen` starts from what the build
/// already has, so a dependency chain that is satisfied costs nothing.
pub async fn dep_plan(
    profile: String,
    kind: String,
    source: String,
    project: String,
    version_id: Option<String>,
) -> Result<DepPlan, String> {
    let ctx = ctx_of(&profile, &kind);
    let vid = version_id.unwrap_or_default();
    let root = match pick_any(&ctx, &source, &project, &vid).await {
        Ok(p) => p,
        Err(_) => {
            return Ok(DepPlan { title: project.clone(), mismatch: mismatch_text(&source, &project).await, ..Default::default() })
        }
    };
    let installed = installed_index(&profile);
    let mut plan = DepPlan {
        title: root.node.title.clone(),
        version_number: root.node.version_number.clone(),
        ..Default::default()
    };
    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(root.node.project_id.clone());
    let mut queue: Vec<(RawDep, String)> = root.deps.iter().cloned().map(|d| (d, root.node.title.clone())).collect();
    while let Some((dep, parent)) = queue.pop() {
        if plan.required.len() + plan.optional.len() + plan.missing.len() >= MAX_NODES {
            plan.truncated = true;
            break;
        }
        if !seen.insert(dep.project_id.clone()) {
            continue;
        }
        if dep.relation == "incompatible" {
            if let Some(c) = conflict_if_present(&installed, &ctx, &dep, &plan.title).await {
                plan.conflicts.push(c);
            }
            continue;
        }
        let picked = pick_any(&ctx, &dep.source, &dep.project_id, &dep.version_id).await;
        match picked {
            Ok(p) => {
                if installed.has(&p.node.project_id, &p.node.title) {
                    continue;
                }
                let mut node = p.node.clone();
                node.relation = dep.relation.clone();
                node.required_by = parent.clone();
                if dep.relation == "required" {
                    for d in p.deps {
                        queue.push((d, node.title.clone()));
                    }
                    plan.required.push(node);
                } else {
                    plan.optional.push(node);
                }
            }
            Err(e) => {
                if dep.relation != "required" {
                    continue;
                }
                let title = fetch_project_meta(&dep.project_id).await.1;
                plan.missing.push(DepNode {
                    source: dep.source.clone(),
                    project_id: dep.project_id.clone(),
                    title: if title.is_empty() { dep.project_id.clone() } else { title },
                    relation: "required".into(),
                    required_by: parent.clone(),
                    problem: e,
                    ..Default::default()
                });
            }
        }
    }
    plan.conflicts.extend(local_conflicts(&profile, &root.node));
    Ok(plan)
}

/// Which game versions the project does ship, so the caller can explain the
/// refusal instead of showing an empty plan.
async fn mismatch_text(source: &str, project: &str) -> String {
    let have = match cf_mod_id(project).or_else(|| if source == "curseforge" { project.parse().ok() } else { None }) {
        Some(id) => cf_files_for(id, "", 0).await.map(|f| cf_short_mc_versions(&f)).unwrap_or_default(),
        None => project_versions(project).await.map(|v| known_game_versions(&v)).unwrap_or_default(),
    };
    if have.is_empty() { "другие версии".into() } else { have }
}

async fn conflict_if_present(installed: &Installed, ctx: &Ctx, dep: &RawDep, with: &str) -> Option<DepConflict> {
    let title = match cf_mod_id(&dep.project_id) {
        Some(id) => cf_get(&format!("v1/mods/{}", id), &[]).await.ok()
            .and_then(|j| j["data"]["name"].as_str().map(String::from))
            .unwrap_or_else(|| dep.project_id.clone()),
        None => fetch_project_meta(&dep.project_id).await.1,
    };
    if !installed.has(&dep.project_id, &title) {
        return None;
    }
    let file = load_content_manifest(&ctx.profile)
        .into_iter()
        .find(|e| e.project_id == dep.project_id || norm_title(&e.title) == norm_title(&title))
        .map(|e| e.file_name)
        .unwrap_or_default();
    Some(DepConflict {
        title,
        file_name: file,
        with: with.to_string(),
        reason: "автор мода отметил их как несовместимые".into(),
    })
}

/// The other direction: a mod already in the build declaring that it breaks with
/// what is about to be installed. Read from the jars, so it works offline.
fn local_conflicts(profile: &str, incoming: &DepNode) -> Vec<DepConflict> {
    let wanted = [norm_title(&incoming.title), norm_title(&incoming.project_id)];
    local_meta_map(profile, "mod")
        .into_values()
        .filter(|m| m.breaks.iter().any(|b| wanted.contains(&norm_title(b))))
        .map(|m| DepConflict {
            title: m.title.clone(),
            file_name: m.file_name.clone(),
            with: incoming.title.clone(),
            reason: "мод в сборке объявляет несовместимость".into(),
        })
        .collect()
}

/// Installs every hard dependency the given relations pull in, transitively.
/// Returns the ones nothing could be found for, so the caller can say so instead
/// of leaving a build that will not start.
pub(crate) async fn install_required(ctx: &Ctx, deps: Vec<RawDep>) -> Vec<String> {
    let mut installed = installed_index(&ctx.profile);
    let mut seen: HashSet<String> = HashSet::new();
    let mut missed: Vec<String> = vec![];
    let mut queue: Vec<RawDep> = deps;
    let mut count = 0;
    while let Some(dep) = queue.pop() {
        count += 1;
        if count > MAX_NODES {
            break;
        }
        if dep.relation != "required" || !seen.insert(dep.project_id.clone()) {
            continue;
        }
        match pick_any(ctx, &dep.source, &dep.project_id, &dep.version_id).await {
            Ok(p) => {
                if installed.has(&p.node.project_id, &p.node.title) {
                    continue;
                }
                match install_pick(ctx, &p).await {
                    Ok(_) => {
                        installed.ids.insert(p.node.project_id.clone());
                        installed.titles.insert(norm_title(&p.node.title));
                        for d in p.deps {
                            queue.push(d);
                        }
                    }
                    Err(e) => missed.push(format!("{} ({})", p.node.title, e)),
                }
            }
            Err(_) => {
                let title = fetch_project_meta(&dep.project_id).await.1;
                missed.push(if title.is_empty() { dep.project_id.clone() } else { title });
            }
        }
    }
    missed
}

/// Installs a hand-picked set: the optional dependencies the user ticked in the
/// plan, or the fixes an audit offered. Each one still drags in its own hard
/// dependencies.
pub async fn install_dep_items(
    app: AppHandle,
    profile: String,
    kind: String,
    items: Vec<PlanItem>,
) -> Result<DepReport, String> {
    let job = Job::start(job_key_content("mr", &profile, &kind, "millida:deps"), "Зависимости")?;
    let res = install_dep_items_job(&app, &job, profile, kind, items).await;
    job.finish(&app, res)
}

async fn install_dep_items_job(
    app: &AppHandle,
    job: &Job,
    profile: String,
    kind: String,
    items: Vec<PlanItem>,
) -> Result<DepReport, String> {
    let ctx = ctx_of(&profile, &kind);
    let mut report = DepReport::default();
    let total = items.len().max(1);
    for (i, it) in items.iter().enumerate() {
        job.check()?;
        job.emit(app, 5.0 + 90.0 * (i as f32 / total as f32), &format!("Ставим {}/{}…", i + 1, total));
        match pick_any(&ctx, &it.source, &it.project_id, &it.version_id).await {
            Ok(p) => match install_pick(&ctx, &p).await {
                Ok(file) => {
                    report.installed.push(file);
                    let missed = install_required(&ctx, p.deps).await;
                    report.failed.extend(missed);
                }
                Err(e) => report.failed.push(format!("{}: {}", p.node.title, e)),
            },
            Err(e) => report.failed.push(format!("{}: {}", it.project_id, e)),
        }
    }
    job.emit(app, 100.0, "Готово");
    Ok(report)
}

/// `/v2/versions?ids=` answers for a whole build at once, which is what makes
/// auditing an installed set cheap enough to run on a button press.
async fn bulk_versions(ids: &[String]) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(50) {
        let list = serde_json::to_string(&chunk.to_vec()).unwrap_or_else(|_| "[]".into());
        let url = format!("https://api.modrinth.com/v2/versions?ids={}", urlencode(&list));
        let Ok(arr) = get_json(&url).await else { continue };
        for v in arr.as_array().cloned().unwrap_or_default() {
            let Some(id) = v["id"].as_str().map(String::from) else { continue };
            out.insert(id, v);
        }
    }
    out
}

/// A jar declares the game versions it targets in free form: an exact list
/// ("1.21, 1.21.1"), a range (">=1.21.11") or nothing. Only an exact list can be
/// judged, so a range is never reported as a mismatch.
pub(crate) fn declared_mismatch(declared: &str, build: &str) -> bool {
    if declared.trim().is_empty() || build.trim().is_empty() {
        return false;
    }
    let parts: Vec<&str> = declared
        .split([',', ';', '/'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if parts.is_empty() {
        return false;
    }
    let ranged = |p: &str| p.chars().any(|c| "<>~^*=[](),".contains(c)) || p.contains('-') || p.ends_with(".x") || p == "x";
    if parts.iter().any(|p| ranged(p)) {
        return false;
    }
    !parts.iter().any(|p| *p == build.trim())
}

/// Quilt loads Fabric mods; nothing else crosses over.
pub(crate) fn loader_mismatch(declared: &str, build_loader: &str) -> bool {
    if declared.is_empty() || build_loader.is_empty() || build_loader == "vanilla" {
        return false;
    }
    if declared == build_loader {
        return false;
    }
    !(build_loader == "quilt" && declared == "fabric")
}

/// Checks a build as it stands: hard dependencies nobody satisfies, mods that
/// declare each other incompatible, and files built for another version or
/// loader. Everything that can be fixed comes back with the fix attached.
pub async fn audit_deps(profile: String) -> Result<DepAudit, String> {
    let ctx = ctx_of(&profile, "mod");
    let prof = profile.clone();
    let locals = tauri::async_runtime::spawn_blocking(move || scan_local_meta(&prof, "mod", false))
        .await
        .map_err(|e| e.to_string())?;
    let manifest: Vec<ContentEntry> = load_content_manifest(&profile).into_iter().filter(|e| e.kind == "mod").collect();
    let installed = installed_index(&profile);
    let mut audit = DepAudit { checked: locals.len() as u32, issues: vec![] };
    let mut wanted: HashMap<String, String> = HashMap::new();

    for m in &locals {
        if declared_mismatch(&m.mc, &ctx.game_version) {
            audit.issues.push(AuditIssue {
                kind: "version".into(),
                title: m.title.clone(),
                detail: format!("файл собран под MC {}, а сборка на {}", m.mc, ctx.game_version),
                file_name: m.file_name.clone(),
                fix: None,
            });
        }
        if loader_mismatch(&m.loader, &ctx.loader_id) {
            audit.issues.push(AuditIssue {
                kind: "loader".into(),
                title: m.title.clone(),
                detail: format!("файл для {}, а сборка на {}", m.loader, ctx.loader_id),
                file_name: m.file_name.clone(),
                fix: None,
            });
        }
        for b in &m.breaks {
            if installed.mod_ids.contains(b) {
                let other = locals
                    .iter()
                    .find(|o| &o.mod_id == b || o.provides.contains(b))
                    .map(|o| o.title.clone())
                    .unwrap_or_else(|| b.clone());
                audit.issues.push(AuditIssue {
                    kind: "conflict".into(),
                    title: m.title.clone(),
                    detail: format!("объявляет несовместимость с «{}»", other),
                    file_name: m.file_name.clone(),
                    fix: None,
                });
            }
        }
        for r in &m.requires {
            if installed.mod_ids.contains(r) {
                continue;
            }
            wanted.entry(r.clone()).or_insert_with(|| m.title.clone());
        }
    }

    let version_ids: Vec<String> = manifest
        .iter()
        .filter(|e| !e.version_id.is_empty() && !e.project_id.starts_with("cf:"))
        .map(|e| e.version_id.clone())
        .collect();
    let versions = bulk_versions(&version_ids).await;
    for e in &manifest {
        let Some(v) = versions.get(&e.version_id) else { continue };
        for dep in mr_deps(v) {
            if dep.relation == "incompatible" {
                let title = fetch_project_meta(&dep.project_id).await.1;
                if installed.has(&dep.project_id, &title) {
                    audit.issues.push(AuditIssue {
                        kind: "conflict".into(),
                        title: e.title.clone(),
                        detail: format!("несовместим с «{}»", if title.is_empty() { dep.project_id.clone() } else { title }),
                        file_name: e.file_name.clone(),
                        fix: None,
                    });
                }
                continue;
            }
            if dep.relation != "required" {
                continue;
            }
            let title = fetch_project_meta(&dep.project_id).await.1;
            if installed.has(&dep.project_id, &title) {
                continue;
            }
            let fix = pick_modrinth(&ctx, &dep.project_id, &dep.version_id).await.ok().map(|p| p.node);
            push_missing(&mut audit, e.title.clone(), if title.is_empty() { dep.project_id } else { title }, fix);
        }
    }

    for (id, needed_by) in wanted {
        if audit.issues.iter().any(|i| i.kind == "missing" && i.detail.contains(&id)) {
            continue;
        }
        let fix = pick_modrinth(&ctx, &id, "").await.ok().map(|p| p.node);
        if fix.as_ref().is_some_and(|f| installed.has(&f.project_id, &f.title)) {
            continue;
        }
        audit.issues.push(AuditIssue {
            kind: "missing".into(),
            title: needed_by.clone(),
            detail: format!("нужен мод «{}», в сборке его нет", id),
            file_name: String::new(),
            fix,
        });
    }
    Ok(audit)
}

fn push_missing(audit: &mut DepAudit, needed_by: String, missing: String, fix: Option<DepNode>) {
    if audit.issues.iter().any(|i| i.kind == "missing" && i.detail.contains(&missing)) {
        return;
    }
    audit.issues.push(AuditIssue {
        kind: "missing".into(),
        title: needed_by,
        detail: format!("нужен мод «{}», в сборке его нет", missing),
        file_name: String::new(),
        fix,
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// input -> verdict. Embedded libraries and tools are already inside the jar:
    /// installing them separately duplicates classes and breaks the game.
    #[test]
    fn only_real_relations_become_installs() {
        assert_eq!(mr_relation("required"), "required");
        assert_eq!(mr_relation("optional"), "optional");
        assert_eq!(mr_relation("incompatible"), "incompatible");
        assert_eq!(mr_relation("embedded"), "skip", "embedded code ships inside the jar");
        assert_eq!(cf_relation(3), "required");
        assert_eq!(cf_relation(2), "optional");
        assert_eq!(cf_relation(5), "incompatible");
        assert_eq!(cf_relation(1), "skip", "relationType 1 is an embedded library");
        assert_eq!(cf_relation(4), "skip", "relationType 4 is a tool, not a dependency");
    }

    #[test]
    fn reads_dependencies_from_both_catalogs() {
        let mr = json!({ "dependencies": [
            { "project_id": "9s6osm5g", "dependency_type": "required", "version_id": "abc" },
            { "project_id": "x", "dependency_type": "embedded" },
            { "project_id": "", "dependency_type": "required" },
        ]});
        let got = mr_deps(&mr);
        assert_eq!(got.len(), 1, "only the real required dependency survives");
        assert_eq!(got[0].project_id, "9s6osm5g");
        assert_eq!(got[0].version_id, "abc");

        let cf = json!({ "dependencies": [
            { "modId": 306612, "relationType": 3 },
            { "modId": 238222, "relationType": 4 },
        ]});
        let got = cf_deps(&cf);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].project_id, "cf:306612", "CurseForge ids keep their prefix");
    }

    /// The same mod under two catalogs must count as installed once, or every
    /// install would offer its Modrinth twin again.
    #[test]
    fn installed_matches_by_id_title_and_mod_id() {
        let mut idx = Installed::default();
        idx.ids.insert("cf:306612".into());
        idx.titles.insert("clothconfigapi".into());
        idx.mod_ids.insert("fabric-api".into());

        assert!(idx.has("cf:306612", ""));
        assert!(idx.has("some-modrinth-id", "Cloth Config API"), "same mod from the other catalog");
        assert!(idx.has("fabric-api", ""), "matched by the id declared inside the jar");
        assert!(!idx.has("sodium", "Sodium"));
    }

    /// A jar that targets another game version is the top cause of a build that
    /// will not start, but a declared range says nothing and must stay silent.
    #[test]
    fn version_mismatch_only_for_exact_lists() {
        assert!(declared_mismatch("1.21.1", "1.20.1"));
        assert!(!declared_mismatch("1.21, 1.21.1", "1.21.1"));
        assert!(!declared_mismatch(">=1.21.11", "1.20.1"), "a range is not a verdict");
        assert!(!declared_mismatch("1.20.x", "1.20.1"));
        assert!(!declared_mismatch("", "1.20.1"));
        assert!(!declared_mismatch("1.21.1", ""));
    }

    #[test]
    fn loader_mismatch_lets_quilt_load_fabric() {
        assert!(loader_mismatch("forge", "fabric"));
        assert!(!loader_mismatch("fabric", "quilt"), "Quilt loads Fabric mods");
        assert!(!loader_mismatch("fabric", "fabric"));
        assert!(!loader_mismatch("fabric", "vanilla"), "a vanilla build judges nothing");
        assert!(!loader_mismatch("", "forge"));
    }
}
