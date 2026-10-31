import { describe, expect, mock, test } from 'bun:test'
import type { Hardware } from './perfTier'

const prefs = new Map<string, string>()
mock.module('./prefs', () => ({
  readPref: (k: string, fallback: string) => (prefs.has(k) ? prefs.get(k)! : fallback),
  writePref: (k: string, v: string) => void prefs.set(k, v),
}))

const { GFX_PRESETS, epicAllowed, forBattery, globalChoice, presetChunks, presetVideo, recommendPreset, resolveChoice, setGlobalChoice, stepDown } = await import('./gfxPresets')

/** Ключи и значения, которые пропускает ядро (engine/game/fpsboost.rs, VIDEO_KEYS и video_value_ok). */
const CORE_KEYS = new Set([
  'graphicsMode', 'fancyGraphics', 'graphicsPreset', 'renderDistance', 'simulationDistance',
  'entityDistanceScaling', 'entityShadows', 'particles', 'ao', 'mipmapLevels', 'biomeBlendRadius',
  'renderClouds', 'cloudRange', 'enableVsync', 'maxFps', 'bobView', 'screenEffectScale', 'guiScale',
  'textureFiltering', 'maxAnisotropyBit', 'cutoutLeaves', 'weatherRadius', 'improvedTransparency',
  'prioritizeChunkUpdates',
])
const coreValueOk = (v: string) =>
  (/^-?[\d.]+$/.test(v) && v.length <= 8) || v === 'true' || v === 'false' || /^"[a-z_]{1,16}"$/.test(v)

const FHD = { screenW: 1920, screenH: 1080 }

describe('options.txt пресетов проходит фильтр ядра целиком', () => {
  for (const id of GFX_PRESETS)
    test(id, () => {
      const rows = presetVideo(id, FHD)
      // Один чужой ключ — и ядро молча ставит общий набор вместо пресета.
      for (const [k, v] of rows) {
        expect(CORE_KEYS.has(k), `${id}: ключ ${k} ядро отбросит`).toBe(true)
        expect(coreValueOk(v), `${id}: значение ${k}=${v} ядро отбросит`).toBe(true)
      }
      expect(rows.length).toBeLessThanOrEqual(40)
    })
})

test('дальность растёт от «Картошки» к «Эпическим», «Стандарт» — как в чистой игре', () => {
  const chunks = GFX_PRESETS.map((id) => presetChunks(id, FHD))
  expect(chunks).toEqual([...chunks].sort((a, b) => a - b))
  const standard = Object.fromEntries(presetVideo('standard', FHD))
  expect(standard.renderDistance, 'дальность ванильной игры').toBe('12')
  expect(standard.graphicsMode, 'красивая графика, как в ванилле').toBe('1')
  expect(standard.enableVsync, 'кадры не упираются в частоту монитора').toBe('false')
  expect(standard.guiScale, 'масштаб интерфейса — авто, как в ванилле').toBe('0')
})

test('на 4K слабые уровни рисуют ближе: пикселей вчетверо больше', () => {
  const uhd = { screenW: 3840, screenH: 2160 }
  expect(presetChunks('potato', uhd)).toBeLessThan(presetChunks('potato', FHD))
  expect(presetChunks('low', uhd)).toBeLessThan(presetChunks('low', FHD))
  expect(presetChunks('standard', uhd), '«Стандарт» не трогаем').toBe(12)
})

