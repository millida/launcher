import { describe, expect, test } from 'bun:test'
import { noCosmeticsIn } from './ModHint'
import type { MillidaModState } from '../../ipc/commands'

const state = (installed: string, available: string): MillidaModState => ({
  installed,
  available,
  version: '',
  loader: 'fabric',
  game_version: '1.21.11',
  reason: '',
  enabled: true,
})

describe('the wardrobe warns only about a build that cannot carry the mod', () => {
  const cases: Array<[MillidaModState | null, boolean, string]> = [
    [null, false, 'an unknown state is not a reason to alarm the player'],
    [state('a.jar', 'a.jar'), false, 'the mod is in place'],
    [state('', 'a.jar'), false, 'the launch installs it by itself'],
    [state('old.jar', ''), false, 'a jar in the build is still there to answer'],
    [state('', ''), true, 'vanilla or no variant: the items cannot reach this game'],
  ]
  for (const [input, want, why] of cases) test(why, () => expect(noCosmeticsIn(input)).toBe(want))
})
