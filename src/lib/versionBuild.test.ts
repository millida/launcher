import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FPS_MODS, stableFile } from './versionBuild'

const CORE = readFileSync(new URL('../../src-tauri/src/engine/game/fpsboost.rs', import.meta.url), 'utf8')

function coreSet(name: string): string[] {
  const body = CORE.match(new RegExp('const ' + name + ': &\\[Slot\\] = &\\[([\\s\\S]*?)\\n\\];'))
  if (!body) throw new Error(name + ' not found in fpsboost.rs')
  return body[1]!
    .split('\n')
    .map((line) => line.match(/(?:install: )?&\["([a-z0-9-]+)"/))
    .flatMap((m) => (m ? [m[1]!] : []))
}

describe('FPS mods of a version build', () => {
  const cases: [keyof typeof FPS_MODS, string, string][] = [
    ['fabric', 'FABRIC_SET', 'the version page lists exactly what the core installs on Fabric'],
    ['forge', 'FORGE_SET', 'pre-1.14 versions run on Forge: the page must promise the Forge set, not the Fabric one'],
  ]
  for (const [loader, set, why] of cases)
    test(loader + ' matches the core', () => {
      expect(FPS_MODS[loader], why).toEqual(coreSet(set))
    })

  test('the pinned sets', () => {
    expect(FPS_MODS.fabric).toEqual([
      'sodium',
      'lithium',
      'ferrite-core',
      'entityculling',
      'immediatelyfast',
      'modernfix',
      'dynamic-fps',
      'moreculling',
    ])
    expect(FPS_MODS.forge).toEqual(['embeddium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'dynamic-fps'])
  })
})

describe('stableFile', () => {
  const f = (version_type: string, n: string) => ({ version_type, version_number: n })
  const cases: [ReturnType<typeof f>[], string | null, string][] = [
    [[f('alpha', 'a'), f('release', 'r')], 'r', 'a newer alpha never beats a release: alphas of Sodium ports crash builds'],
    [[f('alpha', 'a'), f('beta', 'b')], 'b', 'beta is the fallback when a version has no release yet'],
    [[f('alpha', 'a')], null, 'alpha only: the page must not promise a mod the core will skip'],
    [[], null, 'nothing for the version'],
  ]
  for (const [files, want, why] of cases)
    test(why, () => {
      expect(stableFile(files)?.version_number ?? null).toBe(want)
    })
})