describe('Рекомендация по железу (пороги — прод-телеметрия парка)', () => {
  const cases: Array<{ hw: Parameters<typeof recommendPreset>[0]; want: string; why: string }> = [
    { hw: { ramMb: 3900, cores: 4, gpu: 'Intel(R) UHD Graphics 600' }, want: 'potato', why: '4 ГБ — больше всех вылетов по памяти' },
    { hw: { ramMb: 7900, cores: 8, gpu: 'Intel(R) UHD Graphics 620' }, want: 'potato', why: '8 ГБ и встройка' },
    { hw: { ramMb: 7900, cores: 8, gpu: 'NVIDIA GeForce GTX 1650' }, want: 'low', why: '8 ГБ с дискретной картой' },
    { hw: { ramMb: 16000, cores: 4, gpu: 'NVIDIA GeForce GTX 1650' }, want: 'low', why: 'четыре потока — Minecraft упрётся в процессор' },
    { hw: { ramMb: 16000, cores: 12, gpu: 'AMD Radeon(TM) Graphics' }, want: 'low', why: 'встройка AMD — втрое больше вылетов драйвера' },
    { hw: { ramMb: 16000, cores: 12, gpu: 'NVIDIA GeForce GTX 1660 SUPER' }, want: 'standard', why: 'средняя карта' },
    { hw: { ramMb: 16000, cores: 12, gpu: 'NVIDIA GeForce RTX 3060' }, want: 'high', why: 'сильная, но не топовая' },
    { hw: { ramMb: 32000, cores: 16, gpu: 'NVIDIA GeForce RTX 4070', ...FHD }, want: 'epic', why: 'топовая карта и 32 ГБ' },
    { hw: { ramMb: 32000, cores: 16, gpu: 'NVIDIA GeForce RTX 4070', screenW: 3840, screenH: 2160 }, want: 'high', why: 'шейдеры на 4K — уже не для FPS' },
    { hw: { ramMb: 8100, cores: 8, gpu: 'NVIDIA GeForce RTX 4090' }, want: 'low', why: 'память решает раньше видеокарты' },
    { hw: {}, want: 'low', why: 'без сведений — осторожный уровень, не «Картошка»' },
  ]
  for (const c of cases) test(c.why, () => expect(recommendPreset(c.hw)).toBe(c.want as never))
})

test('«Эпические» закрыты для встройки', () => {
  expect(epicAllowed({ gpu: 'Intel(R) UHD Graphics 620' })).toBe(false)
  expect(epicAllowed({ gpu: 'NVIDIA GeForce GT 730' })).toBe(false)
  expect(epicAllowed({ gpu: 'NVIDIA GeForce RTX 3060' })).toBe(true)
  expect(epicAllowed({}), 'карту не знаем — решает ядро').toBe(true)
})

test('общий выбор переживает перезапуск, «Авто» и «не трогать»', () => {
  expect(globalChoice(), 'ещё не выбирали').toBe(null)
  setGlobalChoice('low')
  expect(globalChoice()).toBe('low')
  setGlobalChoice('auto')
  expect(globalChoice()).toBe('auto')
  prefs.set('m-gfx-preset', 'ultra')
  expect(globalChoice(), 'чужое значение в файле — не выбор').toBe(null)
  setGlobalChoice('none')
  expect(globalChoice()).toBe('none')
})

describe('Что встанет перед запуском', () => {
  const rtx4070 = { gpu: 'NVIDIA GeForce RTX 4070', ramMb: 32000, cores: 16, ...FHD }
  const igpu = { gpu: 'Intel(R) UHD Graphics 620', ramMb: 7900, cores: 4, ...FHD }
  const cases: Array<{ choice: Parameters<typeof resolveChoice>[0]; hw: Hardware; shadersOk?: boolean; want: string | null; why: string }> = [
    { choice: 'auto', hw: igpu, want: 'potato', why: '«Авто» — уровень под ПК' },
    { choice: 'auto', hw: rtx4070, want: 'epic', why: '«Авто» на топовой карте — шейдеры' },
    { choice: 'auto', hw: rtx4070, shadersOk: false, want: 'high', why: 'ядро не видит дискретной карты — без шейдеров' },
    { choice: 'epic', hw: igpu, want: 'high', why: '«Эпические» на встройке не ставим' },
    { choice: 'low', hw: rtx4070, want: 'low', why: 'свой уровень — как выбран' },
    { choice: 'none', hw: rtx4070, want: null, why: '«не трогать»' },
    { choice: null, hw: rtx4070, want: null, why: 'не выбирали' },
  ]
  for (const c of cases) test(c.why, () => expect(resolveChoice(c.choice, c.hw, c.shadersOk ?? true)).toBe(c.want as never))
})

test('на батарее — ступень ниже и 60 кадров', () => {
  expect(stepDown('epic')).toBe('high')
  expect(stepDown('potato'), 'ниже «Картошки» некуда').toBe('potato')
  const { level, video } = forBattery('standard', FHD)
  expect(level).toBe('low')
  expect(Object.fromEntries(video).maxFps).toBe('60')
  expect(Object.fromEntries(video).renderDistance, 'дальность ступени ниже').toBe('6')
})

test('слабым ступеням — без анизотропной фильтрации', () => {
  for (const id of ['potato', 'low'] as const) expect(Object.fromEntries(presetVideo(id, FHD)).textureFiltering, id).toBe('0')
})
