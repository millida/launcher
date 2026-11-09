import { expect, test } from 'bun:test'
import type { MillidaPack } from '../../ipc/commands'
import type { SiteCard } from './site'
import { paidSearchHits } from './siteStore'

const pack = (slug: string, title: string, summary = ''): MillidaPack =>
  ({ slug, title, summary, game: '1.21.1', loader: 'neoforge', accessRequired: true, downloads: 0 }) as unknown as MillidaPack
const card = (slug: string): SiteCard => ({ slug, title: slug }) as unknown as SiteCard
const NO_FILTERS = { version: null, loader: null, category: null }

const cases: Array<[SiteCard[], MillidaPack[], string, string[], string]> = [
  [[card('tlou')], [pack('abonent', 'Абонент')], 'абонент', ['abonent', 'tlou'], 'a paid pack the site search never returns is found by its Russian title'],
  [[card('tlou')], [pack('abonent', 'Абонент', 'Новая хоррор-сборка')], 'хоррор', ['abonent', 'tlou'], 'the summary counts as well as the title'],
  [[card('tlou')], [pack('abonent', 'Абонент')], 'immortal', ['tlou'], 'a query that names no paid pack leaves the page as it was'],
  [[card('arcania-2'), card('tlou')], [pack('arcania-2', 'Arcania 2.0')], 'arcania', ['arcania-2', 'tlou'], 'a pack already on the page is not shown twice'],
]

for (const [page, premium, q, want, why] of cases)
  test(why, () => {
    expect(paidSearchHits(page, premium, NO_FILTERS, q).map((c) => c.slug), why).toEqual(want)
  })
