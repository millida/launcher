import { afterEach, describe, expect, mock, test } from 'bun:test'

const store: Record<string, string> = {}
mock.module('../lib/prefs', () => ({
  readPref: (k: string, d: string) => (k in store ? store[k] : d),
  writePref: (k: string, v: string) => {
    store[k] = v
  },
}))

let lite = false
mock.module('../lib/liteMode', () => ({ liteOn: () => lite, onLiteChange: () => () => {} }))

const { tabTransitionMs, TAB_MS_DEFAULT, TAB_MS_MAX, TAB_WAVE_FLASH_MS, waveFrontMs } = await import('./viewPrefs')

afterEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  lite = false
})

describe('переход между вкладками без задержки (WEAK-13)', () => {
  // Приказ владельца 27.10.2026: весь переход ≤ 100 мс (было 118 мс въезда и волна 340 мс поверх).
  test('по умолчанию весь переход — не дольше 100 мс: и въезд экрана, и пиксельная волна с вспышкой', () => {
    // viewPrefs.applyTabMs: длительность въезда = 0,42 от настройки; волна (ScreenWave) = фронт + вспышка.
    expect(Math.round(TAB_MS_DEFAULT * 0.42)).toBeLessThanOrEqual(100)
    expect(waveFrontMs(TAB_MS_DEFAULT) + TAB_WAVE_FLASH_MS, 'фронт волны и вспышка за ним укладываются в настройку').toBeLessThanOrEqual(100)
    expect(tabTransitionMs()).toBeLessThanOrEqual(100)
  })
  test('волна не длиннее выбора игрока и не уходит в минус', () => {
    expect(waveFrontMs(0)).toBe(0)
    expect(waveFrontMs(TAB_WAVE_FLASH_MS)).toBe(0)
    expect(waveFrontMs(640) + TAB_WAVE_FLASH_MS).toBe(640)
  })
  test('на слабом ПК без выбора игрока перехода нет', () => {
    lite = true
    expect(tabTransitionMs()).toBe(0)
  })
  test('прежние «Обычно» (380, 280) и «Быстро» (190) — след прежних умолчаний: идут за новым', () => {
    for (const old of ['380', '280', '190']) {
      store['m-tab-ms'] = old
      expect(tabTransitionMs(), old).toBe(TAB_MS_DEFAULT)
    }
    lite = true
    expect(tabTransitionMs()).toBe(0)
  })
  test('явный выбор игрока главнее и на слабом ПК', () => {
    lite = true
    store['m-tab-ms'] = '640'
    expect(tabTransitionMs()).toBe(640)
    store['m-tab-ms'] = '450'
    expect(tabTransitionMs()).toBe(450)
  })
})

describe('tabTransitionMs', () => {
  const CASES: { name: string; why: string; stored?: string; want: number }[] = [
    { name: 'no choice yet', why: 'default keeps the transition the owner tuned', want: TAB_MS_DEFAULT },
    { name: 'off', why: 'zero must survive so the wave can be skipped', stored: '0', want: 0 },
    { name: 'garbage', why: 'a corrupt pref file must not break navigation', stored: 'x', want: TAB_MS_DEFAULT },
    { name: 'above ceiling', why: 'an absurd value is clamped, never a frozen screen', stored: '99999', want: TAB_MS_MAX },
  ]
  for (const c of CASES) {
    test(c.name, () => {
      if (c.stored !== undefined) store['m-tab-ms'] = c.stored
      expect(tabTransitionMs(), c.name + ': ' + c.why).toBe(c.want)
    })
  }
})
