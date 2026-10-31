/*
 * Пресеты графики «как в играх»: пять уровней от «Картошки» до «Эпических».
 * Здесь — что каждый пишет в options.txt и какой уровень подходит ПК. Моды,
 * текстуры, шейдеры и копию настроек для «Вернуть как было» делает ядро
 * (engine/game/presets.rs); ключи оно пропускает только графические.
 *
 * Пороги — по прод-телеметрии Windows за 7 дней до 26.10.2026 (75 тыс. установок,
 * analysis/2026-10-26_full-audit/work/LAUNCHER-presets.md): ≤8 ГБ ОЗУ — 23,7% парка,
 * ≤4 потока — 21,7%. Вылеты OOM на 1000 запусков: ≤4 ГБ — 17, 4–8 ГБ — 13, >16 ГБ — 5.
 * Вылеты драйвера: RTX — 7, Intel — 14, встройка AMD — 21. Отсюда: встройка и
 * ≤8 ГБ — без шейдеров и с короткой дальностью, шейдеры — только сильной дискретной.
 */
import { gpuClass, screenClass, thisHardware, type Hardware, type ScreenClass } from './perfTier'
import { readPref, writePref } from './prefs'

export const GFX_PRESETS = ['potato', 'low', 'standard', 'high', 'epic'] as const
export type GfxPresetId = (typeof GFX_PRESETS)[number]

export const isGfxPreset = (v: unknown): v is GfxPresetId => typeof v === 'string' && (GFX_PRESETS as readonly string[]).includes(v)

type Row = [string, string]
const q = (v: string) => `"${v}"`

/** options.txt каждого уровня. «Стандарт» выглядит как чистый Minecraft; кадры не ограничены (без V-Sync) — у всех уровней цель FPS. */
const VIDEO: Record<GfxPresetId, Record<string, string>> = {
  potato: {
    graphicsMode: '0', fancyGraphics: 'false', graphicsPreset: q('fast'),
    renderDistance: '4', simulationDistance: '5', entityDistanceScaling: '0.5', entityShadows: 'false',
    particles: '2', ao: 'false', mipmapLevels: '0', biomeBlendRadius: '0', renderClouds: q('false'),
    cutoutLeaves: 'false', weatherRadius: '3', improvedTransparency: 'false', textureFiltering: '0',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0', bobView: 'false',
  },
  low: {
    graphicsMode: '0', fancyGraphics: 'false', graphicsPreset: q('fast'),
    renderDistance: '6', simulationDistance: '5', entityDistanceScaling: '0.5', entityShadows: 'false',
    particles: '2', ao: 'false', mipmapLevels: '0', biomeBlendRadius: '0', renderClouds: q('false'),
    cutoutLeaves: 'false', weatherRadius: '3', improvedTransparency: 'false', textureFiltering: '0',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0',
  },
  standard: {
    graphicsMode: '1', fancyGraphics: 'true', graphicsPreset: q('fancy'),
    renderDistance: '12', simulationDistance: '12', entityDistanceScaling: '1.0', entityShadows: 'true',
    particles: '0', ao: 'true', mipmapLevels: '4', biomeBlendRadius: '2', renderClouds: q('true'),
    cutoutLeaves: 'true', weatherRadius: '10', improvedTransparency: 'false',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0',
  },
  high: {
    graphicsMode: '1', fancyGraphics: 'true', graphicsPreset: q('fancy'),
    renderDistance: '16', simulationDistance: '12', entityDistanceScaling: '1.0', entityShadows: 'true',
    particles: '0', ao: 'true', mipmapLevels: '4', biomeBlendRadius: '5', renderClouds: q('true'), cloudRange: '64',
    cutoutLeaves: 'true', weatherRadius: '10', improvedTransparency: 'false',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0',
  },
  epic: {
    graphicsMode: '1', fancyGraphics: 'true', graphicsPreset: q('fancy'),
    renderDistance: '16', simulationDistance: '12', entityDistanceScaling: '1.0', entityShadows: 'true',
    particles: '0', ao: 'true', mipmapLevels: '4', biomeBlendRadius: '7', renderClouds: q('true'), cloudRange: '64',
    cutoutLeaves: 'true', weatherRadius: '10', improvedTransparency: 'false',
    enableVsync: 'false', maxFps: '260', prioritizeChunkUpdates: '0',
  },
}

const GUI_SCALE: Record<ScreenClass, string> = { '768': '2', '1080': '3', '1440': '3', '2160': '4' }

/** Дальность на больших экранах: пикселей вчетверо больше — слабым уровням дальность ниже. */
const DISTANCE_ON_SCREEN: Partial<Record<GfxPresetId, Partial<Record<ScreenClass, string>>>> = {
  potato: { '1440': '3', '2160': '2' },
  low: { '1440': '5', '2160': '4' },
  high: { '2160': '12' },
  epic: { '2160': '12' },
}

/** Набор options.txt уровня для этого экрана. «Стандарт» не трогает масштаб интерфейса — как в чистой игре. */
export function presetVideo(id: GfxPresetId, hw: Hardware = {}): Row[] {
  const screen = screenClass(hw.screenW, hw.screenH)
  const v: Record<string, string> = { ...VIDEO[id], guiScale: id === 'standard' ? '0' : GUI_SCALE[screen] }
  const distance = DISTANCE_ON_SCREEN[id]?.[screen]
  if (distance) v.renderDistance = distance
  return Object.entries(v)
}

