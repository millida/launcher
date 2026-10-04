import { describe, expect, test } from 'bun:test'
import { appliedKey, pendingAdds, versionAtLeast } from './promoServers'

const anarchy = { name: 'Анархия MCRU', addr: 'mcru.me', minVersion: '1.21' }
const idle = () => false

describe('versionAtLeast', () => {
  const cases: Array<[string, string, boolean, string]> = [
    ['1.21.11', '1.21', true, 'the server version itself'],
    ['1.21', '1.21', true, 'the bare minor counts as its own line'],
    ['1.20.6', '1.21', false, 'an older client cannot join'],
    ['26.1', '1.21', true, 'the new year-based numbering is newer'],
    ['24w14a', '1.21', false, 'a snapshot is not promised to join'],
    ['1.7.10', '1.21', false, 'the OneBlock client stays clean'],
  ]
  for (const [v, min, want, why] of cases) test(why, () => expect(versionAtLeast(v, min), why).toBe(want))
})

describe('pendingAdds', () => {
  const builds = [
    { name: 'Fabric 1.21.11', version: '1.21.11' },
    { name: 'Старая 1.12', version: '1.12.2' },
    { name: 'OneBlock', version: '1.7.10' },
  ]

  test('the lever off adds nothing', () => {
    expect(pendingAdds(builds, [], new Set(), idle), 'an empty list must never touch a player build').toEqual([])
  })
  test('only builds that can join get the server', () => {
    expect(pendingAdds(builds, [anarchy], new Set(), idle).map((x) => x.profile), 'a 1.12 build would show an unjoinable server').toEqual(['Fabric 1.21.11'])
  })
  test('without a minimum every build gets it', () => {
    expect(pendingAdds(builds, [{ name: 'A', addr: 'mcru.me' }], new Set(), idle)).toHaveLength(3)
  })
  test('a server the player already got is not added again', () => {
    expect(pendingAdds(builds, [anarchy], new Set([appliedKey('Fabric 1.21.11', 'mcru.me')]), idle), 'a deleted entry must stay deleted').toEqual([])
  })
  test('a running build waits for the next pass', () => {
    expect(pendingAdds(builds, [anarchy], new Set(), (p) => p === 'Fabric 1.21.11'), 'the game overwrites servers.dat on its own').toEqual([])
  })
})
