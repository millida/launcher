import { expect, test } from 'bun:test'
import { BUILD_NAME_MAX, GROUP_NAME_MAX, TOAST_TEXT_MAX, clipText } from './format'

// Вход → вердикт. Закреплено потому, что имя сборки и имя группы игрок пишет
// сам, а показываются они в тосте и в заголовке списка, где длинная строка
// разносит вёрстку.
const cases: Array<[string, string, number, string]> = [
  ['короткое имя не трогаем', 'Технические', 24, 'Технические'],
  ['ровно по границе остаётся целым', 'абвгд', 5, 'абвгд'],
  ['длинное обрезается с многоточием', 'абвгдеёж', 5, 'абвг…'],
  ['хвостовой пробел не остаётся перед многоточием', 'абв гдеж', 5, 'абв…'],
  ['пустая строка остаётся пустой', '', 5, ''],
]

for (const [name, input, max, want] of cases) {
  test(name, () => {
    expect(clipText(input, max)).toBe(want)
  })
}

test('обрезка считает символы, а не байты UTF-16', () => {
  // Эмодзи-суррогаты рвались пополам и превращались в мусор на экране.
  expect(clipText('🙂🙂🙂🙂', 3)).toBe('🙂🙂…')
})

test('лимиты не длиннее того, что помещается в тост', () => {
  expect(BUILD_NAME_MAX).toBeLessThanOrEqual(TOAST_TEXT_MAX)
  expect(GROUP_NAME_MAX).toBeLessThanOrEqual(BUILD_NAME_MAX)
})
