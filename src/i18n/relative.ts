export type RelativeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface RelativeOptions {
  style?: 'long' | 'short' | 'narrow'
  floor?: RelativeUnit
  ceil?: RelativeUnit
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

const ORDER: readonly RelativeUnit[] = ['minute', 'hour', 'day', 'week', 'month', 'year']
const SIZE: Record<RelativeUnit, number> = { minute: MINUTE, hour: HOUR, day: DAY, week: WEEK, month: MONTH, year: YEAR }

const formatters = new Map<string, Intl.RelativeTimeFormat>()

function formatter(tag: string, style: 'long' | 'short' | 'narrow'): Intl.RelativeTimeFormat {
  const key = tag + '|' + style
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.RelativeTimeFormat(tag, { numeric: 'auto', style })
    formatters.set(key, f)
  }
  return f
}

export function relativeTimeIn(tag: string, then: number, now: number, options: RelativeOptions = {}): string {
  if (!Number.isFinite(then) || !Number.isFinite(now)) return ''
  const rtf = formatter(tag, options.style ?? 'long')
  const floor = ORDER.indexOf(options.floor ?? 'minute')
  const ceil = ORDER.indexOf(options.ceil ?? 'year')
  const diff = then - now
  const abs = Math.abs(diff)
  const sign = diff < 0 ? -1 : 1
  for (let i = ceil; i >= floor; i--) {
    const unit = ORDER[i]!
    if (abs >= SIZE[unit] || i === floor) {
      const n = Math.floor(abs / SIZE[unit])
      if (n === 0) return floor === 0 ? rtf.format(0, 'second') : rtf.format(0, unit)
      return rtf.format(sign * n, unit)
    }
  }
  return ''
}

const pluralRules = new Map<string, Intl.PluralRules>()

export function pluralIn(tag: string, n: number, one: string, few: string, many: string): string {
  let rules = pluralRules.get(tag)
  if (!rules) {
    rules = new Intl.PluralRules(tag)
    pluralRules.set(tag, rules)
  }
  const kind = rules.select(Math.abs(n))
  return kind === 'one' ? one : kind === 'few' ? few : many
}
