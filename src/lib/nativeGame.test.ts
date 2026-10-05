import { describe, expect, test } from 'bun:test'
import { isNativeGame } from './nativeGame'

describe('isNativeGame', () => {
  const cases: Array<[{ version?: string | null; loader?: string | null } | null, boolean, string]> = [
    [{ version: 'native', loader: 'custom' }, true, 'the catalogue pair of a partner game must start on the Millida session, not as Minecraft'],
    [{ version: '1.20.1', loader: 'forge' }, false, 'an ordinary build keeps its Minecraft launch'],
    [{ version: 'native', loader: 'forge' }, false, 'only the exact pair the catalogue gives counts, a stray version string does not'],
    [{ version: '1.20.1', loader: 'custom' }, false, 'custom on a Minecraft version is not a native game'],
    [{ version: 'native' }, false, 'a build without a loader is vanilla'],
    [null, false, 'no build picked is not a native game'],
  ]
  for (const [build, want, why] of cases)
    test(JSON.stringify(build), () => {
      expect(isNativeGame(build), why).toBe(want)
    })
})
