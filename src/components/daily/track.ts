import type {
  ChestTier,
  DailyCellState,
  DailySeason,
  DailyStatus,
  DailyTrackDay,
  Rarity,
  Reward,
} from '../../lib/rubies'
import { word } from '../shop/rarity'
import { DAILY_CONFIG } from './config'

export type CycleDay = DailyStatus['cycle'][number]

/** Ответ службы плюс поле, которого старая служба ещё не шлёт. */
export type DailyView = DailyStatus & {
  /** ISO-время, когда откроется следующий сундук. Нет — считаем по UTC. */
  nextAt?: string | null
}

export interface TrackDay {
  day: number
  base: CycleDay
  bonus: CycleDay
}

const scale = (value: number | undefined, k: number) => (value === undefined ? undefined : Math.round(value * k))

/**
 * Служба отдаёт подписчику цикл уже помноженным, поэтому обычная строка
 * восстанавливается делением обратно, а строка PLUS — это то, что множитель
 * добавляет сверху. Логика та же, что в магазине (shop/DailyBonus.tsx).
 */
export function trackDays(status: DailyView | null): TrackDay[] {
  if (!status) return []
  const times = status.plusMultiplier ?? DAILY_CONFIG.plusMultiplierFallback
  const toBase = status.plus ? 1 / times : 1
  return (status.cycle ?? []).map((day) => {
    const base = {
      ...day,
      rubiesMin: scale(day.rubiesMin, toBase),
      rubiesMax: scale(day.rubiesMax, toBase),
      rubies: scale(day.rubies, toBase),
    }
    const bonus = {
      ...base,
      chest: null,
      rubiesMin: scale(base.rubiesMin, times - 1),
      rubiesMax: scale(base.rubiesMax, times - 1),
      rubies: scale(base.rubies, times - 1),
    }
    return { day: day.day, base, bonus }
  })
}

/** «20–40» или «30»; пусто, когда день рубинов не даёт. */
export function rubiesText(day: { rubiesMin?: number; rubiesMax?: number; rubies?: number }): string {
  const low = day.rubiesMin ?? day.rubies ?? 0
  const high = day.rubiesMax ?? day.rubies ?? 0
  if (!low && !high) return ''
  return low === high ? String(low) : low + '–' + high
}

export function rubiesLabel(n: number): string {
  return n + ' ' + word(n)
}

export type DayState = 'got' | 'now' | 'next' | ''

export function dayState(status: DailyView | null, day: number): DayState {
  if (!status) return ''
  const at = status.cycleDay === day
  if (status.cycleDay > day || (at && status.claimedToday)) return 'got'
  if (at) return 'now'
  return status.cycleDay + 1 === day ? 'next' : ''
}

/** Когда откроется следующая клетка: поле сезона, поле службы или ближайшая полночь UTC. */
export function nextResetAt(status: DailyView | null, now = Date.now()): number {
  const season = status?.season?.nextUnlockAt ? Date.parse(status.season.nextUnlockAt) : NaN
  if (Number.isFinite(season) && season > now) return season
  const fromServer = status?.nextAt ? Date.parse(status.nextAt) : NaN
  if (Number.isFinite(fromServer) && fromServer > now) return fromServer
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** «5:04:09» — часы без ведущего нуля, минуты и секунды с ним. */
export function timerText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return Math.floor(s / 3600) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60)
}

/** «6 дней» с верным окончанием. */
export function daysWord(n: number): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return n + ' дней'
  if (b === 1) return n + ' день'
  if (b >= 2 && b <= 4) return n + ' дня'
  return n + ' дней'
}

/* ============================================================
   ТРЕК СЕЗОНА: 28 КЛЕТОК (схема 24.09.2026)
   ------------------------------------------------------------
   Решение владельца 24.09.2026, 13:43: «в бонусе за вход не должны даваться
   вещи вообще — даём осколки или сундуки, из которых что-то может выпасть».
   В клетках только осколки и сундуки трёх уровней; строка PLUS — та же неделя,
   сундуки на уровень выше и осколков больше. Сундук ложится в «Мои сундуки» и
   открывается когда угодно.

   Служба (millida-services, ветка feat/daily-no-items, SEASON_TRACK в
   rubies.catalog.ts) шлёт все 28 клеток. Старая служба шлёт меньше — тогда
   недостающие клетки ПРОГНОЗ КЛИЕНТА по той же таблице (seasonCell ниже).
   Две копии таблицы держатся равными руками: поменял там — поменяй тут.
   ============================================================ */

/** Сколько дней показывает лента. */
export const TRACK_DAYS = 28
/** Дней в неделе трека. */
export const CYCLE_DAYS = 7

