import { expect, test } from 'bun:test'
import type { MoneyCurrency } from '../../lib/money'
import { giftQuote } from './giftQuote'

const RATE = 90

const PRICED: Array<[why: string, minor: number, currency: MoneyCurrency, rate: number | null, charge: number | null]> = [
  ['a ruble gift is charged as priced, no rate needed', 53900, 'RUB', null, 53900],
  ['a dollar gift is charged at the account rate', 899, 'USD', RATE, 899 * RATE],
  ['a dollar gift without a rate has no known charge, so it is never called unaffordable', 899, 'USD', null, null],
  ['a rupee price is not guessed', 44900, 'INR', RATE, null],
]

for (const [why, minor, currency, rate, charge] of PRICED) {
  test(why, () => {
    expect(giftQuote(minor, currency, rate)?.chargeKopecks ?? null).toBe(charge)
  })
}
