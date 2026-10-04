import { describe, expect, test } from 'bun:test'
import { weave, weaveMarkdown } from './weave'
import type { WeaveKind } from './weave'

const kind = (s: string): WeaveKind => (s.startsWith('#') ? 'head' : s.startsWith('img:') ? 'media' : 'text')
const shot = (u: string) => 'img:' + u
const run = (items: string[], shots: string[]) => weave(items, shots, kind, shot)

const cases: Array<[string[], string[], string[], string]> = [
  [['a', 'b', 'c', 'd', 'e'], ['1', '2'], ['a', 'b', 'img:1', 'c', 'd', 'img:2', 'e'], 'a shot after every second paragraph keeps the wall of text broken up'],
  [['a', 'b'], ['1'], ['a', 'b'], 'a shot never ends the description: it would hang under the text as a stray tail'],
  [['a', '# h', 'b', 'c'], ['1'], ['a', '# h', 'b', 'img:1', 'c'], 'a heading is not a paragraph: a picture must not split a heading from its text'],
  [['a', 'b', 'img:own', 'c', 'd', 'e'], ['1'], ['a', 'b', 'img:own', 'c', 'd', 'e'], 'the author placed pictures himself, our gallery must not reorder his layout'],
  [['a', 'b', 'c'], [], ['a', 'b', 'c'], 'no gallery means the description stays as written'],
  [Array.from({ length: 20 }, (_, i) => 't' + i), ['1', '2', '3', '4', '5', '6'], [], 'long descriptions are capped at four shots'],
]

describe('weave shots into description', () => {
  for (const [items, shots, want, why] of cases)
    test(why, () => {
      const got = run(items, shots)
      if (want.length) expect(got, why).toEqual(want)
      else expect(got.filter((x) => x.startsWith('img:')).length, why).toBe(4)
    })
})

describe('weave markdown', () => {
  test('paragraphs split by blank lines take shots between them', () => {
    expect(weaveMarkdown('one\n\ntwo\n\nthree', ['https://x/1.png']), 'the image must land between paragraphs as markdown').toBe(
      'one\n\ntwo\n\n![](https://x/1.png)\n\nthree',
    )
  })
  test('html body is left untouched', () => {
    const body = '<p>one</p>\n\n<p>two</p>\n\n<p>three</p>'
    expect(weaveMarkdown(body, ['https://x/1.png']), 'splitting html by blank lines can cut inside a tag').toBe(body)
  })
  test('markdown with its own image is left untouched', () => {
    const body = 'one\n\n![](https://own.png)\n\ntwo\n\nthree'
    expect(weaveMarkdown(body, ['https://x/1.png']), 'the author already illustrated the text').toBe(body)
  })
})
