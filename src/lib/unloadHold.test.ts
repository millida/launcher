import { expect, test } from 'bun:test'
import { currentHold, registerUnloadHold, watchHolds } from './unloadHold'

// Вход → вердикт: окно нельзя выгружать, пока в странице идёт установка или звонок,
// и оно должно уйти само, как только они закончились.
test('the window waits for page-only work and hears when it ends', () => {
  let installing = true
  let calling = false
  const subs = new Set<() => void>()
  const subscribe = (cb: () => void) => {
    subs.add(cb)
    return () => subs.delete(cb)
  }
  registerUnloadHold(() => (installing ? 'install' : null), subscribe)
  registerUnloadHold(() => (calling ? 'call' : null), subscribe)
  expect(currentHold(), 'установка в странице оборвалась бы вместе с окном').toBe('install')
  let heard = 0
  const off = watchHolds(() => heard++)
  installing = false
  calling = true
  subs.forEach((cb) => cb())
  expect(currentHold(), 'звонок живёт только в странице').toBe('call')
  calling = false
  subs.forEach((cb) => cb())
  expect(currentHold(), 'ничего не держит — окно выгружается').toBeNull()
  expect(heard).toBeGreaterThan(0)
  off()
  expect(subs.size, 'после выгрузки подписки снимаются, иначе каждая установка будила бы старый обработчик').toBe(0)
})
