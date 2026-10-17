import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { interpolate, lookup, placeholdersOf } from './core'
import { LOCALES, isLocale, localeFromSystem, marketCurrency } from './locales'

describe('lookup falls back own language -> English -> Russian key', () => {
  const own = { 'Далее': 'Weiter' }
  const english = { 'Далее': 'Next', 'Назад': 'Back' }
  const cases: Array<{ locale: Parameters<typeof lookup>[0]; key: string; want: string; why: string }> = [
    { locale: 'ru', key: 'Далее', want: 'Далее', why: 'Russian is the source: the key itself is the text' },
    { locale: 'de', key: 'Далее', want: 'Weiter', why: 'an own translation wins' },
    { locale: 'de', key: 'Назад', want: 'Back', why: 'a missing translation shows English, which far more players read than Russian' },
    { locale: 'de', key: 'Новое', want: 'Новое', why: 'with neither table the key still shows instead of an empty button' },
    { locale: 'en', key: 'Назад', want: 'Back', why: 'English reads its own table' },
  ]
  for (const c of cases)
    test(c.locale + ' ' + c.key, () => {
      expect(lookup(c.locale, c.key, c.locale === 'en' ? english : own, english), c.why).toBe(c.want)
    })
})

describe('interpolate', () => {
  test('fills known placeholders and keeps unknown ones visible', () => {
    expect(interpolate('{nick} has {n} rubies', { nick: 'Steve', n: 5 }), 'every named value lands in its slot').toBe('Steve has 5 rubies')
    expect(interpolate('Hi {nick}', {}), 'a missing value must stay visible as a slot, not vanish silently').toBe('Hi {nick}')
  })
})

describe('system language', () => {
  const cases: Array<{ tags: string[]; want: string; why: string }> = [
    { tags: ['ru-RU'], want: 'ru', why: 'Russian system' },
    { tags: ['uk-UA'], want: 'ru', why: 'Ukrainian readers get Russian, there is no Ukrainian table' },
    { tags: ['be-BY'], want: 'ru', why: 'Belarusian readers get Russian' },
    { tags: ['kk-KZ'], want: 'ru', why: 'Kazakh readers get Russian' },
    { tags: ['pt-PT'], want: 'pt-BR', why: 'the only Portuguese table is Brazilian' },
    { tags: ['zh-TW'], want: 'zh', why: 'Chinese goes to the one Chinese table' },
    { tags: ['pl-PL', 'de-DE'], want: 'de', why: 'an unsupported first choice falls through to the next one the system lists' },
    { tags: ['pl-PL'], want: 'en', why: 'nothing supported means English' },
    { tags: [], want: 'en', why: 'no system answer means English' },
  ]
  for (const c of cases)
    test(c.tags.join(',') || 'empty', () => {
      expect(localeFromSystem(c.tags), c.why).toBe(c.want as never)
    })
})

test('market currency: Russian pays in roubles, everyone else in dollars', () => {
  for (const l of LOCALES) expect(marketCurrency(l.code), l.code).toBe(l.code === 'ru' ? 'RUB' : 'USD')
})

test('the launcher offers exactly the 17 agreed languages, right-to-left only for Arabic and Urdu', () => {
  expect(LOCALES.map((l) => l.code), 'the language list is a product decision; change it on purpose, not by accident').toEqual([
    'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt-BR', 'id', 'ur', 'ru', 'de', 'ja', 'vi', 'te', 'tr', 'ko',
  ])
  expect(LOCALES.filter((l) => l.rtl).map((l) => l.code), 'only these scripts are written right to left').toEqual(['ar', 'ur'])
})

describe('dictionaries', () => {
  const dir = join(import.meta.dir, 'locales')
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const code = file.replace(/\.json$/, '')
    test(file, () => {
      expect(isLocale(code) && code !== 'ru', file + ': a table must be named after a supported non-Russian language').toBe(true)
      const table = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>
      for (const [key, value] of Object.entries(table))
        expect(placeholdersOf(value), `${file}: "${key}" lost or renamed a placeholder, the player would see {name} as text`).toEqual(placeholdersOf(key))
    })
  }
})
