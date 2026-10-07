/**
 * Возврат в лаунчер (06.10.2026, ресёрч `2026-10-06_возврат-в-лаунчер`): таймер
 * сундука на главной, напоминание «серия сгорит», первый день без запусков.
 * Здесь только чистые правила — их проверяют тесты, экраны только рисуют.
 */

const pad = (n: number) => String(n).padStart(2, '0')

/** «2:14» до часа и дольше, «4:05» (минуты:секунды) в последний час. */
export function chestTimerText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? h + ':' + pad(m) : m + ':' + pad(s % 60)
}

/** Сдвиг Москвы от UTC: +3 круглый год. */
export const MSK_OFFSET_MS = 3 * 3_600_000
const DAY_MS = 86_400_000

/** Номер московских суток. */
export const mskDay = (at: number): number => Math.floor((at + MSK_OFFSET_MS) / DAY_MS)

/** Сколько миллисекунд до ближайшей московской полуночи. */
export const toMskMidnight = (at: number): number => (mskDay(at) + 1) * DAY_MS - MSK_OFFSET_MS - at

/** Напоминаем за 3 часа до конца суток, не чаще раза в сутки и трёх раз в неделю. */
export const REMIND_BEFORE_MS = 3 * 3_600_000
export const REMIND_WEEK_MAX = 3

export interface ReminderInput {
  now: number
  /** Есть что забрать сегодня (бонус дня не забран). */
  ready: boolean
  /** Тумблер в «Настройках». */
  enabled: boolean
  /** Когда уже напоминали (мс). */
  shown: number[]
}

export function reminderDue({ now, ready, enabled, shown }: ReminderInput): boolean {
  if (!enabled || !ready) return false
  if (toMskMidnight(now) > REMIND_BEFORE_MS) return false
  const today = mskDay(now)
  if (shown.some((t) => mskDay(t) === today)) return false
  return shown.filter((t) => now - t < 7 * DAY_MS).length < REMIND_WEEK_MAX
}

/** Журнал показов: только последняя неделя, чтобы ключ не рос. */
export const keepWeek = (shown: number[], now: number): number[] => shown.filter((t) => now - t < 7 * DAY_MS).slice(-REMIND_WEEK_MAX)

/**
 * Первый день: лаунчер стоит, а игра ни разу не запускалась. Тогда на главной —
 * одна сборка, одна большая «Играть» и обещанный сундук за первый час.
 */
export function isDayZero(stats: { loaded: boolean; total_seconds: number; sessions: number }, busy: boolean): boolean {
  return stats.loaded && !busy && stats.total_seconds <= 0 && stats.sessions <= 0
}

/** Столько окно должно быть открыто и в фокусе, чтобы день серии засчитался. */
export const SESSION_MS = 10_000

export interface ActivityInput {
  now: number
  /** С какого момента окно непрерывно на экране и в фокусе; null — не на экране. */
  focusedSince: number | null
  /** Только что запустилась игра. */
  gameStarted: boolean
  /** Московские сутки, за которые день уже отправлен. */
  sentDay: number | null
}

/**
 * Засчитать ли сегодняшний день серии (решение 06.10.2026): окно лаунчера
 * открыто хотя бы 10 секунд или запущена игра. Лаунчер, который просто живёт
 * в трее, день не засчитывает. Сутки — московские, раз в сутки.
 */
export function shouldCountDay({ now, focusedSince, gameStarted, sentDay }: ActivityInput): boolean {
  if (sentDay === mskDay(now)) return false
  return gameStarted || (focusedSince !== null && now - focusedSince >= SESSION_MS)
}

