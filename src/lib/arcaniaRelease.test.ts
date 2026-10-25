import { expect, test } from 'bun:test'
import { arcaniaLead, withoutArcaniaLegacy } from './arcaniaRelease'

const packs = [{ slug: 'arcania' }, { slug: 'arcania-2' }, { slug: 'chaoszproject' }, { id: 'arcania' }]

test.each([
  [true, ['arcania-2', 'chaoszproject'], 'with 2.0 out, 1.4.3 leaves every list by slug and by premium id'],
  [false, ['arcania', 'arcania-2', 'chaoszproject', 'arcania'], 'before the release nothing is hidden'],
] as const)('lists with lever %p', (live, want, why) => {
  expect(withoutArcaniaLegacy(packs, live).map((p) => p.slug ?? p.id), why).toEqual([...want])
})

test.each([
  [true, 'arcania-2', '2.0 leads the catalog once released'],
  [false, 'arcania', '1.4.3 keeps the lead until the lever turns on'],
] as const)('lead with lever %p', (live, want, why) => {
  expect(arcaniaLead(live), why).toBe(want)
})
