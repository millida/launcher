import type { CaseConsolation } from '../../lib/rubies'

/** Утешительные призы одной строкой: по виду — от и до («20–80 осколков»). */
export function prizeRanges(list: Pick<CaseConsolation, 'kind' | 'min' | 'max'>[]): { kind: CaseConsolation['kind']; min: number; max: number }[] {
  const out: { kind: CaseConsolation['kind']; min: number; max: number }[] = []
  for (const c of list) {
    const row = out.find((r) => r.kind === c.kind)
    if (row) {
      row.min = Math.min(row.min, c.min)
      row.max = Math.max(row.max, c.max)
    } else out.push({ kind: c.kind, min: c.min, max: c.max })
  }
  return out
}

/**
 * Валюта, которая вылетает из сундука на карточке ящика: утешительные призы и
 * бонус открытия — по две суммы на вид (нижняя и верхняя граница), без нулей.
 */
export function caseCoins(view: { consolation?: Pick<CaseConsolation, 'kind' | 'min' | 'max'>[]; bonus?: { kind: 'shards' | 'rubies'; min: number; max: number }[] }): { kind: 'shards' | 'rubies'; amount: number }[] {
  const lanes = prizeRanges([...(view.consolation ?? []), ...(view.bonus ?? [])]).map((r) =>
    (r.max > r.min ? [r.max, r.min] : [r.max]).filter((n) => n > 0).map((amount) => ({ kind: r.kind, amount })),
  )
  // Виды по очереди: рубины, осколки, рубины… — не две кучки одного вида подряд.
  const out: { kind: 'shards' | 'rubies'; amount: number }[] = []
  for (let i = 0; lanes.some((l) => l[i]); i++) for (const l of lanes) if (l[i]) out.push(l[i]!)
  return out
}
