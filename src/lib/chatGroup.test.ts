import { expect, test } from 'bun:test'
import { dayLabel, isGrouped, isRead } from './chatGroup'
import type { ChatMessage } from '../state/friends'

const at = (ts: number, me?: boolean): ChatMessage => ({ text: 'x', ts, me })

// вход -> вердикт: группировка склеивает подряд идущие реплики одной стороны и
// обязана расклеивать всё остальное, иначе чужое сообщение притворится нашим.
test('склейка только для одной стороны, одного дня и близкого времени', () => {
  const t = Date.parse('2026-08-03T12:00:00Z')
  const cases: Array<[string, ChatMessage[], boolean]> = [
    ['две подряд свои через минуту', [at(t, true), at(t + 60_000, true)], true],
    ['разные стороны', [at(t, true), at(t + 60_000, false)], false],
    ['пауза больше двух минут', [at(t, true), at(t + 121_000, true)], false],
    ['разные дни', [at(t, true), at(t + 86_400_000, true)], false],
    ['первое сообщение в ленте', [at(t, true)], false],
  ]
  for (const [why, msgs, want] of cases) {
    expect(isGrouped(msgs, msgs.length - 1), why).toBe(want)
  }
})

test('день подписывается относительно сегодняшнего', () => {
  const now = Date.parse('2026-08-03T12:00:00Z')
  expect(dayLabel(now - 3_600_000, now)).toBe('Сегодня')
  expect(dayLabel(now - 86_400_000, now)).toBe('Вчера')
  expect(dayLabel(now - 5 * 86_400_000, now)).not.toBe('Вчера')
})

// Галочка «прочитано» на неотправленном сообщении — прямая ложь пользователю,
// именно из-за неё старый чат выглядел рабочим, когда отправка падала.
test('прочитанным считается только своё доставленное сообщение не новее отметки', () => {
  const readAt = 1_000
  expect(isRead({ text: 'a', me: true, ts: 900 }, readAt)).toBe(true)
  expect(isRead({ text: 'a', me: true, ts: 1_100 }, readAt)).toBe(false)
  expect(isRead({ text: 'a', me: true, ts: 900, state: 'sending' }, readAt)).toBe(false)
  expect(isRead({ text: 'a', me: true, ts: 900, state: 'failed' }, readAt)).toBe(false)
  expect(isRead({ text: 'a', me: false, ts: 900 }, readAt)).toBe(false)
  expect(isRead({ text: 'a', me: true }, readAt)).toBe(false)
})
