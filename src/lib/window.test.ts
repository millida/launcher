import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Крестик (в трей) при работе, что живёт только в странице: окно прячется с удержанием, а когда работа
// кончилась, страница сама просит выгрузку ещё раз (C1/C2 ревью 27.10.2026).
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

const unloads: Array<{ reason: string; hold: string | null }> = []
let visible = false
// R9: what happened in what order after the cross — the window must leave the screen before the queues go out.
const order: string[] = []
let flushGate: Promise<void> | null = null
let hideFails = false
mock.module('../ipc/tauri', () => ({ hasTauri: () => true, tauri: () => null }))
mock.module('../ipc/commands', () => ({
  trayAvailable: async () => true,
  setRestoreOnExitNative: async () => {},
  hideToTray: async () => {
    order.push('hide')
    if (hideFails) throw new Error('no tray')
  },
  showFromTray: async () => {},
  mainWindowVisible: async () => visible,
  unloadMainWindow: async (reason: string, hold: string | null) => {
    order.push('unload')
    unloads.push({ reason, hold })
  },
}))
mock.module('../state/music', () => ({ suspendMusic: () => {} }))
mock.module('../state/ui', () => ({ showToast: () => {}, useUi: { getState: () => ({ screen: 'play' }) } }))
mock.module('./telemetry', () => ({
  flushTelemetry: async () => {
    order.push('flush')
    await flushGate
  },
}))
mock.module('./prefs', () => ({ flushPrefs: async () => {}, readPref: (_k: string, d: string) => d, writePref: () => {}, hydratePrefs: async () => {} }))

const { registerUnloadHold } = await import('./unloadHold')
const W = await import('./window')

let installing = false
let launching = false
const subs = new Set<() => void>()
const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}
registerUnloadHold(() => (installing ? 'install' : null), subscribe)
registerUnloadHold(() => (launching ? 'launch' : null), subscribe)
const changed = () => subs.forEach((cb) => cb())
const tick = () => new Promise((r) => setTimeout(r, 10))

describe('крестик под работой страницы', () => {
  beforeEach(async () => {
    unloads.length = 0
    order.length = 0
    flushGate = null
    hideFails = false
    installing = false
    launching = false
    visible = false
    store.set('m-tray-hint', '1')
    W.initTray()
    await tick()
  })

  test('без работы окно выгружается сразу и без удержания', async () => {
    W.hideLauncherToTray()
    await tick()
    expect(unloads).toEqual([{ reason: 'tray', hold: null }])
  })

  // R9: до отправки очередей (до 1,5 с) окно уже ушло с экрана.
  test('крестик: окно уходит с экрана сразу, очереди и выгрузка — после', async () => {
    let release: () => void = () => {}
    flushGate = new Promise<void>((r) => (release = r))
    W.hideLauncherToTray()
    await tick()
    expect(order, 'окно спрятано до того, как очередь ушла; выгрузки ещё нет').toEqual(['hide', 'flush'])
    expect(unloads.length).toBe(0)
    release()
    await tick()
    expect(order).toEqual(['hide', 'flush', 'unload'])
  })

  test('игрок вернул окно, пока уходила очередь, — выгрузки нет', async () => {
    let release: () => void = () => {}
    flushGate = new Promise<void>((r) => (release = r))
    W.hideLauncherToTray()
    await tick()
    visible = true
    release()
    await tick()
    expect(unloads.length, 'окно уже на экране, ломать его нельзя').toBe(0)
  })

  test('трея у ядра не вышло — окно сворачивается и выгрузка идёт как раньше', async () => {
    hideFails = true
    W.hideLauncherToTray()
    await tick()
    expect(order[0]).toBe('hide')
    expect(unloads, 'свёрнутое окно ядро считает видимым: на это не смотрим').toEqual([{ reason: 'tray', hold: null }])
  })

  test('подготовка запуска: окно прячется с удержанием «launch», а выгружается, когда запуск ушёл в ядро', async () => {
    launching = true
    W.hideLauncherToTray()
    await tick()
    expect(unloads).toEqual([{ reason: 'tray', hold: 'launch' }])
    launching = false
    changed()
    await tick()
    expect(unloads[unloads.length - 1]).toEqual({ reason: 'tray', hold: null })
    expect(unloads.length).toBe(2)
  })

  test('установка страницы: окно ждёт её конца, не выгружаясь на промежуточных шагах', async () => {
    installing = true
    W.hideLauncherToTray()
    await tick()
    changed()
    changed()
    await tick()
    expect(unloads, 'пока идёт установка, повторных просьб выгрузить нет').toEqual([{ reason: 'tray', hold: 'install' }])
    installing = false
    changed()
    await tick()
    expect(unloads.length).toBe(2)
    expect(unloads[1].hold).toBeNull()
  })

  test('игрок вернул окно, пока подготовка шла, — выгружать не надо', async () => {
    launching = true
    W.hideLauncherToTray()
    await tick()
    visible = true
    launching = false
    changed()
    await tick()
    expect(unloads.length).toBe(1)
  })
})
