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
  [
    'jar мода держит запущенная игра — ядро отказывает заранее, остальное чужой процесс',
    'promise: Файл занят другой программой — закрой игру и папку сборки, затем повтори: Процесс не может получить доступ к файлу, так как этот файл занят другим процессом. (os error 32)',
    true,
  ],
  [
    'та же ошибка в англоязычной локали Windows',
    'promise: The process cannot access the file because it is being used by another process. (os error 32)',
    true,
  ],
  [
    'у игрока не резолвится наш домен — это его DNS',
    'updater-fallback: https://launcher-storage.millida.net/latest.json: нет связи (Этот хост неизвестен)',
    true,
  ],
  [
    'запрос до хранилища не ушёл с машины игрока',
    'updater: error sending request for url (https://launcher-storage.millida.net/latest.json)',
    true,
  ],
  [
    'ответ сервера с ошибкой — наш сбой, сеть тут ни при чём',
    'updater: сервер обновлений ответил 500',
    false,
  ],
]

for (const [why, text, expected] of cases) {
  test(why, () => {
    expect(isUserEnvironmentError(text)).toBe(expected)
  })
}
