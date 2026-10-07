import { describe, expect, test } from 'bun:test'
import { cues } from './caseSound'

const evs = (c: ReturnType<typeof cues>) => c.map((x) => x.ev)

describe('открытие сундука: событие → звук Minecraft', () => {
  test('появление — низкий стук дерева (тряска)', () => {
    const c = cues({ t: 'rumble' })
    expect(evs(c)).toEqual(['chest_hit', 'chest_hit', 'chest_hit'])
    expect(c.every((x) => x.rate < 0.7)).toBe(true)
  })
  test('каждый удар выше предыдущего; последний трескается', () => {
    const a = cues({ t: 'hit', i: 0, last: false })
    const b = cues({ t: 'hit', i: 1, last: false })
    const z = cues({ t: 'hit', i: 2, last: true })
    expect(evs(a)).toEqual(['chest_hit'])
    expect(b[0]!.rate).toBeGreaterThan(a[0]!.rate)
    expect(evs(b)).toContain('chest_crack')
    expect(evs(z).filter((e) => e === 'chest_crack').length).toBe(2)
  })
  test('взрыв крышки: фейерверк и скрип сундука сразу', () => {
    const c = cues({ t: 'burst' })
    expect(evs(c)).toEqual(['case_burst', 'chest_open', 'chest_card'])
    expect(c[0]!.at).toBe(0)
  })
  test('ленты больше нет: событий щелчков не существует', () => {
    // @ts-expect-error — событие 'tick' удалено вместе с рулеткой (06.10.2026)
    expect(() => cues({ t: 'tick', p: 0 })).not.toThrow()
    // @ts-expect-error — см. выше
    expect(cues({ t: 'tick', p: 0 })).toBeUndefined()
  })
  test('валюта звенит: рубины — золото, осколки — аметист', () => {
    expect(evs(cues({ t: 'reveal', kind: 'rubies' }))).toEqual(['chest_card', 'chest_gold', 'chest_gold'])
    expect(evs(cues({ t: 'reveal', kind: 'shards' }))).toEqual(['chest_rare', 'chest_card'])
  })
  test('вещь — по редкости: эпик = испытание, легенда и выше = новый уровень', () => {
    expect(evs(cues({ t: 'reveal', kind: 'item', rarity: 'COMMON' }))).toEqual(['chest_card'])
    expect(evs(cues({ t: 'reveal', kind: 'item', rarity: 'RARE' }))).toEqual(['chest_rare'])
    expect(evs(cues({ t: 'reveal', kind: 'item', rarity: 'EPIC' }))[0]).toBe('chest_epic')
    for (const r of ['LEGENDARY', 'MYTHIC', 'RELIC'] as const) expect(evs(cues({ t: 'reveal', kind: 'item', rarity: r }))[0]).toBe('achievement')
  })
  test('подъём редкости: каждая ступень выше, с эпической — испытание', () => {
    const a = cues({ t: 'up', rarity: 'UNCOMMON' })
    const b = cues({ t: 'up', rarity: 'RARE' })
    expect(b[0]!.rate).toBeGreaterThan(a[0]!.rate)
    expect(evs(cues({ t: 'up', rarity: 'EPIC' }))).toContain('chest_epic')
  })
  test('×10: карта щёлкает, лучшая — фанфары', () => {
    expect(evs(cues({ t: 'flip', rarity: 'COMMON' }))).toEqual(['chest_card'])
    expect(evs(cues({ t: 'best', rarity: 'LEGENDARY' }))).toContain('achievement')
  })
})
