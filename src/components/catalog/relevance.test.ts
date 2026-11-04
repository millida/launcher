import { expect, test } from 'bun:test'
import { byRelevance, pinsLead } from './siteStore'
test("релевантность: точное и с начала названия — выше, иначе порядок сервера", () => {
  const mk = (title: string) => ({ slug: title, title } as never)
  const r = byRelevance([mk('JEI Integration'), mk('Just Enough Items (JEI)'), mk('jei'), mk('Fabric JEI addon'), mk('ObjeIx')], 'jei')
  expect(r.map((x: { title: string }) => x.title)).toEqual(['jei', 'JEI Integration', 'Just Enough Items (JEI)', 'Fabric JEI addon', 'ObjeIx'])
})

const pinCases: Array<[Parameters<typeof pinsLead>[0], boolean, string]> = [
  ['recommended', true, 'the catalogue opens with Arcania first'],
  ['relevance', true, '«arcania» in the search found only Arcania Origins: 2.0 lives among the paid packs, not in the listing'],
  ['popular', false, 'an explicit sort keeps the server order'],
  ['new', false, 'new first means new first'],
]
for (const [sort, pinned, why] of pinCases) test('Arcania pinned under ' + sort, () => expect(pinsLead(sort), why).toBe(pinned))
