import { expect, test } from 'bun:test'
import { dependentsText, namesList } from './modDependents'

// Input -> verdict. The warning names who breaks without the removed mod; a
// long list must stay readable, and one mod or several get their own grammar.
const lists: Array<[string, string[], string]> = [
  ['one dependent is named as is', ['Iris Shaders'], 'Iris Shaders'],
  ['five fit without a tail', ['A', 'B', 'C', 'D', 'E'], 'A, B, C, D, E'],
  ['the sixth turns into a count', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], 'A, B, C, D, E и ещё 2'],
]

for (const [name, names, want] of lists) {
  test(name, () => {
    expect(namesList(names)).toBe(want)
  })
}

test('one mod and several mods read differently', () => {
  expect(dependentsText(['Mod Menu', 'Entity Culling'], false)).toBe('От этого мода зависят: Mod Menu, Entity Culling. Без него они не запустятся.')
  expect(dependentsText(['Mod Menu'], true)).toBe('От этих модов зависят: Mod Menu. Без них они не запустятся.')
})
