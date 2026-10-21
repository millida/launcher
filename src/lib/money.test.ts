import { afterEach, expect, test } from 'bun:test'
import { useI18n, type Locale } from '../i18n'
import {
  canAfford,
  formatMoney,
  goodsQuote,
  moneyLangFor,
  moneyShortfall,
  plusCheckout,
  quoteText,
  shortfallOf,
  topupUrl,
  type MoneyCurrency,
  type MoneyView,
  type Quote,
} from './money'

const RATE = 90

const account = (currency: MoneyCurrency, kopecks: number): MoneyView => ({
  region: currency === 'RUB' ? 'RU' : 'INTL',
  displayCurrency: currency,
  balance: { kopecks, displayMinor: currency === 'RUB' ? kopecks : Math.floor(kopecks / RATE), displayCurrency: currency, rate: currency === 'RUB' ? 1 : RATE },
  rubPerUsd: RATE,
  topup: { RUB: { minMinor: 10000, maxMinor: 10000000, methods: [], methodMinMinor: {} }, USD: { minMinor: 100, maxMinor: 100000, methods: [], methodMinMinor: {} } },
})

const PLUS_RUB: Quote = { displayCurrency: 'RUB', priceMinor: 29900, chargeKopecks: 29900 }
const PLUS_USD: Quote = { displayCurrency: 'USD', priceMinor: 500, chargeKopecks: 500 * RATE }

const spaced = (s: string | null) => (s ?? '').replace(/\s/g, ' ')

const initialLocale = useI18n.getState().locale
afterEach(() => useI18n.setState({ locale: initialLocale } as never))

type BuyerCase = {
  why: string
  locale: Locale
  view: MoneyView
  quote: Quote
  shown: string
  affords: boolean
  topup: { currency: MoneyCurrency; amountMinor: number } | null
}

const BUYERS: BuyerCase[] = [
  {
    why: 'the Russian interface is quoted the ruble list and affords it from 500 RUB',
    locale: 'ru',
    view: account('RUB', 50000),
    quote: PLUS_RUB,
    shown: '299 ₽',
    affords: true,
    topup: null,
  },
  {
    why: 'any other interface is quoted dollars; 300 RUB of balance is less than $5.00 at 90 RUB, so it tops up the missing $1.67',
    locale: 'en',
    view: account('USD', 30000),
    quote: PLUS_USD,
    shown: '$5',
    affords: false,
    topup: { currency: 'USD', amountMinor: 167 },
  },
  {
    why: 'a dollar quote still on screen right after a switch to Russian keeps its own currency until the list reloads; the language only formats',
    locale: 'ru',
    view: account('USD', 30000),
    quote: PLUS_USD,
    shown: '5 $',
    affords: false,
    topup: { currency: 'USD', amountMinor: 167 },
  },
  {
    why: 'a ruble quote still on screen right after a switch to English is not converted on the client',
    locale: 'en',
    view: account('RUB', 27000),
    quote: PLUS_RUB,
    shown: 'RUB 299',
    affords: false,
    topup: { currency: 'RUB', amountMinor: 10000 },
  },
  {
    why: 'cents never meet kopecks: 555 cents of a dollar balance are 50 000 kopecks and cover a $5.00 price',
    locale: 'en',
    view: account('USD', 50000),
    quote: PLUS_USD,
    shown: '$5',
    affords: true,
    topup: null,
  },
]

for (const c of BUYERS) {
  test('buyer: ' + c.why, () => {
    useI18n.setState({ locale: c.locale } as never)
    expect(spaced(quoteText(c.quote)), 'the price is shown in the quote currency, formatted by the interface language').toBe(c.shown)
    expect(canAfford(c.quote, c.view), 'affordability compares rubles with rubles, never cents with kopecks').toBe(c.affords)
    expect(shortfallOf(c.quote, c.view)?.topup ?? null, 'the top-up is sized in the account currency and raised to its minimum').toEqual(c.topup)
  })
}

const GOODS: Array<[why: string, currency: MoneyCurrency | null, rub: number, line: 'RUB' | undefined, want: Quote | null]> = [
  ['a ruble account pays the ruble price of an author pack', 'RUB', 30000, undefined, { displayCurrency: 'RUB', priceMinor: 30000, chargeKopecks: 30000 }],
  ['a dollar account pays the PLUS-ratio dollar list, charged from rubles at the rate', 'USD', 30000, undefined, { displayCurrency: 'USD', priceMinor: 499, chargeKopecks: 499 * RATE }],
  ['a subscription keeps its ruble line for a dollar account: the gateway bills rubles', 'USD', 25900, 'RUB', { displayCurrency: 'RUB', priceMinor: 25900, chargeKopecks: 25900 }],
  ['no account currency yet means no price rather than a guess', null, 30000, undefined, null],
]

for (const [why, currency, rub, line, want] of GOODS) {
  test('goods: ' + why, () => {
    expect(goodsQuote(rub, currency, RATE, line)).toEqual(want)
  })
}

