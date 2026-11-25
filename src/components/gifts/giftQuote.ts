import { kopecksForUsdCents, type MoneyCurrency, type Quote } from '../../lib/money'

export function giftQuote(priceMinor: number, currency: MoneyCurrency, rubPerUsd: number | null): Quote | null {
  if (currency === 'RUB') return { displayCurrency: currency, priceMinor, chargeKopecks: priceMinor }
  if (currency !== 'USD' || !rubPerUsd) return null
  return { displayCurrency: currency, priceMinor, chargeKopecks: kopecksForUsdCents(priceMinor, rubPerUsd) }
}
