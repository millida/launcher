import { expect, test } from 'bun:test'
import { failedHost, isUserEnvironmentError } from './userEnvError'

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

// Текст ошибки запуска -> хост для телеметрии. Адрес стоит в конце и
// обрезается вместе с текстом, а без хоста не понять, кто рвёт соединение.
const hosts: Array<[string, string, string | null]> = [
  [
    'обрыв на зеркале: адрес в самом конце, после длинной причины',
    'нет связи (Удаленный хост принудительно разорвал существующее подключение. (os error 10054) — соединение не установилось: проверь брандмауэр, VPN и антивирус) — https://api.millida.net/v2/launcher/dl?url=https%3A%2F%2Fmeta.fabricmc.net',
    'api.millida.net',
  ],
  [
    'загрузка файла: адрес в начале строки',
    'https://piston-data.mojang.com/v1/objects/37fd/client.jar: нет связи (operation timed out)',
    'piston-data.mojang.com',
  ],
  ['регистр адреса не плодит разные хосты', 'нет связи — HTTPS://Meta.FabricMC.net/v2/versions/loader', 'meta.fabricmc.net'],
  ['ошибка без адреса не придумывает хост', 'Запуск Java: Отказано в доступе. (os error 5)', null],
]

for (const [why, text, expected] of hosts) {
  test(why, () => {
    expect(failedHost(new Error(text))).toBe(expected)
  })
}
