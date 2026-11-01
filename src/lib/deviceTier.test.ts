import { afterEach, describe, expect, it } from 'bun:test'
import { currentDeviceTier, deviceTier, liteVerdict, weakVerdict, type HardwareHint, maxCanvasPixelRatio, perfOverride, sceneFpsCap, tierWithGpu } from './deviceTier'

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

// Вход → вердикт. Память и ядра не видят видеокарту окна: встроенная снимает
// «мощный» уровень, программная отрисовка — всегда слабый.
describe('tierWithGpu и sceneFpsCap', () => {
  const uhd = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'
  const vega = 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'
  const rtx = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)'
  const basic = 'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)'

  it('ноутбук с 16 ГБ и встроенной графикой больше не «мощный»', () => {
    expect(tierWithGpu('high', uhd)).toBe('mid')
    expect(tierWithGpu('high', vega)).toBe('mid')
    expect(tierWithGpu('mid', uhd)).toBe('mid')
    expect(tierWithGpu('low', uhd)).toBe('low')
  })

  it('дискретная карта и неизвестная карта уровень не меняют', () => {
    expect(tierWithGpu('high', rtx)).toBe('high')
    expect(tierWithGpu('high', '')).toBe('high')
    expect(tierWithGpu('mid', rtx)).toBe('mid')
  })

  it('программная отрисовка — слабый уровень, сколько бы ни было памяти', () => {
    expect(tierWithGpu('high', basic)).toBe('low')
    expect(tierWithGpu('high', 'Google SwiftShader')).toBe('low')
  })

  it('сцене хватает 60 кадров, слабой машине и встроенной графике — 30', () => {
    expect(sceneFpsCap('high', rtx, null)).toBe(60)
    expect(sceneFpsCap('high', '', null)).toBe(60)
    expect(sceneFpsCap('mid', uhd, null)).toBe(30)
    expect(sceneFpsCap('mid', rtx, null)).toBe(60)
    expect(sceneFpsCap('low', rtx, null)).toBe(30)
    expect(sceneFpsCap('low', uhd, 'high')).toBe(60)
  })
})

