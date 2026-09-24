import { expect, test } from 'bun:test'
import { modalToClose } from './escClose'

test('Esc закрывает верхнее окно лаунчера', () => {
  expect(modalToClose([{ id: 'impModal', z: 400 }])).toBe('impModal')
  expect(modalToClose([{ id: 'bsModal', z: 400 }, { id: 'pjModal', z: 400 }])).toBe('pjModal')
  expect(modalToClose([{ id: 'wnModal', z: 400 }, { id: 'mgModal', z: 400 }])).toBe('mgModal')
})

test('над окном чужой слой — Esc достаётся ему, окно под ним стоит', () => {
  expect(modalToClose([{ id: 'pjModal', z: 400 }, { id: '', z: 980 }])).toBeNull()
})

test('ничего не открыто — закрывать нечего', () => {
  expect(modalToClose([])).toBeNull()
})
