use crate::engine::*;
use futures::StreamExt;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use tauri::AppHandle;

const MANIFEST_TTL: Duration = Duration::from_secs(6 * 3600);
const LOADER_TTL: Duration = Duration::from_secs(24 * 3600);
/// Assets are thousands of tiny files where request concurrency, not bandwidth,
/// is the limit; libraries are few and large.
const PARALLEL_LIBS: usize = 24;
const PARALLEL_ASSETS: usize = 64;

/// A single library download. Classpath order must follow the version json, so
/// downloads run in parallel and the classpath is assembled afterwards.
struct LibJob {
    rel: String,
    url: String,
    sha1: Option<String>,
    size: Option<u64>,
    path: PathBuf,
}

async fn fetch_libs(jobs: &[LibJob], app: &AppHandle, from: f32, to: f32, title: &str) -> Result<(), String> {
    let total = jobs.len().max(1);
    let done = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let step = (total / 12).max(1);
    // Each task owns its data: borrowing from the slice would make the future
    // non-'static, which a Tauri command cannot hold.
    let items: Vec<(String, PathBuf, Option<String>, Option<u64>)> = jobs
        .iter()
        .map(|j| (j.url.clone(), j.path.clone(), j.sha1.clone(), j.size))
        .collect();
    let results: Vec<Result<(), String>> = futures::stream::iter(items.into_iter().map(|(url, path, sha1, size)| {
        let done = done.clone();
        let app = app.clone();
        let title = title.to_string();
        async move {
            let r = download_verify(&url, &path, sha1.as_deref(), size).await;
            let d = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if d.is_multiple_of(step) || d == total {
                emit(&app, "files", from + (to - from) * (d as f32 / total as f32), &title);
            }
            r
        }
    }))
    .buffer_unordered(PARALLEL_LIBS)
    .collect()
    .await;
    for r in results {
        r?;
    }
    Ok(())
}

/// Fabric/Quilt manifests and Forge profiles carry no hashes, but their maven
/// repos publish a sibling `.sha1`, which is verified when present.
/// Returns the first error when `strict`, otherwise skips unavailable files.
async fn fetch_missing(jobs: &[LibJob], strict: bool) -> Result<(), String> {
    let items: Vec<(String, PathBuf)> = jobs
        .iter()
        .filter(|j| !j.path.exists() && !j.url.is_empty())
        .map(|j| (j.url.clone(), j.path.clone()))
        .collect();
    let results: Vec<Result<(), String>> = futures::stream::iter(items.into_iter().map(|(url, path)| async move {
        let sha1 = maven_sha1(&url).await;
        download_checked(&url, &path, sha1.as_deref().map(Sum::Sha1), None).await
    }))
    .buffer_unordered(PARALLEL_LIBS)
    .collect()
    .await;
    if strict {
        for r in results {
            r?;
        }
    }
    Ok(())
}

/// Fingerprint of the version's native set; unchanged means no need to unpack
/// the classifier jars again.
fn natives_stamp_path(natives_dir: &Path) -> PathBuf {
    natives_dir.join(".millida-natives")
}

fn natives_up_to_date(natives_dir: &Path, stamp: &str, deep: bool) -> bool {
    if deep {
        return false;
    }
    std::fs::read_to_string(natives_stamp_path(natives_dir))
        .map(|s| s == stamp)
        .unwrap_or(false)
}

/// Reads the maven sibling `.sha1`; the body is bare hex, sometimes followed by
/// a file name, so only the first word is taken and validated.
async fn maven_sha1(url: &str) -> Option<String> {
    let text = client()
        .get(format!("{}.sha1", url))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .text()
        .await
        .ok()?;
    let hex = text.split_whitespace().next()?.to_lowercase();
    (hex.len() == 40 && hex.chars().all(|c| c.is_ascii_hexdigit())).then_some(hex)
}

/// The version json a loader installer writes as `<dir name>.json` inside its dir.
fn loader_profile_json(dir: &Path) -> Option<Value> {
    let name = dir.file_name()?.to_string_lossy().to_string();
    serde_json::from_slice(&std::fs::read(dir.join(format!("{}.json", name))).ok()?).ok()
}

