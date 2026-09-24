import { expect, test } from 'bun:test'
import { isOwnMediaUrl } from './ownMedia'

test('вложения чата грузятся только из своего хранилища', () => {
  expect(isOwnMediaUrl('https://cdn.millida.trade/chat/a.png')).toBe(true)
  expect(isOwnMediaUrl('https://CDN.millida.net/chat/a.png')).toBe(true)
  expect(isOwnMediaUrl('blob:tauri://localhost/123')).toBe(true)
  expect(isOwnMediaUrl('http://cdn.millida.trade/a.png')).toBe(false)
  expect(isOwnMediaUrl('https://cdn.millida.trade.evil.io/a.png')).toBe(false)
  expect(isOwnMediaUrl('https://evil.io/track.png')).toBe(false)
  expect(isOwnMediaUrl('')).toBe(false)
})
