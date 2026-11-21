import { expect, test } from 'bun:test'
import { filesDisabledBy } from './crashUndo'

test('«Вернуть» знает, какие моды выключила починка', () => {
  const cases: [string, string | undefined, string[], string][] = [
    ['disable-mod', 'jei-old.jar', ['jei-old.jar'], 'один мод — один файл'],
    ['disable-added', JSON.stringify(['a.jar', 'b.jar']), ['a.jar', 'b.jar'], 'новые моды после удачного запуска'],
    ['fix-plan', JSON.stringify([['install-dep', 'fabric-api|*'], ['disable-mod', 'x.jar']]), ['x.jar'], 'из плана — только выключенные, поставленное не трогаем'],
    ['install-dep', 'fabric-api|*', [], 'установку «Вернуть» не откатывает'],
    ['disable-added', 'not json', [], 'мусор вместо списка'],
    ['disable-mod', undefined, [], 'без файла'],
  ]
  for (const [kind, arg, want, why] of cases) expect(filesDisabledBy(kind, arg), why).toEqual(want)
})
