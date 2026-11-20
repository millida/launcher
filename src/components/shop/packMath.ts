import type { ShopPack } from '../../lib/rubies'

/** Арт разового оффера «Второй шаг»: сундук среднего размера. */
export const SECOND_ART = '/packs/casket.png'
/** Арт предложения месяца: казна. */
export const MONTH_ART = '/packs/vault.png'

/**
 * Рисунки пакетов от малого к большому. Кодов у сервера меняется число, поэтому
 * рисунок берётся по месту пакета в ряду, а не по коду: при 10 пакетах соседи
 * делят один рисунок, раскладка не ломается.
 */
const ART_ORDER = ['handful', 'pouch', 'purse', 'casket', 'chests', 'hoard', 'trove', 'treasury', 'vault']
export const packArtAt = (i: number, n: number): string => '/packs/' + ART_ORDER[n < 2 ? 0 : Math.round((i * (ART_ORDER.length - 1)) / (n - 1))] + '.png'

/** Пакеты по цене и код самого выгодного (рубин дешевле всех по живым ценам). */
export function sortPacks<P extends ShopPack>(packs: P[]): { list: P[]; best: string } {
  const list = [...packs].sort((x, y) => x.kopecks - y.kopecks)
  const best = list.reduce(
    (win, pack) => (pack.kopecks > 0 && pack.rubies / pack.kopecks > win.rate ? { code: pack.code, rate: pack.rubies / pack.kopecks } : win),
    { code: '', rate: 0 },
  ).code
  return { list, best }
}

/**
 * Значок выгоды «+N%». Служба считает его сама (packs, monthOffer); у разовых
 * офферов без своего badgePct считаем от самого дешёвого обычного пакета —
 * той же точки отсчёта, что и служба.
 */
export function offerPct(rubies: number, kopecks: number, packs: ShopPack[], given?: number): number {
  if (given !== undefined) return given
  const base = packs.filter((p) => !p.oneTime && p.kopecks > 0 && p.rubies > 0)
  if (!base.length || kopecks <= 0 || rubies <= 0) return 0
  const baseRate = Math.min(...base.map((p) => p.rubies / p.kopecks))
  return Math.max(0, Math.round((rubies / kopecks / baseRate - 1) * 100))
}
