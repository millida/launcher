import { describe, expect, test } from 'bun:test'
import { pluralIn, relativeTimeIn, type RelativeOptions } from './relative'

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

type Case = { ago: number; options?: RelativeOptions; want: Record<string, string>; why: string }

const cases: Case[] = [
  {
    ago: 10_000,
    want: { 'en-US': 'now', 'ru-RU': 'сейчас', 'pt-BR': 'agora', 'es-ES': 'ahora', 'de-DE': 'jetzt', 'tr-TR': 'şimdi', 'pl-PL': 'teraz' },
    why: 'under a minute is "now", not "0 minutes ago"',
  },
  {
    ago: 5 * MIN,
    want: {
      'en-US': '5 minutes ago',
      'ru-RU': '5 минут назад',
      'pt-BR': 'há 5 minutos',
      'es-ES': 'hace 5 minutos',
      'de-DE': 'vor 5 Minuten',
      'tr-TR': '5 dakika önce',
      'pl-PL': '5 minut temu',
    },
    why: 'minutes are counted within the first hour',
  },
  {
    ago: 5 * HOUR,
    want: {
      'en-US': '5 hours ago',
      'ru-RU': '5 часов назад',
      'pt-BR': 'há 5 horas',
      'es-ES': 'hace 5 horas',
      'de-DE': 'vor 5 Stunden',
      'tr-TR': '5 saat önce',
      'pl-PL': '5 godzin temu',
    },
    why: 'the screenshot case: an offline friend seen hours ago',
  },
  {
    ago: DAY + HOUR,
    want: { 'en-US': 'yesterday', 'ru-RU': 'вчера', 'pt-BR': 'ontem', 'es-ES': 'ayer', 'de-DE': 'gestern', 'tr-TR': 'dün', 'pl-PL': 'wczoraj' },
    why: 'one day reads as the word for yesterday in every language',
  },
  {
    ago: 3 * DAY,
    want: {
      'en-US': '3 days ago',
      'ru-RU': '3 дня назад',
      'pt-BR': 'há 3 dias',
      'es-ES': 'hace 3 días',
      'de-DE': 'vor 3 Tagen',
      'tr-TR': '3 gün önce',
      'pl-PL': '3 dni temu',
    },
    why: 'the few-form of Russian and Polish plurals is chosen by the language rules',
  },
  {
    ago: 13 * DAY,
    want: {
      'en-US': 'last week',
      'ru-RU': 'на прошлой неделе',
      'pt-BR': 'semana passada',
      'es-ES': 'la semana pasada',
      'de-DE': 'letzte Woche',
      'tr-TR': 'geçen hafta',
      'pl-PL': 'w zeszłym tygodniu',
    },
    why: 'whole units are counted down: 13 days are one week, not an inflated two',
  },
  {
    ago: 3 * HOUR,
    options: { floor: 'day' },
    want: { 'en-US': 'today', 'ru-RU': 'сегодня', 'pt-BR': 'hoje', 'es-ES': 'hoy', 'de-DE': 'heute', 'tr-TR': 'bugün', 'pl-PL': 'dzisiaj' },
    why: 'a day-grained date says "today" instead of counting hours',
  },
  {
    ago: -3 * HOUR,
    want: {
      'en-US': 'in 3 hours',
      'ru-RU': 'через 3 часа',
      'pt-BR': 'em 3 horas',
      'es-ES': 'dentro de 3 horas',
      'de-DE': 'in 3 Stunden',
      'tr-TR': '3 saat sonra',
      'pl-PL': 'za 3 godziny',
    },
    why: 'a moment in the future reads forward, as the next Milli reset does',
  },
  {
    ago: 40 * DAY,
    options: { ceil: 'day' },
    want: {
      'en-US': '40 days ago',
      'ru-RU': '40 дней назад',
      'pt-BR': 'há 40 dias',
      'es-ES': 'hace 40 días',
      'de-DE': 'vor 40 Tagen',
      'tr-TR': '40 gün önce',
      'pl-PL': '40 dni temu',
    },
    why: 'a ceiling keeps the count in days where the screen compares days',
  },
]

describe('relativeTimeIn speaks the interface language', () => {
  for (const c of cases)
    for (const [tag, want] of Object.entries(c.want))
      test(`${tag}: ${c.why}`, () => {
        expect(relativeTimeIn(tag, NOW - c.ago, NOW, c.options), c.why).toBe(want)
      })
  test('a broken moment yields nothing instead of "NaN days ago"', () => {
    expect(relativeTimeIn('en-US', Number.NaN, NOW), 'a missing date must not print garbage').toBe('')
  })
})

describe('pluralIn picks the source form by the rules of the language', () => {
  const cases: Array<[tag: string, n: number, want: 'one' | 'few' | 'many', why: string]> = [
    ['ru-RU', 1, 'one', 'Russian 1 takes the first form'],
    ['ru-RU', 22, 'few', 'Russian 22 takes the 2-4 form'],
    ['ru-RU', 11, 'many', 'Russian 11 is not "one" despite ending in 1'],
    ['pl-PL', 3, 'few', 'Polish has its own 2-4 form, which English rules would lose'],
    ['pl-PL', 5, 'many', 'Polish 5 takes the many form'],
    ['en-US', 2, 'many', 'English has only singular and plural'],
    ['de-DE', 1, 'one', 'German singular'],
  ]
  for (const [tag, n, want, why] of cases)
    test(`${tag} ${n}`, () => {
      expect(pluralIn(tag, n, 'one', 'few', 'many'), why).toBe(want)
    })
})
