import { describe, expect, it } from 'bun:test'
import { cosmeticInflate, cosmeticSlotIcon, cubeInflate } from './cosmeticSlots'

describe('значок места на теле', () => {
  it('у каждого места свой значок, у незнакомого - запасной', () => {
    expect(cosmeticSlotIcon('HEAD')).toBe('i-crown')
    expect(cosmeticSlotIcon('CAPE')).toBe('i-cape')
    expect(cosmeticSlotIcon('ЧТО-ТО НОВОЕ'), 'незнакомое место не оставляет вкладку пустой').toBe(
      'i-box',
    )
  })
})

describe('куб в плоскости надслоя скина', () => {
  it('наплечники (0.2 + место) отходят от надслоя рукава на сотую', () => {
    const total = cubeInflate(0.2, cosmeticInflate('SHOULDERS'))
    expect(total).toBeCloseTo(0.26, 6)
    expect(cubeInflate(0.45, cosmeticInflate('SHOULDERS'))).toBeCloseTo(0.51, 6)
  })

  it('остальные кубы не трогаются', () => {
    expect(cubeInflate(0, cosmeticInflate('TOP'))).toBeCloseTo(0.02, 6)
    expect(cubeInflate(0.4, cosmeticInflate('SHOULDERS'))).toBeCloseTo(0.45, 6)
    expect(cubeInflate(0.1, 0.05)).toBeCloseTo(0.15, 6)
  })
})
