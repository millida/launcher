import { expect, test } from 'bun:test'
import type { Friend } from './friends'
import { createPresenceMemo, presenceEvents, presenceText, presenceTitle } from './presenceNotify'

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

// Вход → вердикт. Мигание присутствия — не новая сессия: стук лаунчера может
// опоздать, и друг на один опрос выпадает из «в игре». Без памяти каждое такое
// мигание приходило игроку отдельной карточкой «зашёл в игру».
test('возврат в игру после мигания не звонит второй раз', () => {
  const memo = createPresenceMemo()
  const off = [f('durov', { online: true, playing: false, place: 'web' })]
  const on = [f('durov', { online: true, playing: true, place: 'game' })]
  expect(presenceEvents(off, on, memo, 0).started).toHaveLength(1)
  expect(presenceEvents(on, off, memo, 60_000).started).toHaveLength(0)
  expect(presenceEvents(off, on, memo, 120_000).started).toHaveLength(0)
})

test('новая сессия спустя окно тишины звонит снова', () => {
  const memo = createPresenceMemo()
  const off = [f('durov', { online: true, playing: false, place: 'launcher' })]
  const on = [f('durov', { online: true, playing: true, place: 'game' })]
  expect(presenceEvents(off, on, memo, 0).started).toHaveLength(1)
  expect(presenceEvents(on, off, memo, 60_000).started).toHaveLength(0)
  expect(presenceEvents(off, on, memo, 11 * 60_000).started).toHaveLength(1)
})

test('мигание лаунчера не звонит карточкой «в сети»', () => {
  const memo = createPresenceMemo()
  const off = [f('durov', { online: false })]
  const on = [f('durov', { online: true, place: 'launcher' })]
  expect(presenceEvents(off, on, memo, 0).cameOnline).toHaveLength(1)
  expect(presenceEvents(off, on, memo, 60_000).cameOnline).toHaveLength(0)
})

test('память не копит ушедших друзей', () => {
  const memo = createPresenceMemo()
  presenceEvents([f('a', { playing: false })], [f('a', { playing: true, online: true, place: 'game' })], memo, 0)
  presenceEvents([f('a')], [], memo, 11 * 60_000)
  expect(memo.playing.size).toBe(0)
  expect(memo.online.size).toBe(0)
})
