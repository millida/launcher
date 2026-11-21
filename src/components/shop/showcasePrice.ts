// Цена вещи на витрине магазина (зеркало службы) — только для демо магазина и тестов: в стартовый
// набор не попадает (chestDrops.ts лежит в стартовом чанке).
import { fragmentOff } from '../daily/chestDrops'

/** Цена со скидкой в процентах, до десятка рубинов. */
const pctOff = (price: number, pct: number) => Math.round((price * (100 - pct)) / 100 / 10) * 10

/** Скидка подписки PLUS/Diamond — последней, поверх дня и фрагментов; не меньше 10. */
export const subPrice = (price: number, pct: number) => (pct ? Math.max(10, pctOff(price, pct)) : price)

/**
 * Цена вещи на витрине (зеркало службы), порядок закреплён тестом: скидка дня от полной цены,
 * затем фрагменты (цена «дособрать»), затем подписка.
 */
export function showcasePrice(base: number, dayPct: number, have: number, need: number, subPct = 0): number {
  const shown = pctOff(base, dayPct)
  return subPrice(shown - fragmentOff(shown, have, need), subPct)
}
