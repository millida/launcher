import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { interpolate, lookup, placeholdersOf } from './core'
import { AVAILABLE_LOCALES, EXTRA_LOCALES, EXTRA_LOCALES_PUBLIC, LOCALES, isLocale, localeFromSystem, type Locale } from './locales'

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
      expect(lookup(c.locale, c.key, c.locale === 'en' ? english : c.locale === 'ru' ? undefined : own, english), c.why).toBe(c.want)
    })
  test('ru with a fix from the site', () => {
    expect(lookup('ru', 'Далее', { 'Далее': 'Дальше' }, english), 'the only Russian table is the site fixes').toBe('Дальше')
    expect(lookup('ru', 'Назад', { 'Далее': 'Дальше' }, english), 'a key without a fix stays the text').toBe('Назад')
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
    { tags: ['nl-NL', 'de-DE'], want: 'de', why: 'an unsupported first choice falls through to the next one the system lists' },
    { tags: ['nl-NL'], want: 'en', why: 'nothing supported means English' },
    { tags: ['pl-PL'], want: 'pl', why: 'Polish has its own table' },
    { tags: [], want: 'en', why: 'no system answer means English' },
  ]
  for (const c of cases)
    test(c.tags.join(',') || 'empty', () => {
      expect(localeFromSystem(c.tags), c.why).toBe(c.want as never)
    })
})

test('the launcher knows exactly the 18 agreed languages, right-to-left only for Arabic and Urdu', () => {
  expect(LOCALES.map((l) => l.code), 'the language list is a product decision; change it on purpose, not by accident').toEqual([
    'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt-BR', 'id', 'ur', 'ru', 'de', 'ja', 'vi', 'te', 'tr', 'ko', 'pl',
  ])
  expect(LOCALES.filter((l) => l.rtl).map((l) => l.code), 'only these scripts are written right to left').toEqual(['ar', 'ur'])
})

test('translated languages stay out of the pickers until the switch is turned on', () => {
  const want: Locale[] = EXTRA_LOCALES_PUBLIC ? ['en', 'pt-BR', 'ru', 'de', 'tr', 'es', 'pl'] : ['en', 'ru']
  expect(AVAILABLE_LOCALES.map((l) => l.code).sort(), 'offering a language is the owner decision behind EXTRA_LOCALES_PUBLIC').toEqual(want.sort())
})

test('every language behind the switch has a filled table, so turning it on never shows a half-English launcher', () => {
  const dir = join(import.meta.dir, 'locales')
  const english = Object.keys(JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')) as Record<string, string>)
  for (const code of EXTRA_LOCALES) {
    const table = JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8')) as Record<string, string>
    const covered = english.filter((k) => table[k]).length / english.length
    expect(covered, `${code}.json covers ${(covered * 100).toFixed(1)}% of English keys; run scripts/i18n-translate.ts --lang ${code}`).toBeGreaterThan(0.9)
  }
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