// Лёгкий режим интерфейса (стекло, украшательские анимации, видеофоны) решается заранее по железу.
describe('liteVerdict', () => {
  const base = { forced: null, gpuLite: false } as const
  const hw = (over: Partial<HardwareHint>): HardwareHint => ({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 16_000, cores: 4, threads: 8, os: 'windows', osVersion: '11 (26100)', ...over })
  const cases: { name: string; in: Parameters<typeof liteVerdict>[0]; want: boolean }[] = [
    // видеокарта окна — главный признак (27% парка — встроенная Intel)
    { name: 'только Intel UHD, 16 ГБ, 8 потоков, Windows 11 — лёгкий', in: { ...base, hw: hw({ gpus: ['Intel(R) UHD Graphics 620'] }) }, want: true },
    { name: 'Intel Iris Xe — лёгкий', in: { ...base, hw: hw({ gpus: ['Intel(R) Iris(R) Xe Graphics'] }) }, want: true },
    { name: 'встройка Ryzen «AMD Radeon(TM) Graphics» — лёгкий', in: { ...base, hw: hw({ gpus: ['AMD Radeon(TM) Graphics'] }) }, want: true },
    { name: 'Radeon Vega 8 — лёгкий', in: { ...base, hw: hw({ gpus: ['AMD Radeon(TM) Vega 8 Graphics'] }) }, want: true },
    { name: 'старая дискретная GT 730 — лёгкий', in: { ...base, hw: hw({ gpus: ['NVIDIA GeForce GT 730'] }) }, want: true },
    { name: 'RTX 3060, Windows 11 — полный', in: { ...base, hw: hw({ gpus: ['NVIDIA GeForce RTX 3060'] }) }, want: false },
    { name: 'гибрид Intel + RTX, вебвью молчит — полный (какая рисует окно, неизвестно)', in: { ...base, hw: hw({ gpus: ['Intel(R) UHD Graphics 630', 'NVIDIA GeForce RTX 3060'] }) }, want: false },
    { name: 'гибрид, но вебвью рисует на Intel — лёгкий', in: { ...base, gpu: 'Intel(R) UHD Graphics 630', hw: hw({ gpus: ['Intel(R) UHD Graphics 630', 'NVIDIA GeForce RTX 3060'] }) }, want: true },
    { name: 'вебвью рисует на RTX при встройке в списке — полный', in: { ...base, gpu: 'NVIDIA GeForce RTX 3060', hw: hw({ gpus: ['Intel(R) UHD Graphics 630', 'NVIDIA GeForce RTX 3060'] }) }, want: false },
    { name: 'неизвестное имя карты — полный, мощный ПК не режем', in: { ...base, hw: hw({ gpus: ['Some Future GPU 9000'] }) }, want: false },
    // Windows 10 + ≤8 ГБ
    { name: 'Windows 10 и 8 ГБ (≈7,8 по ядру) — лёгкий даже с RTX 3060', in: { ...base, hw: hw({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 7_800, osVersion: '10 (19045)' }) }, want: true },
    { name: 'Windows 10 и 16 ГБ — полный', in: { ...base, hw: hw({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 16_000, osVersion: '10 (19045)' }) }, want: false },
    { name: 'Windows 11 и 8 ГБ с RTX — полный', in: { ...base, hw: hw({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 7_800 }) }, want: false },
    // память и ядра
    { name: '4 ГБ по подсказке вебвью — лёгкий', in: { ...base, deviceMemory: 4, hardwareConcurrency: 8 }, want: true },
    { name: '4 ГБ по ядру (3,9 ГБ) — лёгкий', in: { ...base, hw: hw({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 3_900 }) }, want: true },
    { name: '8 ГБ и 8 ядер без сведений о видеокарте — полный', in: { ...base, deviceMemory: 8, hardwareConcurrency: 8 }, want: false },
    { name: '2 ядра — лёгкий, даже с 16 ГБ', in: { ...base, deviceMemory: 16, hardwareConcurrency: 2 }, want: true },
    { name: '4 ядра при 8 ГБ — ещё полный (тир low, но стекло тянет)', in: { ...base, deviceMemory: 8, hardwareConcurrency: 4 }, want: false },
    { name: 'подсказок нет — полный, мощный ПК не режем', in: { ...base }, want: false },
    // точные данные ядра главнее подсказок вебвью (WEAK-06)
    { name: '6 ГБ по ядру (5 900 МиБ), 4 ядра, RTX — лёгкий: вебвью округлил бы до 4 или 8', in: { ...base, deviceMemory: 8, hardwareConcurrency: 8, hw: hw({ ramMb: 5_900 }) }, want: true },
    { name: 'ровно 6 ГБ (6 144 МиБ) — лёгкий', in: { ...base, hw: hw({ ramMb: 6_144 }) }, want: true },
    { name: '8 ГБ (7 800 МиБ) на Windows 11 — полный', in: { ...base, hw: hw({ ramMb: 7_800 }) }, want: false },
    { name: '2 ядра / 4 потока при 16 ГБ — лёгкий: вебвью насчитал бы 4 «ядра»', in: { ...base, hardwareConcurrency: 4, hw: hw({ cores: 2, threads: 4 }) }, want: true },
    { name: '4 ядра / 8 потоков — полный', in: { ...base, hardwareConcurrency: 8, hw: hw({ cores: 4, threads: 8 }) }, want: false },
    { name: 'ядро ответило: 16 ГБ и 8 ядер — подсказки вебвью («4 ГБ», 2 потока) не слушаем', in: { ...base, deviceMemory: 4, hardwareConcurrency: 2, hw: hw({ ramMb: 16_000, cores: 8, threads: 16 }) }, want: false },
    { name: 'число ядер неизвестно (старая запись), потоков 2 — лёгкий', in: { ...base, hw: hw({ cores: 0, threads: 2 }) }, want: true },
    { name: 'число ядер неизвестно, потоков 8 — полный', in: { ...base, hw: hw({ cores: 0, threads: 8 }) }, want: false },
    { name: 'память ядро не назвало (0) — решает подсказка вебвью', in: { ...base, deviceMemory: 4, hw: hw({ ramMb: 0 }) }, want: true },
    { name: 'Windows без единой аппаратной видеокарты — лёгкий: рисует процессор', in: { ...base, hw: hw({ gpus: [] }) }, want: true },
    { name: 'не Windows и список видеокарт пуст (ядро их там не перечисляет) — полный', in: { ...base, hw: hw({ gpus: [], os: 'macos', osVersion: '15.1' }) }, want: false },
    { name: 'программная карта в списке ядра — лёгкий', in: { ...base, hw: hw({ gpus: ['Microsoft Basic Render Driver'] }) }, want: true },
    // сбои и ручной выбор
    { name: 'упавший WebGL — лёгкий', in: { ...base, deviceMemory: 16, hardwareConcurrency: 16, gpuLite: true }, want: true },
    { name: 'программная видеокарта — лёгкий', in: { ...base, deviceMemory: 16, hardwareConcurrency: 16, gpu: 'Microsoft Basic Render Driver' }, want: true },
    { name: '«Слабый ПК» в настройках — лёгкий всегда', in: { ...base, forced: 'low', deviceMemory: 32, hardwareConcurrency: 16, hw: hw({ gpus: ['NVIDIA GeForce RTX 4090'] }) }, want: true },
    { name: '«Полное» в настройках — полный даже на Intel UHD и 2 ГБ', in: { ...base, forced: 'high', deviceMemory: 2, hardwareConcurrency: 2, gpuLite: true, hw: hw({ gpus: ['Intel(R) UHD Graphics 620'] }) }, want: false },
  ]
  for (const c of cases) it(c.name, () => expect(liteVerdict(c.in)).toBe(c.want))
})

