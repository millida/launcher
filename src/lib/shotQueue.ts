/** Порядок очереди снимков (outfitSnapshot): видимые плитки — первыми. */

/** На экране сейчас: 0 — видна, 1 — рядом (до полэкрана), 2 — далеко или не знаем. */
export function shotRank(el: Element | null | undefined, vh = typeof window === 'undefined' ? 0 : window.innerHeight): number {
  if (!el || !el.isConnected) return 2
  const r = el.getBoundingClientRect()
  if (!r.width && !r.height) return 2
  if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < (typeof window === 'undefined' ? 0 : window.innerWidth)) return 0
  return r.bottom > -vh / 2 && r.top < vh * 1.5 ? 1 : 2
}

/** Индекс следующей работы: самая видимая, при равенстве — раньше попросившая. */
export function pickJob(list: { at: number; rank: number }[]): number {
  let best = -1
  for (let i = 0; i < list.length; i++) {
    const j = list[i]!
    const b = best < 0 ? null : list[best]!
    if (!b || j.rank < b.rank || (j.rank === b.rank && j.at < b.at)) best = i
  }
  return best
}
