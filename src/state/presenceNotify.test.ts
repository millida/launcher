import { expect, test } from 'bun:test'
import type { Friend } from './friends'
import { presenceEvents, presenceText, presenceTitle } from './presenceNotify'

const f = (userId: string, extra: Partial<Friend> = {}): Friend => ({ userId, nickname: userId, ...extra })

test('карточка о заходе в игру не дублируется карточкой «в сети»', () => {
  const before = [f('durov', { online: false, playing: false })]
  const now = [f('durov', { online: true, playing: true })]
  const { started, cameOnline } = presenceEvents(before, now)
  expect(started.map((x) => x.userId)).toEqual(['durov'])
  expect(cameOnline).toHaveLength(0)
})

test('уже онлайн и уже в игре не порождает событий', () => {
  const before = [f('a', { online: true, playing: true })]
  const { started, cameOnline } = presenceEvents(before, before)
  expect(started).toHaveLength(0)
  expect(cameOnline).toHaveLength(0)
})

test('присутствие только на сайте не считается заходом в лаунчер', () => {
  const before = [f('web', { online: false })]
  const now = [f('web', { online: true, place: 'web' })]
  expect(presenceEvents(before, now).cameOnline).toHaveLength(0)
})

test('заголовок сворачивает толпу, а не перечисляет всех', () => {
  const list = [f('a'), f('b'), f('c'), f('d')]
  expect(presenceTitle(list)).toBe('a, b и ещё 2')
  expect(presenceTitle([f('solo')])).toBe('solo')
})

test('текст согласован по числу друзей', () => {
  expect(presenceText([f('a'), f('b')], 'online')).toBe('2 друга в сети')
  expect(presenceText([f('a'), f('b'), f('c'), f('d'), f('e')], 'play')).toBe('5 друзей в игре')
  expect(presenceText([f('a', { serverName: 'Моя сборка' })], 'play')).toBe('Играет · Моя сборка')
  expect(presenceText([f('a')], 'online')).toBe('В сети')
})
