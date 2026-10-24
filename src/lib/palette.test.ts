import { describe, expect, test } from 'bun:test'
import { isPaletteShortcut, rankItems, scoreItem, type PaletteItem } from './palette'

const item = (kind: PaletteItem['kind'], title: string, words = ''): PaletteItem => ({ id: kind + title, kind, title, words, run: () => {} })

describe('palette search', () => {
  const cases: Array<[string, string, string, boolean]> = [
    ['title prefix', 'Настройки', 'нас', true],
    ['case and ё do not matter', 'Ёлка', 'ЕЛ', true],
    ['extra words count', 'Звук', 'микрофон', false],
    ['every typed word must be found', 'Мой сервер', 'мой хостинг', false],
    ['an empty query lists everything', 'Друзья', '', true],
  ]
  for (const [why, title, q, found] of cases) test(why, () => expect(scoreItem({ title }, q) > 0).toBe(found))

  test('words widen the match', () => expect(scoreItem({ title: 'Звук', words: 'микрофон наушники' }, 'микро')).toBeGreaterThan(0))

  test('a title prefix ranks above a substring, builds above settings on a tie', () => {
    const list = [item('settings', 'Игра'), item('screen', 'Мои сборки'), item('build', 'Игра с друзьями'), item('build', 'Выживание')]
    expect(rankItems(list, 'игра').map((x) => x.title)).toEqual(['Игра с друзьями', 'Игра'])
  })
})

describe('palette shortcut', () => {
  const key = (p: Partial<KeyboardEvent>) => ({ key: 'k', code: 'KeyK', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...p })
  const cases: Array<[string, Partial<KeyboardEvent>, boolean]> = [
    ['Ctrl+K', { ctrlKey: true }, true],
    ['Cmd+K on macOS', { metaKey: true }, true],
    ['Russian layout gives л on the same key', { key: 'л', code: 'KeyK', ctrlKey: true }, true],
    ['plain K is typing, not a command', {}, false],
    ['Ctrl+Shift+K is left to other bindings', { ctrlKey: true, shiftKey: true }, false],
  ]
  for (const [why, p, want] of cases) test(why, () => expect(isPaletteShortcut(key(p))).toBe(want))
})
