import { describe, expect, test } from 'bun:test'
import { CHEST_DROPS, CHEST_ODDS, demoOpen, fragmentOff, FRAGMENTS_NEED, ODDS_TOTAL, RARITY_ORDER, TIER_ORDER, viewOf } from './chestDrops'
import type { ChestOpenResult } from '../../lib/rubies'

const legacy: ChestOpenResult = {
  chestId: 'c1',
  tier: 'RARE',
  rarity: 'EPIC',
  item: { code: 'X', name: 'Крылья', slot: 'WINGS', previewUrl: null },
  duplicate: true,
  rubies: 336,
  pity: false,
  proof: { serverSeedHash: 'h', clientSeed: 's', nonce: 1, rolledValue: 0.4 },
}

describe('таблица сундуков', () => {
  // v3.1 (24.09.2026): одна строка шансов на все сундуки, в базисных пунктах;
  // выпадает любая редкость, верх держат шансы.
  test('шансы каждого уровня — ровно 10 000 базисных пунктов, у каждой редкости свой шанс', () => {
    for (const t of TIER_ORDER) {
      expect(RARITY_ORDER.reduce((n, r) => n + CHEST_ODDS[t][r], 0)).toBe(ODDS_TOTAL)
      for (const r of RARITY_ORDER) expect(CHEST_ODDS[t][r]).toBeGreaterThan(0)
      expect(CHEST_ODDS[t]).toEqual(CHEST_ODDS.COMMON)
    }
  })
  test('фрагменты: редкая вещь собирается дольше, скидка не больше половины', () => {
    let prev = 0
    for (const r of RARITY_ORDER) {
      expect(FRAGMENTS_NEED[r]).toBeGreaterThan(prev)
      prev = FRAGMENTS_NEED[r]
    }
    expect(fragmentOff(900, 7, 20)).toBe(150)
    expect(fragmentOff(900, 40, 20)).toBe(450)
  })
  test('удары 3–5, уровень выше — не меньше вещей и осколков', () => {
    let prev = CHEST_DROPS.COMMON
    for (const t of TIER_ORDER) {
      const d = CHEST_DROPS[t]
      expect(d.hits).toBeGreaterThanOrEqual(3)
      expect(d.hits).toBeLessThanOrEqual(5)
      expect(d.items).toBeGreaterThanOrEqual(prev.items)
      expect(d.shards[0]).toBeGreaterThanOrEqual(prev.shards[0])
      prev = d
    }
  })
})

describe('viewOf', () => {
  test('старая служба: одна вещь, повтор рубинами, удары по уровню', () => {
    const v = viewOf(legacy)
    expect(v.hits).toBe(CHEST_DROPS.RARE.hits)
    expect(v.drops).toHaveLength(1)
    expect(v.drops[0]).toMatchObject({ kind: 'ITEM', rarity: 'EPIC', duplicate: true, rubies: 336 })
    expect(v.top).toBe('EPIC')
  })
  test('модель v2: фрагменты тоже поднимают свет до своей редкости', () => {
    const v = viewOf({ ...legacy, hits: 4, drops: [{ kind: 'FRAGMENTS', rarity: 'EPIC', item: null, amount: 5, have: 0, need: 40, completed: false, shards: 25 }] })
    expect(v.top).toBe('EPIC')
  })
  test('новая служба: берёт hits и drops как есть', () => {
    const v = viewOf({ ...legacy, hits: 5, drops: [{ kind: 'SHARDS', amount: 40 }, { kind: 'ITEM', rarity: 'RARE', item: null, duplicate: false, shards: 0 }] })
    expect(v.hits).toBe(5)
    expect(v.drops).toHaveLength(2)
    expect(v.top).toBe('RARE')
  })
  test('неизвестный уровень — как обычный', () => {
    expect(viewOf({ ...legacy, tier: 'MEGA' as never }).tier).toBe('COMMON')
  })
})

describe('demoOpen', () => {
  test('слоты вещей и бонус осколков по таблице уровня; прогресс не больше нужного', () => {
    for (const t of TIER_ORDER)
      for (let i = 0; i < 50; i++) {
        const r = demoOpen('d', t)
        const slots = r.drops!.filter((d) => d.kind === 'FRAGMENTS' || d.kind === 'ITEM')
        for (const d of slots) if (d.kind === 'FRAGMENTS') {
          expect(d.have).toBeLessThanOrEqual(d.need)
          expect(d.completed).toBe(d.have === d.need)
        }
        const bonus = r.drops!.find((d) => d.kind === 'SHARDS') as { amount: number }
        expect(slots).toHaveLength(CHEST_DROPS[t].items)
        expect(bonus.amount).toBeGreaterThanOrEqual(CHEST_DROPS[t].shards[0])
        expect(bonus.amount).toBeLessThanOrEqual(CHEST_DROPS[t].shards[1])
      }
  })
})
