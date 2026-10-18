import { describe, expect, it, mock } from 'bun:test'

let locale = 'en'
const asked: string[] = []
const stored: string[] = []

mock.module('../state/accounts', () => ({ getAccount: () => null }))
mock.module('../i18n', () => ({ getLocale: () => locale }))
mock.module('./idbCache', () => ({
  idbGet: async () => null,
  idbSet: async (key: string) => {
    stored.push(key)
  },
}))
mock.module('./api', () => ({
  hasMillidaAccount: () => false,
  api: async (path: string) => {
    asked.push(path)
    return { items: [{ id: 'HEDGEHOG', name: path.endsWith('lang=de') ? 'Igel' : 'Hedgehog', slot: 'PET', access: 'FREE' }] }
  },
}))

const { loadCosmeticCatalog } = await import('./gameProfile')

describe('the cosmetics catalog is asked in the interface language', () => {
  it('names come in the launcher language, and switching language never reuses the other copy', async () => {
    const en = await loadCosmeticCatalog()
    expect(asked, 'the store must name its language or the API answers in Russian').toEqual(['/cosmetics/catalog?lang=en'])
    expect(en.items[0]?.name).toBe('Hedgehog')

    await loadCosmeticCatalog()
    expect(asked.length, 'the same language is served from memory, not 1.5 MB again').toBe(1)

    locale = 'de'
    const de = await loadCosmeticCatalog()
    expect(asked[asked.length - 1], 'a German launcher must not keep showing the English copy').toBe('/cosmetics/catalog?lang=de')
    expect(de.items[0]?.name).toBe('Igel')
    expect(stored, 'each language keeps its own disk copy, or a restart shows the previous language').toEqual([
      'cosmetics-catalog-v1:en',
      'cosmetics-catalog-v1:de',
    ])
  })
})
