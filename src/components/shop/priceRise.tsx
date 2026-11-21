import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import type { PriceRise } from '../../lib/rubies'
import { intlTag, useT } from '../../i18n'

type Translate = (key: string, vars?: Record<string, string | number>) => string

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export function priceRiseText(rise: PriceRise | null | undefined, now: number, t: Translate): string | null {
  if (!rise || !(rise.pct > 0)) return null
  const left = Date.parse(rise.at) - now
  if (!Number.isFinite(left) || left <= 0) return null
  const by = rise.pct === 100 ? '×2' : '+' + rise.pct + '%'
  if (left < DAY_MS) return t('Цена {rise} через {n} ч', { rise: by, n: Math.max(1, Math.ceil(left / HOUR_MS)) })
  return t('Цена {rise} через {n} дн.', { rise: by, n: Math.floor(left / DAY_MS) })
}

export function setPriceRise(rise: { at: string; price: number } | null | undefined, price: number): PriceRise | null {
  if (!rise || !(price > 0) || !(rise.price > price)) return null
  const ratio = rise.price / price
  return { at: rise.at, pct: Math.abs(ratio - 2) <= 0.05 ? 100 : Math.round((ratio - 1) * 100) }
}

export function PriceRiseTag({ rise, then, corner }: { rise: PriceRise | null | undefined; then?: number; corner?: boolean }) {
  const t = useT()
  const text = priceRiseText(rise, Date.now(), t)
  if (!text) return null
  const tag = (
    <span className="sv-clock sv-rise">
      <Icon id="i-clock" />
      <b>{text}</b>
    </span>
  )
  if (corner) return <span className="sv-corner">{tag}</span>
  if (!then) return tag
  return (
    <span className="sv-rise-box">
      {tag}
      <span className="sv-rise-then">
        {t('потом')}
        <Ruby size={13} />
        {then.toLocaleString(intlTag())}
      </span>
    </span>
  )
}
