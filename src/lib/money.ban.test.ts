import { expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dir, '..')
const OWNERS = new Set(['lib/money.ts', 'lib/useMoney.ts'])
const SKIP = /(\.test\.tsx?$|^lib\/demo|^components\/shop\/demo|^i18n\/locales\/)/

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sources(path)
    else if (/\.tsx?$/.test(name)) yield path
  }
}

const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n')

const RULES: Array<[why: string, pattern: RegExp]> = [
  ['a price or balance with a hard-coded ruble sign ignores the account currency', /\d\s?₽|['"`]\s*₽\s*['"`]/],
  ['currency formatting lives in lib/money.ts formatMoney only', /style:\s*['"]currency['"]/],
  ['the currency comes from /v2/me/money, never from the interface language', /marketCurrency|currentCurrency|forced\s*\?\?/],
  ['the retired dollar wallet and per-language price helpers must not come back', /regionalPrices|currencyOverride|rubleGoodsPrice|walletMoney|\/core\/wallet\/me\/(usd|display)/],
  ['a market parameter no longer changes a price', /\/launcher\/plus\?market=/],
  ['top-up links are built by topupUrl with the language and the sum', /millida\.net\/profile\?tab=wallet/],
]

test('one money module: no other place picks a currency, formats money or links the wallet', () => {
  const found: string[] = []
  for (const path of sources(SRC)) {
    const rel = relative(SRC, path).replaceAll('\\', '/')
    if (OWNERS.has(rel) || SKIP.test(rel)) continue
    const code = stripComments(readFileSync(path, 'utf8'))
    for (const [why, pattern] of RULES) {
      if (code.split('\n').some((l) => pattern.test(l))) found.push(`${rel}: ${why}`)
    }
  }
  expect(found, 'route every price, balance and money error through lib/money.ts and lib/useMoney.ts').toEqual([])
})
