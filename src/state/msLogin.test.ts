import { beforeEach, describe, expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
// Stands in for the core vault: the webview only ever learns that a session exists.
const vault = new Set<string>()

const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
}

Object.defineProperty(globalThis, 'localStorage', { value: localStorageStub, configurable: true })
Object.defineProperty(globalThis, 'window', {
  value: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, open() {} },
  configurable: true,
})

const calls = { refresh: 0, validate: 0 }
let refreshImpl: () => Promise<unknown> = async () => ({ status: 'none' })
let validateImpl: () => Promise<unknown> = async () => ({ status: 'expired' })

mock.module('../ipc/tauri', () => ({ hasTauri: () => true, tauri: () => null }))
mock.module('../lib/session', () => ({ enterApp() {} }))
mock.module('../lib/clipboard', () => ({ copyText: async () => true }))
mock.module('./ui', () => ({ showToast() {} }))
mock.module('../ipc/commands', () => ({
  msDeviceStart: async () => ({}),
  msDevicePoll: async () => ({}),
  msSessionCommit: async () => {},
  msSessionForget: async () => void vault.delete('a1'),
  openUrl() {},
  msSessionRefresh: async () => {
    calls.refresh += 1
    const r = (await refreshImpl()) as { status: string }
    if (r.status === 'relogin') vault.delete('a1')
    return r
  },
  msSessionValidate: async () => {
    calls.validate += 1
    const r = (await validateImpl()) as { status: string }
    if (r.status === 'expired') vault.delete('a1')
    return r
  },
}))
mock.module('../lib/secure', () => ({
  hasAccountSession: (id: string) => vault.has(id),
  refreshSessionState: async () => {},
}))

const { ensureMsAuth } = await import('./msLogin')
const { useAccounts } = await import('./accounts')

const HOUR = 3600_000

function seed(exp: number | undefined, opts: { token?: boolean } = {}) {
  vault.clear()
  if (opts.token !== false) vault.add('a1')
  const acc = { id: 'a1', nick: 'Notch', kind: 'microsoft', uuid: 'u1', xuid: 'x1', exp }
  store.set('m-accounts', JSON.stringify([acc]))
  store.set('m-active', 'a1')
  useAccounts.getState().save([acc])
  calls.refresh = 0
  calls.validate = 0
  return acc
}

const accNow = () => useAccounts.getState().list[0]

describe('ensureMsAuth', () => {
  beforeEach(() => {
    refreshImpl = async () => ({ status: 'none' })
    validateImpl = async () => ({ status: 'expired' })
  })

  test('живой токен отдаётся как есть, Microsoft не дёргаем', async () => {
    seed(Date.now() + 6 * HOUR)
    const r = await ensureMsAuth()
    expect(r?.id).toBe('a1')
    expect(calls.refresh).toBe(0)
    expect(calls.validate).toBe(0)
  })

  test('просроченный токен обновляется по refresh, срок и xuid сохраняются', async () => {
    seed(Date.now() - HOUR)
    refreshImpl = async () => ({ status: 'ok', nick: 'Notch', uuid: 'u2', xuid: 'x2', expires_in: 86400 })
    const r = await ensureMsAuth()
    expect(r?.xuid).toBe('x2')
    expect(vault.has('a1')).toBe(true)
    expect(accNow().exp! - Date.now()).toBeGreaterThan(23 * HOUR)
  })

  test('токен, которому осталось меньше пяти минут, считается мёртвым', async () => {
    seed(Date.now() + 60_000)
    refreshImpl = async () => ({ status: 'ok', nick: 'Notch', expires_in: 86400 })
    const r = await ensureMsAuth()
    expect(calls.refresh).toBe(1)
    expect(r?.id).toBe('a1')
  })

  test('отозванный refresh — сессии нет, секреты стёрты (в меню «Вход слетел»)', async () => {
    seed(Date.now() - HOUR)
    refreshImpl = async () => ({ status: 'relogin' })
    const r = await ensureMsAuth()
    expect(r).toBeNull()
    expect(vault.has('a1')).toBe(false)
    expect(accNow().exp).toBe(0)
  })

  test('срок неизвестен (вход до учёта срока): токен живой по ответу Minecraft', async () => {
    seed(undefined)
    validateImpl = async () => ({ status: 'ok', nick: 'Notch', uuid: 'u1' })
    const r = await ensureMsAuth()
    expect(r?.id).toBe('a1')
    expect(calls.validate).toBe(1)
    expect(accNow().exp!).toBeGreaterThan(Date.now())
  })

  test('срок неизвестен, Minecraft отвечает 401 — запуска онлайн не будет', async () => {
    seed(undefined)
    validateImpl = async () => ({ status: 'expired' })
    const r = await ensureMsAuth()
    expect(r).toBeNull()
    expect(vault.has('a1')).toBe(false)
  })

  test('сети нет — токен не стираем и не блокируем запуск', async () => {
    seed(Date.now() - HOUR)
    refreshImpl = async () => {
      throw new Error('нет соединения с сервером')
    }
    validateImpl = async () => {
      throw new Error('нет соединения с сервером')
    }
    const r = await ensureMsAuth()
    expect(r?.id).toBe('a1')
    expect(vault.has('a1')).toBe(true)
  })

  test('без сохранённой сессии Minecraft не опрашивается', async () => {
    seed(undefined, { token: false })
    const r = await ensureMsAuth()
    expect(r).toBeNull()
    expect(calls.validate).toBe(0)
  })
})
