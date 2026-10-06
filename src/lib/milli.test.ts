import { describe, expect, it, test } from 'bun:test'
import {
  MILLI_PLANS,
  milliChosen,
  milliCounterChip,
  milliEnhancedOn,
  milliLeft,
  milliError,
  milliInstallBody,
  milliItems,
  milliPlans,
  milliResetText,
  refineMilliError,
  siteUrl,
  withPreset,
} from './milli'
import type { MilliItem, MilliPack, MilliStatus } from './milli'

const item = (projectId: string, slug = projectId, base = false): MilliItem => ({
  projectId,
  slug,
  title: slug,
  icon: null,
  why: '',
  base,
  source: 'modrinth',
})

const pack = (over: Partial<MilliPack> = {}): MilliPack => ({
  buildId: 'b1',
  title: 'Ночь мертвецов',
  mcVersion: '1.20.1',
  loader: 'fabric',
  mods: [item('zomb', 'zombies'), item('P7dR8mSH', 'fabric-api', true), item('sod', 'sodium', true)],
  resourcepacks: [item('rp1')],
  shaders: [item('sh1')],
  shaderLoader: item('iris', 'iris', true),
  maps: [],
  links: [],
  excluded: [],
  notes: '',
  locked: { extras: false },
  ...over,
})

const status = (day: number, month = 20, over: Partial<MilliStatus> = {}): MilliStatus => ({
  enabled: true,
  blocked: false,
  plus: false,
  day: { used: 5 - day, limit: 5, remaining: day, resetAt: '2026-10-01T00:00:00Z' },
  month: { used: 30 - month, limit: 30, remaining: month, resetAt: '2026-11-01T00:00:00Z' },
  features: { extras: false, server: false },
  ...over,
})

test('milliChosen: базовые первыми, загрузчик шейдеров только при шейдере', () => {
  const all = milliChosen(pack(), new Set())
  expect(all.mods.map((m) => m.slug)).toEqual(['fabric-api', 'sodium', 'zombies', 'iris'])
  expect(all.resourcepacks.map((m) => m.projectId)).toEqual(['rp1'])
  const noShader = milliChosen(pack(), new Set(['sh1']))
  expect(noShader.shaders).toEqual([])
  expect(noShader.mods.some((m) => m.slug === 'iris')).toBe(false)
})

test('milliChosen: Fabric API не снимается даже снятой галочкой', () => {
  const c = milliChosen(pack(), new Set(['P7dR8mSH', 'zomb', 'sod']))
  expect(c.mods.map((m) => m.slug)).toEqual(['fabric-api', 'iris'])
})

test('milliChosen: загрузчик шейдеров не дублируется, если уже в модах', () => {
  const p = pack({ mods: [item('iris', 'iris', true), item('zomb')] })
  expect(milliChosen(p, new Set()).mods.filter((m) => m.projectId === 'iris').length).toBe(1)
})

test('milliItems и тело install: id отмеченного, имя ≤48, пустые списки не шлём', () => {
  const c = milliChosen(pack(), new Set(['rp1', 'sh1']))
  expect(milliItems(c.mods)[0]).toEqual({ source: 'modrinth', project_id: 'P7dR8mSH' })
  const body = milliInstallBody(pack(), c, '  ' + 'x'.repeat(60))
  expect(body.name.length).toBe(48)
  expect(body.projectIds).toEqual(['P7dR8mSH', 'sod', 'zomb'])
  expect('resourcepackIds' in body || 'shaderIds' in body).toBe(false)
  expect(milliInstallBody(pack(), milliChosen(pack(), new Set()), ' ').name).toBe('Ночь мертвецов')
})