// Трёхмерный персонаж отключается только на слабом ПК в узком смысле; встроенная видеокарта — лишь лёгкий режим.
describe('weakVerdict', () => {
  const base = { forced: null, gpuLite: false } as const
  const hw = (over: Partial<HardwareHint>): HardwareHint => ({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 16_000, cores: 4, threads: 8, os: 'windows', osVersion: '11 (26100)', ...over })
  it('Intel UHD при 16 ГБ — не слабый: персонаж остаётся, лёгкий режим — да', () => {
    const i = { ...base, hw: hw({ gpus: ['Intel(R) UHD Graphics 620'] }) }
    expect(weakVerdict(i)).toBe(false)
    expect(liteVerdict(i)).toBe(true)
  })
  it('Windows 10 и 8 ГБ — лёгкий режим, но персонаж остаётся', () => {
    const i = { ...base, hw: hw({ gpus: ['NVIDIA GeForce RTX 3060'], ramMb: 7_800, osVersion: '10 (19045)' }) }
    expect(weakVerdict(i)).toBe(false)
    expect(liteVerdict(i)).toBe(true)
  })
  it('ядро ответило: 6 ГБ или 2 ядра — слабый, 8 ГБ и 4 ядра — нет', () => {
    expect(weakVerdict({ ...base, hw: hw({ ramMb: 5_900 }) })).toBe(true)
    expect(weakVerdict({ ...base, hw: hw({ cores: 2, threads: 4 }) })).toBe(true)
    expect(weakVerdict({ ...base, hw: hw({ ramMb: 7_800, cores: 4 }) })).toBe(false)
  })
  it('4 ГБ, 2 ядра, программная графика, упавший WebGL — слабый', () => {
    expect(weakVerdict({ ...base, deviceMemory: 4 })).toBe(true)
    expect(weakVerdict({ ...base, hardwareConcurrency: 2 })).toBe(true)
    expect(weakVerdict({ ...base, gpu: 'Microsoft Basic Render Driver' })).toBe(true)
    expect(weakVerdict({ ...base, gpuLite: true })).toBe(true)
  })
  it('ручной выбор главнее', () => {
    expect(weakVerdict({ ...base, forced: 'low' })).toBe(true)
    expect(weakVerdict({ forced: 'high', gpuLite: true, deviceMemory: 2 })).toBe(false)
  })
})
