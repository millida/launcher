import { describe, expect, it } from 'bun:test'
import { ENCHANT_GLYPHS, MC_ITEMS } from './milliItems'

describe('предметы Милли', () => {
  it('каждый рисунок 16×16 и не выходит за поле', () => {
    for (const [name, art] of Object.entries(MC_ITEMS)) {
      expect([name, art.size]).toEqual([name, 16])
      for (const p of [...art.px, ...(art.glow ?? [])]) {
        expect(p.x >= 0 && p.y >= 0 && p.x + p.w <= 16 && p.y < 16).toBe(true)
      }
      expect(art.px.length).toBeGreaterThan(8)
    }
  })
  it('блеск только у зачарованной книги', () => {
    expect(MC_ITEMS.ebook.glint?.length).toBeGreaterThan(10)
    expect(MC_ITEMS.book.glint).toBeUndefined()
  })
  it('глифы зачарования 5×5', () => {
    for (const g of ENCHANT_GLYPHS) {
      expect(g.length).toBe(5)
      for (const r of g) expect(r.length).toBe(5)
    }
  })
})
