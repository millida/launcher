import { expect, test } from 'bun:test'
import { hostingPackFor } from './data'
import type { HostingPack } from './data'

const pack = (key: string, name: string, launcherSlug: string | null = null): HostingPack => ({
  key,
  name,
  core: 'fabric',
  version: '1.20.1',
  minRamMb: 8192,
  paidOnly: true,
  requireKey: false,
  launcherSlug,
})

const LIST: HostingPack[] = [
  pack('arcania', 'Arcania', 'arcania'),
  pack('lost-souls', 'Lost Souls'),
  pack('dotg', 'Dominion over the Gods'),
]

const CASES: { why: string; slug: string | null; title: string; want: string | null }[] = [
  { why: 'the bound catalog card finds its own server pack', slug: 'arcania', title: 'Arcania 1.4.3', want: 'arcania' },
  { why: 'Arcania 2.0 must not be sold a 1.4 server on another game version', slug: 'arcania-2', title: 'Arcania 2.0', want: null },
  { why: 'catalog slug collision suffix still finds an unbound pack', slug: 'lost-souls-2', title: 'Lost Souls', want: 'lost-souls' },
  { why: 'initials of an unbound pack name still match', slug: 'dotg', title: 'Dominion', want: 'dotg' },
  { why: 'title fallback must not reach a bound pack', slug: null, title: 'Arcania 2.0', want: null },
]

for (const c of CASES)
  test(c.why, () => {
    const got = hostingPackFor({ slug: c.slug, title: c.title }, LIST)
    expect(got?.key ?? null, `${c.slug ?? c.title}: ${c.why}`).toBe(c.want)
  })
