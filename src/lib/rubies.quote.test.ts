import { describe, expect, mock, test } from 'bun:test'

const asked: string[] = []
mock.module('./api', () => ({
  api: async (path: string) => {
    asked.push(path)
    const codes = decodeURIComponent(path.split('codes=')[1] ?? '').split(',')
    return { prices: Object.fromEntries(codes.map((c) => [c, c === 'GONE' ? null : c === 'ZERO' ? 0 : 270])) }
  },
}))

const { quoteWardrobe } = await import('./rubies')

describe('quoteWardrobe', () => {
  test('the price is the number the service quoted, in batches it accepts', async () => {
    asked.length = 0
    const many = Array.from({ length: 41 }, (_, i) => 'CAPE~c' + i)
    const got = await quoteWardrobe(['CAPE~red', 'CAPE~red', 'GONE', 'ZERO', ...many])
    expect(asked.length, 'the service takes at most 40 codes at once').toBe(2)
    expect(asked.every((p) => p.startsWith('/rubies/shop/quote?source=wardrobe&codes=')), 'always the wardrobe source').toBe(true)
    expect(got.get('CAPE~red'), 'the quoted number goes into expect as is').toBe(270)
    expect(got.get('GONE'), 'null: not on sale or already bought, nothing to offer').toBeNull()
    expect(got.get('ZERO'), 'a zero price is a data fault, never sold').toBeNull()
    expect(got.size, 'a repeated code is asked once').toBe(44)
  })

  test('a code with a tilde reaches the query encoded', async () => {
    asked.length = 0
    await quoteWardrobe(['A B~x'])
    expect(asked[0]).toBe('/rubies/shop/quote?source=wardrobe&codes=A%20B~x')
  })
})
