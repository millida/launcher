import { describe, expect, test } from 'bun:test'
import {
  LAUNCH_FRESH_MS,
  launchBlock,
  launchToRun,
  lfgTagsOk,
  normalizePartyCode,
  partyCodeOk,
  sameIdentity,
  slotPlan,
  type LfgTags,
  type Party,
  type PartyMember,
} from './party'

const member = (userId: string, joinedAt: number, extra: Partial<PartyMember> = {}): PartyMember => ({
  userId,
  nickname: userId,
  avatarUrl: null,
  role: 'member',
  ready: false,
  joinedAt,
  have: null,
  ...extra,
})

describe('party code', () => {
  const CASES: Array<[string, boolean, string]> = [
    ['AB23CD45', true, 'код как его выдал сервер'],
    ['ab23-cd45', true, 'код диктуют голосом и печатают строчными с дефисом'],
    ['https://millida.net/party/AB23CD45', true, 'друг вставляет всю ссылку'],
    ['AB23CD4', false, 'короткий код не должен уходить в запрос'],
    ['AB23CD4O', false, 'O путают с 0, в алфавите её нет'],
    ['../../x', false, 'код становится сегментом пути запроса'],
    ['', false, 'пустой ввод'],
  ]
  for (const [raw, ok, why] of CASES) {
    test(why, () => {
      expect(partyCodeOk(raw), `«${raw}»: ${why}`).toBe(ok)
    })
  }
  test('нормализация убирает всё, кроме букв и цифр', () => {
    expect(normalizePartyCode(' ab23-cd45 ')).toBe('AB23CD45')
  })
})

describe('slotPlan', () => {
  test('по умолчанию трое слотов рядом с персонажем, первый справа', () => {
    const plan = slotPlan(4, [member('me', 1)], 'me')
    expect(plan.cells.map((c) => c.side), 'пустых слотов должно быть capacity-1 и они чередуются').toEqual([
      'right',
      'left',
      'right',
    ])
    expect(plan.cells.every((c) => c.member === null), 'себя в слот не ставим: я — центральный персонаж').toBe(true)
    expect(plan.size).toBe('lg')
  })

  test('участники встают в порядке входа, свободные места — пустые слоты', () => {
    const plan = slotPlan(4, [member('b', 3), member('me', 1), member('a', 2)], 'me')
    expect(plan.cells.map((c) => c.member?.userId ?? null)).toEqual(['a', 'b', null])
  })

  test('большая пати уменьшает фигуры, чтобы оба фланга поместились', () => {
    expect(slotPlan(6, [], 'me').size, 'по три с каждой стороны').toBe('md')
    expect(slotPlan(8, [], 'me').size, 'по четыре с каждой стороны').toBe('sm')
  })

  test('если состав больше вместимости (вместимость уменьшили), никого не прячем', () => {
    const plan = slotPlan(2, [member('me', 1), member('a', 2), member('b', 3)], 'me')
    expect(plan.cells.length).toBe(2)
  })
})

describe('launchToRun', () => {
  const target = { kind: 'version' as const, ref: '1.21.4', version: '1.21.4', title: 'x', game: '1.21.4' }
  const CASES: Array<[number, number, number, boolean, string]> = [
    [2, 1, 1000, true, 'новый запуск лидера'],
    [1, 1, 1000, false, 'уже обработанный запуск не повторяем'],
    [2, 1, LAUNCH_FRESH_MS + 1, false, 'старый запуск после перезапуска лаунчера не стартует игру'],
  ]
  for (const [seq, last, age, run, why] of CASES) {
    test(why, () => {
      const got = launchToRun({ seq, at: 0, addr: null, target }, last, age)
      expect(!!got, why).toBe(run)
    })
  }
})

describe('launchBlock', () => {
  const target = { kind: 'build' as const, ref: 'AB23CD45', version: '2026-10-09', title: 'x', game: '1.20.1' }
  const party = (members: PartyMember[]): Party => ({
    id: 'p',
    leaderId: 'lead',
    capacity: 4,
    maxCapacity: 8,
    target,
    targetRev: 1,
    members,
    launch: null,
    voice: [],
    rev: 1,
  })
  test('все готовы с той же сборкой — можно запускать', () => {
    const have = { kind: target.kind, ref: target.ref, version: target.version }
    expect(launchBlock(party([member('lead', 1, { role: 'leader' }), member('a', 2, { ready: true, have })]))).toBeNull()
  })
  test('готов, но с другой версией сборки — не пускаем: зайдут с разным набором модов', () => {
    const have = { kind: target.kind, ref: target.ref, version: 'old' }
    const b = launchBlock(party([member('lead', 1, { role: 'leader' }), member('a', 2, { ready: true, have })]))
    expect(b && b.kind, 'версия сборки у участника не совпала с выбранной лидером').toBe('not_ready')
  })
  test('без выбранной цели запуска нет', () => {
    expect(launchBlock({ ...party([]), target: null })).toEqual({ kind: 'no_target' })
  })
  test('sameIdentity не считает пустое совпадением', () => {
    expect(sameIdentity(null, null)).toBe(false)
  })
})

describe('lfgTagsOk', () => {
  const base: LfgTags = { mode: 'survival', version: '1.21.4', pack: '', lang: 'ru', region: 'eu', voice: true, time: 'now' }
  const CASES: Array<[Partial<LfgTags>, boolean, string]> = [
    [{}, true, 'обычная карточка'],
    [{ version: '' }, true, 'версия не важна'],
    [{ pack: 'Позвони мне 8-900' }, false, 'свободный текст в теге — канал для контакта с ребёнком'],
    [{ version: '1.21 напиши в дс' }, false, 'свободный текст под видом версии'],
    [{ mode: 'dating' as LfgTags['mode'] }, false, 'режим вне списка'],
  ]
  for (const [patch, ok, why] of CASES) {
    test(why, () => {
      expect(lfgTagsOk({ ...base, ...patch }), why).toBe(ok)
    })
  }
})
