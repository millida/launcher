import { describe, expect, test } from 'bun:test'
import type { MillidaPack } from '../../ipc/commands'
import { isRuPack, ruCard, translationIndex, translationOf } from './site'
import type { SiteCard } from './site'

const studio = { slug: 'arcania-labs', name: 'Arcania Labs' }

const pack = (slug: string, title: string, extra: Partial<MillidaPack> = {}): MillidaPack => ({
  slug,
  title,
  summary: 'Перевод на русский',
  cover: null,
  downloads: 10,
  game: '1.20.1',
  loader: 'forge',
  accessRequired: false,
  hasServer: false,
  partner: studio,
  ...extra,
})

const ru = [
  pack('cursed-walking', 'Cursed Walking - A Modern Zombie Apocalypse'),
  pack('life-in-the-village', 'Life in the village 4'),
  pack('whispers-in-the-void', 'Whispers in the Void - A Horror Adventure & Quests'),
  pack('over-stars', 'Over Stars'),
]

describe('translation of a listing card', () => {
  // (slug, title of the original card, expected translation slug, why this case is pinned)
  const cases: Array<[string, string, string | null, string]> = [
    ['cursed-walking-a-modern-zombie-apocalypse', 'Cursed Walking - A Modern Zombie Apocalypse', 'cursed-walking', 'the same project under the importer slug'],
    ['cursed-walking-lite-edition', 'Cursed Walking - Lite Edition', null, 'a different pack of the same author must keep its own card'],
    ['life-in-the-village-2', 'Life in the village', null, 'part 1 is not the translated part 4'],
    ['whispers-in-the-void-a-horror', 'Whispers in the Void - A Horror Adventure & Quests | Horror Mobs', 'whispers-in-the-void', 'the original carries a longer tagline'],
    ['over-stars-2', 'Over Stars для Minecraft', 'over-stars', 'an import duplicate with the site suffix'],
    ['over-stars', 'Over Stars', null, 'the translation itself is not its own original'],
  ]
  for (const [slug, title, want, why] of cases)
    test(slug, () => {
      expect(translationOf({ slug, title }, ru)?.slug ?? null, why).toBe(want)
    })
})

describe('which packs count as translations', () => {
  test('a studio pack that is not its own exclusive', () => {
    expect(isRuPack(pack('a', 'A'))).toBe(true)
    expect(isRuPack(pack('arcania', 'Arcania', { protectedContent: true })), 'Arcania is the exclusive, not a translation').toBe(false)
    expect(isRuPack(pack('immortal', 'Immortal', { partner: null })), 'packs without a studio are not translations').toBe(false)
  })
})

describe('translation card in place of the original', () => {
  const base: SiteCard = {
    slug: 'cursed-walking-a-modern-zombie-apocalypse',
    section: 'modpacks',
    title: 'Cursed Walking - A Modern Zombie Apocalypse',
    summary: 'English summary',
    cover: 'https://cdn.example/original.png',
    icon: 'https://cdn.example/icon.png',
    side: 'CLIENT',
    author: 'Cursed Team',
    downloads: 5,
    sourceDownloads: 900000,
    versions: ['1.19.2'],
    loaders: ['forge'],
    categories: ['zombies'],
    publishedAt: null,
    updatedAt: null,
  }
  const card = ruCard(ru[0]!, base)

  test('opens and installs our pack', () => {
    expect(card.slug).toBe('cursed-walking')
    expect(card.launcherOnly).toBe(true)
    expect(card.ru).toBe(true)
  })

  test('keeps what the original knows better', () => {
    expect(card.icon, 'our catalog has no square icon for the translation').toBe(base.icon)
    expect(card.categories).toEqual(['zombies'])
    expect(card.author, 'the original author still made the pack').toBe('Cursed Team')
    expect(card.sourceDownloads, 'popularity of the original stays visible').toBe(900000)
  })

  test('a free translation is not a paid partner pack', () => {
    expect(card.premium).toBeUndefined()
    expect(card.partner, 'a partner on a free pack would light the gold frame').toBeNull()
  })
})

describe('packs of a Russian author', () => {
  const mcs = pack('vortex', 'Vortex', { partner: null, author: 'MCSborki', summary: 'Сборка' })

  test('MCSborki counts as Russian, in any letter case', () => {
    expect(isRuPack(mcs)).toBe(true)
    expect(isRuPack({ ...mcs, author: ' mcsborki ' })).toBe(true)
  })

  test('an English pack of another author is not Russian', () => {
    expect(isRuPack(pack('jei', 'JEI', { partner: null, author: 'Someone' }))).toBe(false)
    expect(isRuPack(pack('jei', 'JEI', { partner: null, author: null }))).toBe(false)
  })

  test('no Arcania Labs attribution', () => {
    const card = ruCard(mcs)
    expect(card.ru).toBe(true)
    expect(card.ruBy, 'the mark must not name a studio').toBeUndefined()
    expect(card.partner).toBeNull()
    expect(card.author).toBe('MCSborki')
  })

  test('does not replace an original by title', () => {
    expect(translationIndex([])({ slug: 'vortex-2', title: 'Vortex' })).toBeUndefined()
  })
})
