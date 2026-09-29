import { expect, test } from 'bun:test'

import { pickPackVersion } from './modpackVersion'
import type { MrPackVersion } from './modpackVersion'

const pack = (id: string, game: string[], file = 'pack.mrpack'): MrPackVersion => ({ id, game_versions: game, files: [{ filename: file }] })

const LIST: MrPackVersion[] = [
  pack('newest', ['1.21.8']),
  pack('src-only', ['1.21.4'], 'pack.zip'),
  pack('fo-1214-b', ['1.21.4']),
  pack('fo-1214-a', ['1.21.4']),
  pack('multi', ['1.20.1', '1.20.2']),
]

const CASES: { game: string; want: string | null; why: string }[] = [
  { game: '1.21.4', want: 'fo-1214-b', why: 'the filtered version must win over the newest release of the pack' },
  { game: '1.21.8', want: 'newest', why: 'the newest release is still picked when it matches the filter' },
  { game: '1.20.2', want: 'multi', why: 'a release listing several game versions matches any of them' },
  { game: '1.19.2', want: null, why: 'no silent fallback to the newest release when the pack lacks that version' },
]

for (const c of CASES)
  test('pickPackVersion ' + c.game, () => {
    expect(pickPackVersion(LIST, c.game), c.why).toBe(c.want)
  })

test('pickPackVersion skips releases without an .mrpack file', () => {
  expect(pickPackVersion([pack('src-only', ['1.21.4'], 'pack.zip')], '1.21.4'), 'a release without .mrpack cannot be installed').toBeNull()
})
