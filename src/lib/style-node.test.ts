import { beforeEach, expect, test } from 'bun:test'

const created = { id: '', nonce: '', isConnected: false, sheet: null as object | null }
let documentStyles: { nonce: string }[] = []

Object.defineProperty(globalThis, 'document', {
  value: { createElement: () => created, querySelectorAll: () => documentStyles },
  configurable: true,
  writable: true,
})

const { createStyleNode, documentStyleNonce, styleBlocked } = await import('./style-node')

beforeEach(() => {
  created.id = ''
  created.nonce = ''
  created.isConnected = false
  created.sheet = null
  documentStyles = []
})

/// Входы и вердикты. Нонс приходит от Tauri: он ставит его на `<style>` из
/// index.html и добавляет в `style-src`, после чего `'unsafe-inline'` перестаёт
/// действовать и узел без нонса молча не работает — ровно это ломало темы в
/// релизной сборке, оставляя dev рабочим.
const cases: { name: string; styles: { nonce: string }[]; want: string }[] = [
  { name: 'нет ни одного нонса — политика без него, узел валиден и так', styles: [{ nonce: '' }], want: '' },
  { name: 'нонс на первом теге — берём его', styles: [{ nonce: 'abc' }], want: 'abc' },
  {
    name: 'первый тег без нонса, второй с ним — пропуск пустого',
    styles: [{ nonce: '' }, { nonce: 'zz' }],
    want: 'zz',
  },
  { name: 'в документе нет тегов стилей', styles: [], want: '' },
]

for (const c of cases) {
  test('нонс документа: ' + c.name, () => {
    documentStyles = c.styles
    expect(documentStyleNonce()).toBe(c.want)
  })
}

test('созданный узел надевает нонс документа', () => {
  documentStyles = [{ nonce: 'n1' }]
  const el = createStyleNode('m-theme-pack-css')
  expect(el.id).toBe('m-theme-pack-css')
  expect(el.nonce).toBe('n1')
})

test('без нонса в документе атрибут не выставляется', () => {
  const el = createStyleNode('m-theme-pack-css')
  expect(el.nonce).toBe('')
})

/// Отсутствие stylesheet у подключённого узла — единственный читаемый признак,
/// что правила не приняты. Неподключённый узел ещё не обязан его иметь.
test('вердикт «заблокирован» только для подключённого узла без stylesheet', () => {
  const el = created as unknown as HTMLStyleElement
  expect(styleBlocked(el)).toBe(false)
  created.isConnected = true
  expect(styleBlocked(el)).toBe(true)
  created.sheet = {}
  expect(styleBlocked(el)).toBe(false)
})
