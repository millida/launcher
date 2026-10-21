import { getLocale, intlTag, t, type Locale } from '../i18n'

export type MoneyCurrency = 'RUB' | 'USD'

/// `chargeKopecks` is always rubles whatever `displayCurrency` is: the account holds rubles only.
export interface Quote {
  displayCurrency: MoneyCurrency
  priceMinor: number
  chargeKopecks: number
}

export interface TopupOffer {
  minMinor: number
  maxMinor: number
  methods: string[]
  methodMinMinor: Record<string, number>
}

export interface MoneyView {
  region: 'RU' | 'INTL'
  displayCurrency: MoneyCurrency
  balance: { kopecks: number; displayMinor: number; displayCurrency: MoneyCurrency; rate: number }
  rubPerUsd: number
  topup: Record<MoneyCurrency, TopupOffer>
}

export interface PriceList {
  displayCurrency: MoneyCurrency
  rubPerUsd: number
  plus: { tier: 'PLUS' | 'DIAMOND'; quote: Quote }[]
  hosting: { code: string; ramMb: number; quote: Quote }[]
  rubies: { code: string; quote: Quote }[]
}

export interface TopupAsk {
  currency: MoneyCurrency
  amountMinor: number
}

/// Amounts are null when an older server sent only the fact of the refusal.
export interface MoneyShortfall {
  displayCurrency: MoneyCurrency | null
  missingMinor: number | null
  missingKopecks: number | null
  topup: TopupAsk | null
}

const CURRENCIES: ReadonlySet<string> = new Set(['RUB', 'USD'])

const isCurrency = (v: unknown): v is MoneyCurrency => typeof v === 'string' && CURRENCIES.has(v)

const isAmount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export function isQuote(v: unknown): v is Quote {
  const q = v as Partial<Quote> | null
  return !!q && isCurrency(q.displayCurrency) && isAmount(q.priceMinor) && q.priceMinor >= 0 && isAmount(q.chargeKopecks) && q.chargeKopecks >= 0
}

export function isMoneyView(v: unknown): v is MoneyView {
  const m = v as Partial<MoneyView> | null
  const b = m?.balance
  return (
    !!m &&
    isCurrency(m.displayCurrency) &&
    !!b &&
    isAmount(b.kopecks) &&
    isAmount(b.displayMinor) &&
    isCurrency(b.displayCurrency) &&
    isAmount(m.rubPerUsd) &&
    m.rubPerUsd > 0 &&
    !!m.topup &&
    isAmount(m.topup.RUB?.minMinor) &&
    isAmount(m.topup.USD?.minMinor)
  )
}

export function isPriceList(v: unknown): v is PriceList {
  const p = v as Partial<PriceList> | null
  return !!p && isCurrency(p.displayCurrency) && isAmount(p.rubPerUsd) && Array.isArray(p.plus) && Array.isArray(p.hosting) && Array.isArray(p.rubies)
}

