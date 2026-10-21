import { describe, expect, it, mock } from 'bun:test'

let locale = 'de'
const asked: string[] = []

Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
})
const real = await import('../i18n')
mock.module('../i18n', () => ({ ...real, getLocale: () => locale }))
globalThis.fetch = (async (url: string) => {
  asked.push(String(url))
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
}) as unknown as typeof fetch

const { catalog, CATALOG_API } = await import('./millidaCatalog')

describe('the catalog card, listing and install plan are asked in the interface language', () => {
  const cases: { why: string; lang: string; call: () => Promise<unknown>; want: string }[] = [
    { why: 'the project window reads title, summary and description from the card', lang: 'de', call: () => catalog.item('sodium'), want: '/items/sodium?lang=de' },
    { why: 'install toasts and the dependency list name projects from the plan', lang: 'pt-BR', call: () => catalog.resolve('sodium', '1.21.1', 'fabric'), want: '/items/sodium/resolve?gameVersion=1.21.1&loader=fabric&lang=pt-BR' },
    { why: 'listing cards carry summaries', lang: 'es', call: () => catalog.listing({ section: 'mods' }), want: '/listing?section=mods&perPage=24&lang=es' },
    { why: 'a Russian interface keeps the old addresses and their caches', lang: 'ru', call: () => catalog.item('sodium'), want: '/items/sodium' },
  ]
  for (const c of cases) {
    it(`${c.lang}: ${c.want}`, async () => {
      locale = c.lang
      await c.call()
      expect(asked[asked.length - 1], c.why).toBe(CATALOG_API + c.want)
    })
  }
})
