import { expect, test } from 'bun:test'
import { quietFor } from './renderGate'

const base = { hidden: false, shown: true, focused: true, game: false }

// Жалоба 25.09.2026: лобби рисовалось поверх идущей игры и забирало FPS.
test('лаунчер замирает, когда поверх идёт игра или окно не видно', () => {
  const cases: [Partial<typeof base>, boolean, string][] = [
    [{}, false, 'обычная работа в лаунчере'],
    [{ focused: false }, false, 'без игры потеря фокуса не глушит всё окно'],
    [{ game: true, focused: false }, true, 'игра в фокусе — лаунчер не рисует'],
    [{ game: true, focused: true }, false, 'игрок вернулся в лаунчер — он живой'],
    [{ hidden: true }, true, 'свёрнуто'],
    [{ shown: false }, true, 'убрано в трей'],
    [{ shown: false, game: true, focused: true }, true, 'в трее во время игры'],
  ]
  for (const [patch, quiet, why] of cases) expect([why, quietFor({ ...base, ...patch })]).toEqual([why, quiet])
})
