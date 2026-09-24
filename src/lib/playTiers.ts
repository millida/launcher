/**
 * Ступени наигранного времени — как трофеи в Brawl Stars: растут и никогда
 * не отнимаются (разбор лобби 23.09.2026). Считаются только от часов,
 * которые лаунчер и так ведёт.
 */
export const PLAY_TIERS_H = [1, 10, 50, 100, 250, 500, 1000, 2500, 5000]

export interface PlayTier {
  /** Сколько ступеней уже взято (0 — ни одной). */
  reached: number
  /** Следующая ступень в часах; null — взяты все. */
  next: number | null
  /** Путь от прошлой ступени к следующей, 0…1. */
  progress: number
}

export function playTier(seconds: number): PlayTier {
  const h = Math.max(0, seconds) / 3600
  const reached = PLAY_TIERS_H.filter((t) => h >= t).length
  const next = PLAY_TIERS_H[reached] ?? null
  const from = reached ? PLAY_TIERS_H[reached - 1] : 0
  return { reached, next, progress: next ? Math.min(1, (h - from) / (next - from)) : 1 }
}
