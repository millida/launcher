import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { RamCheck } from '../ipc/commands'

// Окно «Сборка тяжелее ПК» перед запуском на ПК с 4 ГБ: что показано, что нажато, что применено.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

const pc4: RamCheck = { heapMb: 1900, needMb: 4096, fitMb: 1900, totalMb: 3900, availableMb: 2200, mods: 60, manual: false, packOwned: false }
let check: RamCheck = pc4
let gfx: { preset: string | null; applicable: boolean; custom: boolean; fresh: boolean; source: string | null; want: string | null; battery: boolean; shadersOk: boolean } = {
  preset: null,
  applicable: true,
  custom: false,
  fresh: false,
  source: null,
  want: null,
  battery: false,
  shadersOk: false,
}
const asked: Array<{ message: string; opts: Record<string, unknown> }> = []
let answer: 'yes' | 'no' | 'dismiss' = 'yes'
const applied: Array<[string, string]> = []
const toasts: string[] = []

mock.module('../ipc/commands', () => ({
  ramCheck: async () => check,
  gfxPresetState: async () => gfx,
  applyGfxPreset: async (profile: string, preset: string) => void applied.push([profile, preset]),
  seedVideoOptions: async () => {},
}))
mock.module('../state/confirm', () => ({
  uiChoice: async (message: string, opts: Record<string, unknown>) => {
    asked.push({ message, opts })
    return answer
  },
}))
mock.module('../state/ui', () => ({ showToast: (m: string) => void toasts.push(m) }))
mock.module('./ramPref', () => ({ setBuildRamMb: async () => true }))
mock.module('./launch', () => ({ ramMbFor: () => 0 }))
mock.module('./graphicsRelease', () => ({ GRAPHICS_PRESETS_PUBLIC: true }))
mock.module('./gfxPresets', () => ({
  cachedHardware: async () => ({}),
  presetVideo: () => [],
  globalChoice: () => 'none',
  isGfxChoice: () => false,
  resolveChoice: () => null,
  forBattery: () => ({ level: 'low', video: [] }),
  onBattery: async () => false,
}))

const { prelaunchCare } = await import('./prelaunchCare')

describe('окно «Сборка тяжелее ПК»', () => {
  beforeEach(() => {
    store.clear()
    asked.length = 0
    applied.length = 0
    toasts.length = 0
    check = pc4
    answer = 'yes'
    gfx = { ...gfx, preset: null, applicable: true, custom: false }
  })

  test('показывает число модов, нужную память и предлагает ступень; «да» применяет её', async () => {
    await prelaunchCare('Мир')
    expect(asked.length).toBe(1)
    expect(asked[0].message).toContain('60')
    expect(asked[0].message).toContain('4 ГБ')
    expect(asked[0].message).toContain('1.9 ГБ')
    expect(String(asked[0].opts.confirmLabel)).toContain('Низкие')
    expect(applied).toEqual([['Мир', 'low']])
  })

  test('«Играть так» ничего не применяет и неделю не спрашивает снова', async () => {
    answer = 'no'
    await prelaunchCare('Мир')
    expect(applied).toEqual([])
    await prelaunchCare('Мир')
    expect(asked.length, 'второй раз в течение недели — молча').toBe(1)
    await prelaunchCare('Другая')
    expect(asked.length, 'у другой сборки свой счётчик').toBe(2)
  })

  test('закрыли окно мимо кнопок — спросим при следующем запуске', async () => {
    answer = 'dismiss'
    await prelaunchCare('Мир')
    answer = 'no'
    await prelaunchCare('Мир')
    expect(asked.length).toBe(2)
  })

  test('нужная ступень уже стоит — окно только с цифрами, кнопки графики нет', async () => {
    gfx = { ...gfx, preset: 'low' }
    await prelaunchCare('Мир')
    expect(asked.length).toBe(1)
    expect(String(asked[0].opts.confirmLabel)).not.toContain('Низкие')
    expect(applied).toEqual([])
  })

  test('графику игрок настроил сам (ступень «Своя») — не перезаписываем', async () => {
    gfx = { ...gfx, custom: true }
    answer = 'yes'
    await prelaunchCare('Мир')
    expect(applied).toEqual([])
  })

  test('на нормальном ПК окна нет', async () => {
    check = { ...pc4, totalMb: 15800, heapMb: 4096, fitMb: 4096 }
    await prelaunchCare('Мир')
    expect(asked.length).toBe(0)
  })
})
