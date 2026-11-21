import type { DailyCellState, DailySeason, SeasonRowTotals } from '../../lib/rubies'
import type { DailyView, PassCol, Row, TrackCol } from './track'

/* ============================================================
   НОВОГОДНИЙ КАЛЕНДАРЬ (декабрь 2026, решения владельца 14.11.2026)
   ------------------------------------------------------------
   Вместо пропуска на 28 клеток в декабре — календарь на 31 день, строки
   обычная и PLUS. Включает и выключает служба: сезон `kind: 'advent'`
   приходит с 01.12 по 31.12 (МСК), 1 января — снова обычный пропуск, без
   релиза лаунчера.
   - Клетка N открывается N декабря и забирается только в этот день. Пропущенный
     день сгорает (`missed`), забрать его потом нельзя.
   - 31-я клетка строки — эксклюзивная вещь — открывается, только если в этой
     строке забраны все 30 дней до неё. Иначе служба шлёт её `missed`.
   - Сюрприз: содержимое незабранной клетки служба не шлёт (`free: []`,
     `plus: []`), оно приходит в ответе «Забрать» (`granted`) и дальше лежит в
     забранной клетке. Таблицы наград в лаунчере нет и быть не должно: дерево
     уходит в публичный репозиторий. Таблица и тест сумм — в службе
     (docs/ADVENT.md).
   ============================================================ */

/** Клеток в календаре. */
export const ADVENT_DAYS = 31

/** МСК — UTC+3 круглый год. */
const MSK_MS = 3 * 3_600_000

/** Сезон пришёл календарём. */
export const isAdvent = (status: DailyView | null | undefined): boolean => status?.season?.kind === 'advent'

/**
 * Дата клетки N по МСК (полдень, чтобы день недели не съехал по поясу).
 * Начало — `startsAt` службы, иначе 1 декабря года, в котором кончается сезон.
 */
export function adventDate(season: Pick<DailySeason, 'startsAt' | 'endsAt'> | null | undefined, n: number): Date {
  const start = season?.startsAt ? Date.parse(season.startsAt) : NaN
  if (Number.isFinite(start)) {
    const msk = new Date(start + MSK_MS)
    return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + n - 1, 12))
  }
  const end = season?.endsAt ? Date.parse(season.endsAt) - 1 : NaN
  const year = Number.isFinite(end) ? new Date(end + MSK_MS).getUTCFullYear() : new Date().getUTCFullYear()
  return new Date(Date.UTC(year, 11, n, 12))
}

/** Суббота или воскресенье: на выходные крупные награды, клетка — с золотой подложкой. */
export function adventWeekend(season: Pick<DailySeason, 'startsAt' | 'endsAt'> | null | undefined, n: number): boolean {
  const wd = adventDate(season, n).getUTCDay()
  return wd === 0 || wd === 6
}

/**
 * Клетки календаря с состояниями. Состояние присылает служба; без него (или
 * `locked` у того, кто только что купил PLUS и ответ ещё старый) — по дню:
 * прошлое сгорело, сегодня открыто, дальше закрыто. 31-я по догадке не
 * открывается никогда: цепочку 30 дней знает только служба.
 */
export function adventCols(status: DailyView, own: boolean): PassCol[] {
  const src = status.track ?? []
  const today = status.season?.day ?? 0
  const guess = (n: number): DailyCellState =>
    n > today ? 'future' : n < today ? 'missed' : n === ADVENT_DAYS ? 'missed' : 'ready'
  return Array.from({ length: Math.max(ADVENT_DAYS, src.length) }, (_, i): PassCol => {
    const n = i + 1
    const d = src[i]
    const freeState = d?.freeState && d.freeState !== 'locked' ? d.freeState : guess(n)
    const plusRaw = d?.plusState && d.plusState !== 'locked' ? d.plusState : guess(n)
    const col: TrackCol = {
      n,
      cycleDay: n,
      cycle: 0,
      // Незабранное служба не раскрывает; если вдруг прислала — всё равно не показываем.
      free: freeState === 'claimed' ? (d?.free ?? []) : [],
      plus: plusRaw === 'claimed' ? (d?.plus ?? []) : [],
      forecast: !d,
    }
    // Без подписки строка PLUS под замком, но сгоревшее и забранное остаются как есть.
    const plusState: DailyCellState = own || plusRaw === 'claimed' || plusRaw === 'missed' ? plusRaw : 'locked'
    return { ...col, freeState, plusState }
  })
}

/** Сколько клеток строки забрано и цела ли цепочка к 31-й (все 30 до неё забраны или ещё впереди). */
export function adventChain(cols: PassCol[], row: Row): { got: number; intact: boolean } {
  let got = 0
  let intact = true
  for (const c of cols) {
    if (c.n >= ADVENT_DAYS) break
    const s = row === 'free' ? c.freeState : c.plusState
    if (s === 'claimed') got++
    else if (s === 'missed') intact = false
  }
  return { got, intact }
}

/** Итоги строки за сезон от службы (содержимое клеток спрятано, считать по ним нельзя). */
export const seasonTotals = (season: DailySeason | null | undefined, row: Row): SeasonRowTotals | null =>
  season?.totals?.[row] ?? null
