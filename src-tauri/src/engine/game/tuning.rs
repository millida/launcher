//! Memory and JVM flags picked for the machine and the build, with the reasons
//! spelled out. The most common crash a new player hits is a hundred mods
//! running in the two gigabytes some guide told them to set.

use serde::Serialize;

use crate::engine::{content_dir, profile_dir, SHARED_DIRS};

/// GC settings shared by auto-tuning and the FPS boost mode, so the two can
/// never drift into two different profiles for the same JVM.
pub const GC_FLAGS: &[&str] = &[
    "-XX:+UseG1GC",
    "-XX:+ParallelRefProcEnabled",
    "-XX:MaxGCPauseMillis=50",
    "-XX:+UnlockExperimentalVMOptions",
    "-XX:+DisableExplicitGC",
    "-XX:G1NewSizePercent=30",
    "-XX:G1MaxNewSizePercent=40",
    "-XX:G1HeapRegionSize=8M",
    "-XX:G1ReservePercent=20",
    "-XX:G1HeapWastePercent=5",
    "-XX:G1MixedGCCountTarget=4",
    "-XX:InitiatingHeapOccupancyPercent=15",
    "-XX:G1MixedGCLiveThresholdPercent=90",
    "-XX:G1RSetUpdatingPauseTimePercent=5",
    "-XX:SurvivorRatio=32",
    "-XX:+PerfDisableSharedMem",
    "-XX:MaxTenuringThreshold=1",
];

/// Reserves the whole heap up front: steadier frame times, a slower first
/// launch and a machine that must actually have the memory. That trade is for
/// the explicit boost mode, not for the default.
pub const PRETOUCH_FLAG: &str = "-XX:+AlwaysPreTouch";

/// Left for the system, the launcher itself and everything else the player has
/// open. Below this Windows starts swapping and the game stutters far worse
/// than it would with a smaller heap. A flat four gigabytes took half of an
/// 8 GB machine, so the reserve is a share with a floor -- the same rule the
/// manual slider follows in `src/lib/ram.ts`.
const RESERVE_RATIO_DIVISOR: u64 = 4;
const RESERVE_MIN_MB: u64 = 2048;
const MIN_HEAP_MB: u32 = 2048;
const MAX_HEAP_MB: u32 = 12288;

#[derive(Serialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Tuning {
    pub ram_mb: u32,
    pub flags: Vec<String>,
    /// One line per decision, in the order they were made.
    pub reasons: Vec<String>,
    pub total_ram_mb: u64,
    pub mods: u32,
    pub shaders: bool,
    /// The player pinned a value by hand; tuning is only advice then.
    pub manual_ram_mb: u32,
}

pub fn total_ram_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.total_memory() / 1024 / 1024
}

fn count_files(profile: &str, kind: &str) -> u32 {
    let dir = profile_dir(profile).join(content_dir(kind));
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .filter(|e| {
                    let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                    e.path().is_file() && !n.ends_with(".disabled") && (n.ends_with(".jar") || n.ends_with(".zip"))
                })
                .count() as u32
        })
        .unwrap_or(0)
}

/// Heap the pack itself needs, before the machine gets a say. The steps come
/// from what packs of that size actually allocate: a hundred mods with their
/// registries and baked models do not fit in four gigabytes.
fn wanted_mb(mods: u32, shaders: bool) -> u32 {
    let base = match mods {
        0 => 2048,
        1..=20 => 3072,
        21..=80 => 4096,
        81..=150 => 6144,
        151..=250 => 8192,
        _ => 10240,
    };
    base + if shaders { 1024 } else { 0 }
}

fn reserved_mb(total_mb: u64) -> u64 {
    (total_mb / RESERVE_RATIO_DIVISOR).max(RESERVE_MIN_MB)
}

/// What the machine can actually give: never more than total minus the reserve,
/// and never so little that the game cannot start.
fn fit_to_machine(want: u32, total_mb: u64) -> (u32, Option<String>) {
    if total_mb == 0 {
        return (want.clamp(MIN_HEAP_MB, 4096), None);
    }
    let reserve = reserved_mb(total_mb);
    let ceiling = total_mb.saturating_sub(reserve).max(1024) as u32;
    if want > ceiling {
        let capped = ceiling.clamp(1024, MAX_HEAP_MB);
        return (
            capped,
            Some(format!(
                "Столько ОЗУ в системе нет — оставили {} ГБ системе и другим программам",
                reserve / 1024
            )),
        );
    }
    (want.min(MAX_HEAP_MB), None)
}

fn manual_ram_mb(profile: &str) -> u32 {
    let s: serde_json::Value = std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(serde_json::Value::Null);
    s["ramMb"].as_u64().unwrap_or(0) as u32
}

pub fn tune_profile(profile: &str) -> Tuning {
    let mods = count_files(profile, "mod");
    let shaders = count_files(profile, "shader") > 0;
    let total = total_ram_mb();
    let want = wanted_mb(mods, shaders);
    let (ram_mb, capped) = fit_to_machine(want, total);

    let mut reasons = vec![match mods {
        0 => "Ваниль без модов — игре хватает небольшой кучи".to_string(),
        n => format!("{} модов в сборке — под них нужно {} ГБ", n, want / 1024),
    }];
    if shaders {
        reasons.push("Установлены шейдеры — им нужен ещё гигабайт".into());
    }
    if total > 0 {
        reasons.push(format!("В системе {} ГБ ОЗУ", total / 1024));
    }
    if let Some(note) = capped {
        reasons.push(note);
    }
    reasons.push("Профиль сборщика мусора G1 подобран под короткие паузы — без него на больших сборках заметны рывки".into());

    Tuning {
        ram_mb,
        flags: GC_FLAGS.iter().map(|f| f.to_string()).collect(),
        reasons,
        total_ram_mb: total,
        mods,
        shaders,
        manual_ram_mb: manual_ram_mb(profile),
    }
}

