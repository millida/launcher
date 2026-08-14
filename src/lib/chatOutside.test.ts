import { expect, test } from 'bun:test'

class FakeElement {
  id = ''
  classList: { contains: (c: string) => boolean }
  constructor(id: string, classes: string[]) {
    this.id = id
    this.classList = { contains: (c: string) => classes.includes(c) }
  }
}

Object.defineProperty(globalThis, 'HTMLElement', { value: FakeElement, configurable: true, writable: true })

const { keepsChatOpen } = await import('./chatOutside')

const el = (id: string, ...classes: string[]) => new FakeElement(id, classes) as unknown as EventTarget

const CASES: { name: string; path: EventTarget[]; keep: boolean }[] = [
  { name: 'сама панель переписки', path: [el('', 'chat-body'), el('chat')], keep: true },
  { name: 'карточка уведомления открывает переписку', path: [el('', 'chat-notify-body'), el('', 'chat-notify')], keep: true },
  { name: 'док звонка открывает переписку', path: [el('', 'call-dock-who'), el('', 'call-dock')], keep: true },
  { name: 'строка друга открывает переписку', path: [el('', 'fr-row')], keep: true },
  { name: 'просмотр картинки поверх переписки', path: [el('', 'lightbox')], keep: true },
  { name: 'клик по контенту экрана', path: [el('', 'card'), el('', 'content')], keep: false },
  { name: 'пустой путь', path: [], keep: false },
  { name: 'не-элементы в пути', path: [{} as EventTarget], keep: false },
]

for (const c of CASES)
  test('keepsChatOpen: ' + c.name, () => {
    expect(keepsChatOpen(c.path)).toBe(c.keep)
  })
