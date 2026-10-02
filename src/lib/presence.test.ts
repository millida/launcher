import { describe, expect, it } from 'bun:test'
import { STATS_SYNC_EVERY_MS, beatKey, beatStatus, presenceBeatDue, statsSyncDue, type BeatState } from './presence'

/// Input -> verdict. Every row is pinned because the server credits playtime for
/// each "playing" beat: a wrong verdict here is hours the player never played.
describe('beatStatus', () => {
  const cases: Array<[string, string | undefined, boolean, boolean, 'playing' | 'lobby']> = [
    ['игра идёт — бьём playing', undefined, true, true, 'playing'],
    ['launch попросил playing', 'playing', true, true, 'playing'],
    ['lobby при живой сессии остаётся игрой (окно свернули)', 'lobby', true, true, 'playing'],
    ['сессии нет — только lobby', undefined, false, true, 'lobby'],
    ['без ядра сессия ничего не доказывает', undefined, true, false, 'lobby'],
    ['без ядра прямой playing тоже отклоняем', 'playing', true, false, 'lobby'],
  ]

  for (const [name, asked, hasSession, coreAvailable, want] of cases) {
    it(name, () => {
      expect(beatStatus(asked, hasSession, coreAvailable)).toBe(want)
    })
  }
})

const lobby: BeatState = {
  status: 'lobby',
  server: null,
  serverIp: null,
  build: null,
  gameNick: null,
  catalogPack: null,
  discordUserId: null,
}
const playing: BeatState = {
  ...lobby,
  status: 'playing',
  server: 'Хайпиксель',
  serverIp: 'mc.example.net',
  build: 'Survival+',
  gameNick: 'Steve',
  catalogPack: 'survival-plus',
  discordUserId: '42',
}

/// Input -> verdict. Without the socket the beat is what keeps the player online
/// and counts hours, so it must go out every time; with the socket a repeat of
/// the same state is pure load, and any change of state must still reach friends.
describe('presenceBeatDue', () => {
  const k = beatKey(playing)
  const cases: Array<[string, boolean, string, string | null, string | null, boolean]> = [
    ['без сокета каждый удар уходит, даже повтор', false, k, k, null, true],
    ['без сокета и без прошлых ударов', false, k, null, null, true],
    ['сокет: первый удар после подключения', true, k, null, null, true],
    ['сокет: то же состояние — молчим', true, k, k, null, false],
    ['сокет: то же состояние уже в полёте — второй не шлём', true, k, null, k, false],
    ['сокет: состояние сменилось — шлём', true, k, beatKey(lobby), null, true],
  ]
  for (const [name, tracked, key, sent, sending, want] of cases) {
    it(name, () => {
      expect(presenceBeatDue(tracked, key, sent, sending)).toBe(want)
    })
  }
})

/// Input -> verdict. Each field the server stores from the beat must change the
/// key, or that change would never be sent while the socket is live.
describe('beatKey', () => {
  const fields: Array<keyof BeatState> = ['status', 'server', 'serverIp', 'build', 'gameNick', 'catalogPack', 'discordUserId']
  for (const field of fields) {
    it(`смена поля ${field} — новый удар`, () => {
      expect(beatKey({ ...playing, [field]: 'other' })).not.toBe(beatKey(playing))
    })
  }
  it('одно и то же состояние — один ключ', () => {
    expect(beatKey({ ...playing })).toBe(beatKey(playing))
  })
})

describe('statsSyncDue', () => {
  const cases: Array<[string, number, number, boolean]> = [
    ['ни разу не отправляли', 0, 1_000_000, true],
    ['минута в игре — рано, снимок только для сверки', 1_000_000, 1_000_000 + 60_000, false],
    ['ровно десять минут — пора', 1_000_000, 1_000_000 + STATS_SYNC_EVERY_MS, true],
  ]
  for (const [name, last, now, want] of cases) {
    it(name, () => {
      expect(statsSyncDue(last, now)).toBe(want)
    })
  }
})
