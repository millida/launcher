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

const { launchAuthKind } = await import('./accounts')

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
