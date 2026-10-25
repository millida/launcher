import { describe, expect, test } from 'bun:test'
import { premiumBuildOf } from './premiumBuild'
import type { PremiumBuild } from './premiumBuild'
import { ARCANIA_POSTER } from '../components/arcania/content'

const CDN = 'https://cdn.millida.trade/catalog/launcher-packs/x/cover.webp'

describe('premiumBuildOf', () => {
  const cases: Array<[string, string | null, { cover?: string | null; accessRequired?: boolean } | null, boolean, PremiumBuild | null, string]> = [
    ['paid pack', 'oneblock', { cover: CDN, accessRequired: true }, false, { slug: 'oneblock', cover: CDN }, 'an install of a paid pack wears the premium frame with its catalogue cover'],
    ['free pack', 'free-pack', { cover: CDN, accessRequired: false }, true, null, 'a free catalogue build keeps the plain build card'],
    ['old API', 'old', { cover: CDN }, true, null, 'a card without the access flag must not turn a build gold'],
    ['own build', null, { cover: CDN, accessRequired: true }, true, null, 'a build not from the catalogue never borrows a pack look'],
    ['no card', 'arcania-2', null, true, null, 'an unreadable card leaves the build as it was'],
    ['arcania 2 live', 'arcania-2', { cover: CDN, accessRequired: true }, true, { slug: 'arcania-2', cover: ARCANIA_POSTER }, 'the released 2.0 shows its own art, not the catalogue cover'],
    ['arcania 2 held', 'arcania-2', { cover: CDN, accessRequired: true }, false, { slug: 'arcania-2', cover: CDN }, 'before the lever the 2.0 art stays hidden'],
    ['arcania 1.4', 'arcania', { cover: CDN, accessRequired: true }, true, { slug: 'arcania', cover: CDN }, 'the 1.4 install keeps its own catalogue cover'],
    ['no cover', 'paid', { cover: null, accessRequired: true }, false, { slug: 'paid', cover: null }, 'a paid pack without a cover still gets the frame and tag'],
  ]
  for (const [name, slug, view, live, want, why] of cases)
    test(name, () => {
      expect(premiumBuildOf(slug, view, live), why).toEqual(want)
    })
})
