import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dropBootSplash } from './boot'

// Вход → вердикт. Закреплено после 1.0.84: окно оверлея грузит тот же
// index.html, заставка оттуда никем не снималась и висела на весь экран
// поверх всего, без рамки и без кнопки закрытия.
test('заставка снимается, когда она есть в документе', () => {
  let removed = false
  const doc = { getElementById: () => ({ remove: () => (removed = true) }) as unknown as HTMLElement }
  dropBootSplash(doc)
  expect(removed).toBe(true)
})

test('документ без заставки не роняет запуск', () => {
  expect(() => dropBootSplash({ getElementById: () => null })).not.toThrow()
})

test('окно оверлея снимает заставку до отрисовки', () => {
  const src = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
  const branch = src.slice(src.indexOf('if (isOverlay)'), src.lastIndexOf('createRoot'))
  expect(branch).toContain('dropBootSplash')
})

test('заставка в index.html непрозрачна на весь экран — снимать её обязательно', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const rule = /#boot\{([^}]*)\}/.exec(html)?.[1] ?? ''
  expect(rule).toContain('inset:0')
  expect(rule).toMatch(/background:#[0-9a-f]{3,6}/i)
})
