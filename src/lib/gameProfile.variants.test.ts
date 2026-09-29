import { describe, expect, it, mock } from 'bun:test'

mock.module('../state/accounts', () => ({ getAccount: () => null }))
mock.module('./api', () => ({ api: async () => null, hasMillidaAccount: () => false }))

const { expandCatalog } = await import('./gameProfile')

const earmuffs = {
  id: 'EARMUFFS',
  name: 'Наушники',
  slot: 'HAT',
  access: 'PURCHASE',
  preview: 'previews/EARMUFFS.png',
  variants: [
    { name: 'black', color: '000000' },
    { name: 'pink', color: 'FF9AE6', preview: 'previews/EARMUFFS~pink.png' },
    { name: 'white', color: 'FFFFFF' },
  ],
}

describe('превью вещи-расцветки', () => {
  const cards = expandCatalog([earmuffs])
  const cases: [string, string, string | undefined, string][] = [
    ['EARMUFFS~black', 'previews/EARMUFFS.png', undefined, 'базовая расцветка и есть превью вещи'],
    ['EARMUFFS~pink', 'previews/EARMUFFS~pink.png', undefined, 'чёрную базу тоном в розовый не перекрасить: своё превью без перекраски'],
    ['EARMUFFS~white', 'previews/EARMUFFS.png', 'FFFFFF', 'без своего превью карточка по-прежнему перекрашивает превью вещи'],
  ]
  for (const [id, preview, tint, why] of cases) {
    it(id + ': ' + why, () => {
      const card = cards.find((c) => c.id === id)
      expect(card?.preview).toBe(preview)
      expect(card?.tint).toBe(tint)
    })
  }
})
