import { gpuClass, type GpuClass } from './perfTier'

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

/**
 * Границы слабого ПК по точным данным ядра (WEAK-06, измерено на 75 218 установках Windows за неделю:
 * так лёгкий режим берёт 13,3% парка, а не 6,6% по подсказкам вебвью).
 * Физические ядра, не потоки: 2 ядра / 4 потока тянут стекло и анимации не лучше двух потоков.
 */
const LITE_CORES = 2
/** «6 ГБ» ядро видит как 6144 МиБ и меньше (часть памяти уходит встроенной видеокарте): «8 ГБ» показывает ≈7,8 ГБ и сюда не попадает. */
export const LITE_RAM_MB = 6144
const WIN10_RAM_MB = 8448

/** Железо по данным ядра (device_specs): видеокарты, память, ядра, потоки, система. Приходит по IPC, помнится между запусками. */
export interface HardwareHint {
  gpus: string[]
  ramMb: number
  /** Физические ядра; 0 — неизвестно (ядро не сказало, или сведения записаны старой версией). */
  cores: number
  threads: number
  os: string
  osVersion: string
}

export interface LiteInput extends DeviceProfile {
  // deviceMemory / hardwareConcurrency — подсказки вебвью, только пока ядро не ответило (первый запуск на ПК):
  // «6 ГБ» они округляют до 4 или 8, а 2 ядра / 4 потока считают четырьмя ядрами.
  /** Ручной выбор в настройках («Слабый ПК» / «Полное»); null — «Авто». */
  forced: DeviceTier | null
  /** Графика окна уже упала дважды (lib/gpuLite): сам WebGL выключен, стекло и видео тоже не нужны. */
  gpuLite: boolean
  /** Имя видеокарты окна из первого контекста WebGL (lib/deviceTier.webviewGpu); программная отрисовка рисует всё на процессоре. */
  gpu?: string
  /** Сведения ядра; пока их нет (первый запуск), решают только подсказки вебвью. */
  hw?: HardwareHint | null
}

/**
 * Видеокарта, на которой рисует окно лаунчера, слабая (встроенная Intel/AMD, старая дискретная).
 * Имя от самого вебвью (WebGL) — точнее всего. Иначе список карт ядра: слабая, если среди них
 * нет ни одной средней и мощной; гибридный ноутбук (встройка + дискретная) без вестей от вебвью
 * считаем способным — какая из двух рисует окно, ядро не говорит.
 */
export function weakWindowGpu(webviewGpu: string | undefined, cards: readonly string[] | undefined): boolean {
  const weak = (c: GpuClass) => c === 'igpu' || c === 'weak'
  if (webviewGpu) {
    const c = gpuClass(webviewGpu)
    if (c !== 'unknown') return weak(c)
  }
  const classes = (cards ?? []).map((n) => gpuClass(n))
  if (!classes.length) return false
  return classes.some(weak) && !classes.some((c) => c === 'mid' || c === 'high')
}

/**
 * Слабый ПК в узком смысле — тянуть на нём трёхмерную сцену (three.js, WebGL) не стоит:
 * ≤6 ГБ памяти, ≤2 физических ядра, программная отрисовка, упавший WebGL или выбор «Слабый ПК».
 * Встроенная видеокарта сюда не входит: 3D-персонаж остаётся (после простоя), а вот стекло
 * и украшательские анимации ей режет liteVerdict.
 */
export function weakVerdict(p: LiteInput): boolean {
  if (p.forced === 'low') return true
  if (p.forced === 'high') return false
  if (p.gpuLite || SOFTWARE_GPU.test(p.gpu || '') || (p.hw?.gpus ?? []).some((g) => SOFTWARE_GPU.test(g))) return true
  return weakHardware(p)
}

/**
 * Память и ядра слабые. Решает ядро, если оно ответило: точная память, физические ядра (нет
 * числа ядер — потоки). Подсказки вебвью берутся только без ответа ядра, по каждой величине отдельно.
 * На Windows пустой список видеокарт ядра — нет ни одной аппаратной (виртуалка, сбой драйвера): рисует процессор.
 */
export function weakHardware(p: Pick<LiteInput, 'deviceMemory' | 'hardwareConcurrency' | 'hw'>): boolean {
  const hw = p.hw
  const ram = hw?.ramMb || 0
  const weakMemory = ram > 0 ? ram <= LITE_RAM_MB : typeof p.deviceMemory === 'number' && p.deviceMemory <= LOW_MEMORY_GB
  const cores = hw?.cores || 0
  const threads = hw?.threads || 0
  const weakCores =
    cores > 0
      ? cores <= LITE_CORES
      : threads > 0
        ? threads <= LITE_CORES
        : typeof p.hardwareConcurrency === 'number' && p.hardwareConcurrency <= LITE_CORES
  const noHardwareGpu = !!hw && hw.os === 'windows' && ram > 0 && hw.gpus.length === 0
  return weakMemory || weakCores || noHardwareGpu
}

/**
 * Включать ли «лёгкий режим» интерфейса: без стекла (backdrop-filter), без бесконечных
 * украшательских анимаций, без видеофонов. Заранее по железу, а не после первых тормозов.
 * Главное — видеокарта окна (телеметрия: встроенная Intel — 27% парка, дорогое стекло и
 * анимации съедают её кадры), затем Windows 10 с ≤8 ГБ и всё из weakVerdict. Ручной выбор бьёт
 * авто: «Слабый ПК» включает режим всегда, «Полное» — выключает (сам WebGL при этом остаётся
 * выключенным в lib/gpuLite).
 */
export function liteVerdict(p: LiteInput): boolean {
  if (p.forced === 'low') return true
  if (p.forced === 'high') return false
  if (weakVerdict(p)) return true
  if (weakWindowGpu(p.gpu, p.hw?.gpus)) return true
  const ram = p.hw?.ramMb || 0
  return p.hw?.os === 'windows' && /^10\b/.test(p.hw.osVersion) && ram > 0 && ram <= WIN10_RAM_MB
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
  cached = tierWithGpu(
    deviceTier({
      deviceMemory: (nav as Navigator & { deviceMemory?: number }).deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
    }),
    webviewGpu(),
  )
  return cached
}
