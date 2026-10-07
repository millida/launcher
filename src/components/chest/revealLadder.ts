import type { CaseOpenView, CaseReward, Rarity } from '../../lib/rubies'
import { RARITY_ORDER, rarityRank } from '../shop/rarity'

/**
 * Рост редкости на глазах (как Starr Drops, 08-гарант-x10-флоу.md п. 3): сундук
 * встаёт на пол своего ящика и по ударам поднимается ровно до той редкости,
 * что уже решил сервер. Выше итога не показываем, вниз не откатываем.
 */

/** Ступени от пола до итога включительно. Итог ниже пола или не вещь — одна ступень, пол. */
export function revealLadder(floor: Rarity, final?: Rarity): Rarity[] {
  const from = Math.max(0, RARITY_ORDER.indexOf(floor))
  const to = final ? RARITY_ORDER.indexOf(final) : -1
  if (to <= from) return [RARITY_ORDER[from]!]
  return RARITY_ORDER.slice(from, to + 1)
}

/**
 * Ступень после удара `hit` (1…need): подъёмы приходятся на последние удары,
 * последний удар — всегда итог. Если ступеней больше, чем ударов, первый удар
 * поднимает сразу на несколько.
 */
export function ladderAt(ladder: Rarity[], hit: number, need: number): number {
  const top = ladder.length - 1
  if (hit <= 0) return 0
  return Math.max(0, Math.min(top, top - (need - hit)))
}

/** Итог, до которого растёт сундук: главная вещь (не дешёвая вещь промаха); у ×10 — лучшая вещь десятки. */
export function finalRarity(opens: CaseOpenView[]): Rarity | undefined {
  let best: Rarity | undefined
  for (const o of opens) {
    const r = o.kind === 'item' ? (o.rarity ?? o.rewards[0]?.item?.rarity) : undefined
    if (r && (!best || rarityRank(r) > rarityRank(best))) best = r
  }
  return best
}

/** Один ящик из старого ответа (только награды): главная — первая. */
export function openOfRewards(rewards: CaseReward[]): CaseOpenView {
  const main = rewards[0]
  const kind = main?.kind === 'item' || main?.kind === 'cheap' || main?.kind === 'rubies' || main?.kind === 'shards' ? main.kind : 'item'
  return { rewards, kind, rarity: main?.item?.rarity, top: false }
}

/** Порядок карт ×10: лучшая вещь — последней (её открывают с фанфарами), остальные как пришли. */
export function dealOrder(opens: CaseOpenView[]): number[] {
  const idx = opens.map((_, i) => i)
  let best = -1
  let rank = -1
  opens.forEach((o, i) => {
    const r = o.kind === 'item' ? rarityRank(o.rarity ?? o.rewards[0]?.item?.rarity) : -1
    if (r > rank) {
      rank = r
      best = i
    }
  })
  if (best < 0) return idx
  return [...idx.filter((i) => i !== best), best]
}