/** Ступень ниже: на батарее ноутбук греется и садится, кадры важнее красоты. */
export function stepDown(id: GfxPresetId): GfxPresetId {
  const i = GFX_PRESETS.indexOf(id)
  return GFX_PRESETS[Math.max(0, i - 1)]
}

/** Ноутбук на батарее: ступень ниже и 60 кадров (ресёрч 27.10, E9). */
export function forBattery(id: GfxPresetId, hw: Hardware = {}): { level: GfxPresetId; video: Row[] } {
  const level = stepDown(id)
  const video = presetVideo(level, hw).map(([k, v]): Row => (k === 'maxFps' ? [k, '60'] : [k, v]))
  return { level, video }
}

/**
 * Работает ли ноутбук от батареи. Battery Status API есть в WebView2 (Windows);
 * на macOS WebKit его нет — тогда считаем, что от сети.
 */
export async function onBattery(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> }
    if (typeof nav.getBattery !== 'function') return false
    const b = await nav.getBattery()
    return !b.charging && b.level < 1
  } catch {
    return false
  }
}

/** Дальность прорисовки уровня — главное число карточки. */
export const presetChunks = (id: GfxPresetId, hw: Hardware = {}): number =>
  Number(presetVideo(id, hw).find(([k]) => k === 'renderDistance')?.[1] ?? 0)

/** Картинка уровня: одна сцена на пяти пресетах (public/presets). */
export const presetArt = (id: GfxPresetId): string => `/presets/${id}.webp`

export type PresetTag = 'noShadows' | 'simpleTextures' | 'noClouds' | 'shadows' | 'clouds' | 'smoothLight' | 'shaders'

/** Две метки «что включено» к дальности прорисовки. */
export const PRESET_TAGS: Record<GfxPresetId, [PresetTag, PresetTag]> = {
  potato: ['noShadows', 'simpleTextures'],
  low: ['noShadows', 'noClouds'],
  standard: ['shadows', 'clouds'],
  high: ['shadows', 'smoothLight'],
  epic: ['shaders', 'smoothLight'],
}

const TOP = /rtx\s*(30[7-9]0|40[7-9]0|50[7-9]0)|rx\s*(6[89]\d0|7[89]\d0|90[7-9]0)|apple m\d (max|ultra)/i

/** Уровень для этого ПК. Слабое звено решает: память и потоки раньше видеокарты. */
export function recommendPreset(hw: Hardware): GfxPresetId {
  const ram = hw.ramMb || 0
  const cores = hw.cores || 0
  const gpu = gpuClass(hw.gpu)
  const integrated = gpu === 'igpu' || gpu === 'weak'
  if ((ram && ram < 4600) || (cores && cores <= 2)) return 'potato'
  if ((ram && ram < 8600) || (cores && cores <= 4)) return integrated ? 'potato' : 'low'
  if (integrated) return 'low'
  if (gpu === 'high') {
    const screen = screenClass(hw.screenW, hw.screenH)
    if (TOP.test(hw.gpu || '') && ram >= 15000 && cores >= 8 && screen !== '2160') return 'epic'
    return ram >= 15000 ? 'high' : 'standard'
  }
  if (gpu === 'mid') return 'standard'
  return ram >= 15000 && cores >= 8 ? 'standard' : 'low'
}

/** Шейдеры не для встройки: на ней вылетов драйвера вдвое-втрое больше, а кадров нет. */
export function epicAllowed(hw: Hardware): boolean {
  const gpu = gpuClass(hw.gpu)
  return gpu === 'high' || gpu === 'mid' || gpu === 'unknown'
}

/**
 * Выбор игрока: уровень, «auto» (уровень под этот ПК) или «none» (графику не
 * трогать). На странице сборки ещё null — «как в общих настройках».
 */
export type GfxChoice = GfxPresetId | 'auto' | 'none'

export const isGfxChoice = (v: unknown): v is GfxChoice => v === 'auto' || v === 'none' || isGfxPreset(v)

const GLOBAL_KEY = 'm-gfx-preset'

/** Общий выбор (онбординг, «Настройки → Графика»), хранится в файле ядра; null — ещё не выбирали. */
export function globalChoice(): GfxChoice | null {
  const v = readPref(GLOBAL_KEY, '')
  return isGfxChoice(v) ? v : null
}

export function setGlobalChoice(choice: GfxChoice) {
  writePref(GLOBAL_KEY, choice)
}

/**
 * Уровень, который встанет перед запуском: «auto» — рекомендованный для ПК,
 * «Эпические» без дискретной карты — «Высокие»; «none» — ничего.
 */
export function resolveChoice(choice: GfxChoice | null, hw: Hardware, shadersOk = true): GfxPresetId | null {
  if (!choice || choice === 'none') return null
  const level = choice === 'auto' ? recommendPreset(hw) : choice
  return level === 'epic' && !(shadersOk && epicAllowed(hw)) ? 'high' : level
}

let hwAsk: Promise<Hardware> | null = null
/** Железо спрашивается один раз за запуск: оно не меняется, а карточки рисуются в трёх местах. */
export const cachedHardware = (): Promise<Hardware> => (hwAsk ??= thisHardware().catch(() => ({})))
