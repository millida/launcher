import { describe, expect, test } from 'bun:test'
import { librariesLast, looksLikeLibrary } from './similar'
import type { SiteCard } from './site'

const card = (title: string, summary = '', categories: string[] = []) => ({ slug: title, title, summary, categories }) as unknown as SiteCard

describe('libraries in «Рекомендуемые»', () => {
  test('libraries are recognised by title, summary or category', () => {
    expect(looksLikeLibrary(card('Placebo', 'A library mod'))).toBe(true)
    expect(looksLikeLibrary(card('Fabric API'))).toBe(true)
    expect(looksLikeLibrary(card('FTB Library (NeoForge)'))).toBe(true)
    expect(looksLikeLibrary(card('GeckoLib'))).toBe(true)
    expect(looksLikeLibrary(card('Something', '', ['библиотеки']))).toBe(true)
  })
  test('ordinary mods are not libraries', () => {
    expect(looksLikeLibrary(card('Just Enough Items (JEI)', 'View Items and Recipes'))).toBe(false)
    expect(looksLikeLibrary(card('Sodium', 'A high-performance rendering engine'))).toBe(false)
    expect(looksLikeLibrary(card('Sophisticated Backpacks', 'Yet another backpack mod'))).toBe(false)
  })
  test('libraries move to the end, the rest keeps its order', () => {
    const l = librariesLast([card('JEI'), card('Placebo', 'A library mod'), card('Sodium'), card('Fabric API'), card('Create')])
    expect(l.map((c) => c.title)).toEqual(['JEI', 'Sodium', 'Create', 'Placebo', 'Fabric API'])
  })
})
