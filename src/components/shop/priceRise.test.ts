import { describe, expect, test } from 'bun:test'
import { priceRiseText, setPriceRise } from './priceRise'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const at = (hours: number) => new Date(NOW + hours * 3_600_000).toISOString()
const echo = (key: string, vars?: Record<string, string | number>) => key.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''))

describe('price rise label', () => {
  const cases: Array<{ rise: { at: string; pct: number } | null; want: string | null; why: string }> = [
    { rise: { at: at(72), pct: 100 }, want: 'Цена ×2 через 3 дн.', why: 'pct 100 reads as a doubling, days are whole' },
    { rise: { at: at(50), pct: 50 }, want: 'Цена +50% через 2 дн.', why: 'any other pct is shown as a plus percent' },
    { rise: { at: at(5.5), pct: 100 }, want: 'Цена ×2 через 6 ч', why: 'under a day the label switches to hours, rounded up' },
    { rise: { at: at(0.1), pct: 100 }, want: 'Цена ×2 через 1 ч', why: 'the last minutes still say one hour, never zero' },
    { rise: { at: at(-1), pct: 100 }, want: null, why: 'a rise in the past has already happened, so no badge' },
    { rise: { at: 'garbage', pct: 100 }, want: null, why: 'an unreadable date from the server hides the badge instead of showing NaN' },
    { rise: { at: at(10), pct: 0 }, want: null, why: 'a zero rise is not a rise' },
    { rise: null, want: null, why: 'an older service sends no field and the card must look as before' },
  ]
  for (const c of cases) test(c.why, () => expect(priceRiseText(c.rise, NOW, echo)).toBe(c.want))
})

describe('set price rise', () => {
  const cases: Array<{ rise: { at: string; price: number } | null; price: number; want: number | null; why: string }> = [
    { rise: { at: at(48), price: 2000 }, price: 1000, want: 100, why: 'twice the current price is a doubling' },
    { rise: { at: at(48), price: 2030 }, price: 1000, want: 100, why: 'rounding to tens around a doubling still reads as x2' },
    { rise: { at: at(48), price: 1500 }, price: 1000, want: 50, why: 'a partial rise is shown as a percent' },
    { rise: { at: at(48), price: 900 }, price: 1000, want: null, why: 'a lower future price is not a rise' },
    { rise: { at: at(48), price: 2000 }, price: 0, want: null, why: 'a set the player already owns has nothing to rise' },
    { rise: null, price: 1000, want: null, why: 'no field from the service means no badge' },
  ]
  for (const c of cases) test(c.why, () => expect(setPriceRise(c.rise, c.price)?.pct ?? null).toBe(c.want))
})
