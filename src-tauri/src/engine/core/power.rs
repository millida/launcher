// Whether the computer runs on a nearly empty battery. Background work that only makes a later
// click faster (preparing a build in the lobby) stays off then: the player would pay for it with
// battery. Read from the system (Windows: GetSystemPowerStatus; macOS: `pmset -g batt`; Linux:
// /sys/class/power_supply). Nothing leaves the machine.

/// Below this charge, on battery, the lobby prepares nothing in the background.
pub(crate) const LOW_BATTERY_PERCENT: u8 = 20;

/// What the system says about its power.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Power {
    pub on_battery: bool,
    /// Charge, when the system knows it.
    pub percent: Option<u8>,
}

impl Power {
    pub(crate) fn low(&self) -> bool {
        self.on_battery && self.percent.is_some_and(|p| p < LOW_BATTERY_PERCENT)
    }
}

/// True only when the system says it runs on battery below 20 %; a desktop, a laptop on its
/// charger and a system that cannot tell are not low.
pub(crate) fn low_battery() -> bool {
    power().is_some_and(|p| p.low())
}

#[cfg(windows)]
fn power() -> Option<Power> {
    use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut st: SYSTEM_POWER_STATUS = unsafe { std::mem::zeroed() };
    // SAFETY: a plain out-parameter of the documented size.
    if unsafe { GetSystemPowerStatus(&mut st) } == 0 {
        return None;
    }
    windows_status(st.ACLineStatus, st.BatteryFlag, st.BatteryLifePercent)
}

/// ACLineStatus 0 is battery, 1 the charger, 255 unknown; BatteryFlag 128 is "no battery";
/// BatteryLifePercent 255 is unknown.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_status(ac_line: u8, flag: u8, percent: u8) -> Option<Power> {
    if flag == 128 || ac_line == 255 {
        return None;
    }
    Some(Power { on_battery: ac_line == 0, percent: (percent <= 100).then_some(percent) })
}

#[cfg(target_os = "macos")]
fn power() -> Option<Power> {
    let out = std::process::Command::new("/usr/bin/pmset").args(["-g", "batt"]).output().ok()?;
    pmset_status(&String::from_utf8_lossy(&out.stdout))
}

/// `pmset -g batt`: "Now drawing from 'Battery Power'" and "InternalBattery-0 (id=…) 15%; discharging; …".
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn pmset_status(text: &str) -> Option<Power> {
    let battery_line = text.lines().find(|l| l.contains("InternalBattery"))?;
    let percent = battery_line
        .split(|c: char| c.is_whitespace() || c == ';')
        .find_map(|w| w.strip_suffix('%').and_then(|n| n.parse::<u8>().ok()));
    Some(Power { on_battery: text.contains("'Battery Power'"), percent })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn power() -> Option<Power> {
    let rd = std::fs::read_dir("/sys/class/power_supply").ok()?;
    for e in rd.flatten() {
        let dir = e.path();
        let kind = std::fs::read_to_string(dir.join("type")).unwrap_or_default();
        if kind.trim() != "Battery" {
            continue;
        }
        let status = std::fs::read_to_string(dir.join("status")).unwrap_or_default();
        let capacity = std::fs::read_to_string(dir.join("capacity")).unwrap_or_default();
        return Some(sysfs_status(&status, &capacity));
    }
    None
}

#[cfg_attr(not(all(unix, not(target_os = "macos"))), allow(dead_code))]
fn sysfs_status(status: &str, capacity: &str) -> Power {
    Power { on_battery: status.trim() == "Discharging", percent: capacity.trim().parse::<u8>().ok().filter(|p| *p <= 100) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_nearly_empty_battery_counts_as_low() {
        let at = |on_battery: bool, percent: Option<u8>| Power { on_battery, percent }.low();
        assert!(at(true, Some(15)));
        assert!(!at(true, Some(20)), "20 % is the line, not below it");
        assert!(!at(false, Some(5)), "on the charger nothing is spared");
        assert!(!at(true, None), "a charge the system cannot tell is not low");
    }

    #[test]
    fn every_system_is_read_its_own_way() {
        assert_eq!(windows_status(0, 1, 12), Some(Power { on_battery: true, percent: Some(12) }));
        assert_eq!(windows_status(1, 8, 12), Some(Power { on_battery: false, percent: Some(12) }));
        assert_eq!(windows_status(1, 128, 255), None, "a desktop without a battery");
        assert_eq!(windows_status(0, 1, 255), Some(Power { on_battery: true, percent: None }));
        let mac = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=7405667)\t15%; discharging; 1:02 remaining present: true\n";
        assert_eq!(pmset_status(mac), Some(Power { on_battery: true, percent: Some(15) }));
        let mac_ac = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=7405667)\t100%; charged; 0:00 remaining present: true\n";
        assert_eq!(pmset_status(mac_ac), Some(Power { on_battery: false, percent: Some(100) }));
        assert_eq!(pmset_status("Now drawing from 'AC Power'\n"), None, "a Mac without a battery");
        assert_eq!(sysfs_status("Discharging\n", "9\n"), Power { on_battery: true, percent: Some(9) });
        assert_eq!(sysfs_status("Charging\n", "9\n"), Power { on_battery: false, percent: Some(9) });
    }
}
