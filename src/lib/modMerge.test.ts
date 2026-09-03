import { expect, test } from 'bun:test'
import { mergeSources, modKey } from './modMerge'

const hit = (title: string, dl = 1, slug?: string) => ({ title, dl, slug })

// two titles -> same project? The reported case is first: with the source set
// to "all" the list showed one entry from Modrinth and a second from
// CurseForge for the very same mod.
const KEYS: [string, string, boolean, string][] = [
  ['Sodium', 'Sodium (Fabric)', true, 'CurseForge appends the loader in brackets'],
  ['Jade', 'Jade 🔍', true, 'decoration in the title is not a different mod'],
  ['JEI', 'JEI  ', true, 'trailing spaces'],
  ['Just Enough Items', 'Just Enough Items (JEI)', true, 'expanded name in brackets'],
  ['Iris Shaders', 'Iris', false, 'different names stay different mods'],
  ['Sodium', 'Sodium Extra', false, 'an addon is not its host mod'],
  ['Create', 'Create: Steam n Rails', false, 'addon with a prefix stays separate'],
]

test('titles of the same project collapse to one key', () => {
  for (const [a, b, want, why] of KEYS) {
    expect(modKey(hit(a)) === modKey(hit(b)), why).toBe(want)
  }
})

test('a Modrinth entry wins over its CurseForge twin', () => {
  const merged = mergeSources([hit('Sodium', 10)], [hit('Sodium (Fabric)', 99)])
  expect(merged.length).toBe(1)
  expect(merged[0].title).toBe('Sodium')
})

test('the next page does not repeat what the list already shows', () => {
  const shown = [hit('Sodium', 10), hit('Iris', 9)]
  const merged = mergeSources([hit('Create', 8)], [hit('Sodium (Fabric)', 99), hit('Iris (Fabric)', 50)], shown)
  expect(merged.map((h) => h.title)).toEqual(['Create'])
})

test('duplicates inside one source collapse too', () => {
  const merged = mergeSources([hit('Sodium', 10)], [hit('Sodium', 5), hit('Sodium (Forge)', 4)])
  expect(merged.length).toBe(1)
})

test('sorting stays by downloads', () => {
  const merged = mergeSources([hit('A', 1), hit('B', 30)], [hit('C', 20)])
  expect(merged.map((h) => h.title)).toEqual(['B', 'C', 'A'])
})

// Reported 03.09.2026: a search for «vanilla like» showed RLCraft and ATM10,
// because a 30M-download pack outranks the pack the player actually typed for.
test('a search orders by the query, not by downloads', () => {
  const merged = mergeSources(
    [hit('Vanilla Like Experience', 265), hit('Vanilla But I Like It', 400)],
    [hit('RLCraft', 30_000_000), hit('All the Mods 10', 21_000_000)],
    [],
    'vanilla like',
  )
  expect(merged.map((h) => h.title)).toEqual([
    'Vanilla Like Experience',
    'Vanilla But I Like It',
    'RLCraft',
    'All the Mods 10',
  ])
})

test('an empty query keeps the download order', () => {
  const merged = mergeSources([hit('A', 1), hit('B', 30)], [hit('C', 20)], [], '   ')
  expect(merged.map((h) => h.title)).toEqual(['B', 'C', 'A'])
})

test('a title that normalises to nothing falls back to the slug', () => {
  expect(modKey(hit('(Fabric)', 1, 'shiny-mod'))).toBe('shiny-mod')
})
