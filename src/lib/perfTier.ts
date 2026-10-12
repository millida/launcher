/*
 * Настройки графики под железо игрока (ресёрч 11.10.2026,
 * analysis/2026-10-11_оптимизация-minecraft-ресерч.md, §3). Режим FPS раньше
 * ставил всем одну и ту же «слабую» графику: мощный ПК получал дальность 8 и
 * быструю графику, слабый ноутбук на 1440p — всё ещё слишком много пикселей.
 * Здесь — уровень ПК по видеокарте, памяти и ядрам и поправка на экран. Ядро
 * (engine/game/fpsboost.rs) пишет набор в options.txt только из графических ключей.
 */

export type GpuClass = 'igpu' | 'weak' | 'mid' | 'high' | 'unknown'
export type PerfTier = 'low' | 'mid' | 'high'
export type ScreenClass = '768' | '1080' | '1440' | '2160'

export interface Hardware {
  gpu?: string
  ramMb?: number
  cores?: number
  /** Физические пиксели экрана (CSS × devicePixelRatio). */
  screenW?: number
  screenH?: number
}

const IGPU = /intel.*(uhd|hd graphics|iris)|radeon\(tm\) (graphics|vega)|radeon (vega|graphics)\b|vega \d+ graphics|radeon\(tm\) \d{3}m|radeon \d{3}m|microsoft basic render|swiftshader|llvmpipe|mali|adreno|powervr/i
const HIGH = /rtx\s*(30[6-9]0|40[6-9]0|50\d0)|rx\s*(6[6-9]\d0|7\d{3}|9\d{3})|apple m\d (pro|max|ultra)|arc a7\d0|arc b\d{3}/i
const MID = /gtx\s*(10[5-8]0|16\d0)|rtx\s*(20\d0|30[0-5]0|40[0-5]0)|rx\s*(5[6-9]0|5[5-7]00|6[45]00|6600)|arc a[35]\d0|apple m\d\b/i
const WEAK = /\bgt\s*\d{3,4}\b|gtx\s*(6|7|9)\d\d|\bmx\s*\d{3}|radeon (r[579]|hd)|rx\s*(4\d0|5[0-5]0)\b/i

export function gpuClass(gpu: string | undefined): GpuClass {
  const g = (gpu || '').trim()
  if (!g) return 'unknown'
  if (HIGH.test(g)) return 'high'
  if (MID.test(g)) return 'mid'
  if (WEAK.test(g)) return 'weak'
  if (IGPU.test(g)) return 'igpu'
  return 'unknown'
}

export function perfTier(hw: Hardware): PerfTier {
  const ram = hw.ramMb || 0
  const cores = hw.cores || 0
  const gpu = gpuClass(hw.gpu)
  // Мало памяти или ядер — слабый, что бы ни стояло внутри: игра упрётся в них.
  if ((ram && ram < 8000) || (cores && cores <= 4)) return 'low'
  if (gpu === 'igpu' || gpu === 'weak') return 'low'
  if (gpu === 'high') return ram >= 15000 ? 'high' : 'mid'
  if (gpu === 'mid') return 'mid'
  return ram >= 15000 && cores >= 8 ? 'mid' : 'low'
}

export function screenClass(w = 0, h = 0): ScreenClass {
  const px = w * h
  if (px >= 7_000_000) return '2160'
  if (px >= 3_000_000) return '1440'
  if (px >= 1_700_000) return '1080'
  return '768'
}

type Row = [string, string]
const q = (v: string) => `"${v}"`

const BASE: Record<PerfTier, Record<string, string>> = {
  low: {
    graphicsMode: '0', fancyGraphics: 'false', graphicsPreset: q('fast'),
    renderDistance: '6', simulationDistance: '5', entityDistanceScaling: '0.5', entityShadows: 'false',
    particles: '2', ao: 'false', mipmapLevels: '0', biomeBlendRadius: '0', renderClouds: q('false'),
    cutoutLeaves: 'false', weatherRadius: '3', improvedTransparency: 'false',
    enableVsync: 'false', maxFps: '120', prioritizeChunkUpdates: '0',
  },
  mid: {
    graphicsMode: '1', fancyGraphics: 'true', graphicsPreset: q('fancy'),
    renderDistance: '12', simulationDistance: '8', entityDistanceScaling: '0.75', entityShadows: 'false',
    particles: '1', ao: 'true', mipmapLevels: '2', biomeBlendRadius: '3', renderClouds: q('fast'), cloudRange: '32',
    cutoutLeaves: 'true', weatherRadius: '5', improvedTransparency: 'false',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0',
  },
  high: {
    graphicsMode: '1', fancyGraphics: 'true', graphicsPreset: q('fancy'),
    renderDistance: '16', simulationDistance: '12', entityDistanceScaling: '1.0', entityShadows: 'true',
    particles: '0', ao: 'true', mipmapLevels: '4', biomeBlendRadius: '5', renderClouds: q('true'), cloudRange: '64',
    cutoutLeaves: 'true', weatherRadius: '10', improvedTransparency: 'false',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0',
  },
}

const GUI_SCALE: Record<ScreenClass, string> = { '768': '2', '1080': '3', '1440': '3', '2160': '4' }

/** Набор options.txt для этого ПК. Пиксели на встройке — главный враг FPS: на 1440p и 4K дальность ниже. */
export function videoTuning(hw: Hardware): Row[] {
  const tier = perfTier(hw)
  const screen = screenClass(hw.screenW, hw.screenH)
  const v: Record<string, string> = { ...BASE[tier], guiScale: GUI_SCALE[screen] }
  if (tier === 'low' && screen === '1440') v.renderDistance = '5'
  if (tier === 'low' && screen === '2160') v.renderDistance = '4'
  if (tier === 'mid' && screen === '1440') v.renderDistance = '10'
  if (tier === 'mid' && screen === '2160') {
    v.renderDistance = '8'
    v.mipmapLevels = '2'
  }
  return Object.entries(v)
}

/** Железо этого компьютера: память и ядра — у ядра, видеокарта — у вебвью, экран — у окна. */
export async function thisHardware(): Promise<Hardware> {
  let pc: { ramMb?: number; cores?: number; gpu?: string } | null = null
  try {
    pc = await (await import('./milli')).milliPc()
  } catch {}
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const scr = typeof window !== 'undefined' ? window.screen : null
  return {
    ...(pc?.gpu ? { gpu: pc.gpu } : {}),
    ...(pc?.ramMb ? { ramMb: pc.ramMb } : {}),
    ...(pc?.cores ? { cores: pc.cores } : {}),
    ...(scr ? { screenW: Math.round(scr.width * dpr), screenH: Math.round(scr.height * dpr) } : {}),
  }
}

/** Набор для режима FPS; без сведений о железе — undefined, и ядро ставит общий. */
export async function hardwareVideo(): Promise<Row[] | undefined> {
  const hw = await thisHardware()
  return hw.gpu || hw.ramMb ? videoTuning(hw) : undefined
}
