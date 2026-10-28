import { gpuClass } from './perfTier'

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

// Видеокарта, на которой рисует само окно лаунчера. Память и ядра о ней не
// говорят: ноутбук с 16 ГБ, 12 потоками и встроенной Intel UHD считался
// «мощным» и получал суперсэмплинг и кадры с частотой экрана. Таких — 38%
// установок (встроенная графика, телеметрия 13.10.2026). Имя берётся из первого
// же контекста WebGL (сцена лобби) и помнится неделю: отдельный контекст ради
// одного вопроса не создаём.
const GPU_KEY = 'm-webview-gpu'
const GPU_TTL_MS = 7 * 86_400_000
const SOFTWARE_GPU = /basic render|swiftshader|llvmpipe|software/i

let gpuName: string | null = null

export function webviewGpu(): string {
  if (gpuName !== null) return gpuName
  gpuName = ''
  try {
    const raw = localStorage.getItem(GPU_KEY)
    const saved = raw ? (JSON.parse(raw) as { name?: unknown; at?: unknown }) : null
    if (saved && typeof saved.name === 'string' && Date.now() - Number(saved.at) < GPU_TTL_MS) gpuName = saved.name
  } catch {}
  return gpuName
}

/** Зовёт сцена, получив контекст: имя видеокарты из WEBGL_debug_renderer_info. */
export function noteWebviewGpu(name: string): void {
  const clean = String(name || '').trim().slice(0, 160)
  if (!clean) return
  if (clean !== gpuName) cached = null
  gpuName = clean
  try {
    localStorage.setItem(GPU_KEY, JSON.stringify({ name: clean, at: Date.now() }))
  } catch {}
}

/** Уровень с поправкой на видеокарту окна: встроенная снимает «мощный», программная отрисовка — всегда слабый. */
export function tierWithGpu(base: DeviceTier, gpu: string): DeviceTier {
  if (!gpu) return base
  if (SOFTWARE_GPU.test(gpu)) return 'low'
  const cls = gpuClass(gpu)
  return (cls === 'igpu' || cls === 'weak') && base === 'high' ? 'mid' : base
}

/**
 * Сколько кадров в секунду рисуют 3D-сцены интерфейса. Экран на 144–240 Гц
 * будил сцену лобби 144–240 раз в секунду — это и было «лаунчер жрёт
 * видеокарту». Персонажу хватает 60, на слабой машине и встроенной графике — 30.
 */
export function sceneFpsCap(tier: DeviceTier, gpu: string, forced: DeviceTier | null): number {
  if (forced === 'high') return 60
  if (tier === 'low') return 30
  const cls = gpuClass(gpu)
  return cls === 'igpu' || cls === 'weak' ? 30 : 60
}

export const currentSceneFpsCap = (): number => sceneFpsCap(currentDeviceTier(), webviewGpu(), perfOverride())

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
  cached = tierWithGpu(
    deviceTier({
      deviceMemory: (nav as Navigator & { deviceMemory?: number }).deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
    }),
    webviewGpu(),
  )
  return cached
}
