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

const { launchAuthKind, pinnedOfflineNick, retireElyby, useAccounts } = await import('./accounts')

const acc = (kind: string) => ({ id: 'a1', nick: 'Steve', kind })

describe('launchAuthKind', () => {
  const cases: Array<{ name: string; account: ReturnType<typeof acc> | null; millida: boolean; expect: string; why: string }> = [
    {
      name: 'offline account while signed into Millida',
      account: acc('offline'),
      millida: true,
      expect: 'offline',
      why: 'without a known profile name the session could rename the player, so the chosen offline nick stays plain offline',
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
    {
      name: 'leftover ely.by row while signed into Millida',
      account: acc('elyby'),
      millida: true,
      expect: 'offline',
      why: 'Ely.by sign-in is removed; a row that slipped past the load migration must still keep its own nick instead of taking the Millida profile name',
    },
    { name: 'no account at all', account: null, millida: true, expect: 'millida', why: 'nothing chose a nick, so the session may name one' },
  ]

  for (const c of cases)
    test(c.name, () => {
      expect(launchAuthKind(c.account, c.millida), c.why).toBe(c.expect as never)
    })
})

describe('launchAuthKind for an offline account next to a Millida login', () => {
  const cases: Array<{ name: string; nick: string; millida: boolean; profile: string; expect: string; why: string }> = [
    {
      name: 'nick equals the Millida profile name',
      nick: 'Steve',
      millida: true,
      profile: 'Steve',
      expect: 'millida',
      why: 'servers with Millida sign-in only admit a player with our session; the name and the offline UUID stay the same, so nothing changes for offline servers',
    },
    {
      name: 'another nick',
      nick: 'Alex',
      millida: true,
      profile: 'Steve',
      expect: 'offline',
      why: 'the session would rename the player to the profile name and move them to another UUID, the chosen nick must reach the game',
    },
    {
      name: 'same nick in another case',
      nick: 'steve',
      millida: true,
      profile: 'Steve',
      expect: 'offline',
      why: 'the offline UUID hashes the exact spelling, a session for Steve would give steve a different UUID than offline play',
    },
    {
      name: 'profile name not known yet',
      nick: 'Steve',
      millida: true,
      profile: '',
      expect: 'offline',
      why: 'without the profile name there is no proof the session keeps the nick',
    },
    {
      name: 'no Millida login',
      nick: 'Steve',
      millida: false,
      profile: 'Steve',
      expect: 'offline',
      why: 'a cached profile name without a session token cannot issue a game session',
    },
  ]

  for (const c of cases)
    test(c.name, () => {
      expect(launchAuthKind({ id: 'a1', nick: c.nick, kind: 'offline' }, c.millida, false, c.profile), c.why).toBe(c.expect as never)
    })

  test('a licence never takes the Millida session because of a matching nick', () => {
    expect(launchAuthKind({ id: 'a1', nick: 'Steve', kind: 'microsoft' }, true, false, 'Steve'), 'the Mojang session is what licensed servers check').toBe('microsoft')
  })
})

describe('pinnedOfflineNick', () => {
  const cases: Array<{ millida: boolean; profile: string; expect: string; why: string }> = [
    { millida: true, profile: 'Steve', expect: 'Steve', why: 'signed in: the new offline account is created under the profile name the account holds' },
    { millida: false, profile: 'Steve', expect: '', why: 'signed out: a stale cached name must not lock the field' },
    { millida: true, profile: '', expect: '', why: 'the name has not arrived yet, the player may type one' },
    { millida: true, profile: 'Стив', expect: '', why: 'a name Minecraft rejects as an offline nick must not be forced into the field' },
    { millida: true, profile: 'a_very_long_name_17', expect: '', why: 'longer than 16 characters is not a valid nick' },
  ]
  for (const c of cases)
    test(`${c.millida ? 'signed in' : 'signed out'} as "${c.profile}"`, () => {
      expect(pinnedOfflineNick(c.millida, c.profile), c.why).toBe(c.expect)
    })
})

describe('launchAuthKind on a Millida-only server', () => {
  const cases: Array<{ name: string; account: ReturnType<typeof acc> | null; millida: boolean; expect: string; why: string }> = [
    {
      name: 'microsoft account',
      account: acc('microsoft'),
      millida: true,
      expect: 'millida',
      why: 'OneBlock checks hasJoined on our Yggdrasil: a licence session is never found there and the player is kicked',
    },
    {
      name: 'offline account',
      account: acc('offline'),
      millida: true,
      expect: 'millida',
      why: 'an offline nick has no session at all, the gate turns it away too',
    },
    { name: 'millida account', account: acc('millida'), millida: true, expect: 'millida', why: 'already the right session' },
    {
      name: 'microsoft account without a Millida session',
      account: acc('microsoft'),
      millida: false,
      expect: 'offline',
      why: 'not millida, so the launch stops and asks to sign in instead of starting a game that cannot join',
    },
  ]

  for (const c of cases)
    test(c.name, () => {
      expect(launchAuthKind(c.account, c.millida, true), c.why).toBe(c.expect as never)
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

describe('retired Ely.by rows', () => {
  const row = (id: string, nick: string, kind: string) => ({ id, nick, kind })
  const cases: Array<{ name: string; list: ReturnType<typeof row>[]; active: string; want: string[]; active2: string; why: string }> = [
    {
      name: 'ely.by row becomes an offline nick',
      list: [row('e1', 'Alex', 'elyby')],
      active: 'e1',
      want: ['e1:offline:Alex'],
      active2: 'e1',
      why: 'the player keeps the nick they played under and Play keeps working without a session the core no longer handles',
    },
    {
      name: 'ely.by row with an offline twin is dropped',
      list: [row('o1', 'Alex', 'offline'), row('e1', 'Alex', 'elyby')],
      active: 'e1',
      want: ['o1:offline:Alex'],
      active2: 'o1',
      why: 'two identical offline rows read as a bug, and the active pointer must move to the survivor instead of dangling',
    },
    {
      name: 'other kinds are untouched',
      list: [row('m1', 'Steve', 'microsoft'), row('a1', 'durov', 'millida')],
      active: 'a1',
      want: ['m1:microsoft:Steve', 'a1:millida:durov'],
      active2: 'a1',
      why: 'the migration must not rewrite live licence or Millida rows',
    },
  ]
  for (const c of cases)
    test(c.name, () => {
      const out = retireElyby(c.list, c.active)
      expect(out.list.map((a) => a.id + ':' + a.kind + ':' + a.nick), c.why).toEqual(c.want)
      expect(out.active, c.why).toBe(c.active2)
    })

  test('ely.by row is migrated on load', async () => {
    store.set('m-accounts', JSON.stringify([{ id: 'e1', nick: 'Alex', kind: 'elyby', uuid: 'ffc8fdc95824509e8a57c99b940fb996' }]))
    store.set('m-active', 'e1')
    const { loadState } = await import('./accounts')
    const state = loadState()
    expect(state.list, 'the stored Ely.by uuid must not follow an offline nick into the game').toEqual([{ id: 'e1', nick: 'Alex', kind: 'offline', avatar: undefined, avatarFrom: undefined }])
    expect(JSON.parse(store.get('m-accounts') || '[]')[0].kind, 'the migration is written back so it runs once').toBe('offline')
  })
})

describe('guest rows from earlier versions', () => {
  test('a guest row is dropped on load and the removal is written back', async () => {
    store.set('m-accounts', JSON.stringify([{ id: 'g1', nick: 'Player6548', kind: 'guest' }, { id: 'o1', nick: 'Alex', kind: 'offline' }]))
    store.set('m-active', 'g1')
    const { loadState } = await import('./accounts')
    const state = loadState()
    expect(state.list.map((a) => a.kind), 'guest mode is gone: without a Millida sign-in nobody gets into the launcher').toEqual(['offline'])
    expect(JSON.parse(store.get('m-accounts') || '[]').length, 'the migration is written back so it runs once').toBe(1)
  })
})
