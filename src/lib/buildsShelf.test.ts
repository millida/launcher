import { describe, expect, test } from 'bun:test'
import { BUILDS_SHOWN, buildsShelf } from './buildsShelf'

const builds = (n: number) => Array.from({ length: n }, (_, i) => ({ name: 'b' + (i + 1) }))
const names = (xs: { name: string }[]) => xs.map((x) => x.name)

describe('buildsShelf — «Мои сборки» с «Показать ещё»', () => {
  const cases: Array<[string, number, string | null, boolean, string[], number, boolean]> = [
    ['мало сборок — все на месте, плитки-переключателя нет', 3, null, false, ['b1', 'b2', 'b3'], 0, false],
    ['ровно два ряда с «Все версии» — сворачивать нечего', 9, null, false, names(builds(9)), 0, false],
    ['десять — первые восемь и «Показать ещё 2»', 10, null, false, names(builds(8)), 2, true],
    ['раскрыто — все сборки и «Свернуть»', 10, null, true, names(builds(10)), 0, true],
    ['выбранная в первых — порядок не меняется', 12, 'b3', false, names(builds(8)), 4, true],
    ['выбранная за краем встаёт на последнее место — «Играть» не теряет её из виду', 12, 'b11', false, [...names(builds(7)), 'b11'], 4, true],
    ['выбрана не сборка (сервер, версия) — обычная свёртка', 12, 'нет такой', false, names(builds(8)), 4, true],
  ]
  for (const [why, n, selected, expanded, shown, hidden, toggle] of cases) {
    test(why, () => {
      const s = buildsShelf(builds(n), selected, expanded)
      expect(names(s.shown)).toEqual(shown)
      expect(s.hidden).toBe(hidden)
      expect(s.toggle).toBe(toggle)
    })
  }

  test('свёрнутая полка с «Все версии» и переключателем — ровно два ряда по пять', () => {
    expect(BUILDS_SHOWN + 2).toBe(10)
  })
})