/// Locates an installed Forge/NeoForge dir for this MC version: exact name
/// first, then the newest loader dir whose `inheritsFrom` matches, since a
/// NeoForge dir name does not contain the MC version at all.
fn resolve_loader_dir(vdir: &Path, loader: &str, ver_dir_name: &str, vid: &str) -> Option<PathBuf> {
    let exact = vdir.join(ver_dir_name);
    if exact.join(format!("{}.json", ver_dir_name)).exists() {
        return Some(exact);
    }
    let mut cands: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(vdir)
        .ok()?
        .flatten()
        // "neoforge-21.1.73" also contains "forge", so plain Forge must exclude it.
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_lowercase();
            n.contains(loader) && (loader == "neoforge" || !n.contains("neoforge"))
        })
        .filter(|e| {
            loader_profile_json(&e.path()).is_some_and(|j| j["inheritsFrom"].as_str() == Some(vid))
        })
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| (t, e.path())))
        .collect();
    cands.sort_by_key(|(t, _)| *t);
    cands.pop().map(|(_, p)| p)
}

/// Returns (merged version json, main_class, classpath, java_bin).
pub async fn install(
    app: &AppHandle,
    version_id: &str,
    with_fabric: bool,
) -> Result<(Value, String, Vec<PathBuf>, PathBuf), String> {
    install_loader(app, version_id, if with_fabric { "fabric" } else { "vanilla" }).await
}

pub async fn install_loader(
    app: &AppHandle,
    version_id: &str,
    loader: &str,
) -> Result<(Value, String, Vec<PathBuf>, PathBuf), String> {
    install_loader_pinned(app, version_id, loader, None).await
}

/// Same, but pinned to an exact loader build: modpacks target one build and the
/// recommended one usually breaks their mods.
pub async fn install_loader_pinned(
    app: &AppHandle,
    version_id: &str,
    loader: &str,
    loader_version: Option<&str>,
) -> Result<(Value, String, Vec<PathBuf>, PathBuf), String> {
    install_loader_with_java(app, version_id, loader, loader_version, None).await
}

