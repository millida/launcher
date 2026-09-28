import { describe, expect, test } from 'bun:test'
import { AUTO_UPDATE_PLAYED_WITHIN_MS, autoUpdateAttempt, autoUpdateVerdict } from './packAutoUpdate'
import type { AutoUpdateInput, AutoUpdateVerdict } from './packAutoUpdate'

const NOW = 1_800_000_000_000
const update = { slug: 'oneblock-metalabs', from: '1.0.8', to: '1.0.9' }
const idle: AutoUpdateInput = {
  update,
  lastPlayedAt: NOW - 60 * 60 * 1000,
  now: NOW,
  gameRunning: false,
  launching: false,
  busy: false,
  failed: false,
}

// state of the launcher -> what the background does with the build.
const cases: Array<[string, Partial<AutoUpdateInput>, AutoUpdateVerdict]> = [
  ['вышла новая версия сборки, в которую играют, — лаунчер ставит её сам, не дожидаясь «Играть»', {}, { kind: 'update', update }],
  ['стоит опубликованная версия — качать нечего', { update: null }, { kind: 'skip', reason: 'current' }],
  [
    'сборку ни разу не запускали — гигабайты в фоне ради неё не качаем',
    { lastPlayedAt: null },
    { kind: 'skip', reason: 'not-played' },
  ],
  [
    'сборку бросили больше двух недель назад — фон её не трогает, обновит «Играть»',
    { lastPlayedAt: NOW - AUTO_UPDATE_PLAYED_WITHIN_MS - 1 },
    { kind: 'skip', reason: 'not-played' },
  ],
  [
    'ровно на границе двух недель сборка ещё считается живой',
    { lastPlayedAt: NOW - AUTO_UPDATE_PLAYED_WITHIN_MS },
    { kind: 'update', update },
  ],
  ['идёт игра — канал не отбираем, иначе лаг на сервере', { gameRunning: true }, { kind: 'skip', reason: 'game' }],
  ['идёт запуск — сборку обновляет сам запуск', { launching: true }, { kind: 'skip', reason: 'launching' }],
  ['обновление уже качается — вторая задача делила бы с ним временные файлы', { busy: true }, { kind: 'skip', reason: 'busy' }],
  [
    'эта версия уже не встала в фоне — не качаем гигабайт каждые полчаса, причину покажет «Играть»',
    { failed: true },
    { kind: 'skip', reason: 'failed' },
  ],
]

describe('autoUpdateVerdict', () => {
  for (const [why, patch, want] of cases) {
    test(why, () => {
      expect(autoUpdateVerdict({ ...idle, ...patch }), why).toEqual(want)
    })
  }
})

describe('autoUpdateAttempt', () => {
  test('неудача помнится для версии, а не для сборки: следующий выпуск снова пробуется в фоне', () => {
    const next = { ...update, to: '1.0.10' }
    expect(autoUpdateAttempt('OneBlock', update)).not.toBe(autoUpdateAttempt('OneBlock', next))
    expect(autoUpdateAttempt('OneBlock', update)).not.toBe(autoUpdateAttempt('OneBlock 2', update))
  })
})
