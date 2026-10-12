import { describe, expect, test } from 'bun:test'
import { gpuClass, perfTier, screenClass, videoTuning } from './perfTier'

describe('Уровень ПК по видеокарте', () => {
  const cases: Array<[string, string]> = [
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'igpu'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'igpu'],
    ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0)', 'igpu'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GT 730 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'weak'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX350 Direct3D11)', 'weak'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'mid'],
    ['ANGLE (AMD, Radeon RX 580 Series Direct3D11)', 'mid'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11)', 'mid'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'high'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Ti Direct3D11)', 'high'],
    ['ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11)', 'high'],
    ['Apple M2', 'mid'],
    ['Apple M3 Pro', 'high'],
    ['', 'unknown'],
  ]
  for (const [gpu, want] of cases) {
    test(gpu || 'пусто', () => expect(gpuClass(gpu)).toBe(want as never))
  }
})

describe('Уровень ПК целиком', () => {
  test('мощная карта при 8 ГБ — средний: упрётся в память', () => {
    expect(perfTier({ gpu: 'RTX 4070', ramMb: 8192, cores: 12 })).toBe('mid')
  })
  test('мало памяти — слабый при любой карте', () => {
    expect(perfTier({ gpu: 'RTX 3060', ramMb: 6144, cores: 8 })).toBe('low')
  })
  test('встройка — слабый', () => expect(perfTier({ gpu: 'Intel(R) UHD Graphics 620', ramMb: 16384, cores: 8 })).toBe('low'))
  test('мощная карта и 32 ГБ — мощный', () => expect(perfTier({ gpu: 'RTX 3070', ramMb: 32768, cores: 16 })).toBe('high'))
  test('неизвестная карта, но много памяти и ядер — средний', () => expect(perfTier({ gpu: 'Something', ramMb: 16384, cores: 12 })).toBe('mid'))
})

describe('Настройки графики', () => {
  const row = (rows: [string, string][], k: string) => rows.find(([key]) => key === k)?.[1]
  test('слабый ноутбук на 1080p: дальность 6, быстрая графика, интерфейс 3', () => {
    const v = videoTuning({ gpu: 'Intel(R) UHD Graphics 620', ramMb: 8192, cores: 4, screenW: 1920, screenH: 1080 })
    expect(row(v, 'renderDistance')).toBe('6')
    expect(row(v, 'graphicsMode')).toBe('0')
    expect(row(v, 'guiScale')).toBe('3')
  })
  test('встройка на 1440p — дальность ниже: пиксели съедают FPS', () => {
    const v = videoTuning({ gpu: 'Intel(R) Iris(R) Xe Graphics', ramMb: 16384, cores: 8, screenW: 2560, screenH: 1440 })
    expect(row(v, 'renderDistance')).toBe('5')
  })
  test('мощный ПК получает красивую картинку, а не «слабый» набор', () => {
    const v = videoTuning({ gpu: 'RTX 3080', ramMb: 32768, cores: 16, screenW: 2560, screenH: 1440 })
    expect(row(v, 'renderDistance')).toBe('16')
    expect(row(v, 'graphicsMode')).toBe('1')
    expect(row(v, 'enableVsync')).toBe('false')
  })
  test('экран', () => {
    expect(screenClass(1366, 768)).toBe('768')
    expect(screenClass(3840, 2160)).toBe('2160')
  })
})