/// `java_override` skips downloading the bundled JRE entirely.
pub async fn install_loader_with_java(
    app: &AppHandle,
    version_id: &str,
    loader: &str,
    loader_version: Option<&str>,
    java_override: Option<PathBuf>,
) -> Result<(Value, String, Vec<PathBuf>, PathBuf), String> {
    let root = game_root_ready()?;

    // Version metadata is content-addressed, so a cached copy is always current
    // and the Mojang manifest is only needed to discover its URL.
    let cached_meta = |vid: &str| -> Option<Value> {
        serde_json::from_slice(
            &std::fs::read(root.join("versions").join(vid).join(format!("{}-meta.json", vid))).ok()?,
        )
        .ok()
    };
    let (vid, vjson) = match (version_id != "latest").then(|| cached_meta(version_id)).flatten() {
        Some(v) => (version_id.to_string(), v),
        None => {
            emit(app, "files", 5.0, "Читаем манифест версий…");
            let manifest = get_json_fresh(MANIFEST, &root.join("version_manifest_v2.json"), MANIFEST_TTL).await?;
            let vid = if version_id == "latest" {
                manifest["latest"]["release"].as_str().unwrap_or("1.21.4").to_string()
            } else {
                version_id.to_string()
            };
            let ventry = manifest["versions"]
                .as_array()
                .and_then(|a| a.iter().find(|v| v["id"] == vid.as_str()))
                .ok_or(format!("Версия {} не найдена", vid))?;
            let vurl = ventry["url"]
                .as_str()
                .ok_or_else(|| format!("Манифест Mojang не дал ссылку на версию {}", vid))?;
            let vjson =
                get_json_immutable(vurl, &root.join("versions").join(&vid).join(format!("{}-meta.json", vid))).await?;
            (vid, vjson)
        }
    };

    emit(app, "files", 12.0, &format!("Minecraft {} — клиент…", vid));
    let client_jar = root.join("versions").join(&vid).join(format!("{}.jar", vid));
    download_verify(
        vjson["downloads"]["client"]["url"]
            .as_str()
            .ok_or_else(|| format!("В описании версии {} нет ссылки на клиент", vid))?,
        &client_jar,
        vjson["downloads"]["client"]["sha1"].as_str(),
        vjson["downloads"]["client"]["size"].as_u64(),
    ).await?;

    // Natives (LWJGL and friends) are extracted from classifier jars per version.
    let natives_dir = root.join("versions").join(&vid).join("natives");
    std::fs::create_dir_all(&natives_dir).ok();

    let mut cp: Vec<(String, PathBuf)> = vec![];
    let libs = vjson["libraries"].as_array().cloned().unwrap_or_default();
    let mut jobs: Vec<LibJob> = vec![];
    let mut native_jobs: Vec<(LibJob, Value)> = vec![];
    for lib in libs.iter() {
        if !rules_allow(&lib["rules"]) {
            continue;
        }
        if let Some(art) = lib["downloads"]["artifact"].as_object() {
            if let (Some(rel), Some(url)) = (art["path"].as_str(), art["url"].as_str()) {
                jobs.push(LibJob {
                    rel: rel.to_string(),
                    url: url.to_string(),
                    sha1: art["sha1"].as_str().map(String::from),
                    size: art["size"].as_u64(),
                    path: root.join("libraries").join(rel),
                });
            }
        }
        // natives: downloads.classifiers[ natives.<os> ], extracted into natives_dir
        if let Some(nat) = lib["natives"].as_object() {
            if let Some(key_tmpl) = nat.get(natives_os_key()).and_then(|v| v.as_str()) {
                let arch = if cfg!(target_arch = "x86_64") { "64" } else { "32" };
                let key = key_tmpl.replace("${arch}", arch);
                if let Some(cl) = lib["downloads"]["classifiers"].get(&key).and_then(|c| c.as_object()) {
                    if let (Some(u), Some(rel)) = (cl["url"].as_str(), cl["path"].as_str()) {
                        native_jobs.push((
                            LibJob {
                                rel: rel.to_string(),
                                url: u.to_string(),
                                sha1: cl["sha1"].as_str().map(String::from),
                                size: cl["size"].as_u64(),
                                path: root.join("libraries").join(rel),
                            },
                            lib["extract"].clone(),
                        ));
                    }
                }
            }
        }
    }
    emit(app, "files", 15.0, "Библиотеки…");
    fetch_libs(&jobs, app, 15.0, 45.0, "Библиотеки…").await?;
    for j in &jobs {
        cp_put(&mut cp, &j.rel, j.path.clone());
    }

    if !native_jobs.is_empty() {
        let stamp = native_jobs
            .iter()
            .map(|(j, _)| format!("{}:{}", j.rel, j.sha1.clone().unwrap_or_default()))
            .collect::<Vec<_>>()
            .join("\n");
        let nat_libs: Vec<LibJob> = native_jobs
            .iter()
            .map(|(j, _)| LibJob {
                rel: j.rel.clone(),
                url: j.url.clone(),
                sha1: j.sha1.clone(),
                size: j.size,
                path: j.path.clone(),
            })
            .collect();
        let _ = fetch_libs(&nat_libs, app, 45.0, 48.0, "Нативные библиотеки…").await;
        if !natives_up_to_date(&natives_dir, &stamp, deep_verify()) {
            emit(app, "files", 48.0, "Распаковываем нативные библиотеки…");
            let items: Vec<(PathBuf, Value)> =
                native_jobs.iter().map(|(j, rule)| (j.path.clone(), rule.clone())).collect();
            let nd = natives_dir.clone();
            let stamp_c = stamp.clone();
            // Tens of megabytes of inflate must not run on the async runtime.
            let _ = tokio::task::spawn_blocking(move || {
                for (jar, rule) in items {
                    if jar.exists() {
                        extract_natives(&jar, &nd, &rule);
                    }
                }
                let _ = std::fs::write(natives_stamp_path(&nd), stamp_c.as_bytes());
            })
            .await;
        }
    }

    let mut main_class = vjson["mainClass"]
        .as_str()
        .ok_or_else(|| format!("В описании версии {} нет главного класса", vid))?
        .to_string();
    let mut merged = vjson.clone();
    if loader == "fabric" || loader == "quilt" {
        let (meta_base, title) = if loader == "quilt" {
            ("https://meta.quiltmc.org/v3", "Quilt-лоадер…")
        } else {
            ("https://meta.fabricmc.net/v2", "Fabric-лоадер…")
        };
        emit(app, "files", 52.0, title);
        let lcache = root.join("loader-cache");
        let profile_cache = |v: &str| lcache.join(format!("{}-{}-{}-profile.json", loader, vid, v));
        // A cached profile for a pinned loader build makes the version list
        // request unnecessary.
        let ready = loader_version.filter(|v| profile_cache(v).exists()).map(String::from);
        let loader_v = match ready {
            Some(v) => v,
            None => {
                let loaders = get_json_fresh(
                    &format!("{}/versions/loader/{}", meta_base, vid),
                    &lcache.join(format!("{}-{}-list.json", loader, vid)),
                    LOADER_TTL,
                ).await?;
                let arr = loaders.as_array().cloned().unwrap_or_default();
                // The pinned build wins, but only if meta actually lists it.
                let pinned = loader_version.filter(|v| {
                    arr.iter().any(|l| l["loader"]["version"].as_str() == Some(v))
                }).map(String::from);
                match pinned {
                    Some(v) => v,
                    None => arr
                        .iter()
                        .find(|l| l["loader"]["stable"] == true)
                        .or(arr.first())
                        .and_then(|l| l["loader"]["version"].as_str())
                        .ok_or(format!("{} недоступен для этой версии", loader))?
                        .to_string(),
                }
            }
        };
        // A profile for a fixed loader build is immutable, so it can be cached.
        let profile = get_json_immutable(&format!(
            "{}/versions/loader/{}/{}/profile/json",
            meta_base, vid, loader_v
        ), &profile_cache(&loader_v)).await?;
        main_class = profile["mainClass"]
            .as_str()
            .ok_or_else(|| format!("{} не отдал главный класс для {}", loader, vid))?
            .to_string();
        let mut ljobs: Vec<LibJob> = vec![];
        for lib in profile["libraries"].as_array().cloned().unwrap_or_default() {
            let Some(coord) = lib["name"].as_str() else { continue };
            let base = lib["url"].as_str().unwrap_or(if loader == "quilt" { "https://maven.quiltmc.org/repository/release/" } else { "https://maven.fabricmc.net/" });
            let rel = maven_path(coord);
            ljobs.push(LibJob {
                url: format!("{}{}", base, rel),
                path: root.join("libraries").join(&rel),
                rel,
                sha1: None,
                size: None,
            });
        }
        fetch_missing(&ljobs, true).await?;
        for j in &ljobs {
            cp_put(&mut cp, &j.rel, j.path.clone());
        }
        merged["fabricArguments"] = profile["arguments"].clone();
    }
    // Forge/NeoForge ship a headless installer that lays out libraries and runs
    // its own patch processors; its version json is read afterwards.
    if loader == "forge" || loader == "neoforge" {
        let lcache = root.join("loader-cache");
        let vdir = root.join("versions");
        // An already installed loader needs neither the NeoForge version list
        // nor the Forge promotions file, so launching stays offline-capable.
        let pinned_dir_name = loader_version.map(|pin| if loader == "neoforge" {
            format!("neoforge-{}", pin)
        } else {
            format!("{}-forge-{}", vid, pin)
        });
        let mut found = match &pinned_dir_name {
            // A pinned build accepts only an exact match.
            Some(name) => Some(vdir.join(name)).filter(|d| d.join(format!("{}.json", name)).exists()),
            None => resolve_loader_dir(&vdir, loader, "", &vid),
        };
        if found.is_none() {
            emit(app, "files", 50.0, &format!("{}-инсталлер…", loader));
            let mut installers: Vec<(String, String)> = if loader == "neoforge" {
                let list = get_json_cached(
                    "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
                    &lcache.join("neoforge-versions.json"),
                ).await?;
                // NeoForge versioning: MC "1.A.B" -> prefix "A.B.", MC "1.A" -> "A.0."
                // (MC 1.21.1 -> 21.1.x, MC 1.21 -> 21.0.x).
                let parts: Vec<&str> = vid.split('.').collect();
                let a = parts.get(1).copied().unwrap_or("");
                let b = parts.get(2).copied().unwrap_or("0");
                let prefix = format!("{}.{}.", a, b);
                let mut cands: Vec<String> = list["versions"].as_array().map(|arr| arr.iter()
                    .filter_map(|v| v.as_str())
                    .filter(|v| v.starts_with(&prefix) && !v.contains("beta"))
                    .map(String::from).collect()).unwrap_or_default();
                cands.sort_by_key(|v| v.rsplit('.').next().and_then(|n| n.parse::<u64>().ok()).unwrap_or(0));
                if cands.is_empty() { return Err("NeoForge для этой версии не найден".into()) }
                cands.iter().rev().take(3).map(|nv| (
                    format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar", v = nv),
                    format!("neoforge-{}", nv),
                )).collect()
            } else {
                let promos = get_json_cached(
                    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json",
                    &lcache.join("forge-promos.json"),
                ).await?;
                let mut builds: Vec<String> = vec![];
                for key in [format!("{}-recommended", vid), format!("{}-latest", vid)] {
                    if let Some(fv) = promos["promos"][&key].as_str() {
                        if !builds.iter().any(|b| b == fv) { builds.push(fv.to_string()) }
                    }
                }
                if builds.is_empty() { return Err("Forge для этой версии не найден".into()) }
                // The Forge installer creates "<mc>-forge-<build>", not "forge-<mc>-<build>".
                builds.into_iter().map(|fv| (
                    format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{f}/forge-{f}-installer.jar", f = format!("{}-{}", vid, fv)),
                    format!("{}-forge-{}", vid, fv),
                )).collect()
            };
            // The modpack's pinned build is tried first.
            if let Some(pin) = loader_version {
                let (url, name) = if loader == "neoforge" {
                    (
                        format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar", v = pin),
                        format!("neoforge-{}", pin),
                    )
                } else {
                    (
                        format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{f}/forge-{f}-installer.jar", f = format!("{}-{}", vid, pin)),
                        format!("{}-forge-{}", vid, pin),
                    )
                };
                installers.retain(|(_, n)| n != &name);
                installers.insert(0, (url, name));
            }
            // Skip the installer when the profile is already laid out: it takes
            // up to a minute and needs network.
            let ver_dir_name = installers[0].1.clone();
            found = if loader_version.is_some() {
                Some(vdir.join(&ver_dir_name)).filter(|d| d.join(format!("{}.json", ver_dir_name)).exists())
            } else {
                resolve_loader_dir(&vdir, loader, &ver_dir_name, &vid)
            };
            if found.is_none() {
                let java_pre = match java_override.clone() {
                    Some(j) => j,
                    None => ensure_java(app, vjson["javaVersion"]["majorVersion"].as_u64().unwrap_or(21)).await?,
                };
                // The installer refuses to run without launcher_profiles.json.
                let lp = root.join("launcher_profiles.json");
                if !lp.exists() { let _ = std::fs::write(&lp, b"{\"profiles\":{},\"version\":3}"); }
                let mut last_err = String::new();
                for (inst_url, name) in &installers {
                    // Name carries the build, otherwise one installer file would
                    // be reused for every build.
                    let inst = data_dir().join("tmp").join(format!("{}-installer.jar", name));
                    // The installer is executed by a JVM, so it is only accepted
                    // with the maven-published sha1.
                    let Some(sha1) = maven_sha1(inst_url).await else {
                        last_err = format!("{}: maven не дал контрольную сумму инсталлера", name);
                        continue;
                    };
                    if let Err(e) = download_checked(inst_url, &inst, Some(Sum::Sha1(&sha1)), None).await {
                        let _ = std::fs::remove_file(&inst);
                        last_err = e;
                        continue;
                    }
                    emit(app, "files", 60.0, "Ставим загрузчик (может занять минуту)…");
                    let (jp, ip, rp) = (java_pre.clone(), inst.clone(), root.clone());
                    let st = tokio::task::spawn_blocking(move || {
                        quiet(&mut Command::new(&jp)).arg("-jar").arg(&ip).arg("--installClient").arg(&rp)
                            .current_dir(&rp).status()
                    }).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
                    let _ = std::fs::remove_file(&inst);
                    if !st.success() {
                        last_err = "Инсталлер загрузчика завершился с ошибкой".into();
                        continue;
                    }
                    found = resolve_loader_dir(&vdir, loader, name, &vid);
                    if found.is_some() { break }
                    last_err = "Не нашли профиль загрузчика".into();
                }
                if found.is_none() { return Err(last_err) }
            }
        }
        let dir = found.ok_or("Не нашли профиль загрузчика".to_string())?;
        let jname = format!(
            "{}.json",
            dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
        );
        let lj: Value = serde_json::from_slice(&std::fs::read(dir.join(&jname)).map_err(|_| "Не нашли профиль загрузчика".to_string())?)
            .map_err(|e| e.to_string())?;
        main_class = lj["mainClass"].as_str().unwrap_or(&main_class).to_string();
        // The installer already laid out most libraries; classpath order comes
        // from its version json.
        let mut ljobs: Vec<LibJob> = vec![];
        for lib in lj["libraries"].as_array().cloned().unwrap_or_default() {
            if !rules_allow(&lib["rules"]) { continue }
            if let Some(art) = lib["downloads"]["artifact"].as_object() {
                let rel = art["path"].as_str().unwrap_or("").to_string();
                if rel.is_empty() { continue }
                let p = root.join("libraries").join(&rel);
                let url = art["url"].as_str().unwrap_or("").to_string();
                ljobs.push(LibJob { rel, url, sha1: None, size: None, path: p });
            } else if let Some(name) = lib["name"].as_str() {
                let rel = maven_path(name);
                let p = root.join("libraries").join(&rel);
                let base = lib["url"].as_str().unwrap_or("https://libraries.minecraft.net/");
                ljobs.push(LibJob { url: format!("{}{}", base, rel), path: p, rel, sha1: None, size: None });
            }
        }
        let _ = fetch_missing(&ljobs, false).await;
        for j in &ljobs {
            if j.path.exists() { cp_put(&mut cp, &j.rel, j.path.clone()); }
        }
        merged["fabricArguments"] = lj["arguments"].clone();
    }

    let mut classpath: Vec<PathBuf> = cp.into_iter().map(|(_, p)| p).collect();
    classpath.push(client_jar);

    emit(app, "assets", 55.0, "Ассеты игры…");
    let (Some(aidx_url), Some(aidx_id)) = (vjson["assetIndex"]["url"].as_str(), vjson["assetIndex"]["id"].as_str())
    else {
        return Err(format!("В описании версии {} нет индекса ассетов", vid));
    };
    let idx_path = root.join("assets/indexes").join(format!("{}.json", aidx_id));
    let aidx = get_json_immutable(aidx_url, &idx_path).await?;
    // Marker avoids walking the whole object store (thousands of files) on every
    // launch once the index has been fully downloaded.
    let done_marker = root.join("assets/indexes").join(format!("{}.done", aidx_id));
    if !done_marker.exists() || deep_verify() {
        let objects: Vec<(String, String, Option<u64>)> = aidx["objects"]
            .as_object()
            .map(|o| {
                o.values()
                    .filter_map(|v| {
                        let h = v["hash"].as_str()?;
                        Some((h.get(0..2)?.to_string(), h.to_string(), v["size"].as_u64()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        let total_a = objects.len().max(1);
        // One blocking pass over the store collects what is missing before any
        // async task is spawned; deep verify also rejects truncated objects.
        let obj_root = root.join("assets/objects");
        let deep = deep_verify();
        let missing: Vec<(String, String)> = tokio::task::spawn_blocking(move || {
            objects
                .into_iter()
                .filter(|(pre, hash, size)| {
                    let Ok(md) = std::fs::metadata(obj_root.join(pre).join(hash)) else { return true };
                    deep && size.is_some_and(|want| md.len() != want)
                })
                .map(|(pre, hash, _)| (pre, hash))
                .collect()
        })
        .await
        .map_err(|e| e.to_string())?;
        let need = missing.len();
        if need > 0 {
            emit(app, "assets", 55.0, &format!("Ассеты игры: докачиваем {}…", need));
        }
        let done = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let root_c = root.clone();
        let step = (need / 20).max(1);
        let failed: Vec<bool> = futures::stream::iter(missing.into_iter().map(|(pre, hash)| {
            let root = root_c.clone();
            let done = done.clone();
            let app = app.clone();
            async move {
                let dest = root.join("assets/objects").join(&pre).join(&hash);
                // An asset object's name is its sha1.
                let bad = download_checked(&format!("{}/{}/{}", RESOURCES, pre, hash), &dest, Some(Sum::Sha1(&hash)), None)
                    .await
                    .is_err();
                let d = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if d.is_multiple_of(step) || d == need {
                    emit(&app, "assets", 55.0 + 30.0 * (d as f32 / need as f32),
                         &format!("Ассеты {}/{}", total_a - need + d, total_a));
                }
                bad
            }
        }))
        .buffer_unordered(PARALLEL_ASSETS)
        .collect::<Vec<_>>()
        .await;
        if !failed.iter().any(|b| *b) {
            let _ = std::fs::write(&done_marker, b"ok");
        }
    }

    if needs_log4j_config(vjson["id"].as_str().unwrap_or_default()) {
        if let Some(arg) = ensure_log4j_config(&vjson, &root).await {
            merged["millidaLog4jArg"] = Value::String(arg);
        }
    }

    let java = match java_override {
        Some(j) => j,
        None => ensure_java(app, vjson["javaVersion"]["majorVersion"].as_u64().unwrap_or(21)).await?,
    };

    Ok((merged, main_class, classpath, java))
}

/// `formatMsgNoLookups` exists since log4j 2.10, i.e. Minecraft 1.12+, where
/// Mojang's replacement config adds no protection but does force XML output.
/// Only pre-1.12 versions get it; unparsable ids are treated as old.
pub(crate) fn needs_log4j_config(id: &str) -> bool {
    let mut parts = id.split('.');
    let (major, minor) = (parts.next().unwrap_or_default(), parts.next().unwrap_or_default());
    match (major.parse::<u32>(), minor.parse::<u32>()) {
        (Ok(1), Ok(m)) => m < 12,
        _ => true,
    }
}

async fn ensure_log4j_config(vjson: &Value, root: &Path) -> Option<String> {
    let logging = vjson["logging"]["client"].as_object()?;
    let file = logging.get("file")?;
    let id = file["id"].as_str()?;
    let url = file["url"].as_str()?;
    let name = safe_file_name(id).ok()?;
    let dest = safe_child(&root.join("assets").join("log_configs"), &name).ok()?;
    download_new(url, &dest, file["sha1"].as_str().map(Sum::Sha1), file["size"].as_u64())
        .await
        .ok()?;
    let arg = logging
        .get("argument")
        .and_then(|a| a.as_str())
        .unwrap_or("-Dlog4j.configurationFile=${path}");
    Some(arg.replace("${path}", &dest.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log4j_config_only_for_pre_1_12() {
        assert!(needs_log4j_config("1.7.10"));
        assert!(needs_log4j_config("1.11.2"));
        assert!(!needs_log4j_config("1.12.2"));
        assert!(!needs_log4j_config("1.21.4"));
        assert!(needs_log4j_config("13w39a"));
    }

    #[test]
    fn natives_stamp_survives_same_set_and_resets_on_change() {
        let dir = std::env::temp_dir().join("millida-natives-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let stamp = "lwjgl.jar:aaa\nglfw.jar:bbb";

        assert!(!natives_up_to_date(&dir, stamp, false), "без метки распаковка обязана пройти");
        std::fs::write(natives_stamp_path(&dir), stamp.as_bytes()).unwrap();
        assert!(natives_up_to_date(&dir, stamp, false), "тот же набор — распаковывать нечего");
        assert!(
            !natives_up_to_date(&dir, "lwjgl.jar:ccc\nglfw.jar:bbb", false),
            "версия натива сменилась — набор надо разложить заново"
        );
        assert!(
            !natives_up_to_date(&dir, stamp, true),
            "«Проверить файлы» обязана разложить нативы заново даже при целой метке"
        );
    }
}