/// The language only formats; the currency is the one the server quoted.
export function formatMoney(minor: number, currency: MoneyCurrency, locale: Locale = getLocale()): string {
  const amount = Math.round(minor) / 100
  const whole = Number.isInteger(amount)
  return new Intl.NumberFormat(intlTag(locale), {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amount)
}

export const quoteText = (q: Quote | null | undefined): string | null => (q && isQuote(q) ? formatMoney(q.priceMinor, q.displayCurrency) : null)

export const balanceOf = (view: MoneyView | null): { minor: number; currency: MoneyCurrency } | null =>
  view ? { minor: view.balance.displayMinor, currency: view.balance.displayCurrency } : null

/// The only affordability check: rubles against rubles. A dollar price and a ruble balance never meet.
export function canAfford(q: Quote | null | undefined, view: MoneyView | null): boolean | null {
  if (!view || !q || !isQuote(q)) return null
  return view.balance.kopecks >= q.chargeKopecks
}

/// The server's dollar list for ruble-only goods follows the PLUS price ratio, not the exchange rate.
export function digitalUsdCents(rubKopecks: number): number {
  const cents = (rubKopecks * 500) / 29900
  const step = cents >= 1000 ? 100 : 10
  return Math.max(99, Math.round(cents / step) * step - 1)
}

export const kopecksForUsdCents = (cents: number, rubPerUsd: number): number => Math.ceil(Math.round(cents * rubPerUsd * 1e6) / 1e6)

export const usdCentsCoveringKopecks = (kopecks: number, rubPerUsd: number): number =>
  kopecks <= 0 ? 0 : Math.ceil(Math.round((kopecks / rubPerUsd) * 1e6) / 1e6)

/// Catalog goods carry only a ruble price, so the launcher quotes them as the server charges them.
/// A subscription keeps its ruble line: the gateway bills rubles.
export function goodsQuote(rubKopecks: number, currency: MoneyCurrency | null, rubPerUsd: number | null, line?: 'RUB'): Quote | null {
  if (!isAmount(rubKopecks) || rubKopecks < 0) return null
  if (line === 'RUB' || currency === 'RUB') return { displayCurrency: 'RUB', priceMinor: rubKopecks, chargeKopecks: rubKopecks }
  if (currency !== 'USD' || !rubPerUsd) return null
  const cents = digitalUsdCents(rubKopecks)
  return { displayCurrency: 'USD', priceMinor: cents, chargeKopecks: kopecksForUsdCents(cents, rubPerUsd) }
}

/// The ruble gateway charges rubles, so a buyer shown a dollar price pays from the balance at that price.
/// The price list follows the interface language and is reloaded when it changes; a PLUS status may be older.
export function plusCheckout(current: Quote | null | undefined, statusQuote: Quote | null | undefined): 'gateway' | 'balance' {
  const currency = current?.displayCurrency ?? statusQuote?.displayCurrency
  return currency === 'USD' ? 'balance' : 'gateway'
}

export function scaleQuote(q: Quote | null | undefined, fromKopecks: number, toKopecks: number): Quote | null {
  if (!q || !isQuote(q) || fromKopecks <= 0) return null
  const k = toKopecks / fromKopecks
  return { ...q, priceMinor: Math.round(q.priceMinor * k), chargeKopecks: Math.round(q.chargeKopecks * k) }
}

/// Sized like the server's own top-up options, so a pre-check and a refusal ask for the same sum.
export function topupFor(missingKopecks: number, view: MoneyView): TopupAsk {
  const currency = view.displayCurrency
  const offer = view.topup[currency]
  const raw = currency === 'USD' ? usdCentsCoveringKopecks(missingKopecks, view.rubPerUsd) : Math.ceil(missingKopecks / 100) * 100
  return { currency, amountMinor: Math.min(Math.max(raw, offer.minMinor), offer.maxMinor) }
}

export function shortfallOf(q: Quote | null | undefined, view: MoneyView | null): MoneyShortfall | null {
  if (!view || !q || !isQuote(q)) return null
  const missingKopecks = q.chargeKopecks - view.balance.kopecks
  if (missingKopecks <= 0) return null
  const currency = view.displayCurrency
  const missingMinor = currency === 'USD' ? usdCentsCoveringKopecks(missingKopecks, view.rubPerUsd) : missingKopecks
  return { displayCurrency: currency, missingMinor, missingKopecks, topup: topupFor(missingKopecks, view) }
}

const MONEY_PATHS =
  /^\/(me\/money|pricing|launcher\/plus(\/.*)?|rubies\/(rules|packs(\/.*)?|shop\/packs(\/.*)?|topup)|hosting\/plans(\/.*)?|hosting\/servers(\/[^/?]+\/plan(\/.*)?)?|vds\/plans|catalog\/(purchases\/quotes|items\/[^/?]+\/(access|buy|subscribe)))(\?.*)?$/

/// The server prices by the interface language (Russian in rubles, any other in dollars),
/// so every request that shows or charges a price names it; other requests stay as they were.
export const moneyLangFor = (pathname: string, locale: Locale = getLocale()): Locale | undefined =>
  MONEY_PATHS.test(pathname) ? locale : undefined

/// The core passes an INSUFFICIENT_FUNDS refusal through as this marker plus the body as JSON.
export const INSUFFICIENT_FUNDS_PREFIX = 'insufficient-funds: '

const LEGACY_SHORTFALL = /^http 402$|insufficient_funds|не хватает (денег|средств)|недостаточно средств|not enough on your/i

const messageOf = (e: unknown): string =>
  String((e as { message?: string } | null)?.message ?? e ?? '')
    .replace(/^Error:\s*/, '')
    .trim()

function fromBody(body: unknown): MoneyShortfall | null {
  const b = body as {
    code?: unknown
    displayCurrency?: unknown
    missingMinor?: unknown
    missingKopecks?: unknown
    topupCurrencyOptions?: unknown
  } | null
  if (!b || b.code !== 'INSUFFICIENT_FUNDS') return null
  const options = Array.isArray(b.topupCurrencyOptions) ? b.topupCurrencyOptions : []
  const first = options[0] as { currency?: unknown; amountMinor?: unknown } | undefined
  const currency = isCurrency(b.displayCurrency) ? b.displayCurrency : null
  return {
    displayCurrency: currency,
    missingMinor: currency && isAmount(b.missingMinor) ? b.missingMinor : null,
    missingKopecks: isAmount(b.missingKopecks) ? b.missingKopecks : null,
    topup: first && isCurrency(first.currency) && isAmount(first.amountMinor) && first.amountMinor > 0 ? { currency: first.currency, amountMinor: first.amountMinor } : null,
  }
}

/// The browser fetch path reads the body itself and produces the same marker as the core.
export function shortfallMarker(body: unknown): string | null {
  const parsed = fromBody(body)
  if (!parsed) return null
  const b = body as Record<string, unknown>
  return (
    INSUFFICIENT_FUNDS_PREFIX +
    JSON.stringify({
      code: 'INSUFFICIENT_FUNDS',
      displayCurrency: b.displayCurrency,
      missingMinor: b.missingMinor,
      missingKopecks: b.missingKopecks,
      topupCurrencyOptions: parsed.topup ? [parsed.topup] : [],
    })
  )
}

export function moneyShortfall(e: unknown): MoneyShortfall | null {
  const direct = typeof e === 'object' && e !== null && !(e instanceof Error) ? fromBody(e) : null
  if (direct) return direct
  const text = messageOf(e)
  if (text.startsWith(INSUFFICIENT_FUNDS_PREFIX)) {
    try {
      const parsed = fromBody(JSON.parse(text.slice(INSUFFICIENT_FUNDS_PREFIX.length)))
      if (parsed) return parsed
    } catch {
      return { displayCurrency: null, missingMinor: null, missingKopecks: null, topup: null }
    }
  }
  return LEGACY_SHORTFALL.test(text) ? { displayCurrency: null, missingMinor: null, missingKopecks: null, topup: null } : null
}

export function shortfallText(s: MoneyShortfall): string {
  if (s.displayCurrency && s.missingMinor !== null && s.missingMinor > 0) {
    return t('Не хватает {sum} на балансе Millida — пополни и повтори', { sum: formatMoney(s.missingMinor, s.displayCurrency) })
  }
  return t('Не хватает средств на балансе Millida — пополни и повтори')
}

const SITE_PREFIX: Partial<Record<Locale, string>> = { ru: '', en: '/en', 'pt-BR': '/pt-br', es: '/es', de: '/de', tr: '/tr', pl: '/pl' }

/// The site keeps Russian at the root (`/ru/...` is a 404 there); a language the site lacks opens in English.
export function topupUrl(ask: TopupAsk | null, locale: Locale = getLocale()): string {
  const prefix = SITE_PREFIX[locale] ?? '/en'
  const q = new URLSearchParams({ tab: 'wallet' })
  if (ask && ask.amountMinor > 0) {
    q.set('topup', ask.currency)
    q.set('amount', String(Math.round(ask.amountMinor)))
  }
  return 'https://millida.net' + prefix + '/profile?' + q.toString()
}
