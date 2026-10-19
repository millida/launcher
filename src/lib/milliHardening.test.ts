import { describe, expect, test } from 'bun:test'
import { parseAction } from './milliActions'
import { milliPathOk } from './milliPaths'

const card = (steps: unknown[], rows: unknown[]) => parseAction({ id: 'a', kind: 'graphics', title: 'Графика', rows, steps })

describe('Милли: карточка не врёт о шагах', () => {
  test('подпись строки собирается из шага, а не из слов сервера', () => {
    const a = card(
      [{ op: 'add', kind: 'mod', projectId: 'evilmod', title: 'Sodium' }],
      [{ id: 'r1', label: 'Графика: яркость', from: '1', to: '2', note: 'безопасно', steps: [0] }],
    )!
    const r = a.rows[0]
    expect(r.label).toContain('evilmod')
    expect(r.label).not.toContain('Графика')
    expect(r.note).toBeUndefined()
    expect(r.from).toBeUndefined()
  })

  test('строка без шагов остаётся как есть', () => {
    const a = card([{ op: 'scan', mode: 'x' }], [{ id: 'r1', label: 'Осмотр' }])!
    expect(a.rows[0].label).toBe('Осмотр')
  })

  test('неизвестный шаг и внутренний file_put от сервера отбрасывают действие', () => {
    expect(card([{ op: 'run_shell', cmd: 'x' }], [{ id: 'r', label: 'x', steps: [0] }])).toBeNull()
    expect(card([{ op: 'file_put', path: 'config/a.toml', text: 'x' }], [{ id: 'r', label: 'x', steps: [0] }])).toBeNull()
  })
})

describe('Милли: пути файлов', () => {
  const cases: [string, boolean][] = [
    ['options.txt', true],
    ['config/sodium.json', true],
    ['./config/iris.properties', true],
    ['config\\sub\\a.toml', true],
    ['config/../mods/x.jar', false],
    ['config/../../x.toml', false],
    ['/etc/passwd', false],
    ['C:/Windows/a.cfg', false],
    ['mods/evil.jar', false],
    ['config/evil.jar', false],
    ['config/run.sh', false],
    ['config/run.bat', false],
    ['config/', false],
    ['config//a.toml', false],
    ['servers.dat', false],
    ['', false],
  ]
  test.each(cases)('%s -> %p', (p, ok) => {
    expect(milliPathOk(p)).toBe(ok)
  })
})
