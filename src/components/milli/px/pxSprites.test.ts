import { describe, expect, it } from 'bun:test'
import { PX_ART, PX_CHIP_ORDER, PX_GLYPHS, PX_NAMES, pxSprite } from './pxSprites'
import { PX_EMPTY, PX_GRID, pxGlintRuns, pxRuns } from './pxTypes'

describe('пиксельные предметы Милли', () => {
  it('каждый рисунок 16×16 и только из символов своей палитры', () => {
    for (const name of PX_NAMES) {
      const art = PX_ART[name]
      expect([name, art.rows.length]).toEqual([name, PX_GRID])
      art.rows.forEach((row, y) => {
        expect([name, y, row.length]).toEqual([name, y, PX_GRID])
        const stray = [...row].filter((c) => c !== PX_EMPTY && !(c in art.pal))
        expect([name, y, stray.join('')]).toEqual([name, y, ''])
      })
    }
  })
  it('палитра — только #rrggbb, без прозрачного символа', () => {
    for (const name of PX_NAMES) {
      const pal = PX_ART[name].pal
      expect([name, PX_EMPTY in pal]).toEqual([name, false])
      for (const c of Object.values(pal)) expect([name, /^#[0-9a-f]{6}$/i.test(c)]).toEqual([name, true])
    }
  })
  it('блеск ссылается на символы палитры', () => {
    for (const name of PX_NAMES) {
      const g = (PX_ART[name] as { glint?: string }).glint
      if (!g || g === '*') continue
      for (const c of g) expect([name, c in PX_ART[name].pal]).toEqual([name, true])
      expect(pxGlintRuns(PX_ART[name]).length).toBeGreaterThan(0)
    }
  })
  it('отрезки не выходят за поле и не пустые', () => {
    for (const name of PX_NAMES) {
      const runs = pxRuns(PX_ART[name])
      expect(runs.length).toBeGreaterThan(8)
      for (const r of runs) expect(r.x >= 0 && r.w >= 1 && r.x + r.w <= PX_GRID && r.y >= 0 && r.y < PX_GRID).toBe(true)
    }
  })
  it('нужные имена на месте, неизвестное имя не падает', () => {
    for (const n of [...PX_CHIP_ORDER, 'paper_plane', 'barrier', 'clock', 'compass', 'book_quill', 'bell', 'crafting_table', 'painting', 'glowstone', 'hopper', 'player_head', 'xp_orb_0', 'xp_orb_1', 'xp_orb_2', 'xp_orb_3', 'nether_star', 'comparator', 'redstone_lamp_off', 'glowstone_dim', 'glowstone_bright', 'iron_ingot', 'gold_ingot', 'diamond', 'redstone', 'spyglass', 'chest', 'chest_large', 'ender_chest', 'shulker_box', 'torch', 'firework_star', 'redstone_lamp_on'])
      expect([n, pxSprite(n) !== null]).toEqual([n, true])
    expect(pxSprite('нет-такого')).toBeNull()
    expect(pxSprite('toString')).toBeNull()
  })
  it('глифы зачарования: 6 штук 5×7 из # и .', () => {
    expect(PX_GLYPHS.length).toBe(6)
    for (const g of PX_GLYPHS) {
      expect(g.length).toBe(7)
      for (const row of g) expect(/^[#.]{5}$/.test(row)).toBe(true)
    }
  })
})
