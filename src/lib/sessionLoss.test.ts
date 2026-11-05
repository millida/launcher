import { beforeEach, describe, expect, mock, test } from 'bun:test'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

// Ядро: проверка сессии и выход — подменяем, чтобы видеть, что лаунчер у него просит.
let statusFails = false
let logouts = 0
let logoutFails = false
let statusCalls = 0
const realTauri = await import('../ipc/tauri')
const realCommands = await import('../ipc/commands')
mock.module('../ipc/tauri', () => ({ ...realTauri, hasTauri: () => true }))
mock.module('../ipc/commands', () => ({
  ...realCommands,
  sessionStatus: async () => {
    statusCalls++
    if (statusFails) throw new Error('ipc timeout')
    return { millida: true, accounts: {} }
  },
  millidaLogout: async () => {
    logouts++
    if (logoutFails) throw new Error('vault busy')
  },
  msSessionForget: async () => {},
}))

const { refreshSessionState, hasMillidaSession } = await import('./secure')
const { isUnauthorized } = await import('./api')
const { showLogin, signOut } = await import('./session')
const { restoreAccounts, useAccounts } = await import('../state/accounts')
const { useUi } = await import('../state/ui')

describe('session loss', () => {
  beforeEach(() => {
    statusFails = false
    logouts = 0
    logoutFails = false
    statusCalls = 0
    useAccounts.setState({ list: [{ id: 'm1', nick: 'Steve', kind: 'millida' } as never], active: 'm1' })
  })

  test('only the exact "unauthorized" from the core ends the sign-in', () => {
    expect(isUnauthorized('unauthorized')).toBe(true)
    expect(isUnauthorized(new Error('unauthorized'))).toBe(true)
    expect(isUnauthorized('http 403: Unauthorized region')).toBe(false)
    expect(isUnauthorized('http 502: upstream unauthorized')).toBe(false)
  })

  test('a core that does not answer is "unknown", not "signed out"', async () => {
    expect(await refreshSessionState()).toBe('ok')
    expect(hasMillidaSession()).toBe(true)
    statusFails = true
    expect(await refreshSessionState(1)).toBe('failed')
    expect(hasMillidaSession()).toBe(true)
  })

  test('the sign-in screen erases nothing: no core logout, the account row stays', () => {
    showLogin('expired')
    expect(useUi.getState().logged).toBe(false)
    expect(logouts).toBe(0)
    expect(useAccounts.getState().list.map((a) => a.id)).toEqual(['m1'])
  })

  test('signing out on purpose drops the core session and the Millida row', async () => {
    signOut()
    await Promise.resolve()
    expect(logouts).toBe(1)
    expect(useAccounts.getState().list).toEqual([])
  })

  test('a sign-out the core refused asks the core again, because the core finishes it on a session check', async () => {
    logoutFails = true
    signOut()
    await new Promise((r) => setTimeout(r, 0))
    expect(logouts).toBe(1)
    expect(statusCalls, 'one check comes from removing the row, the second is the one that finishes the sign-out').toBeGreaterThanOrEqual(2)
    expect(useAccounts.getState().list, 'the player asked to leave: the row goes either way').toEqual([])
  })

  test('the disk copy of the account list carries no avatar, it would not fit the core limit', () => {
    useAccounts.getState().save([{ id: 'm1', nick: 'Steve', kind: 'millida', uuid: 'u1', avatar: 'data:image/png;base64,AAAA', avatarFrom: 'cpu:skin' } as never])
    const copy = JSON.parse(store.get('m-accounts-backup') ?? '[]')
    expect(copy).toEqual([{ id: 'm1', nick: 'Steve', kind: 'millida', uuid: 'u1' }])
  })

  test('a wiped webview account list comes back from the disk copy, and only when it is gone', () => {
    useAccounts.getState().save([{ id: 'm1', nick: 'Steve', kind: 'millida' } as never])
    store.delete('m-accounts')
    useAccounts.setState({ list: [], active: '' })
    expect(restoreAccounts()).toBe(true)
    expect(useAccounts.getState().list.map((a) => a.id)).toEqual(['m1'])
    expect(restoreAccounts()).toBe(false)
  })
})
