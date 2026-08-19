import { expect, test } from 'bun:test'
import { parseLevel } from './notifyPrefs'

test('присутствие друзей по умолчанию показывается молча', () => {
  expect(parseLevel('play', null)).toBe('silent')
  expect(parseLevel('online', null)).toBe('silent')
})

test('сообщения и заявки по умолчанию звучат', () => {
  expect(parseLevel('msg', null)).toBe('sound')
  expect(parseLevel('room', null)).toBe('sound')
  expect(parseLevel('request', null)).toBe('sound')
})

test('сохранённый уровень выигрывает у значения по умолчанию', () => {
  expect(parseLevel('msg', 'off')).toBe('off')
  expect(parseLevel('play', 'sound')).toBe('sound')
})

test('мусор в настройке читается как значение по умолчанию', () => {
  expect(parseLevel('play', 'loud')).toBe('silent')
  expect(parseLevel('msg', '')).toBe('sound')
})
