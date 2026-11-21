import { useMemo } from 'react'
import type { ChestTier } from '../../lib/rubies'
import { useDaily } from '../../state/daily'
import { PLUS_PASS } from './chestDrops'
import { ADVENT_DAYS, seasonTotals } from './advent'
import { TRACK_DAYS } from './track'

export interface PlusPassView {
  /** Сундуки строки PLUS по уровням. */
  chests: Partial<Record<ChestTier, number>>
  /** Всего сундуков. */
  count: number
  /** Дней в сезоне: 28 у пропуска, 31 у календаря. */
  days: number
}

const fromConst = (): PlusPassView => ({
  chests: PLUS_PASS.chests,
  count: Object.values(PLUS_PASS.chests).reduce((a, b) => a + (b || 0), 0),
  days: TRACK_DAYS,
})

/**
 * Что обещает строка PLUS в этом сезоне. Плитка PLUS в магазине и значки
 * подписки берут числа отсюда: в декабре (календарь) служба шлёт свои итоги
 * (`season.totals.plus`: 3 редких, 4 эпических, 1 легендарный), в остальное время —
 * таблица пропуска (PLUS_PASS, копия SEASON_TRACK службы).
 */
export function usePlusPass(): PlusPassView {
  const season = useDaily((s) => s.status?.season ?? null)
  return useMemo(() => {
    const sent = seasonTotals(season, 'plus')
    if (!sent) return fromConst()
    const chests = sent.chests ?? {}
    return {
      chests,
      count: Object.values(chests).reduce((a, b) => a + (b || 0), 0),
      days: season?.kind === 'advent' ? ADVENT_DAYS : TRACK_DAYS,
    }
  }, [season])
}
