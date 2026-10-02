import { describe, expect, it } from 'bun:test'
import type { Friend } from '../state/friends'
import { TYPING_FALLBACK_MS, readPresencePush, readTypingPush, typingHoldMs, withPresence } from './friendsPush'

const inGame: Friend = {
  userId: 'u1',
  nickname: 'Steve',
  online: true,
  playing: true,
  place: 'game',
  text: 'В игре · Хайпиксель',
  serverIp: 'mc.example.net',
  serverName: 'Хайпиксель',
  build: 'Survival+',
  gameNick: 'Steve_MS',
  lastSeen: 1_000,
  unread: 2,
}
const offline: Friend = { userId: 'u2', nickname: 'Alex', online: false, playing: false, place: null, text: 'Не в сети', lastSeen: 500 }
const list = [inGame, offline]

/// Input -> verdict. A push the client cannot rebuild exactly must turn into one
/// fetch (null): a guessed card would lose the join button or say the wrong place.
describe('withPresence', () => {
  const cases: Array<[string, Parameters<typeof withPresence>[1], Partial<Friend> | null]> = [
    [
      'вернулся в лаунчер — карточка как у сервера, без адреса и сборки',
      { id: 'u1', status: 'online', server: null, at: 2_000 },
      { online: true, playing: false, place: 'launcher', text: 'В лаунчере', lastSeen: 2_000, serverIp: undefined, build: undefined },
    ],
    [
      'зашёл в лаунчер из офлайна',
      { id: 'u2', status: 'online', server: null, at: 3_000 },
      { online: true, place: 'launcher', text: 'В лаунчере' },
    ],
    [
      'тот же сервер — меняется только отметка',
      { id: 'u1', status: 'playing', server: 'Хайпиксель', at: 4_000 },
      { playing: true, serverIp: 'mc.example.net', lastSeen: 4_000 },
    ],
    ['другой сервер — адреса в публикации нет, перезапрос', { id: 'u1', status: 'playing', server: 'Другой', at: 4_000 }, null],
    ['начал играть — адреса и сборки нет, перезапрос', { id: 'u2', status: 'playing', server: 'Хайпиксель', at: 4_000 }, null],
    ['вышел — «на сайте» или «не в сети» знает только сервер', { id: 'u1', status: 'offline', server: null, at: 5_000 }, null],
    ['незнакомый — новый друг, нужен список', { id: 'u9', status: 'online', server: null, at: 5_000 }, null],
  ]

  for (const [name, push, want] of cases) {
    it(name, () => {
      const next = withPresence(list, push)
      if (want === null) {
        expect(next).toBeNull()
        return
      }
      expect(next).not.toBeNull()
      const got = (next as Friend[]).find((f) => f.userId === push.id) as Friend
      for (const [k, v] of Object.entries(want)) expect(got[k as keyof Friend]).toEqual(v as never)
      expect(got.unread ?? 0).toBe(push.id === 'u1' ? 2 : 0)
    })
  }

  it('не трогает остальных друзей и исходный массив', () => {
    const next = withPresence(list, { id: 'u1', status: 'online', server: null, at: 2_000 }) as Friend[]
    expect(next[1]).toBe(offline)
    expect(list[0]).toBe(inGame)
    expect(inGame.serverIp).toBe('mc.example.net')
  })
})

/// Input -> verdict. A malformed push is treated as a bare poke (null), which
/// costs one fetch instead of showing a broken status.
describe('readPresencePush', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['форма из договора', { t: 'presence', u: { id: 'u1', status: 'playing', server: 'X', at: 1 } }, true],
    ['сервер null', { t: 'presence', u: { id: 'u1', status: 'online', server: null, at: 1 } }, true],
    ['без at — время клиента', { t: 'presence', u: { id: 'u1', status: 'online', server: null } }, true],
    ['толчок без u', { t: 'presence' }, false],
    ['неизвестный статус', { t: 'presence', u: { id: 'u1', status: 'away', server: null, at: 1 } }, false],
    ['пустой id', { t: 'presence', u: { id: '', status: 'online', server: null, at: 1 } }, false],
    ['сервер числом', { t: 'presence', u: { id: 'u1', status: 'playing', server: 5, at: 1 } }, false],
    ['u массивом', { t: 'presence', u: [] }, false],
  ]
  for (const [name, data, ok] of cases) {
    it(name, () => {
      expect(!!readPresencePush(data)).toBe(ok)
    })
  }
})

describe('readTypingPush', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['форма из договора', { t: 'friends', typing: { from: 'u1', until: 10 } }, true],
    ['толчок о сообщении', { t: 'friends' }, false],
    ['until строкой', { t: 'friends', typing: { from: 'u1', until: '10' } }, false],
    ['без from', { t: 'friends', typing: { until: 10 } }, false],
  ]
  for (const [name, data, ok] of cases) {
    it(name, () => {
      expect(!!readTypingPush(data)).toBe(ok)
    })
  }
})

/// Input -> verdict. "Typing" must vanish on its own: a stuck indicator reads as a
/// message that never comes. Clocks of client and server may disagree.
describe('typingHoldMs', () => {
  const cases: Array<[string, number, number, number]> = [
    ['обычный случай — до until сервера', 16_000, 10_000, 6_000],
    ['часы клиента убежали вперёд — запасные 6 с', 9_000, 10_000, TYPING_FALLBACK_MS],
    ['часы клиента отстали — не держим минуту', 70_000, 10_000, TYPING_FALLBACK_MS],
  ]
  for (const [name, until, now, want] of cases) {
    it(name, () => {
      expect(typingHoldMs(until, now)).toBe(want)
    })
  }
})