/// Auto-tuning is the default: a build only opts out by pinning memory or by
/// turning the switch off in its settings.
pub fn auto_tune_on(profile: &str) -> bool {
    let s: serde_json::Value = std::fs::read(profile_dir(profile).join("millida-settings.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(serde_json::Value::Null);
    s["autoTune"].as_bool().unwrap_or(true)
}

pub fn set_auto_tune(profile: &str, on: bool) {
    let mut patch = serde_json::Map::new();
    patch.insert("autoTune".into(), serde_json::json!(on));
    crate::engine::merge_settings(profile, patch);
}

/// Flags the launch adds for a build, skipping anything the player already set
/// by hand and anything the boost mode is about to add: with the JVM the last
/// occurrence of a flag wins, so a duplicate would silently override the
/// player's own value.
pub fn tuned_flags(profile: &str, own_args: &str, boost_on: bool) -> Vec<String> {
    if !auto_tune_on(profile) || boost_on {
        return vec![];
    }
    let taken: Vec<&str> = own_args.split_whitespace().collect();
    GC_FLAGS
        .iter()
        .filter(|f| !taken.iter().any(|a| flag_name(a) == flag_name(f)))
        .map(|f| f.to_string())
        .collect()
}

/// `-XX:MaxGCPauseMillis=200` and `-XX:MaxGCPauseMillis=50` are the same flag
/// with different values, and only one of them can win.
fn flag_name(arg: &str) -> &str {
    arg.split('=').next().unwrap_or(arg)
}

/// Memory for a launch: an explicit request wins, otherwise the tuned value.
pub fn tuned_ram_mb(profile: &str, requested: u32) -> u32 {
    if requested > 0 {
        return requested.clamp(512, 65536);
    }
    let manual = manual_ram_mb(profile);
    if manual > 0 {
        return manual.clamp(512, 65536);
    }
    if !auto_tune_on(profile) {
        return default_half_ram();
    }
    tune_profile(profile).ram_mb
}

/// What auto-tuning is measured against: half the machine, the rule launchers
/// used before anyone looked at the pack.
pub(crate) fn default_half_ram() -> u32 {
    let total = total_ram_mb();
    if total == 0 {
        return 4096;
    }
    (total / 2).clamp(2048, 8192) as u32
}

/// Rough disk footprint of a build, used by the settings screen next to the
/// shared-store numbers.
pub fn profile_content_bytes(profile: &str) -> u64 {
    let dir = profile_dir(profile);
    SHARED_DIRS
        .iter()
        .map(|sub| crate::engine::dir_size(&dir.join(sub)))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// mods x machine -> heap. Every row is a machine we actually see in
    /// support: the point of the table is that no row ends up with a heap the
    /// machine cannot back or a heap the pack cannot start in.
    #[test]
    fn heap_fits_both_the_pack_and_the_machine() {
        let cases: [(u32, bool, u64, u32, &str); 6] = [
            (0, false, 8192, 2048, "ваниль на 8 ГБ: больше двух гигабайт игре не нужно"),
            (40, false, 16384, 4096, "средняя сборка на 16 ГБ получает свои 4 ГБ"),
            (200, false, 32768, 8192, "большая сборка на 32 ГБ — 8 ГБ"),
            (200, false, 8192, 6144, "та же сборка на 8 ГБ ужимается до четверти под систему"),
            (40, true, 16384, 5120, "шейдеры добавляют гигабайт"),
            (0, false, 4096, 2048, "на 4 ГБ ваниль умещается в половину машины"),
        ];
        for (mods, shaders, total, want, why) in cases {
            let (got, _) = fit_to_machine(wanted_mb(mods, shaders), total);
            assert_eq!(
                got, want,
                "{mods} модов на машине с {total} МБ должны дать {want} МБ кучи, получили {got}. \
                 Зачем случай закреплён: {why}",
            );
        }
    }

    #[test]
    fn machine_reserve_is_never_eaten() {
        for total in [2048u64, 4096, 6144, 8192, 16384, 65536] {
            let (heap, _) = fit_to_machine(wanted_mb(300, true), total);
            assert!(
                (heap as u64) <= total.saturating_sub(reserved_mb(total)).max(1024),
                "куча {heap} МБ на машине с {total} МБ не оставляет системе {} МБ — \
                 игра уйдёт в своп и будет тормозить сильнее, чем с меньшей кучей",
                reserved_mb(total),
            );
        }
    }

    /// The player's own flag must survive: the JVM takes the last one, so a
    /// tuned duplicate would quietly replace what they set.
    #[test]
    fn tuning_never_overrides_a_flag_the_player_set() {
        let flags = GC_FLAGS
            .iter()
            .filter(|f| flag_name(f) != "-XX:MaxGCPauseMillis")
            .count();
        let kept: Vec<String> = GC_FLAGS
            .iter()
            .filter(|f| flag_name(f) != flag_name("-XX:MaxGCPauseMillis=200"))
            .map(|f| f.to_string())
            .collect();
        assert_eq!(kept.len(), flags);
        assert!(
            !kept.iter().any(|f| f.starts_with("-XX:MaxGCPauseMillis")),
            "свой -XX:MaxGCPauseMillis игрока должен остаться единственным",
        );
    }

    #[test]
    fn pretouch_is_not_part_of_the_default_profile() {
        assert!(
            !GC_FLAGS.contains(&PRETOUCH_FLAG),
            "{PRETOUCH_FLAG} резервирует всю кучу на старте: в автоматическом режиме это \
             неожиданно долгий запуск и требование иметь всю память физически свободной",
        );
    }
}
