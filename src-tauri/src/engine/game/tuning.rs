// Picks memory and JVM flags for the computer and the modpack, with the reasons. Downloads and runs nothing.
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

/// Ниже этого свободная сейчас память кучу не урезает (см. `safe_ceiling_mb`).
const FREE_FLOOR_MB: u64 = 4096;
const SMALL_MACHINE_HEAP_MB: u64 = 4096;
const LARGE_MACHINE_KEEP_MB: u64 = 10240;
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

/// The JVM spends roughly another 30 % on top of the heap (metaspace, native
/// buffers of mods), an integrated GPU takes its memory from the same RAM, and
/// Windows, the launcher and a browser live next to the game. Half of a 16 GB
/// machine as heap meant a ~10 GB java.exe and swapping, so above 8 GB the heap
/// gets three eighths of the machine, which keeps the whole process near half
/// of it. Modrinth App (4 GB at 16, 6 GB at 32) and Prism (4 GB) stay lower
/// still; a pack-aware auto may go above them, not into the swap. Small machines
/// keep half, capped at 4 GB: below that a mid-size pack does nothing but GC.
///
/// Свободное «сейчас» режет кучу не ниже `FREE_FLOOR_MB`: -Xmx — только предел,
/// G1 занимает память по мере надобности, а браузер, открытый в момент нажатия
/// «Играть», потом закрывают. Без пола 8–12 ГБ машина с открытым браузером
/// давала сборке на 200 модов 2 ГБ кучи — сборщик мусора без остановки и FPS
/// вдвое ниже (жалоба 25.09.2026).
fn safe_ceiling_mb(total_mb: u64, available_mb: u64) -> u64 {
    let by_total = (total_mb / 2)
        .min(SMALL_MACHINE_HEAP_MB)
        .max(total_mb * 3 / 8)
        .max(total_mb.saturating_sub(LARGE_MACHINE_KEEP_MB));
    let by_free = if available_mb > 0 {
        (available_mb * 10 / 13).saturating_sub(512).max(FREE_FLOOR_MB)
    } else {
        u64::MAX
    };
    by_total.min(by_free).max(MIN_HEAP_MB as u64)
}

pub fn available_ram_mb() -> u64 {
    let mut sys = sysinfo::System::new();
    sys.refresh_memory();
    sys.available_memory() / 1024 / 1024
}

/// What the machine can actually give: never more than total minus the reserve,
/// and never so little that the game cannot start.
fn fit_to_machine(want: u32, total_mb: u64) -> (u32, Option<String>) {
    fit_to_machine_with(want, total_mb, available_ram_mb())
}

