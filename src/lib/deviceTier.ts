export type DeviceTier = 'low' | 'mid' | 'high'

export interface DeviceProfile {
  deviceMemory?: number
  hardwareConcurrency?: number
}

const HIGH_MEMORY_GB = 8
const HIGH_CORES = 8
const LOW_MEMORY_GB = 4
const LOW_CORES = 4

/**
 * Grades the machine from the two hints WebView2/Chromium expose. A missing
 * hint counts as capable: a powerful desktop that hides the value must keep the
 * full-quality path, degrading only where the hint proves the machine is weak.
 */
export function deviceTier(p: DeviceProfile): DeviceTier {
  const mem = p.deviceMemory
  const cores = p.hardwareConcurrency
  const weakMemory = typeof mem === 'number' && mem <= LOW_MEMORY_GB
  const weakCores = typeof cores === 'number' && cores <= LOW_CORES
  if (weakMemory || weakCores) return 'low'
  const capableMemory = typeof mem !== 'number' || mem >= HIGH_MEMORY_GB
  const capableCores = typeof cores !== 'number' || cores >= HIGH_CORES
  return capableMemory && capableCores ? 'high' : 'mid'
}

/**
 * Ceiling for the device-pixel-ratio a full-screen canvas or WebGL frame should
 * honour on this tier. Infinity means no extra cap, so high-end rendering keeps
 * its native density and looks byte-identical to before.
 */
export function maxCanvasPixelRatio(tier: DeviceTier): number {
  if (tier === 'low') return 1
  if (tier === 'mid') return 1.5
  return Infinity
}

let cached: DeviceTier | null = null

/**
 * Manual quality override from settings. Auto-detection sees only RAM and cores,
 * not the GPU, so a strong-CPU machine with a weak integrated GPU is graded
 * high and gets no caps; the switch lets the user force the weak-device path.
 */
export function perfOverride(): DeviceTier | null {
  try {
    const v = localStorage.getItem('m-perf-mode')
    return v === 'low' || v === 'high' ? v : null
  } catch {
    return null
  }
}

/** Live tier of the running browser: manual override wins, else the detection. */
export function currentDeviceTier(): DeviceTier {
  const forced = perfOverride()
  if (forced) return forced
  if (cached) return cached
  const nav = typeof navigator === 'undefined' ? ({} as Navigator) : navigator
  cached = deviceTier({
    deviceMemory: (nav as Navigator & { deviceMemory?: number }).deviceMemory,
    hardwareConcurrency: nav.hardwareConcurrency,
  })
  return cached
}
