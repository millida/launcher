import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { FPS_MODS, fpsTopUpAllowed, stableFile } from './versionBuild'

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
      'fast-ip-ping',
    ])
    expect(FPS_MODS.forge).toEqual(['embeddium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'dynamic-fps', 'fast-ip-ping'])
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

describe('new revision of the FPS set', () => {
  const cases: [boolean, { fresh: boolean } | null, boolean, string][] = [
    [true, { fresh: true }, true, 'a build the game has never started takes the new set'],
    [true, { fresh: false }, false, 'a played build is not changed silently'],
    [true, null, false, 'no answer about the build: treated as played'],
    [false, { fresh: true }, false, 'nothing new to bring'],
  ]
  for (const [stale, gfx, want, why] of cases) test(why, () => expect(fpsTopUpAllowed({ stale }, gfx)).toBe(want))
})

describe('fpsMods when Modrinth does not answer', () => {
  test('a hung request gives up and a failed answer is not kept for the session', async () => {
    const { fpsMods } = await import('./versionBuild')
    const real = globalThis.fetch
    let asked = 0
    // A connection that never answers: only the abort signal can end it.
    globalThis.fetch = ((_: unknown, init?: { signal?: AbortSignal }) => {
      asked += 1
      return new Promise((_ok, fail) => init?.signal?.addEventListener('abort', () => fail(new Error('aborted'))))
    }) as typeof fetch
    const realTimeout = globalThis.setTimeout
    // The 8 s wait runs at once here: the point is that it ends, not how long it is.
    globalThis.setTimeout = ((fn: () => void) => realTimeout(fn, 0)) as typeof setTimeout
    try {
      expect(await fpsMods('1.20.1')).toBeNull()
      const first = asked
      expect(first).toBeGreaterThan(0)
      await new Promise((r) => realTimeout(r, 0))
      expect(await fpsMods('1.20.1')).toBeNull()
      expect(asked, 'Modrinth is asked again, not answered from a cached failure').toBeGreaterThan(first)
    } finally {
      globalThis.fetch = real
      globalThis.setTimeout = realTimeout
    }
  })
})

describe('one preparation per build', () => {
  test('Play after a cancel joins the preparation still running instead of starting a second one', async () => {
    const { sharedPreparation } = await import('./versionBuild')
    let runs = 0
    let finish: (name: string) => void = () => undefined
    const work = () => {
      runs += 1
      return new Promise<string | null>((ok) => {
        finish = ok
      })
    }
    const first = sharedPreparation('Minecraft 1.20.1', work)
    const second = sharedPreparation('Minecraft 1.20.1', work)
    expect(runs, 'two runs would write the mods of one build at the same time').toBe(1)
    finish('Minecraft 1.20.1')
    expect(await first).toBe('Minecraft 1.20.1')
    expect(await second).toBe('Minecraft 1.20.1')
    const later = sharedPreparation('Minecraft 1.20.1', work)
    expect(runs, 'a finished preparation does not block the next launch').toBe(2)
    finish('Minecraft 1.20.1')
    await later
  })
  test('another build prepares on its own', async () => {
    const { sharedPreparation } = await import('./versionBuild')
    let runs = 0
    const work = async () => {
      runs += 1
      return 'x'
    }
    await Promise.all([sharedPreparation('Minecraft 1.8.9', work), sharedPreparation('Millida PvP 1.8.9', work)])
    expect(runs).toBe(2)
  })
})
