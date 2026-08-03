import { expect, test } from 'bun:test'
import { isUserEnvironmentError } from './userEnvError'

const cases: Array<[string, string, boolean]> = [
  [
    'диск игрока переполнен: чинить в лаунчере нечего',
    'updater: Недостаточно места на диске. (os error 112)',
    true,
  ],
  [
    'тот же случай в англоязычной локали',
    'promise: No space left on device (os error 28) ENOSPC',
    true,
  ],
  [
    'пользователь отменил запрос установщика',
    'updater: The operation was canceled by the user. (os error 1223)',
    true,
  ],
  [
    'наш баг обязан долетать до админки',
    'promise: TypeError: undefined is not an object',
    false,
  ],
  [
    'отказ в доступе не глушим: часто это наш путь или права',
    'launch: Отказано в доступе. (os error 5)',
    false,
  ],
]

for (const [why, text, expected] of cases) {
  test(why, () => {
    expect(isUserEnvironmentError(text)).toBe(expected)
  })
}