const DAY_MS = 86_400_000

const shards = (amount: number): Reward => ({ kind: 'SHARDS', amount })
const rubies = (amount: number): Reward => ({ kind: 'RUBIES', amount })
const chest = (tier: ChestTier): Reward => ({ kind: 'CHEST', tier })
const frags = (rarity: Rarity, amount: number): Reward => ({ kind: 'FRAGMENTS', rarity, amount })
/** Модель v3 (копия SEASON_TRACK службы). Бесплатно: сундук 4-го дня по неделям. */
const DAY4_FREE: ChestTier[] = ['COMMON', 'COMMON', 'RARE', 'COMMON']
/** 7-й день бесплатной строки: во 2-ю и 4-ю неделю сундук, в 1-ю и 3-ю осколки. */
const DAY7_FREE: Reward[] = [shards(60), chest('RARE'), shards(60), chest('EPIC')]
/** Бесплатные рубины: клетка → сумма (230 за сезон; с горстями ≤ 500 за 30 дней). */
const FREE_RUBIES: Record<number, number> = { 6: 50, 13: 60, 20: 60, 27: 60 }
/** PLUS: сундук 3-го дня по неделям и осколки 7-го дня (вещей PLUS не даёт). */
const DAY3_PLUS: ChestTier[] = ['RARE', 'RARE', 'EPIC', 'RARE']
const DAY7_PLUS_SHARDS = [60, 175, 60, 480]

/** Награды клетки 1…28 по таблице сезона (копия SEASON_TRACK службы, модель v3). */
export function seasonCell(n: number): { free: Reward[]; plus: Reward[] } {
  const i = Math.min(TRACK_DAYS, Math.max(1, n)) - 1
  const week = Math.floor(i / CYCLE_DAYS)
  const cell = i + 1
  const withRubies = (list: Reward[]) => (FREE_RUBIES[cell] ? [...list, rubies(FREE_RUBIES[cell]!)] : list)
  switch ((i % CYCLE_DAYS) + 1) {
    case 1:
      return { free: withRubies([shards(15)]), plus: [rubies(100)] }
    case 2:
      return { free: withRubies([shards(15)]), plus: [frags('RARE', 8)] }
    case 3:
      return { free: withRubies([shards(25)]), plus: [chest(DAY3_PLUS[week] ?? 'RARE')] }
    case 4:
      return { free: withRubies([chest(DAY4_FREE[week] ?? 'COMMON')]), plus: [rubies(120)] }
    case 5:
      return { free: withRubies([shards(20)]), plus: [week % 2 === 0 ? shards(60) : frags('EPIC', 8)] }
    case 6:
      return { free: withRubies([shards(30)]), plus: [chest('EPIC')] }
    default: {
      const top = shards(DAY7_PLUS_SHARDS[week] ?? 60)
      return {
        free: withRubies([DAY7_FREE[week] ?? shards(60)]),
        plus: week === TRACK_DAYS / CYCLE_DAYS - 1 ? [top, chest('LEGEND')] : [top],
      }
    }
  }
}

/** Номер суток UTC «сегодня»: по `nextAt` службы, иначе по часам. */
export function todayKey(status: DailyView | null, now = Date.now()): number {
  const next = status?.nextAt ? Date.parse(status.nextAt) : NaN
  return Number.isFinite(next) ? Math.round(next / DAY_MS) - 1 : Math.floor(now / DAY_MS)
}

/**
 * Награда в клетке ленты. MYSTERY — закрытая карта: так старые версии прятали
 * вещь будущей недели. Новая схема вещей не даёт, тип оставлен ради старых
 * ответов и магазина (shop/FreeDaily.tsx).
 */
export type TrackReward =
  | Reward
  | {
      kind: 'MYSTERY'
      of: 'ITEM' | 'FRAGMENTS'
      amount?: number
      rarity?: Rarity
    }

export interface TrackCol {
  /** Сквозной номер дня ленты, 1…28. */
  n: number
  /** День недели 1…7. */
  cycleDay: number
  /** Неделя сезона 0…3. */
  cycle: number
  free: TrackReward[]
  plus: TrackReward[]
  /** Клетка достроена клиентом, а не пришла от службы. */
  forecast: boolean
}

/**
 * Лента на 28 дней. Служба прислала всё — берём как есть; прислала меньше —
 * остальное по таблице сезона (прогноз клиента).
 */
export function longTrack(status: DailyView | null, days = TRACK_DAYS): TrackCol[] {
  const src = status?.track
  if (!status || !src?.length) return []
  return Array.from({ length: days }, (_, i) => {
    const d: DailyTrackDay | undefined = src[i]
    const cell = d ?? seasonCell(i + 1)
    return {
      n: i + 1,
      cycleDay: (i % CYCLE_DAYS) + 1,
      cycle: Math.floor(i / CYCLE_DAYS),
      free: cell.free,
      plus: cell.plus,
      forecast: !d,
    }
  })
}

