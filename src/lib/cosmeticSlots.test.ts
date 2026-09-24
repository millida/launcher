import { describe, expect, it } from 'bun:test'
import { cosmeticSlotIcon } from './cosmeticSlots'

describe('значок места на теле', () => {
  it('у каждого места свой значок, у незнакомого - запасной', () => {
    expect(cosmeticSlotIcon('HEAD')).toBe('i-crown')
    expect(cosmeticSlotIcon('CAPE')).toBe('i-cape')
    expect(cosmeticSlotIcon('ЧТО-ТО НОВОЕ'), 'незнакомое место не оставляет вкладку пустой').toBe(
      'i-box',
    )
  })
})