fn fit_to_machine_with(want: u32, total_mb: u64, available_mb: u64) -> (u32, Option<String>) {
    if total_mb == 0 {
        return (want.clamp(MIN_HEAP_MB, 4096), None);
    }
    let reserve = reserved_mb(total_mb);
    let ceiling = total_mb
        .saturating_sub(reserve)
        .min(safe_ceiling_mb(total_mb, available_mb))
        .max(1024) as u32;
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

/// The most any launch may take, however the number was chosen (slider, crash fix, a pack's own
/// memory): the machine minus what the system keeps. Past it Windows swaps and the game and the
/// launcher stutter far worse than with a smaller heap. Unknown machine size: no limit.
pub fn os_reserve_ceiling_mb(total_mb: u64) -> Option<u32> {
    if total_mb == 0 {
        return None;
    }
    Some(total_mb.saturating_sub(reserved_mb(total_mb)).clamp(1024, 65536) as u32)
}

/// `ram` cut to what the machine can give without swapping.
pub fn clamp_to_os_reserve(ram: u32, total_mb: u64) -> u32 {
    match os_reserve_ceiling_mb(total_mb) {
        Some(ceiling) => ram.min(ceiling),
        None => ram,
    }
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

/// The build's own memory setting, the one value every memory control writes:
/// the slider, the crash dialog, Milli and the pre-launch advice. 0 is auto.
/// A second copy in the webview's storage used to win over it, so a crash
/// fix or a pack's own memory changed nothing the launch actually took.
pub(crate) fn ram_setting(mb: u32) -> Result<serde_json::Value, String> {
    match mb {
        0 => Ok(serde_json::Value::Null),
        m if (512..=65536).contains(&m) => Ok(serde_json::json!(m)),
        _ => Err("Такой объём памяти лаунчер не выставит".into()),
    }
}

pub fn set_profile_ram(profile: &str, mb: u32) -> Result<(), String> {
    let value = ram_setting(mb)?;
    if !crate::engine::load_profiles().iter().any(|p| p.name == profile) {
        return Err("Сборка не найдена".into());
    }
    let mut patch = serde_json::Map::new();
    patch.insert("ramMb".into(), value);
    crate::engine::merge_settings(profile, patch);
    Ok(())
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
    tuned_flags_for(auto_tune_on(profile), own_args, boost_on)
}

/// `tuned_flags` with the build's auto-tuning switch already read.
pub(crate) fn tuned_flags_for(auto_tune: bool, own_args: &str, boost_on: bool) -> Vec<String> {
    if !auto_tune || boost_on {
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

/// Опции, которые HotSpot принимает только после -XX:+UnlockExperimentalVMOptions.
/// Гайды копируют их без разблокировки, и игра падала до окна: «VM option
/// 'G1NewSizePercent' is experimental» (телеметрия 25.09.2026). UseG1GC здесь
/// ради старых JVM, где G1 ещё экспериментальный.
const EXPERIMENTAL_XX: &[&str] = &[
    "G1NewSizePercent",
    "G1MaxNewSizePercent",
    "G1MixedGCLiveThresholdPercent",
    "UseG1GC",
    "UseZGC",
    "UseShenandoahGC",
    "UseEpsilonGC",
    "EnableJVMCI",
    "UseJVMCICompiler",
    "EagerJVMCI",
    "UseJVMCINativeLibrary",
    "UseFastUnorderedTimeStamps",
    "UseCriticalJavaThreadPriority",
    "UseVectorCmov",
    "TrimNativeHeapInterval",
];

const UNLOCK_EXPERIMENTAL: &str = "-XX:+UnlockExperimentalVMOptions";

fn xx_name(arg: &str) -> Option<&str> {
    let rest = arg.strip_prefix("-XX:")?;
    let rest = rest.strip_prefix('+').or_else(|| rest.strip_prefix('-')).unwrap_or(rest);
    Some(rest.split('=').next().unwrap_or(rest))
}

/// Выбор сборщика мусора: два сразу JVM не принимает («Multiple garbage
/// collectors selected»).
fn gc_choice(arg: &str) -> bool {
    arg.starts_with("-XX:+Use")
        && matches!(
            xx_name(arg),
            Some("UseG1GC" | "UseZGC" | "UseShenandoahGC" | "UseParallelGC" | "UseSerialGC" | "UseConcMarkSweepGC" | "UseEpsilonGC")
        )
}

/// Опции запускатора, которых нет в старой Java: с ними JVM выходит сразу с
/// «Unrecognized option». (опция, первая Java, где она есть)
const LAUNCHER_OPTIONS_SINCE: &[(&str, u32)] = &[
    ("--sun-misc-unsafe-memory-access", 23),
    ("--enable-native-access", 17),
];

/// Не для Java 8: резервирование всей кучи на её старте там делается одним потоком и держит
/// запуск минуту на больших кучах, а выигрыша в кадрах старая JVM не даёт.
const NOT_ON_JAVA_8: &[&str] = &[PRETOUCH_FLAG];

/// Последняя правка аргументов JVM перед запуском. Флаги собираются из
/// четырёх мест (описание версии, автоподбор, буст, свои аргументы игрока), и
/// каждое по отдельности верно, а вместе они роняли JVM до окна:
/// - экспериментальная опция без разблокировки перед ней;
/// - два сборщика мусора (свой игрока и наш G1) — остаётся последний, то есть
///   выбор игрока: его аргументы стоят правее наших;
/// - опции запускатора новее выбранной Java.
///
/// Незнакомые этой Java -XX (UseBiasedLocking на Java 21 и т.п.) JVM с
/// -XX:+IgnoreUnrecognizedVMOptions пропускает вместо выхода.
pub fn fit_jvm_args(args: &mut Vec<String>, java_major: Option<u32>) {
    if let Some(major) = java_major {
        args.retain(|a| {
            let name = a.split('=').next().unwrap_or(a);
            !LAUNCHER_OPTIONS_SINCE.iter().any(|(opt, since)| name == *opt && major < *since)
        });
        if major <= 8 {
            args.retain(|a| !NOT_ON_JAVA_8.contains(&a.as_str()));
        }
    }
    let gcs: Vec<usize> = (0..args.len()).filter(|&i| gc_choice(&args[i])).collect();
    if let Some((&keep, rest)) = gcs.split_last() {
        let keep_name = xx_name(&args[keep]).map(str::to_string);
        let drop: Vec<usize> = rest
            .iter()
            .copied()
            .filter(|&i| xx_name(&args[i]).map(str::to_string) != keep_name)
            .collect();
        for i in drop.into_iter().rev() {
            args.remove(i);
        }
    }
    args.retain(|a| a != "-XX:-UnlockExperimentalVMOptions");
    let first_exp = args
        .iter()
        .position(|a| xx_name(a).is_some_and(|n| EXPERIMENTAL_XX.contains(&n)));
    if let Some(i) = first_exp {
        if !args[..i].iter().any(|a| a == UNLOCK_EXPERIMENTAL) {
            args.retain(|a| a != UNLOCK_EXPERIMENTAL);
            let i = args
                .iter()
                .position(|a| xx_name(a).is_some_and(|n| EXPERIMENTAL_XX.contains(&n)))
                .unwrap_or(0);
            args.insert(i, UNLOCK_EXPERIMENTAL.to_string());
        }
    }
    if !args.iter().any(|a| a.contains("IgnoreUnrecognizedVMOptions")) {
        let at = usize::from(!args.is_empty() && args[0].starts_with("-Xmx"));
        args.insert(at, "-XX:+IgnoreUnrecognizedVMOptions".into());
    }
}

/// Memory facts the launch screen checks before a start: the heap this launch
/// will get, what the build needs, and what the PC has free right now.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RamCheck {
    pub heap_mb: u32,
    /// The build's own need by its mods and shaders, before the PC has a say.
    pub need_mb: u32,
    /// The most auto-tuning would give this build on this PC.
    pub fit_mb: u32,
    pub total_mb: u64,
    pub available_mb: u64,
    pub mods: u32,
    /// The heap was set by hand (slider or a crash fix), not by auto-tuning.
    pub manual: bool,
    /// A catalogue pack states its own memory; the launch follows it.
    pub pack_owned: bool,
}

pub fn ram_check(profile: &str, requested: u32) -> RamCheck {
    let mods = count_files(profile, "mod");
    let shaders = count_files(profile, "shader") > 0;
    let tuning = tune_profile(profile);
    RamCheck {
        heap_mb: clamp_to_os_reserve(tuned_ram_mb(profile, requested), tuning.total_ram_mb),
        need_mb: wanted_mb(mods, shaders),
        fit_mb: tuning.ram_mb,
        total_mb: tuning.total_ram_mb,
        available_mb: available_ram_mb(),
        mods,
        manual: requested > 0 || manual_ram_mb(profile) > 0,
        pack_owned: !crate::engine::fps_boost_applicable(profile),
    }
}

/// Memory for a launch: an explicit request wins, otherwise the tuned value.
pub fn tuned_ram_mb(profile: &str, requested: u32) -> u32 {
    heap_for(&HeapAsk::of(profile, requested), &Machine::now())
}

/// What a build asks of memory: an explicit request for this launch, the build's own pinned value,
/// whether auto-tuning is on, and what the build holds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct HeapAsk {
    pub requested: u32,
    pub manual: u32,
    pub auto_tune: bool,
    pub mods: u32,
    pub shaders: bool,
}

/// The memory of the machine at the moment of the launch, in MB.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Machine {
    pub total_mb: u64,
    pub available_mb: u64,
}

impl Machine {
    pub(crate) fn now() -> Machine {
        Machine { total_mb: total_ram_mb(), available_mb: available_ram_mb() }
    }
}

impl HeapAsk {
    /// The build's own side of the question, read from its folder.
    pub(crate) fn of(profile: &str, requested: u32) -> HeapAsk {
        HeapAsk {
            requested,
            manual: manual_ram_mb(profile),
            auto_tune: auto_tune_on(profile),
            mods: count_files(profile, "mod"),
            shaders: count_files(profile, "shader") > 0,
        }
    }
}

/// `tuned_ram_mb` as a calculation: the same answer from the same facts, without reading the disk
/// or the system. An explicit request wins, then the build's own value, then half the machine
/// with auto-tuning off, then auto-tuning.
pub(crate) fn heap_for(ask: &HeapAsk, machine: &Machine) -> u32 {
    if ask.requested > 0 {
        return ask.requested.clamp(512, 65536);
    }
    if ask.manual > 0 {
        return ask.manual.clamp(512, 65536);
    }
    if !ask.auto_tune {
        return half_ram_of(machine.total_mb);
    }
    fit_to_machine_with(wanted_mb(ask.mods, ask.shaders), machine.total_mb, machine.available_mb).0
}

/// Heap to offer after the game ran out of the `used_mb` it had. The tuned value
/// is what the game just ran out of: offered again, the button pinned the same
/// heap and the next start died the same way. The step goes over the swap-wary
/// ceiling of auto-tuning, since the heap has proven too small, but never into
/// the reserve the system keeps. `None` when there is nothing more to give.
pub fn heap_after_oom(used_mb: u32, total_mb: u64) -> Option<u32> {
    if total_mb == 0 {
        return None;
    }
    let cap = total_mb.saturating_sub(reserved_mb(total_mb)).min(MAX_HEAP_MB as u64) as u32;
    let next = used_mb.saturating_add(OOM_STEP_MB).min(cap);
    (next > used_mb).then_some(next)
}

const OOM_STEP_MB: u32 = 2048;

/// What auto-tuning is measured against: half the machine, the rule launchers
/// used before anyone looked at the pack.
fn half_ram_of(total: u64) -> u32 {
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
    /// Вход (память системы) → потолок кучи. Резерв системы — четверть, но не меньше 2 ГБ.
    #[test]
    fn a_launch_never_takes_the_memory_the_system_needs() {
        let gb = 1024u64;
        assert_eq!(super::os_reserve_ceiling_mb(4 * gb), Some(2048), "на 4 ГБ системе остаются 2");
        assert_eq!(super::os_reserve_ceiling_mb(8 * gb), Some(6144));
        assert_eq!(super::os_reserve_ceiling_mb(16 * gb), Some(12 * 1024));
        assert_eq!(super::os_reserve_ceiling_mb(0), None, "размер памяти неизвестен — не режем");
        assert_eq!(super::os_reserve_ceiling_mb(2 * gb), Some(1024), "даже на 2 ГБ игре остаётся минимум, чтобы запуститься");
        // Игрок или автор сборки просит 6 ГБ на 4-гигабайтном ПК: своп вместо игры.
        assert_eq!(super::clamp_to_os_reserve(6144, 4 * gb), 2048);
        assert_eq!(super::clamp_to_os_reserve(1536, 4 * gb), 1536, "меньше потолка — не трогаем");
        assert_eq!(super::clamp_to_os_reserve(6144, 0), 6144);
    }

    #[test]
    fn a_16gb_laptop_never_gives_the_heap_more_than_half() {
        assert_eq!(super::safe_ceiling_mb(16 * 1024, 12 * 1024), 6 * 1024);
        assert_eq!(super::safe_ceiling_mb(32 * 1024, 0), 22 * 1024);
        // Свободно мало — куча под то, что есть, но не меньше пола в 4 ГБ.
        assert!(super::safe_ceiling_mb(16 * 1024, 5 * 1024) <= 5 * 1024);
        assert_eq!(super::safe_ceiling_mb(8 * 1024, 1024), 4 * 1024);
    }

    /// Открытый браузер в момент запуска не должен душить большую сборку:
    /// 2 ГБ кучи на 200 модов — это сборка мусора каждый кадр.
    #[test]
    fn busy_ram_at_launch_does_not_starve_a_big_pack() {
        for total in [8u64, 12, 16] {
            let total_mb = total * 1024;
            let free_mb = total_mb * 4 / 10;
            let (heap, _) = super::fit_to_machine_with(super::wanted_mb(250, false), total_mb, free_mb);
            assert!(heap >= 4096, "{total} ГБ, свободно 40 %: куча {heap} МБ");
            assert!(heap as u64 <= total_mb / 2);
        }
    }

    /// machine -> ceiling of the heap. The heap plus ~30 % off-heap is what
    /// java.exe shows in Task Manager; past about half of the machine Windows
    /// swaps and both the game and the launcher stutter.
    #[test]
    fn heap_ceiling_keeps_the_java_process_near_half_of_the_machine() {
        let cases: [(u64, u64, &str); 8] = [
            (4096, 2048, "4 GB keeps half: less and vanilla does not start"),
            (6144, 3072, "6 GB keeps half"),
            (8192, 4096, "8 GB keeps 4 GB: a mid-size pack in 3 GB does nothing but GC"),
            (12288, 4608, "12 GB: three eighths, half was 6 GB of heap and ~8 GB of java.exe"),
            (16384, 6144, "16 GB: 6 GB of heap is ~8 GB of java.exe; 8 GB of heap was the «eats 10 GB» review"),
            (16180, 6067, "16 GB sticks as Windows reports them must not round up into the old half"),
            (24576, 14336, "24 GB: machine minus 10 GB, more than any pack asks for"),
            (32768, 22528, "32 GB: the heavy-pack request (up to 11 GB) still fits untouched"),
        ];
        for (total, want, why) in cases {
            let got = safe_ceiling_mb(total, 0);
            assert_eq!(got, want, "machine of {total} MB must cap the heap at {want} MB, got {got}. Why pinned: {why}");
            if total <= 16 * 1024 {
                assert!(
                    got * 13 / 10 <= (total / 2).max(SMALL_MACHINE_HEAP_MB * 13 / 10),
                    "heap {got} MB plus off-heap does not fit half of a {total} MB machine: the game swaps",
                );
            }
        }
    }

    use super::*;

    /// requested megabytes -> what lands in the build's settings.
    #[test]
    fn every_memory_control_writes_one_validated_value() {
        let cases: [(u32, Result<serde_json::Value, ()>, &str); 5] = [
            (0, Ok(serde_json::Value::Null), "0 is auto: the key goes, tuning decides"),
            (6144, Ok(serde_json::json!(6144)), "the slider at 6 GB"),
            (512, Ok(serde_json::json!(512)), "the smallest heap the launcher sets"),
            (511, Err(()), "below that the game does not start"),
            (65537, Err(()), "a value from a broken payload is refused, not clamped"),
        ];
        for (mb, want, why) in cases {
            assert_eq!(ram_setting(mb).map_err(|_| ()), want, "{mb} MB: {why}");
        }
    }

    /// (heap the game ran out of, machine) -> heap the crash dialog offers.
    #[test]
    fn a_heap_that_ran_out_is_never_offered_again() {
        let cases: [(u32, u64, Option<u32>, &str); 6] = [
            (6040, 16251, Some(8088), "All of Aeronautics 24.10: auto gave 6040 MB, the button offered «5 ГБ» — the same heap"),
            (4029, 8059, Some(6011), "8 GB machine: up to what is left after the 2 GB the system keeps"),
            (6011, 8059, None, "8 GB machine at its reserve: no button that pins the same heap"),
            (2048, 4096, None, "4 GB machine: the reserve leaves nothing above 2 GB"),
            (10240, 32768, Some(12288), "a 32 GB machine stops at the heap ceiling of the launcher"),
            (4096, 0, None, "machine size unknown: nothing to measure the step against"),
        ];
        for (used, total, want, why) in cases {
            let got = heap_after_oom(used, total);
            assert_eq!(got, want, "ran out at {used} MB on {total} MB, offered {got:?}. Why pinned: {why}");
            if let Some(mb) = got {
                assert!(mb > used, "the offer must be more than the heap that ran out");
                assert!(mb as u64 <= total - reserved_mb(total), "the offer must leave the system its reserve");
            }
        }
    }

    /// mods x machine -> heap. Every row is a machine we actually see in
    /// support: the point of the table is that no row ends up with a heap the
    /// machine cannot back or a heap the pack cannot start in.
    #[test]
    fn heap_fits_both_the_pack_and_the_machine() {
        let cases: [(u32, bool, u64, u32, &str); 8] = [
            (200, false, 16384, 6144, "большая сборка на 16 ГБ — 6 ГБ: при 8 java.exe занимал ~10 ГБ и машина уходила в своп"),
            (300, true, 16384, 6144, "самая тяжёлая сборка с шейдерами на 16 ГБ упирается в тот же потолок"),
            (0, false, 8192, 2048, "ваниль на 8 ГБ: больше двух гигабайт игре не нужно"),
            (40, false, 16384, 4096, "средняя сборка на 16 ГБ получает свои 4 ГБ"),
            (200, false, 32768, 8192, "большая сборка на 32 ГБ — 8 ГБ"),
            (200, false, 8192, 4096, "та же сборка на 8 ГБ — не больше половины ОЗУ: Java сверх кучи и встройка тоже едят память"),
            (40, true, 16384, 5120, "шейдеры добавляют гигабайт"),
            (0, false, 4096, 2048, "на 4 ГБ ваниль умещается в половину машины"),
        ];
        for (mods, shaders, total, want, why) in cases {
            let (got, _) = fit_to_machine_with(wanted_mb(mods, shaders), total, 0);
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
            let (heap, _) = fit_to_machine_with(wanted_mb(300, true), total, 0);
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

    fn v(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn experimental_options_get_unlocked_before_them() {
        let mut a = v(&["-Xmx4096M", "-XX:G1NewSizePercent=30", "-XX:+UseG1GC", "net.minecraft.client.main.Main"]);
        fit_jvm_args(&mut a, Some(21));
        let unlock = a.iter().position(|x| x == UNLOCK_EXPERIMENTAL).expect("разблокировка добавлена");
        let exp = a.iter().position(|x| x.starts_with("-XX:G1NewSizePercent")).unwrap();
        assert!(unlock < exp, "разблокировка стоит перед опцией, иначе JVM всё равно выходит: {a:?}");

        let mut late = v(&["-Xmx2G", "-XX:G1NewSizePercent=30", UNLOCK_EXPERIMENTAL, "Main"]);
        fit_jvm_args(&mut late, None);
        assert_eq!(late.iter().filter(|x| *x == UNLOCK_EXPERIMENTAL).count(), 1, "разблокировка одна: {late:?}");
        assert!(late.iter().position(|x| x == UNLOCK_EXPERIMENTAL) < late.iter().position(|x| x.starts_with("-XX:G1New")));

        let mut ok = v(&["-Xmx2G", UNLOCK_EXPERIMENTAL, "-XX:G1NewSizePercent=30", "Main"]);
        fit_jvm_args(&mut ok, None);
        assert_eq!(ok.iter().filter(|x| *x == UNLOCK_EXPERIMENTAL).count(), 1, "правильный порядок не трогаем");
    }

    #[test]
    fn only_the_players_gc_survives() {
        let mut a = v(&["-Xmx4G", "-XX:+UseG1GC", "-XX:MaxGCPauseMillis=50", "-XX:+UseZGC", "Main"]);
        fit_jvm_args(&mut a, Some(21));
        assert!(!a.contains(&"-XX:+UseG1GC".to_string()), "наш G1 уступает выбору игрока: {a:?}");
        assert!(a.contains(&"-XX:+UseZGC".to_string()));
    }

    #[test]
    fn launcher_options_newer_than_java_are_dropped() {
        let mut a = v(&["-Xmx4G", "--sun-misc-unsafe-memory-access=allow", "--enable-native-access=ALL-UNNAMED", "Main"]);
        let mut on25 = a.clone();
        fit_jvm_args(&mut on25, Some(25));
        assert!(on25.iter().any(|x| x.starts_with("--sun-misc")), "Java 25 опцию знает");
        fit_jvm_args(&mut a, Some(21));
        assert!(!a.iter().any(|x| x.starts_with("--sun-misc")), "на Java 21 — «Unrecognized option»: {a:?}");
        assert!(a.iter().any(|x| x.starts_with("--enable-native-access")), "с Java 17 она есть");
        assert!(a.contains(&"-XX:+IgnoreUnrecognizedVMOptions".to_string()));
        assert_eq!(a[0], "-Xmx4G", "память остаётся первой");
    }

    #[test]
    fn heap_pretouch_stays_off_java_8() {
        let boost = v(&["-Xmx6G", "-XX:+UseG1GC", PRETOUCH_FLAG, "Main"]);
        let mut old = boost.clone();
        fit_jvm_args(&mut old, Some(8));
        assert!(!old.contains(&PRETOUCH_FLAG.to_string()), "на Java 8 запуск с предзаполнением кучи тянется минуту: {old:?}");
        assert!(old.contains(&"-XX:+UseG1GC".to_string()), "остальные флаги буста остаются");
        for major in [Some(11), Some(17), Some(21), Some(25), None] {
            let mut a = boost.clone();
            fit_jvm_args(&mut a, major);
            assert!(a.contains(&PRETOUCH_FLAG.to_string()), "на Java {major:?} предзаполнение — выбор буста: {a:?}");
        }
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
