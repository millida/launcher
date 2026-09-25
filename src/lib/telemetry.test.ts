import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Очередь телеметрии: гонка отправок, дубли после init, штамп времени и
// версии, один app_exit на страницу, trackFailure (bughunt 25.09.2026).
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})
const listeners: Record<string, Array<() => void>> = {}
Object.defineProperty(globalThis, 'window', {
  value: {
    addEventListener: (t: string, fn: () => void) => void (listeners[t] ||= []).push(fn),
    setInterval: () => 1,
    screen: { width: 1920, height: 1080 },
  },
  configurable: true,
})
Object.defineProperty(globalThis, 'document', {
  value: { addEventListener: (t: string, fn: () => void) => void (listeners['doc:' + t] ||= []).push(fn), hidden: false },
  configurable: true,
})
Object.defineProperty(globalThis, 'location', { value: { hash: '' }, configurable: true, writable: true })

type Batch = { events: Array<{ type: string; at?: number; appVersion?: string; data?: Record<string, unknown> }> }
const sent: Batch[] = []
let release: Array<(ok: boolean) => void> = []
let manual = false

mock.module('../ipc/tauri', () => ({ hasTauri: () => true }))
mock.module('../ipc/commands', () => ({
  appVersion: async () => '2.0.1',
  deviceSpecs: async () => ({ os: 'windows', os_version: '11', arch: 'x86_64' }),
  millidaApi: (path: string, _m: string, body: Batch) => {
    if (path !== '/launcher/telemetry') return Promise.resolve({})
    sent.push(JSON.parse(JSON.stringify(body)))
    if (!manual) return Promise.resolve({})
    return new Promise((res, rej) => release.push((ok) => (ok ? res({}) : rej(new Error('offline')))))
  },
}))
mock.module('./api', () => ({ LAUNCHER_API: 'http://x', apiHeaders: () => ({}) }))
mock.module('./gpu', () => ({ detectGpu: () => 'gpu' }))

const T = await import('./telemetry')
const tick = () => new Promise((r) => setTimeout(r, 0))
const types = (b: Batch) => b.events.map((e) => e.type)

describe('очередь телеметрии', () => {
  beforeEach(() => {
    T.__resetTelemetryForTests()
    store.clear()
    sent.length = 0
    release = []
    manual = false
    for (const k of Object.keys(listeners)) delete listeners[k]
    ;(globalThis as { location: { hash: string } }).location.hash = ''
  })

  test('параллельные flush не шлют пачку дважды и не теряют события', async () => {
    manual = true
    T.track('ui_click', { a: 1 })
    T.track('ui_click', { a: 2 })
    const first = T.flushTelemetry()
    T.track('ui_click', { a: 3 })
    const second = T.flushTelemetry()
    await tick()
    expect(sent.length).toBe(1)
    expect(sent[0].events.length).toBe(2)
    release.shift()!(true)
    await tick()
    await tick()
    // Второй вызов попросил ещё круг — уходит только третье событие.
    expect(sent.length).toBe(2)
    expect(sent[1].events.map((e) => e.data?.a)).toEqual([3])
    release.shift()!(true)
    await Promise.all([first, second])
    expect(store.get('m-telemetry-queue')).toBeUndefined()
  })

  test('события до init не дублируются и сохранённая очередь не затирается', async () => {
    store.set('m-telemetry-queue', JSON.stringify([{ type: 'app_exit', at: 1 }]))
    T.track('screen_view', { screen: 'home' })
    await T.initTelemetry(100)
    await tick()
    const all = sent.flatMap(types)
    expect(all.filter((t) => t === 'screen_view').length).toBe(1)
    expect(all.filter((t) => t === 'app_exit').length).toBe(1)
    expect(all.filter((t) => t === 'app_start').length).toBe(1)
  })

  test('каждое событие со временем и версией, которая его записала', async () => {
    const before = Date.now()
    T.track('ui_click', {})
    await T.initTelemetry(1)
    await tick()
    const ev = sent.flatMap((b) => b.events)
    expect(ev.every((e) => typeof e.at === 'number' && e.at! >= before)).toBe(true)
    expect(ev.every((e) => e.appVersion === '2.0.1')).toBe(true)
    // Событие прошлой версии из сохранённой очереди свою версию не теряет.
    T.__resetTelemetryForTests()
    sent.length = 0
    store.set('m-telemetry-queue', JSON.stringify([{ type: 'game_exit', at: 5, appVersion: '1.0.115' }]))
    await T.initTelemetry(1)
    await tick()
    expect(sent.flatMap((b) => b.events).find((e) => e.type === 'game_exit')?.appVersion).toBe('1.0.115')
  })

  test('app_exit — один на страницу, повторный init слушателей не добавляет', async () => {
    await T.initTelemetry(1)
    await T.initTelemetry(1)
    expect(listeners.pagehide.length).toBe(1)
    listeners.beforeunload[0]()
    listeners.pagehide[0]()
    listeners.pagehide[0]()
    T.trackAppExit()
    await tick()
    expect(sent.flatMap(types).filter((t) => t === 'app_exit').length).toBe(1)
  })

  test('отменённый выход забирает свой app_exit назад', async () => {
    manual = true
    await T.initTelemetry(1)
    listeners.beforeunload[0]()
    T.cancelAppExit()
    release.forEach((r) => r(true))
    await tick()
    manual = false
    await T.flushTelemetry()
    expect(sent.flatMap(types)).not.toContain('app_exit')
    // И может случиться позже по-настоящему.
    T.trackAppExit()
    await tick()
    expect(sent.flatMap(types)).toContain('app_exit')
  })

  test('окно оверлея ничего не пишет в общую очередь', () => {
    ;(globalThis as { location: { hash: string } }).location.hash = '#overlay'
    T.track('ui_click', {})
    expect(store.get('m-telemetry-queue')).toBeUndefined()
  })

  test('trackFailure: класс, чистый текст, без повторов и без отмен', async () => {
    expect(T.trackFailure('launch', 'Запуск отменён')).toBe(null)
    expect(T.trackFailure('login', 'unauthorized')).toBe(null)
    const kind = T.trackFailure('updater', new Error('нет связи (operation timed out) C:/Users/Вася/x Bearer abc.def'), { step: 'boot' })
    expect(kind).toBe('network_timeout')
    T.trackFailure('updater', new Error('нет связи (operation timed out) C:/Users/Вася/x Bearer abc.def'), { step: 'boot' })
    await T.flushTelemetry()
    const errs = sent.flatMap((b) => b.events).filter((e) => e.type === 'error')
    expect(errs.length).toBe(1)
    expect(errs[0].data).toMatchObject({ where: 'updater', kind: 'network_timeout', step: 'boot' })
    const code = String(errs[0].data?.code)
    expect(code).not.toContain('Вася')
    expect(code).not.toContain('abc.def')
  })

  test('отказ от телеметрии чистит сохранённую очередь', () => {
    T.track('ui_click', {})
    expect(store.get('m-telemetry-queue')).toBeDefined()
    T.setTelemetryEnabled(false)
    expect(store.get('m-telemetry-queue')).toBeUndefined()
    T.track('ui_click', {})
    expect(store.get('m-telemetry-queue')).toBeUndefined()
    T.setTelemetryEnabled(true)
  })
})
