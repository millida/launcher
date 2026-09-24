import { describe, expect, test } from 'bun:test'
import { playTier } from './playTiers'

describe('ступени наигранного', () => {
  test('ноль — ни одной ступени, путь к первому часу', () => {
    expect(playTier(0)).toEqual({ reached: 0, next: 1, progress: 0 })
  })
  test('середина пути между 10 и 50 часами', () => {
    const t = playTier(30 * 3600)
    expect(t.reached).toBe(2)
    expect(t.next).toBe(50)
    expect(t.progress).toBeCloseTo(0.5)
  })
  test('ровно на ступени — она уже взята', () => {
    expect(playTier(100 * 3600).reached).toBe(4)
  })
  test('после последней ступени дальше идти некуда', () => {
    expect(playTier(6000 * 3600)).toEqual({ reached: 9, next: null, progress: 1 })
  })
})
