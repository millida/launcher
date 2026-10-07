import { describe, expect, it } from 'bun:test'
import { BOARDS, boardValueText } from './boards'

describe('доски', () => {
  it('четыре доски в порядке экрана', () => {
    expect(BOARDS.map((b) => b.name)).toEqual(['Неделя', 'Месяц', 'Всё время', 'Огоньки'])
  })
  it('часы с запятой, огоньки — число дней', () => {
    expect(boardValueText('week', 42)).toBe('42 ч')
    expect(boardValueText('month', 7.5)).toBe('7,5 ч')
    expect(boardValueText('streak', 17)).toBe('17 дней')
    expect(boardValueText('streak', 2)).toBe('2 дня')
  })
})
