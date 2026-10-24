import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractCoreKeys, extractKeys } from '../../scripts/i18n-extract.mjs'
import { localizeCore, type Table } from './core'
import { EXTRA_LOCALES, EXTRA_LOCALES_PUBLIC, type Locale } from './locales'

const dir = join(import.meta.dir, 'locales')
const table = (code: Locale): Table => JSON.parse(readFileSync(join(dir, code + '.json'), 'utf8')) as Table
const PUBLIC: Locale[] = ['en', ...(EXTRA_LOCALES_PUBLIC ? EXTRA_LOCALES : [])]

describe('every text the launcher shows has a translation in every public language', () => {
  const ui = extractKeys()
  const core = extractCoreKeys()
  test('the scan finds both interface and core texts', () => {
    expect(ui.size, 'the t() scan found almost nothing: the extractor broke, and this test would pass on an empty list').toBeGreaterThan(3000)
    expect(core.size, 'the core scan found almost nothing: Rust messages would go unchecked').toBeGreaterThan(500)
  })
  for (const code of PUBLIC)
    test(code, () => {
      const own = table(code)
      const missing = [...ui, ...core].filter(([key]) => !own[key]).map(([key, at]) => `${at}: ${key}`)
      expect(missing, `${code}.json lacks these texts, so a ${code} player sees them in Russian or English. Add them to every public table.`).toEqual([])
    })
})

describe('core messages are translated whole, with their inserted parts translated too', () => {
  const en: Table = {
    'Не удалось открыть папку: {0}': 'Could not open the folder: {0}',
    'Скачиваем {0}…': 'Downloading {0}…',
    '{0} из {1} МБ': '{0} of {1} MB',
    'нет связи': 'no connection',
    'Готово': 'Done',
  }
  const de: Table = { 'Готово': 'Fertig' }
  const cases: Array<{ locale: Locale; raw: string; want: string; why: string }> = [
    { locale: 'en', raw: 'Готово', want: 'Done', why: 'a plain core message is looked up whole' },
    { locale: 'en', raw: 'Error: Готово', want: 'Done', why: 'the "Error: " prefix of a rejected promise is not part of the text' },
    { locale: 'en', raw: 'Не удалось открыть папку: нет связи', want: 'Could not open the folder: no connection', why: 'a nested core message inside a template is translated as well' },
    { locale: 'en', raw: 'Скачиваем sodium-0.6.jar…', want: 'Downloading sodium-0.6.jar…', why: 'a file name in the slot is kept as is' },
    { locale: 'en', raw: '12 из 40 МБ', want: '12 of 40 MB', why: 'numbers in several slots land in their places' },
    { locale: 'de', raw: 'Готово', want: 'Fertig', why: 'the own table wins over English' },
    { locale: 'de', raw: 'Скачиваем x…', want: 'Downloading x…', why: 'a template missing in the own table falls back to English, not Russian' },
    { locale: 'en', raw: 'Совсем новая ошибка ядра', want: 'Совсем новая ошибка ядра', why: 'an unknown text is shown as written rather than dropped' },
    { locale: 'ru', raw: 'Error: Готово', want: 'Готово', why: 'Russian shows the core text itself' },
    { locale: 'en', raw: 'HTTP 500', want: 'HTTP 500', why: 'text without Cyrillic is never touched' },
    { locale: 'en', raw: 'Готово; нет связи', want: 'Done; no connection', why: 'reasons the core joined with "; " are translated one by one' },
    { locale: 'en', raw: 'Не удалось открыть папку: Готово; нет связи', want: 'Could not open the folder: Done; no connection', why: 'a joined list inside a template slot is translated as well' },
    { locale: 'en', raw: 'https://cdn.example/x.jar: нет связи', want: 'https://cdn.example/x.jar: no connection', why: 'an address put in front of a reason keeps the address and translates the reason' },
    { locale: 'en', raw: 'Готово: C:\\Games\\x.jar', want: 'Done: C:\\Games\\x.jar', why: 'a stage put in front of a path is translated, the path is kept' },
    { locale: 'en', raw: 'Готово, совсем новая ошибка', want: 'Готово, совсем новая ошибка', why: 'a split that leaves any part untranslated is not taken, so no half-English sentence appears' },
  ]
  for (const c of cases)
    test(c.why, () => {
      expect(localizeCore(c.locale, c.raw, c.locale === 'en' ? en : c.locale === 'de' ? de : null, en), c.why).toBe(c.want)
    })
})