/* ============================================================
   СЕЗОН И КЛЕТКИ (Battle Pass, 23.09.2026, вечер)
   ------------------------------------------------------------
   Каждая клетка — отдельная награда со своим состоянием:
   claimed — забрана; ready — открыта, можно забрать когда угодно до конца
   сезона; locked — строка PLUS без подписки (видно, но под замком);
   future — откроется в свой день входа. 1 день входа = 1 открытая клетка.
   Новая служба шлёт `season` и `freeState`/`plusState`. Старая — нет: тогда
   ПРОГНОЗ КЛИЕНТА по старой схеме — дни до сегодняшнего забраны, сегодня
   открыт (или забран), дальше закрыто; «забрать» у неё одно на день и
   приносит обе строки.
   ============================================================ */

export type CellState = DailyCellState
export type Row = 'free' | 'plus'
export type ClaimTarget = { day: number; row: Row } | 'all'

export interface PassCol extends TrackCol {
  freeState: CellState
  plusState: CellState
}

/** Служба уже на сезонной схеме: шлёт состояния клеток. */
export const seasonal = (status: DailyView | null) =>
  !!status?.season || !!status?.track?.some((d) => d.freeState || d.plusState)

/** Сезон: от службы или прогноз клиента по старой схеме. */
export function seasonOf(status: DailyView): DailySeason {
  if (status.season) return status.season
  const start = todayKey(status) - (status.cycleDay - 1)
  return {
    id: 'legacy',
    day: status.cycleDay,
    endsAt: new Date((start + TRACK_DAYS) * DAY_MS).toISOString(),
    nextUnlockAt: new Date(nextResetAt(status)).toISOString(),
  }
}

/** Лента с состояниями клеток. `own` — есть подписка PLUS. */
export function passCols(status: DailyView | null, own: boolean): PassCol[] {
  if (!status) return []
  const open = seasonOf(status).day
  const legacy = !seasonal(status)
  const guess = (n: number): CellState => {
    if (n > open) return 'future'
    if (legacy) return n < open || status.claimedToday ? 'claimed' : 'ready'
    return 'ready'
  }
  return longTrack(status).map((c) => {
    const src = c.forecast ? undefined : status.track?.[c.n - 1]
    const freeState = src?.freeState ?? guess(c.n)
    const plusRaw = src?.plusState && src.plusState !== 'locked' ? src.plusState : legacy ? guess(c.n) : freeState === 'future' ? 'future' : 'ready'
    return { ...c, freeState, plusState: own ? plusRaw : 'locked' }
  })
}

/** Клетки, которые можно забрать прямо сейчас. */
export function readyCells(cols: PassCol[]): { day: number; row: Row }[] {
  const out: { day: number; row: Row }[] = []
  for (const c of cols) {
    if (c.freeState === 'ready') out.push({ day: c.n, row: 'free' })
    if (c.plusState === 'ready') out.push({ day: c.n, row: 'plus' })
  }
  return out
}

/** Награды, которые принесёт «Забрать» по цели (для вида сундука и «С PLUS было бы»). */
export function targetRewards(cols: PassCol[], target: ClaimTarget | null, legacy: boolean) {
  const cells =
    target === 'all' || !target
      ? readyCells(cols)
      : legacy
        ? readyCells(cols).filter((c) => c.day === target.day)
        : [target]
  const got: TrackReward[] = []
  const missed: TrackReward[] = []
  for (const cell of cells) {
    const c = cols[cell.day - 1]
    if (!c) continue
    got.push(...(cell.row === 'free' ? c.free : c.plus))
  }
  for (const d of new Set(cells.map((c) => c.day))) {
    const c = cols[d - 1]
    if (c && c.plusState === 'locked') missed.push(...c.plus)
  }
  return { got, missed }
}

/** Что даёт строка за весь сезон: осколки и сундуки по уровням (для карточки PLUS). */
export function rowTotals(cols: TrackCol[], row: Row) {
  const chests: Record<ChestTier, number> = { COMMON: 0, RARE: 0, EPIC: 0, LEGEND: 0 }
  let shards = 0
  let rubies = 0
  for (const c of cols) {
    for (const r of c[row]) {
      if (r.kind === 'SHARDS') shards += r.amount
      else if (r.kind === 'RUBIES') rubies += r.amount
      else if (r.kind === 'CHEST') chests[r.tier] += 1
    }
  }
  return { shards, rubies, chests }
}
