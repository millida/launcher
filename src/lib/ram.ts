/// Share of the machine left for the system, the launcher and everything open
/// next to them. The core's auto-tuner reserves the same (`engine::game::tuning`):
/// the manual slider must not take the machine where the automatic path refuses to.
export const RAM_RESERVE_RATIO = 0.25

/// Floor of that share: on a small machine a quarter is not enough for Windows.
export const RAM_RESERVE_MIN_GB = 2

/// Above this a larger heap stops helping, even on the biggest packs.
export const RAM_MAX_GB = 16

/**
 * Ceiling of the memory slider for this machine. A slider that reaches 16 GB on
 * an 8 GB machine is not a generous setting: the JVM commits what it was
 * promised, Windows starts swapping, and the first thing to fall over is
 * whatever asks for memory next — usually the launcher's own window, which then
 * shows "Out of Memory" instead of the UI.
 *
 * The machine size is rounded, not truncated: Windows reports 8 GB of sticks as
 * ~7.9 GiB once the firmware has taken its share, and flooring that turned an
 * 8 GB machine into a 7 GB one — a whole gigabyte lost to arithmetic.
 */
export function maxRamGb(totalRamMb: number): number {
  if (!totalRamMb) return RAM_MAX_GB
  const totalGb = Math.round(totalRamMb / 1024)
  const reserve = Math.max(RAM_RESERVE_MIN_GB, totalGb * RAM_RESERVE_RATIO)
  return Math.max(1, Math.min(RAM_MAX_GB, Math.floor(totalGb - reserve)))
}
