import { describe, expect, it } from 'bun:test'
import { beatStatus } from './presence'

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
