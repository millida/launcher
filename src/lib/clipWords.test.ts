import { expect, test } from 'bun:test'
import { clipWords } from './format'

test('a short description is left alone', () => {
  expect(clipWords('Fast bedwars', 40)).toBe('Fast bedwars')
})

test('a long one is cut at a word boundary with an ellipsis, never in the middle of a word', () => {
  const out = clipWords('I spent hours hopping between servers until I found this one', 29)
  expect(out.endsWith('…')).toBe(true)
  expect(out).toBe('I spent hours hopping…')
})
