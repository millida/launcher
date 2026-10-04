import { afterEach, describe, expect, it } from 'bun:test'
import { cfProjectOf, cfSourceRef } from '../../lib/millidaCatalog'
import { resolveHit, sourceOf, type SiteCard } from './site'

describe('cfSourceRef', () => {
  const cases: { why: string; url: string; want: ReturnType<typeof cfSourceRef> }[] = [
    {
      why: 'a CurseForge modpack from the catalog must install in the launcher instead of bouncing to the site',
      url: 'https://www.curseforge.com/minecraft/modpacks/ciscos-adventure-rpg-ultimate',
      want: { classId: 4471, slug: 'ciscos-adventure-rpg-ultimate' },
    },
    {
      why: 'mods, packs and maps carry their own CurseForge class, a wrong class finds nothing',
      url: 'https://www.curseforge.com/minecraft/mc-mods/reactive-music',
      want: { classId: 6, slug: 'reactive-music' },
    },
    {
      why: 'a trailing path or query is not part of the slug',
      url: 'https://www.curseforge.com/minecraft/texture-packs/faithful-32x/files?page=2',
      want: { classId: 12, slug: 'faithful-32x' },
    },
    { why: 'maps are a class of their own', url: 'https://www.curseforge.com/minecraft/worlds/skyblock', want: { classId: 17, slug: 'skyblock' } },
    {
      why: 'a class the launcher cannot install stays on the site',
      url: 'https://www.curseforge.com/minecraft/bukkit-plugins/essentials',
      want: null,
    },
    { why: 'a Modrinth link is handled by the Modrinth path', url: 'https://modrinth.com/modpack/fps', want: null },
    { why: 'an item without a source has nothing to resolve', url: '', want: null },
  ]

  for (const c of cases) {
    it(c.why, () => {
      expect(cfSourceRef(c.url), `${c.url} resolved wrong: ${c.why}`).toEqual(c.want)
    })
  }
})

describe('cfProjectOf', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const cases: { why: string; item: { curseforgeId?: number | null; sourceUrl: string | null }; want: number | null; searches: number }[] = [
    {
      why: 'a stored id must not cost a CurseForge search: per-card searches exhausted the shared budget for everyone',
      item: { curseforgeId: 1082278, sourceUrl: 'https://www.curseforge.com/minecraft/modpacks/biohazard-project-genesis' },
      want: 1082278,
      searches: 0,
    },
    {
      why: 'an older backend without the id still resolves through the slug search',
      item: { sourceUrl: 'https://www.curseforge.com/minecraft/modpacks/biohazard-project-genesis' },
      want: 1082278,
      searches: 1,
    },
    { why: 'a Modrinth card has no CurseForge project', item: { curseforgeId: null, sourceUrl: 'https://modrinth.com/mod/sodium' }, want: null, searches: 0 },
  ]

  for (const c of cases) {
    it(c.why, async () => {
      let searches = 0
      globalThis.fetch = (async () => {
        searches++
        return new Response(JSON.stringify({ data: [{ id: 1082278, slug: 'biohazard-project-genesis' }] }))
      }) as unknown as typeof fetch
      expect(await cfProjectOf(c.item), c.why).toBe(c.want)
      expect(searches, `CurseForge searched ${searches} times: ${c.why}`).toBe(c.searches)
    })
  }
})

const card = (extra: Partial<SiteCard>): SiteCard => ({
  slug: 'sodium',
  section: 'mods',
  title: 'Sodium',
  summary: '',
  cover: null,
  icon: null,
  side: null,
  author: null,
  downloads: null,
  versions: [],
  loaders: [],
  categories: [],
  publishedAt: null,
  updatedAt: null,
  ...extra,
})

describe('sourceOf', () => {
  const cases: { why: string; extra: Partial<SiteCard>; want: ReturnType<typeof sourceOf> }[] = [
    { why: 'an older backend without the field still loads the full item', extra: {}, want: null },
    {
      why: 'a listing with the source spares the per-row item request',
      extra: { sourceUrl: 'https://modrinth.com/mod/sodium' },
      want: { sourceUrl: 'https://modrinth.com/mod/sodium', curseforgeId: null },
    },
    {
      why: 'a listed null source is an answer too: the item would say the same',
      extra: { sourceUrl: null, curseforgeId: null },
      want: { sourceUrl: null, curseforgeId: null },
    },
    {
      why: 'the stored CurseForge id travels with the source',
      extra: { sourceUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei', curseforgeId: 238222 },
      want: { sourceUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei', curseforgeId: 238222 },
    },
  ]
  for (const c of cases) {
    it(c.why, () => {
      expect(sourceOf(card(c.extra)), c.why).toEqual(c.want)
    })
  }
})

describe('resolveHit', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('does not ask /catalog/items when the listing carries the source', async () => {
    const asked: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      asked.push(url)
      return new Response(JSON.stringify([{ id: 'AANobbMI', slug: 'sodium' }]))
    }) as unknown as typeof fetch
    const hit = await resolveHit(card({ slug: 'sodium-listed', sourceUrl: 'https://modrinth.com/mod/sodium' }))
    expect(hit?.pid, 'the Modrinth project must still resolve from the listed source').toBe('AANobbMI')
    expect(asked.filter((u) => u.includes('/catalog/items/')), 'per-row item requests were 13% of all launcher API calls').toEqual([])
  })
})
