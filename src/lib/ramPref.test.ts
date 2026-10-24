import { afterEach, describe, expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

let settings: Record<string, number | null> = {}
let writeFails = false
let slowFirst = false
const written: number[] = []
let calls = 0

mock.module('../ipc/commands', () => ({
  loadProfileSettings: async (profile: string) => ({ ramMb: settings[profile] ?? undefined }),
  setProfileRam: async (profile: string, mb: number) => {
    calls += 1
    if (slowFirst && calls === 1) await new Promise((r) => setTimeout(r, 20))
    if (writeFails) throw new Error('Сборка не найдена')
    written.push(mb)
    settings[profile] = mb || null
  },
}))

const { adoptLegacyRam, buildRamGb, pendingLegacyRamMb, ramPrefKey, setBuildRamMb } = await import('./ramPref')

afterEach(() => {
  localStorage.removeItem(ramPrefKey('Big'))
  settings = {}
  writeFails = false
  slowFirst = false
  written.length = 0
  calls = 0
})

describe('память сборки — одно значение в ядре', () => {
  test('ползунок старой версии переезжает в ядро и больше не перебивает его', async () => {
    localStorage.setItem(ramPrefKey('Big'), '6')
    settings.Big = 4096
    expect(await buildRamGb('Big')).toBe(6)
    expect(settings.Big).toBe(6144)
    expect(localStorage.getItem(ramPrefKey('Big'))).toBeNull()
    expect(pendingLegacyRamMb('Big')).toBe(0)
  })

  test('ядро не приняло запись — старое значение остаётся, запуск не теряет память игрока', async () => {
    localStorage.setItem(ramPrefKey('Big'), '6')
    writeFails = true
    await adoptLegacyRam('Big')
    expect(localStorage.getItem(ramPrefKey('Big'))).toBe('6')
    expect(pendingLegacyRamMb('Big')).toBe(6144)
  })

  const writes: Array<[number, boolean, number | undefined, string]> = [
    [6144, true, 6144, 'кнопка окна вылета ставит 6 ГБ в настройки сборки'],
    [6600, true, 6144, 'целые гигабайты, как на ползунке'],
    [0, true, 0, '0 — авто: ключ снимается, решает автоподбор'],
    [Number('abc'), false, undefined, 'мусор не уходит в ядро'],
    [-1024, false, undefined, 'отрицательное не уходит в ядро'],
  ]
  for (const [mb, ok, sent, why] of writes) {
    test('запись: ' + why, async () => {
      expect(await setBuildRamMb('Big', mb)).toBe(ok)
      expect(written[0]).toBe(sent as number)
    })
  }

  test('ползунок тянут быстро: последняя запись остаётся последней', async () => {
    slowFirst = true
    const a = setBuildRamMb('Big', 4096)
    const b = setBuildRamMb('Big', 8192)
    await Promise.all([a, b])
    expect(written).toEqual([4096, 8192])
    expect(settings.Big).toBe(8192)
  })

  test('сбой записи доходит до вызывающего', async () => {
    writeFails = true
    expect(await setBuildRamMb('Big', 4096)).toBe(false)
  })
})
