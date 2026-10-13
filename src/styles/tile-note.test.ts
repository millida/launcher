import { expect, test } from 'bun:test'

const css = await Bun.file(new URL('./pixel/character.css', import.meta.url)).text()
const tile = await Bun.file(new URL('../components/character/ItemTile.tsx', import.meta.url)).text()

const ruleBody = (selector: string): string => {
  const found = new RegExp(selector.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}').exec(css)
  expect(found, selector + ': правило пропало из стилей гардероба — пин смотрит не туда').not.toBeNull()
  return found![1]
}

test('длинная строка статуса карточки обрезается с конца, с многоточием', () => {
  const row = ruleBody('.ch-tile-status')
  expect(row, 'строка статуса перестала быть флексом — пин устарел, проверь обрезку заново').toContain('inline-flex')

  const note = ruleBody('.ch-tile-note')
  const needs: [string, string][] = [
    ['min-width: 0', 'без этого текст не сжимается и вылезает за карточку'],
    ['overflow: hidden', 'без этого многоточие не появляется'],
    ['text-overflow: ellipsis', 'условие плаща режется на полуслове без знака, что текст длиннее'],
  ]
  for (const [declaration, why] of needs) expect(note, declaration + ': ' + why).toContain(declaration)

  expect(
    tile,
    'текст статуса лежит голым во флекс-строке: центрирование срезает длинную строку с обоих концов',
  ).toContain('<span className="ch-tile-note">{p.note}</span>')
})
