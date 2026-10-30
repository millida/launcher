import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type { GamePerf } from '../ipc/events'

// «Почему лагало» после выгрузки окна (WEAK-16): кадры, что ядро копило без окна, приходят
// пачкой при открытии лаунчера и со своим временем. Судить их по часам разбора нельзя:
// пачка за час уложилась бы в одну секунду, и ни минуты низкого FPS не набралось бы.
const prefs = new Map<string, string>()
mock.module('./prefs', () => ({
  readPref: (k: string, d: string) => prefs.get(k) ?? d,
  writePref: (k: string, v: string) => void prefs.set(k, v),
}))
const tracked: Array<[string, Record<string, unknown>]> = []
mock.module('./telemetry', () => ({ track: (type: string, data: Record<string, unknown>) => void tracked.push([type, data]) }))
const notices: string[] = []
let noticeDelayMs = 0
let noticeFails = false
mock.module('../ipc/commands', () => ({
  fpsBoostState: async () => null,
  listContent: async () => [],
  ramCheck: async () => null,
  gameNotice: async (_profile: string, title: string) => {
    if (noticeFails) throw new Error('игра не отвечает')
    notices.push(title)
    return true
  },
}))
let onExit: (profile: string) => void = () => {}
mock.module('../ipc/events', () => ({
  listenGameExit: async (fn: (profile: string) => void) => {
    onExit = fn
    return null
  },
  listenGamePerf: async () => null,
}))
mock.module('../ipc/tauri', () => ({ hasTauri: () => true }))
mock.module('../state/game', () => ({ useGame: { getState: () => ({ list: [] as string[] }) } }))
mock.module('../state/ui', () => ({ showToast: () => {} }))
mock.module('./launch', () => ({
  ramMbFor: async () => {
    if (noticeDelayMs) await new Promise((r) => setTimeout(r, noticeDelayMs))
    return 0
  },
}))
mock.module('./milliLocal', () => ({ filesRead: async () => [] }))

const H = await import('./lagHelp')

const T0 = Date.now() - 20 * 60_000
let n = 0
/** Каждому тесту своя сборка: окна и кулдауны живут в модуле. */
let profile = 'Мир'
const sample = (i: number, over: Partial<GamePerf> = {}): GamePerf => ({
  profile,
  focused: true,
  fps: 18,
  world: true,
  throttled: false,
  heapMb: 1000,
  maxMb: 4096,
  gcPct: 1,
  at: T0 + i * 5000,
  ...over,
})
/** Три минуты игры в мире с отчётами раз в 5 с. */
const session = (over: Partial<GamePerf> = {}) => Array.from({ length: 36 }, (_, i) => sample(i, over))
const tick = () => new Promise((r) => setTimeout(r, 5))
const lags = () => tracked.filter(([type]) => type === 'lag_detected')

describe('помощник лагов: кадры, копившиеся без окна', () => {
  beforeEach(() => {
    prefs.clear()
    tracked.length = 0
    notices.length = 0
    noticeDelayMs = 0
    noticeFails = false
    H.useLag.getState().close()
    profile = 'Мир ' + ++n
  })

  test('час лагов, пришедший пачкой за миг, считается за лаг по времени мода', async () => {
    for (const p of session()) H.onPerf(p)
    await tick()
    expect(lags().length).toBe(1)
    expect(notices.length).toBe(1)
    const pending = JSON.parse(prefs.get('m-lag-pending') ?? 'null')
    expect(pending.profile).toBe(profile)
    expect(pending.at, 'карточка помнит, когда лагало на самом деле, а не когда открыли окно').toBeLessThan(T0 + 36 * 5000 + 1)
    expect(pending.at).toBeGreaterThan(T0)
  })

  test('те же кадры без времени (старые часы разбора) лага не дают: так терялись события', async () => {
    for (const p of session({ at: undefined })) H.onPerf(p)
    await tick()
    expect(lags().length, 'за миг набралось бы 36 отчётов, но «45 с после входа в мир» по часам не прошли').toBe(0)
  })

  test('кулдаун 30 минут считается по времени мода: два лага с разницей в час — оба в счётчике', async () => {
    for (const p of session()) H.onPerf(p)
    await tick()
    const hourLater = session().map((p) => ({ ...p, at: p.at! + 3600_000 }))
    for (const p of hourLater) H.onPerf(p)
    await tick()
    expect(lags().length).toBe(2)
  })

  test('второй лаг через 10 минут того же запуска не плодит карточки', async () => {
    for (const p of session()) H.onPerf(p)
    await tick()
    const soon = session().map((p) => ({ ...p, at: p.at! + 600_000 }))
    for (const p of soon) H.onPerf(p)
    await tick()
    expect(lags().length).toBe(1)
  })

  test('выход игры не обгоняет разбор: карточка «Почему лагало» появляется и при пачке на открытии окна', async () => {
    H.startLagHelp()
    noticeDelayMs = 30
    for (const p of session()) H.onPerf(p)
    onExit(profile)
    expect(H.useLag.getState().report, 'разбор ещё идёт').toBeNull()
    await new Promise((r) => setTimeout(r, 80))
    expect(H.useLag.getState().report?.profile).toBe(profile)
  })

  test('сбой показа строки на острове не теряется молча: причина в журнале, карточка и счётчик целы', async () => {
    noticeFails = true
    const warn = console.warn
    const seen: string[] = []
    console.warn = (...a: unknown[]) => void seen.push(String(a[0]))
    try {
      for (const p of session()) H.onPerf(p)
      await tick()
    } finally {
      console.warn = warn
    }
    expect(seen.some((m) => m.startsWith('[lag]'))).toBe(true)
    expect(lags().length).toBe(1)
    expect(prefs.get('m-lag-pending')).toBeTruthy()
  })
})
