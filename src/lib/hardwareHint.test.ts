import { describe, expect, it } from 'bun:test'
import { normalizeHardware } from './hardwareHint'

describe('normalizeHardware: запись железа с прошлых запусков', () => {
  const old = { gpus: ['Intel(R) UHD Graphics 620'], ramMb: 5_900, threads: 4, os: 'windows', osVersion: '10 (19045)' }
  it('запись без числа ядер читается, ядра неизвестны (0): их ядро скажет при ближайшем обновлении', () => {
    expect(normalizeHardware(old)).toEqual({ ...old, cores: 0 })
  })
  it('число ядер из ядра сохраняется', () => {
    expect(normalizeHardware({ ...old, cores: 2 })?.cores).toBe(2)
  })
  it('мусор и чужие записи отбрасываются', () => {
    expect(normalizeHardware(null)).toBeNull()
    expect(normalizeHardware({ gpus: 'x', ramMb: 1 })).toBeNull()
    expect(normalizeHardware('4 GB')).toBeNull()
  })
  it('отрицательные и нечисловые ядра — неизвестно', () => {
    expect(normalizeHardware({ ...old, cores: -1 })?.cores).toBe(0)
    expect(normalizeHardware({ ...old, cores: 'two' })?.cores).toBe(0)
  })
})