const REFUSALS: Array<[why: string, error: unknown, topup: { currency: MoneyCurrency; amountMinor: number } | null, known: boolean]> = [
  [
    'the core marker carries the server top-up, first option first',
    new Error('insufficient-funds: {"code":"INSUFFICIENT_FUNDS","displayCurrency":"USD","missingMinor":250,"missingKopecks":22500,"topupCurrencyOptions":[{"currency":"USD","amountMinor":250},{"currency":"RUB","amountMinor":22500}]}'),
    { currency: 'USD', amountMinor: 250 },
    true,
  ],
  [
    'the body itself, as a browser fetch sees it',
    { code: 'INSUFFICIENT_FUNDS', displayCurrency: 'RUB', missingMinor: 5000, topupCurrencyOptions: [{ currency: 'RUB', amountMinor: 10000 }] },
    { currency: 'RUB', amountMinor: 10000 },
    true,
  ],
  ['an older server answer is still a shortfall, without a sum', 'http 402', null, true],
  ['the old Russian text of the catalog is still a shortfall', 'Не хватает денег на балансе', null, true],
  ['any other refusal is not a money error', 'http 404', null, false],
]

for (const [why, error, topup, known] of REFUSALS) {
  test('refusal: ' + why, () => {
    const s = moneyShortfall(error)
    expect(s !== null, 'only a shortfall offers a top-up').toBe(known)
    expect(s?.topup ?? null).toEqual(topup)
  })
}

const URLS: Array<[why: string, locale: Locale, ask: { currency: MoneyCurrency; amountMinor: number } | null, want: string]> = [
  ['Russian lives at the root of the site, /ru/ is a 404 there', 'ru', { currency: 'RUB', amountMinor: 10000 }, 'https://millida.net/profile?tab=wallet&topup=RUB&amount=10000'],
  ['English opens the English wallet with the dollar sum', 'en', { currency: 'USD', amountMinor: 166 }, 'https://millida.net/en/profile?tab=wallet&topup=USD&amount=166'],
  ['the site spells Brazilian Portuguese in lower case', 'pt-BR', null, 'https://millida.net/pt-br/profile?tab=wallet'],
  ['a language the site lacks opens in English', 'zh', null, 'https://millida.net/en/profile?tab=wallet'],
]

for (const [why, locale, ask, want] of URLS) {
  test('top-up link: ' + why, () => {
    expect(topupUrl(ask, locale)).toBe(want)
  })
}

const LANG_PATHS: Array<[why: string, path: string, sent: boolean]> = [
  ['the account money view decides the shown currency', '/me/money', true],
  ['the price list quotes every product', '/pricing', true],
  ['the PLUS status carries its quote', '/launcher/plus', true],
  ['a PLUS wallet buy can answer with a shortfall', '/launcher/plus/wallet/buy', true],
  ['a ruby pack buy can answer with a shortfall', '/rubies/packs/buy', true],
  ['hosting plans are quoted for the viewer', '/hosting/plans?brand=millida', true],
  ['creating a paid server charges the balance', '/hosting/servers', true],
  ['changing a plan charges the balance', '/hosting/servers/abc/plan', true],
  ['the catalog access answer carries the price', '/catalog/items/bsl/access', true],
  ['a catalog buy is charged at the quote of the interface language', '/catalog/items/bsl/buy', true],
  ['a catalog subscription is priced by the interface language', '/catalog/items/bsl/subscribe', true],
  ['the PLUS gateway subscription is priced by the interface language', '/launcher/plus/subscribe', true],
  ['binding PLUS to the balance can answer with a shortfall', '/launcher/plus/wallet/bind', true],
  ['rubies bought from the balance are charged at the language quote', '/rubies/topup', true],
  ['VDS plans are quoted for the viewer', '/vds/plans', true],
  ['the catalog card list asks quotes in one call', '/catalog/purchases/quotes?prices=100', true],
  ['a server console has nothing to price', '/hosting/servers/abc/console', false],
  ['the friends list has nothing to price', '/friends', false],
]

for (const [why, path, sent] of LANG_PATHS) {
  test('language on money requests: ' + why, () => {
    expect(moneyLangFor(path, 'ru'), 'only money requests name the language').toBe(sent ? 'ru' : undefined)
  })
}

test('a fractional sum keeps its cents and a whole one drops them', () => {
  useI18n.setState({ locale: 'en' } as never)
  expect(spaced(formatMoney(129050, 'RUB'))).toBe('RUB 1,290.50')
  expect(spaced(formatMoney(500, 'USD'))).toBe('$5')
})

const CHECKOUTS: Array<[why: string, current: Quote | null, statusQuote: Quote | undefined, want: 'gateway' | 'balance']> = [
  ['a ruble quote goes through the ruble gateway', PLUS_RUB, undefined, 'gateway'],
  ['a dollar quote is paid from the balance: the gateway bills rubles only', PLUS_USD, undefined, 'balance'],
  ['the price list follows the interface language, so it outranks an older PLUS status', PLUS_USD, PLUS_RUB, 'balance'],
  ['without a price list the status quote decides', null, PLUS_USD, 'balance'],
  ['nothing known yet falls back to the gateway', null, undefined, 'gateway'],
]

for (const [why, current, statusQuote, want] of CHECKOUTS) {
  test('PLUS checkout: ' + why, () => {
    expect(plusCheckout(current, statusQuote), 'the checkout must match the currency of the price on screen').toBe(want)
  })
}

const LOCALES: Array<[why: string, locale: Locale]> = [
  ['Russian asks for the ruble list', 'ru'],
  ['English asks for the dollar list', 'en'],
  ['Brazilian Portuguese is sent as the launcher spells it', 'pt-BR'],
]

for (const [why, locale] of LOCALES) {
  test('interface language on money requests: ' + why, () => {
    expect(moneyLangFor('/pricing', locale), 'the server prices by exactly this language').toBe(locale)
  })
}