test('milliError: коды из тела, статусы, текст ядра', () => {
  expect(milliError(new Error('http 429 milli_limit month Лимит')).kind).toBe('limit')
  expect(milliError(new Error('http 429 milli_limit month Лимит')).scope).toBe('month')
  expect(milliError(new Error('http 429 milli_busy')).kind).toBe('busy')
  expect(milliError(new Error('http 403 milli_plus')).kind).toBe('plus')
  expect(milliError(new Error('http 401')).kind).toBe('auth')
  expect(milliError('unauthorized').kind).toBe('auth')
  expect(milliError(new Error('http 502')).kind).toBe('failed')
  expect(milliError(new Error('http 502')).retry).toBe(true)
  expect(milliError(new Error('http 503')).kind).toBe('off')
  expect(milliError(new Error('http 403')).kind).toBe('blocked')
  expect(milliError(new TypeError('Failed to fetch')).kind).toBe('offline')
  // В приложении ядро отдаёт только message сервера.
  expect(milliError('Лимит Милли на сегодня исчерпан').kind).toBe('limit')
  expect(milliError('Милли ещё думает над прошлым запросом').kind).toBe('busy')
  expect(milliError('something odd').text).toBe('Милли не ответила')
})

test('refineMilliError: статус после сбоя точнее текста', () => {
  const failed = milliError(new Error('http 500'))
  expect(refineMilliError(failed, status(0)).kind).toBe('limit')
  expect(refineMilliError(failed, status(3, 0)).scope).toBe('month')
  expect(refineMilliError(failed, status(3, 10, { enabled: false })).kind).toBe('off')
  expect(refineMilliError(milliError('лимит'), status(2)).kind).toBe('failed')
  expect(refineMilliError(failed, null)).toBe(failed)
})

test('счётчик и время сброса', () => {
  expect(milliCounterChip(status(3))).toBe('осталось 3')
  expect(milliCounterChip(status(-1))).toBe('осталось 0')
  expect(milliCounterChip(null)).toBe(null)
  // Месяц кончается раньше дня — счётчик показывает меньшее.
  expect(milliLeft(status(3, 1))).toBe(1)
  expect(milliLeft(null)).toBe(null)
  const now = Date.parse('2026-09-30T19:00:00Z')
  expect(milliResetText('2026-10-01T00:00:00Z', now)).toBe('через 5 ч')
  expect(milliResetText('2026-09-30T19:40:00Z', now)).toBe('через 40 мин')
  expect(milliResetText('2026-10-03T19:00:00Z', now)).toBe('через 3 дня')
  expect(milliResetText('2026-10-01T19:00:00Z', now)).toBe('через 1 день')
  expect(milliResetText('2026-09-30T19:00:30Z', now)).toBe('через минуту')
  expect(milliResetText('bad', now)).toBe('')
})

test('«Улучшенная сборка» уходит на сервер только у PLUS', () => {
  expect(milliEnhancedOn(status(3), true)).toBe(false)
  expect(milliEnhancedOn(status(3, 10, { plus: true }), true)).toBe(true)
  expect(milliEnhancedOn(status(3, 10, { plus: true }), false)).toBe(false)
  expect(milliEnhancedOn(status(3, 10, { plus: true, features: { extras: true, server: true, enhanced: false } }), true)).toBe(false)
  expect(milliEnhancedOn(null, true)).toBe(false)
})

test('первое сообщение с версией из «Новой сборки», ссылки сайта', () => {
  expect(withPreset('Хоррор', { mcVersion: '1.20.1', loader: 'fabric' })).toBe('Хоррор (1.20.1, Fabric)')
  expect(withPreset('Хоррор', null)).toBe('Хоррор')
  expect(siteUrl('/maps/x')).toBe('https://millida.net/maps/x')
  expect(siteUrl('https://skins.millida.net/?q=1')).toBe('https://skins.millida.net/?q=1')
})

describe('milliPlans — живые тарифы из /catalog/milli/limits', () => {
  it('берёт цифры из ответа', () => {
    expect(milliPlans({ free: { day: 7, month: 40 }, plus: { day: 150, month: 800 }, period: 'utc', plusExtras: [] })).toEqual({
      free: { day: 7, month: 40 },
      plus: { day: 150, month: 800 },
      diamond: { day: 200, month: 1500 },
    })
  })

  it('чего нет или мусор — из сетки 10/40, 100/600, 200/1500', () => {
    expect(milliPlans({ plus: { day: 120 } })).toEqual({ free: { day: 10, month: 40 }, plus: { day: 120, month: 600 }, diamond: { day: 200, month: 1500 } })
    expect(milliPlans(null)).toEqual(MILLI_PLANS)
  })
})
