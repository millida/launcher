import { describe, expect, test } from 'bun:test'
import { mixTogether } from './PlayTogether'
import type { SiteCard } from '../catalog/site'

const card = (slug: string, categories: string[] = []): SiteCard => ({
  slug,
  section: null,
  title: slug,
  summary: '',
  cover: null,
  icon: null,
  side: null,
  author: null,
  downloads: 0,
  versions: [],
  loaders: [],
  categories,
  publishedAt: null,
  updatedAt: null,
})

describe('«Играть вдвоём» — как на millida.net/katalog', () => {
  test('по очереди из подборок, без повторов, оптимизации и чужих OneBlock', () => {
    const packs = [{ section: 'modpacks' as const, card: card('adv1') }, { section: 'modpacks' as const, card: card('fps', ['оптимизация']) }, { section: 'modpacks' as const, card: card('create-oneblock') }, { section: 'modpacks' as const, card: card('adv2') }]
    const horror = [{ section: 'maps' as const, card: card('h1') }, { section: 'maps' as const, card: card('h2') }]
    const parkour = [{ section: 'maps' as const, card: card('h1') }, { section: 'maps' as const, card: card('k1') }]
    expect(mixTogether([packs, horror, parkour]).map((p) => p.section + '/' + p.card.slug)).toEqual(['modpacks/adv1', 'maps/h1', 'maps/h2', 'maps/k1', 'modpacks/adv2'])
  })

  test('два ряда — не больше десяти', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ section: 'maps' as const, card: card('m' + i) }))
    expect(mixTogether([many])).toHaveLength(10)
  })
})
