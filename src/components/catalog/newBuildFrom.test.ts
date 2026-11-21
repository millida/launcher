import { expect, test } from 'bun:test'
import type { ModHit } from '../../state/mods'
import { planFor } from './newBuildFrom'

const hit = (gameVers: string[], loaders: string[]): ModHit => ({ gameVers, loaders }) as ModHit

test('a new build from a catalog tile never lands on a loader that has no build for the game version', () => {
  const cases: [ModHit, string, { version: string; loader: string } | null, string][] = [
    [hit(['1.21.1'], ['fabric', 'forge']), 'mod', { version: '1.21.1', loader: 'fabric' }, 'Fabric stays first where it exists'],
    [hit(['1.8.9'], ['fabric', 'forge']), 'mod', { version: '1.8.9', loader: 'forge' }, 'Fabric has no 1.8.9: the build would end in a bare 502'],
    [hit(['1.12.2'], ['fabric']), 'mod', null, 'no loader of the tile fits 1.12.2, so no button rather than a broken build'],
    [hit(['1.12.2'], ['quilt', 'forge']), 'mod', { version: '1.12.2', loader: 'forge' }, 'Quilt shares the 1.14 floor with Fabric'],
    [hit(['1.8.9'], []), 'shader', null, 'a shader needs Iris on Fabric, which 1.8.9 does not have'],
    [hit(['1.20.1'], []), 'shader', { version: '1.20.1', loader: 'fabric' }, 'a shader on a Fabric version still gets its build'],
  ]
  for (const [h, kind, want, why] of cases) expect(planFor(h, kind), why).toEqual(want)
})
