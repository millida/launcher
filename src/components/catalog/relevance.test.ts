import { expect, test } from 'bun:test'
import { byRelevance } from './siteStore'
test("релевантность: точное и с начала названия — выше, иначе порядок сервера", () => {
  const mk = (title: string) => ({ slug: title, title } as never)
  const r = byRelevance([mk('JEI Integration'), mk('Just Enough Items (JEI)'), mk('jei'), mk('Fabric JEI addon'), mk('ObjeIx')], 'jei')
  expect(r.map((x: { title: string }) => x.title)).toEqual(['jei', 'JEI Integration', 'Just Enough Items (JEI)', 'Fabric JEI addon', 'ObjeIx'])
})
