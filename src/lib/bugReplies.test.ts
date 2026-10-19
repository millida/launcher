import { expect, test } from 'bun:test'
import { pickReplies, replyText } from './bugReplies'

const tr = (key: string, vars?: Record<string, string | number>) =>
  key.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ''))

test('ответ «починили» несёт версию из ответа сервера', () => {
  expect(replyText({ kind: 'fixed', workaround: null, version: '2.0.240' }, tr)).toBe('Починили в версии 2.0.240 — обновись')
})

test('«починили» с мусором вместо версии не обещает обновление', () => {
  expect(replyText({ kind: 'fixed', workaround: null, version: '<script>' }, tr)).toBe('Знаем об этой проблеме, чиним')
})

test('«знаем, чиним» дополняется советом, если он есть', () => {
  expect(replyText({ kind: 'ack', workaround: 'Добавь папку в исключения антивируса', version: null }, tr)).toBe(
    'Знаем об этой проблеме, чиним. Добавь папку в исключения антивируса',
  )
  expect(replyText({ kind: 'ack', workaround: '  ', version: null }, tr)).toBe('Знаем об этой проблеме, чиним')
})

test('из очереди берутся только «починили» с настоящей версией, не больше двух', () => {
  const items = [
    { id: 'a', kind: 'ack', text: '', version: null },
    { id: 'b', kind: 'fixed', text: '', version: '2.0.1' },
    { id: 'c', kind: 'fixed', text: '', version: 'x' },
    { id: 'd', kind: 'fixed', text: '', version: '2.0.2' },
    { id: 'e', kind: 'fixed', text: '', version: '2.0.3' },
  ]
  expect(pickReplies(items).map((r) => r.id)).toEqual(['b', 'd'])
  expect(pickReplies(null)).toEqual([])
})
