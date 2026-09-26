import { afterEach, describe, expect, it } from 'bun:test'
import { currentDeviceTier, deviceTier, maxCanvasPixelRatio, perfOverride } from './deviceTier'

// Вход → вердикт. Тир решает, резать ли плотность рендера: ошибка в одну
// сторону мылит картинку на мощной машине, в другую — не спасает слабую.
describe('deviceTier', () => {
  const cases: { name: string; mem?: number; cores?: number; want: 'low' | 'mid' | 'high' }[] = [
    { name: '4 ГБ ОЗУ = слабая, даже с 8 ядрами', mem: 4, cores: 8, want: 'low' },
    { name: '4 ядра = слабая, даже с 16 ГБ', mem: 16, cores: 4, want: 'low' },
    { name: '2 ГБ и 2 ядра — слабая', mem: 2, cores: 2, want: 'low' },
    { name: '6 ГБ и 6 ядер — средняя', mem: 6, cores: 6, want: 'mid' },
    { name: '16 ГБ, но 6 ядер — средняя', mem: 16, cores: 6, want: 'mid' },
    { name: '8 ГБ и 8 ядер — мощная', mem: 8, cores: 8, want: 'high' },
    { name: '32 ГБ и 12 ядер — мощная', mem: 32, cores: 12, want: 'high' },
    { name: 'подсказок нет — считаем мощной, не мылим', want: 'high' },
    { name: 'только память известна и большая — мощная', mem: 16, want: 'high' },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(deviceTier({ deviceMemory: c.mem, hardwareConcurrency: c.cores })).toBe(c.want)
    })
  }
})

// Мощная машина не получает потолка: старое поведение сохраняется байт-в-байт.
describe('maxCanvasPixelRatio', () => {
  it('слабой — только нативная плотность, без суперсэмплинга', () => {
    expect(maxCanvasPixelRatio('low')).toBe(1)
  })
  it('средней — потолок 1.5', () => {
    expect(maxCanvasPixelRatio('mid')).toBe(1.5)
  })
  it('мощной — без потолка', () => {
    expect(maxCanvasPixelRatio('high')).toBe(Infinity)
  })
})

// Ручной выбор в настройках бьёт авто-детект: авто видит только ОЗУ и ядра, но
// не GPU, поэтому машина с сильным CPU и слабой встройкой должна уметь
// принудительно уйти в «Слабый ПК» (жалоба владельца 25.09.2026).
describe('perfOverride / currentDeviceTier', () => {
  const store: Record<string, string> = {}
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  }
  afterEach(() => {
    for (const k of Object.keys(store)) delete store[k]
  })

  const cases: { name: string; why: string; stored?: string; overrideNull: boolean; tier: 'low' | 'high' | null }[] = [
    { name: 'нет выбора', why: 'по умолчанию решает авто-детект', overrideNull: true, tier: null },
    { name: 'слабый пк', why: 'сильный CPU + слабая встройка форсит низкий тир', stored: 'low', overrideNull: false, tier: 'low' },
    { name: 'полное', why: 'ручной high отключает авто-занижение', stored: 'high', overrideNull: false, tier: 'high' },
    { name: 'мусор', why: 'битый pref не должен ломать рендер', stored: 'zzz', overrideNull: true, tier: null },
  ]
  for (const c of cases) {
    it(c.name, () => {
      if (c.stored !== undefined) store['m-perf-mode'] = c.stored
      expect(perfOverride() === null, c.name + ': ' + c.why).toBe(c.overrideNull)
      if (c.tier) expect(currentDeviceTier(), c.name).toBe(c.tier)
    })
  }
})
