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

const { gameStepDue } = await import('./firstRun')

describe('game account step after a Millida sign-in', () => {
  const cases: Array<{ name: string; returning: boolean; state: string; hasGame: boolean; expect: boolean; why: string }> = [
    { name: 'new player, first sign-in', returning: false, state: '', hasGame: false, expect: true, why: 'a new player must pick a licence or an offline nick: the Millida login is no longer a game account for them' },
    { name: 'player who signed in before', returning: true, state: '', hasGame: false, expect: false, why: 'existing Millida game accounts keep working untouched' },
    { name: 'step left unfinished, signing in again', returning: true, state: 'game', hasGame: false, expect: true, why: 'the earlier sign-in marked the player as returning, but they never got a game account' },
    { name: 'already has a game account', returning: false, state: '', hasGame: true, expect: false, why: 'signing in from the shop or assistant must not ask again' },
    { name: 'first run finished', returning: false, state: '1', hasGame: false, expect: false, why: 'the player went through the first run already' },
    { name: 'unfinished step but an account appeared', returning: false, state: 'game', hasGame: true, expect: false, why: 'the account is what the step asks for' },
  ]
  for (const c of cases)
    test(c.name, () => {
      expect(gameStepDue({ returning: c.returning, state: c.state, hasGame: c.hasGame }), c.why).toBe(c.expect)
    })
})
