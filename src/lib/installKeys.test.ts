import { expect, test } from 'bun:test'
import { keyContent, pickTargetName } from './installKeys'

// Вход → вердикт. Закреплено потому, что по этому имени строится ключ задачи:
// разойдётся с тем, куда реально ставится мод — строка навсегда останется
// «Добавить», а нажатие будет качать файл заново.
const cases: Array<[string, string | null, string[], string, string]> = [
  ['каталог открыт из сборки — она и есть цель', 'Тех', ['Тех', 'Ваниль'], 'Ваниль', 'Тех'],
  ['сборка одна — спрашивать нечего', null, ['Ваниль'], '', 'Ваниль'],
  ['без области берём выбранную сборку', null, ['Тех', 'Ваниль'], 'Ваниль', 'Ваниль'],
  ['удалённая область не подменяет выбранную', 'Стёртая', ['Тех', 'Ваниль'], 'Тех', 'Тех'],
  ['сборок нет — цели нет', null, [], 'Ваниль', ''],
  ['выбранной сборки больше нет', null, ['Тех', 'Ваниль'], 'Стёртая', ''],
]

for (const [name, scoped, profiles, selected, want] of cases) {
  test(name, () => {
    expect(pickTargetName(scoped, profiles, selected)).toBe(want)
  })
}

test('ключ задачи меняется вместе со сборкой', () => {
  expect(keyContent('mr', 'Тех', 'mod', 'sodium')).not.toBe(keyContent('mr', 'Ваниль', 'mod', 'sodium'))
})
