/// What is left for the system, the launcher and everything open next to them.
/// The core's auto-tuner reserves the same amount (`engine::game::tuning`): the
/// manual slider must not take the machine where the automatic path refuses to.
export const RAM_RESERVE_GB = 4

/// Above this a larger heap stops helping, even on the biggest packs.
export const RAM_MAX_GB = 16

/**
 * Ceiling of the memory slider for this machine. A slider that reaches 16 GB on
 * an 8 GB machine is not a generous setting: the JVM commits what it was
 * promised, Windows starts swapping, and the first thing to fall over is
 * whatever asks for memory next — usually the launcher's own window, which then
 * shows "Out of Memory" instead of the UI.
 */
export function maxRamGb(totalRamMb: number): number {
  if (!totalRamMb) return RAM_MAX_GB
  return Math.max(1, Math.min(RAM_MAX_GB, Math.floor(totalRamMb / 1024) - RAM_RESERVE_GB))
}
