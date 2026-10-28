import { afterEach, describe, expect, mock, test } from 'bun:test'

const store: Record<string, string> = {}
mock.module('../lib/prefs', () => ({
  readPref: (k: string, d: string) => (k in store ? store[k] : d),
  writePref: (k: string, v: string) => {
    store[k] = v
  },
}))

const { tabTransitionMs, TAB_MS_DEFAULT, TAB_MS_MAX } = await import('./viewPrefs')

afterEach(() => {
  for (const k of Object.keys(store)) delete store[k]
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
