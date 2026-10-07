import { describe, expect, test } from 'bun:test'
import { bagOrder } from './ChestPop'

describe('ChestPop: вещи без повторов, пока пул не пройден', () => {
  test('мешок — перестановка всех вещей пула', () => {
    const bag = bagOrder(12)
    expect([...bag].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i))
  })
  test('пустой и единичный пул', () => {
    expect(bagOrder(0)).toEqual([])
    expect(bagOrder(1)).toEqual([0])
  })
})

import { popKind } from './ChestPop'
import { caseCoins } from '../shop/casePrizes'

describe('ChestPop: валюта среди вещей', () => {
  test('каждая третья — валюта, если она есть', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => popKind(n, 2, 10))).toEqual(['item', 'item', 'coin', 'item', 'item', 'coin'])
    expect(popKind(3, 0, 10)).toBe('item')
    expect(popKind(1, 2, 0)).toBe('coin')
  })
  test('суммы из утешительных призов и бонуса, виды по очереди', () => {
    const c = caseCoins({ consolation: [{ kind: 'shards', min: 20, max: 80 }, { kind: 'rubies', min: 30, max: 30 }], bonus: [{ kind: 'shards', min: 5, max: 10 }] })
    expect(c).toEqual([
      { kind: 'shards', amount: 80 },
      { kind: 'rubies', amount: 30 },
      { kind: 'shards', amount: 5 },
    ])
    expect(caseCoins({})).toEqual([])
  })
})
