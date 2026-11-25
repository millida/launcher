// Честный онлайн рейтинга: та же логика, что у millida.net/rating (lib/online-honest-mode.ts сайта).
export type OnlineHonestMode = 'suspect' | 'verified' | 'plain'

export interface OnlineHonestInput {
  online: number
  real?: number | null
  suspect?: boolean
  verified?: boolean
  approx?: boolean
}

/** Зачёркиваем, только когда есть чем заменить: оценка ниже заявленного и не нулевая. */
export function onlineHonestMode(p: OnlineHonestInput): OnlineHonestMode {
  if (p.approx) return 'plain'
  if (p.suspect && typeof p.real === 'number' && p.real > 0 && p.real < p.online) return 'suspect'
  if (p.verified && !p.suspect) return 'verified'
  return 'plain'
}

/** Игроков на самом деле: у накрученного онлайна — оценка, у остальных — число из пинга. */
export function honestOnline(s: { online?: number; onlineReal?: number | null; onlineSuspect?: boolean }): number {
  const online = s.online ?? 0
  return s.onlineSuspect && typeof s.onlineReal === 'number' ? Math.min(online, s.onlineReal) : online
}
