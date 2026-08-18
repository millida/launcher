import { describe, expect, test } from 'bun:test'

const store = new Map<string, string>()

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

const { launchAuthKind, useAccounts } = await import('./accounts')

const acc = (kind: string) => ({ id: 'a1', nick: 'Steve', kind })

describe('launchAuthKind', () => {
  const cases: Array<{ name: string; account: ReturnType<typeof acc> | null; millida: boolean; expect: string; why: string }> = [
    {
      name: 'offline account while signed into Millida',
      account: acc('offline'),
      millida: true,
      expect: 'offline',
      why: 'a Millida session overrides the launch nick with the site profile name, so the chosen offline nick never reaches the game',
    },
    { name: 'offline account without Millida', account: acc('offline'), millida: false, expect: 'offline', why: 'nothing else to use' },
    { name: 'millida account', account: acc('millida'), millida: true, expect: 'millida', why: 'our Yggdrasil session is what the account is for' },
    { name: 'telegram account', account: acc('tg'), millida: true, expect: 'millida', why: 'tg is a Millida login, not a separate nick' },
    {
      name: 'millida account without a session',
      account: acc('millida'),
      millida: false,
      expect: 'offline',
      why: 'no token to issue a session with',
    },
    { name: 'microsoft account', account: acc('microsoft'), millida: true, expect: 'microsoft', why: 'the licence wins over our session' },
    { name: 'no account at all', account: null, millida: true, expect: 'millida', why: 'nothing chose a nick, so the session may name one' },
  ]

  for (const c of cases)
    test(c.name, () => {
      expect(launchAuthKind(c.account, c.millida), c.why).toBe(c.expect as never)
    })
})

describe('single Millida row', () => {
  const reset = (list: unknown[], active = '') => {
    store.set('m-accounts', JSON.stringify(list))
    store.set('m-active', active)
    useAccounts.setState({ list: list as never, active })
  }

  test('second sign-in replaces the first', () => {
    reset([{ id: 'a1', nick: 'durov', kind: 'millida', balance: 5000 }], 'a1')
    const acc = useAccounts.getState().add({ nick: 'steve', kind: 'millida' })
    const list = useAccounts.getState().list
    expect(list.length, 'the launcher holds one Millida session, so a second row would show it twice').toBe(1)
    expect(list[0].nick, 'the row names whoever is signed in now').toBe('steve')
    expect(list[0].balance, "the previous user's balance must not follow the new login").toBeUndefined()
    expect(acc.id, 'the row keeps its id so the active account stays addressable').toBe('a1')
  })

  test('a tg row is the same slot as a millida row', () => {
    reset([{ id: 'a1', nick: 'durov', kind: 'tg' }], 'a1')
    useAccounts.getState().add({ nick: 'durov', kind: 'millida' })
    expect(useAccounts.getState().list.length, 'tg is the old name of the same Millida login').toBe(1)
  })

  test('a Microsoft row survives a Millida sign-in', () => {
    reset([{ id: 'm1', nick: 'qwseMC', kind: 'microsoft' }], 'm1')
    useAccounts.getState().add({ nick: 'durov', kind: 'millida' })
    const kinds = useAccounts.getState().list.map((a) => a.kind)
    expect(kinds, 'licence accounts carry their own tokens and are unrelated to the site session').toEqual(['microsoft', 'millida'])
  })

  test('duplicates written by older builds collapse on load', async () => {
    store.set(
      'm-accounts',
      JSON.stringify([
        { id: 'm1', nick: 'qwseMC', kind: 'microsoft' },
        { id: 'a1', nick: 'durov', kind: 'millida' },
        { id: 'a2', nick: 'durov', kind: 'millida' },
      ]),
    )
    store.set('m-active', 'a2')
    const { loadState } = await import('./accounts')
    const state = loadState()
    expect(state.list.map((a) => a.id), 'both rows point at the one live session; the active one is the truthful row').toEqual(['m1', 'a2'])
    expect(state.active, 'the surviving row stays active').toBe('a2')
  })
})
