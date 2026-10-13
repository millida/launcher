import { expect, test } from 'bun:test'
import type { PlusStatus } from './gameProfile'
import { purchaseLanded } from './plusPurchase'

const plus = (patch: Partial<PlusStatus>): PlusStatus => ({
  active: true,
  paidUntil: '2026-11-01T00:00:00.000Z',
  canceled: false,
  priceKopecks: 19900,
  items: 0,
  tier: 'PLUS',
  ...patch,
})

const CASES: [string, PlusStatus | null, PlusStatus | null, boolean][] = [
  ['подписки не было, после оплаты она активна', plus({ active: false, paidUntil: null, tier: null }), plus({}), true],
  ['состояние до оплаты не успело загрузиться — активная подписка считается покупкой', null, plus({}), true],
  [
    'у игрока уже был PLUS, он открыл оплату Diamond: первый же опрос видел старый PLUS и праздновал покупку, которой не было',
    plus({}),
    plus({}),
    false,
  ],
  ['оплата Diamond поверх PLUS видна по смене уровня', plus({}), plus({ tier: 'DIAMOND' }), true],
  ['продление того же уровня видно по новой дате', plus({}), plus({ paidUntil: '2026-12-01T00:00:00.000Z' }), true],
  ['опрос не ответил — ждём дальше', plus({ active: false }), null, false],
  ['оплата ещё не прошла', plus({ active: false }), plus({ active: false }), false],
]

test.each(CASES)('оплата подписки: %s', (_why, before, now, landed) => {
  expect(purchaseLanded(before, now)).toBe(landed)
})
