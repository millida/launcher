import { afterEach, expect, test } from 'bun:test'
import { useCurrencyOverride } from '../i18n/currencyOverride'
import { digitalUsdCents, rubleGoodsPrice, useI18n } from '../i18n'
import { plusPrice, useRegionalPriceStore, walletMoney, type PriceList } from './regionalPrices'

const rubText = (k: number) => `${k / 100} ₽`

const foreignList: PriceList = {
  region: 'INTL',
  country: 'US',
  proven: true,
  forceCurrency: 'USD',
  rubPerUsd: 90,
  plus: [
    { tier: 'PLUS', price: { USD: 499 } },
    { tier: 'DIAMOND', price: { USD: 899 } },
  ],
  hosting: [],
  rubies: [],
  skins: { USD: {} },
}

afterEach(() => {
  useCurrencyOverride.setState({ forced: null, rubPerUsd: null })
  useRegionalPriceStore.setState({ list: null, loading: false })
})

type Case = [why: string, forced: 'USD' | null, minor: number, expected: string]

const WALLET_CASES: Case[] = [
  ['a ruble account sees its ruble balance', null, 50000, '500 ₽'],
  ['a foreign account sees its dollar balance in dollars, never converted', 'USD', 1250, '$12.50'],
]

for (const [why, forced, minor, expected] of WALLET_CASES) {
  test('wallet: ' + why, () => {
    useI18n.setState({ locale: 'en' } as never)
    useCurrencyOverride.setState({ forced })
    expect(walletMoney(minor, rubText).replace(/ /g, ' ')).toBe(expected)
  })
}

test('a foreign account is shown the dollar PLUS price on the Russian interface too', () => {
  useI18n.setState({ locale: 'ru' } as never)
  useRegionalPriceStore.setState({ list: foreignList })
  useCurrencyOverride.setState({ forced: 'USD' })
  expect(plusPrice('PLUS', 29900)).toContain('4,99')
  expect(plusPrice('PLUS', 29900)).not.toContain('₽')
})

const GOODS_CASES: Array<[why: string, kopecks: number, cents: number]> = [
  ['300 RUB author pack is $4.99, the dollar list, not the rate', 30000, 499],
  ['100 RUB is $1.69', 10000, 169],
  ['3000 RUB rounds to .99 above $10', 300000, 4999],
]

for (const [why, kopecks, cents] of GOODS_CASES) {
  test('ruble goods: ' + why, () => {
    expect(digitalUsdCents(kopecks)).toBe(cents)
  })
}

test('ruble goods keep rubles for a ruble surface', () => {
  useI18n.setState({ locale: 'ru' } as never)
  expect(rubleGoodsPrice(30000, rubText)).toBe('300 ₽')
})
