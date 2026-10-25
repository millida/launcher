import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EXTRA_LOCALES, EXTRA_LOCALES_PUBLIC, type Locale } from '../../i18n/locales'
import { BOSSES, CAST, HEAD, NEWS, STATS } from './content'
import { KIND_WORDS, REGION, SINGLE, WORLD_POINTS } from './world-map'

const PUBLIC: Locale[] = ['en', ...(EXTRA_LOCALES_PUBLIC ? EXTRA_LOCALES : [])]
const table = (code: Locale): Record<string, string> =>
  JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'i18n', 'locales', code + '.json'), 'utf8')) as Record<string, string>

const lists: Array<[string, string[]]> = [
  ['HEAD.lead', [HEAD.lead]],
  ['CAST roles', CAST.flatMap((c) => ('role' in c ? [c.role] : []))],
  ['NEWS', NEWS.flatMap((n) => [n.title, n.text])],
  ['STATS', STATS.map((s) => s.label)],
  ['BOSSES', BOSSES.map((b) => b.name)],
  ['SINGLE', Object.values(SINGLE)],
  ['REGION', Object.values(REGION)],
  ['KIND_WORDS', Object.values(KIND_WORDS).flat()],
  ['WORLD_POINTS', WORLD_POINTS.map((p) => p.t)],
]

describe('Arcania 2.0 page texts kept in data constants have translations', () => {
  test('the lists see the data they guard', () => {
    expect(lists.find(([name]) => name === 'WORLD_POINTS')![1].length, 'the place list came back empty: this test would pass while checking nothing').toBeGreaterThan(50)
  })
  for (const code of PUBLIC)
    test(code, () => {
      const own = table(code)
      const missing = lists.flatMap(([name, list]) => list.filter((key) => /[А-Яа-яЁё]/.test(key) && !own[key]).map((key) => `${name}: ${key}`))
      expect(missing, `${code}.json lacks Arcania page texts, so a ${code} player reads them in Russian. Add them to every public table.`).toEqual([])
    })
})
