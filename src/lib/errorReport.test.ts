import { describe, expect, test } from 'bun:test'
import {
  EXPECTED_BY_COMMAND,
  STACK_MAX,
  createReportGate,
  expectedFailure,
  failureMessage,
  gameCrashMessage,
  installTarget,
  javaMajorOf,
  ramChoice,
  redactSecrets,
  safeArgs,
  tailForReport,
} from './errorReport'

// Вход → вердикт. Всё, что здесь закреплено, уходит с машины игрока в журнал,
// который читают люди: утечка токена или пути с именем — это публикация чужих
// данных, а не косметика.
describe('redactSecrets', () => {
  const cases: Array<[string, string, string]> = [
    [
      'Forge печатает аргументы запуска: токен сессии и ник уходят в лог игры',
      '--username, Steve, --accessToken, eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlc2ln, --userType, msa',
      '--username, <redacted>, --accessToken, <redacted>, --userType, msa',
    ],
    [
      'заголовок авторизации в тексте ошибки запроса',
      'GET /v2/me failed: Authorization: Bearer abc.DEF-123_xyz',
      'GET /v2/me failed: Authorization: Bearer <redacted>',
    ],
    [
      'подписанная ссылка на архив платной сборки — по ней её скачает кто угодно',
      'https://garage.millida.net/pack.zip?X-Amz-Credential=AKIA123%2F20260921&X-Amz-Signature=deadbeef&token=abc123',
      'https://garage.millida.net/pack.zip?X-Amz-Credential=<redacted>&X-Amz-Signature=<redacted>&token=<redacted>',
    ],
    [
      'пароль и clientToken в JSON-ответе',
      '{"login":"a","password":"hunter2","clientToken":"x1"}',
      '{"login":"a","password":"<redacted>","clientToken":"<redacted>"}',
    ],
    [
      'старые версии пишут «Session ID is token:<токен>:<uuid>»',
      'Session ID is token:0123456789abcdef:11112222333344445555666677778888',
      'Session ID is token:<redacted>',
    ],
    [
      'Minecraft пишет ник игрока при каждом запуске',
      '[12:00:01] [Render thread/INFO]: Setting user: Вася_2010',
      '[12:00:01] [Render thread/INFO]: Setting user: <nick>',
    ],
    [
      'домашний каталог Windows: имя кириллицей и с пробелом',
      'Не удалось прочитать C:\\Users\\Иван Петров\\AppData\\Roaming\\.millida\\profiles\\Сборка\\mods',
      'Не удалось прочитать ~\\AppData\\Roaming\\.millida\\profiles\\Сборка\\mods',
    ],
    [
      'тот же путь внутри JSON — с удвоенными обратными слэшами',
      '{"path":"C:\\\\Users\\\\olga\\\\AppData"}',
      '{"path":"~\\\\AppData"}',
    ],
    [
      'macOS: в журнале уже лежат пути с именами игроков из апдейтера',
      'старую копию не сдвинуть (/Users/olgakansina/Desktop/Millida Launcher.app): Operation not permitted (os error 1)',
      'старую копию не сдвинуть (~/Desktop/Millida Launcher.app): Operation not permitted (os error 1)',
    ],
    ['Linux', 'java: /home/vasya/.local/share/millida/java/17/bin/java', 'java: ~/.local/share/millida/java/17/bin/java'],
    [
      'имена классов Java — не JWT: три сегмента через точку, но короткие',
      'java.lang.NoClassDefFoundError: net/minecraft/class_310 at dev.architectury.transformer.TransformerRuntime',
      'java.lang.NoClassDefFoundError: net/minecraft/class_310 at dev.architectury.transformer.TransformerRuntime',
    ],
    [
      'обычная ошибка с числами проходит как есть',
      'Не скачались файлы сборки: 3 из 120 (os error 10054)',
      'Не скачались файлы сборки: 3 из 120 (os error 10054)',
    ],
  ]

  for (const [why, input, expected] of cases) {
    test(why, () => {
      expect(redactSecrets(input)).toBe(expected)
    })
  }
})

const WRONG_VERSION =
  'Один из модов собран под другую версию игры: он зовёт код, которого в ней нет. Обнови моды сборки под её версию.'

const tailOf = (time: string, nick: string, home: string, method: string) =>
  [
    `[${time}] [Render thread/INFO]: Setting user: ${nick}`,
    `[${time}] [Render thread/ERROR]: Unreported exception thrown!`,
    `java.lang.NoSuchMethodError: net.minecraft.class_${method}.method_5678()V`,
    `\tat ${home}\\AppData\\Roaming\\.millida\\profiles\\Моя сборка\\mods\\create.jar`,
  ].join('\n')

// Сообщение вылета — ключ группировки на сервере: оно решает, придёт ли новый
// алерт. Разный ник, время, путь или версия мода — одна и та же поломка; другой
// вердикт, другая сборка каталога или другое исключение — уже другая.
describe('gameCrashMessage', () => {
  const steve = gameCrashMessage({
    reason: WRONG_VERSION,
    culprits: ['create-1.20.1-0.5.1.f.jar', 'Sodium-fabric-0.5.8+mc1.20.1.jar'],
    tail: tailOf('12:01:02', 'Steve', 'C:\\Users\\Steve', '1234'),
  })

  test('формат закреплён: вердикт, исключение, моды без версий', () => {
    expect(steve).toBe(
      'Один из модов собран под другую версию игры: он зовёт код, которого в ней нет. | java.lang.NoSuchMethodError | моды: create, sodium-fabric',
    )
  })

  const same: Array<[string, Parameters<typeof gameCrashMessage>[0]]> = [
    [
      'другой игрок, время, домашний каталог и версии тех же модов',
      {
        reason: WRONG_VERSION,
        culprits: ['sodium-fabric-0.5.11+mc1.20.1.jar', 'create-1.20.1-6.0.0.jar'],
        tail: tailOf('23:59:59', 'Вася', 'C:\\Users\\Вася', '9999'),
      },
    ],
  ]
  for (const [why, facts] of same) {
    test('одно сообщение: ' + why, () => {
      expect(gameCrashMessage(facts)).toBe(steve)
    })
  }

  const differ: Array<[string, Parameters<typeof gameCrashMessage>[0]]> = [
    [
      'другой вердикт',
      {
        reason: 'Не хватило оперативной памяти. Добавь ОЗУ в настройках сборки.',
        culprits: ['create-1.20.1-0.5.1.f.jar', 'Sodium-fabric-0.5.8+mc1.20.1.jar'],
        tail: tailOf('12:01:02', 'Steve', 'C:\\Users\\Steve', '1234'),
      },
    ],
    [
      'та же поломка, но в сборке каталога Millida',
      {
        reason: WRONG_VERSION,
        catalogPack: 'create-2',
        culprits: ['create-1.20.1-0.5.1.f.jar', 'Sodium-fabric-0.5.8+mc1.20.1.jar'],
        tail: tailOf('12:01:02', 'Steve', 'C:\\Users\\Steve', '1234'),
      },
    ],
    [
      'другое исключение в хвосте',
      {
        reason: WRONG_VERSION,
        culprits: ['create-1.20.1-0.5.1.f.jar', 'Sodium-fabric-0.5.8+mc1.20.1.jar'],
        tail: 'java.lang.NoClassDefFoundError: net/minecraft/class_310',
      },
    ],
    [
      'другой виновный мод',
      {
        reason: WRONG_VERSION,
        culprits: ['iris-1.7.0.jar'],
        tail: tailOf('12:01:02', 'Steve', 'C:\\Users\\Steve', '1234'),
      },
    ],
  ]
  for (const [why, facts] of differ) {
    test('разные сообщения: ' + why, () => {
      expect(gameCrashMessage(facts)).not.toBe(steve)
    })
  }

  test('две сборки каталога не сливаются в одно сообщение', () => {
    const base = { reason: WRONG_VERSION, tail: '' }
    expect(gameCrashMessage({ ...base, catalogPack: 'create-2' })).not.toBe(
      gameCrashMessage({ ...base, catalogPack: 'create-3' }),
    )
  })

  test('в сообщение не попадают ник, время и путь', () => {
    for (const leak of ['Steve', '12:01', 'Users', 'AppData']) expect(steve).not.toContain(leak)
  })

  test('падение самой JVM без Java-исключения называет сигнал', () => {
    const msg = gameCrashMessage({
      reason: 'Java аварийно завершилась. Отчёт hs_err_pid лежит в папке сборки — пришли его в поддержку.',
      tail: '# EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ffb',
    })
    expect(msg).toBe('Java аварийно завершилась. | EXCEPTION_ACCESS_VIOLATION')
  })
})

describe('failureMessage', () => {
  test('имя сборки и домашний каталог игрока не дробят одну поломку на алерты', () => {
    const a = failureMessage(
      'delete_profile',
      'Не удалось удалить C:\\Users\\Иван\\AppData\\Roaming\\.millida\\profiles\\Моя сборка: Отказано в доступе. (os error 5)',
      [['Моя сборка', '<profile>']],
    )
    const b = failureMessage(
      'delete_profile',
      'Не удалось удалить C:\\Users\\olga\\AppData\\Roaming\\.millida\\profiles\\Survival: Отказано в доступе. (os error 5)',
      [['Survival', '<profile>']],
    )
    expect(a).toBe(b)
    expect(a).toBe('delete_profile: Не удалось удалить ~\\AppData\\Roaming\\.millida\\profiles\\<profile>: Отказано в доступе. (os error 5)')
  })

  test('в сообщение идёт первая строка: хвост лога запуска живёт в stack', () => {
    expect(failureMessage('launch_profile', 'Игра не запустилась (код Some(1)).\n[main/INFO] Loading Minecraft', [])).toBe(
      'launch_profile: Игра не запустилась (код Some(1)).',
    )
  })

  test('разные файлы с одного хоста — одна поломка', () => {
    const a = failureMessage('mr-mod', 'https://cdn.modrinth.com/data/AANobbMI/versions/a/sodium.jar: контрольная сумма не сошлась', [])
    const b = failureMessage('mr-mod', 'https://cdn.modrinth.com/data/YL57xq9U/versions/b/iris.jar: контрольная сумма не сошлась', [])
    expect(a).toBe(b)
    expect(a).toBe('mr-mod: https://cdn.modrinth.com/… контрольная сумма не сошлась')
  })

  test('хеш файла не делает сообщение уникальным', () => {
    expect(failureMessage('repair_profile', '37fd7d25a1f94b3c6a1b0cfa36e8e6a19b1e4a2c: размер 10 вместо 12', [])).toBe(
      'repair_profile: <hash>: размер 10 вместо 12',
    )
  })
})

// Отказ, который игрок вызвал сам или который и есть ответ на его ввод, не
// чинится нами: каждый такой отчёт — ложный алерт. Остальное обязано уходить.
describe('expectedFailure', () => {
  const cases: Array<[string, string, string, boolean]> = [
    ['игрок отменил установку', 'install_shared_pack', 'Установка отменена', true],
    ['игрок отменил запуск', 'launch_profile', 'Запуск отменён', true],
    ['имя сборки уже занято — ввод игрока', 'create_profile', 'Сборка с таким именем уже есть', true],
    ['выключенный сервер в списке — это ответ пинга', 'ping_server', 'connection refused', true],
    ['ника нет у Mojang — ответ на поиск', 'mc_textures', 'игрок не найден', true],
    ['неверный ключ платной сборки — ответ на ввод', 'redeem_pack_key', 'Ключ не найден или уже использован', true],
    ['сессия кончилась — дальше ведёт повторный вход', 'cloud_push', 'unauthorized', true],
    ['нет доступа к платной сборке — открывается окно ключа', 'launch_profile', 'pack-access: нужен ключ', true],
    ['сборка запущена — игрока просят закрыть игру', 'repair_profile', 'Сборка сейчас запущена — закрой игру и повтори', true],
    ['сбой задачи установки уходит отдельным InstallFailed', 'install_catalog_pack', 'Не скачались файлы сборки: 502', true],
    ['транспорт самого отчёта не отчитывается о себе', 'millida_api', 'http 500', true],
    ['игрок выбрал папку без прав на запись', 'set_game_dir', 'Нет прав на запись: Отказано в доступе. (os error 5)', true],
    ['перенос папки игры упал на копировании — наш сбой', 'set_game_dir', 'mods: Отказано в доступе. (os error 5)', false],
    ['создание сборки упало на диске — наш сбой', 'create_profile', 'Не удалось создать папку: Отказано в доступе. (os error 5)', false],
    ['игра не стартовала — наш сбой', 'launch_profile', 'Игра не запустилась (код Some(1)).', false],
    ['интерфейс и ядро разошлись в аргументах — наш баг', 'list_content', 'invalid args `profile` for command `list_content`: missing field `profile`', false],
    ['починка не скачала файл — наш сбой', 'repair_profile', 'Не удалось скачать файл сборки: 404', false],
  ]

  for (const [why, cmd, text, expected] of cases) {
    test(why, () => {
      expect(expectedFailure(text, cmd) !== null).toBe(expected)
    })
  }

  test('у каждого исключения записана причина', () => {
    for (const [cmd, rule] of Object.entries(EXPECTED_BY_COMMAND)) expect(rule.why.length > 10 ? cmd : '').toBe(cmd)
  })

  test('в списке нет команд, которых ядро не знает: переименование оставило бы мёртвую запись', async () => {
    const source = await Bun.file(import.meta.dir + '/../ipc/commands.ts').text()
    const missing = Object.keys(EXPECTED_BY_COMMAND).filter((cmd) => !source.includes("'" + cmd + "'"))
    expect(missing).toEqual([])
  })
})

describe('safeArgs', () => {
  test('из аргументов уходят только идентификаторы — ни токенов, ни кодов, ни путей, ни ника', () => {
    expect(
      safeArgs({
        profile: 'Моя сборка',
        auth: { kind: 'microsoft', accountId: 'acc-1' },
        deviceCode: 'ABCD-EFGH',
        pngBase64: 'iVBORw0KGgo',
        path: 'C:\\Users\\Иван\\pack.zip',
        code: 'SHARE1',
        nick: 'Steve',
        slug: 'create-2',
        ramMb: 4096,
      }),
    ).toEqual({ profile: 'Моя сборка', slug: 'create-2', ramMb: 4096 })
  })
})

describe('installTarget', () => {
  const cases: Array<[string, string, ReturnType<typeof installTarget>]> = [
    ['сборка каталога Millida', 'catalog-pack:create-2', { kind: 'catalog-pack', profile: null, catalogPack: 'create-2' }],
    ['мод в сборку', 'mr-mod:Моя сборка:AANobbMI', { kind: 'mr-mod', profile: 'Моя сборка', catalogPack: null }],
    ['зависимости: двоеточие в самом проекте', 'mr-mod:Моя сборка:millida:deps', { kind: 'mr-mod', profile: 'Моя сборка', catalogPack: null }],
    ['обновление сборки Modrinth поверх своей', 'mr-modpack:fo:Моя сборка', { kind: 'mr-modpack', profile: 'Моя сборка', catalogPack: null }],
    ['новая сборка Modrinth', 'mr-modpack:fo', { kind: 'mr-modpack', profile: null, catalogPack: null }],
    ['сборка CurseForge', 'cf-modpack:12345', { kind: 'cf-modpack', profile: null, catalogPack: null }],
    ['перенос сборки', 'migrate:Моя сборка', { kind: 'migrate', profile: 'Моя сборка', catalogPack: null }],
  ]
  for (const [why, key, expected] of cases) {
    test(why, () => {
      expect(installTarget(key)).toEqual(expected)
    })
  }
})

// Бюджет у каждого вида свой: шторм ошибок интерфейса или команд не должен
// съесть отчёт о вылете, ради которого всё и затевалось.
describe('createReportGate', () => {
  test('повтор того же текста не уходит и не тратит бюджет', () => {
    const gate = createReportGate({ crash: 2, core: 2, install: 2 })
    expect([gate.admit('core', 'a'), gate.admit('core', 'a'), gate.admit('core', 'b')]).toEqual([true, false, true])
  })

  test('исчерпанный бюджет закрывает только свой канал', () => {
    const gate = createReportGate({ crash: 1, core: 1, install: 1 })
    expect([gate.admit('core', 'a'), gate.admit('core', 'b'), gate.admit('crash', 'a')]).toEqual([true, false, true])
  })
})

describe('мелкие разборы', () => {
  const majors: Array<[string, string, number | null]> = [
    ['современная строка версии', 'openjdk version "17.0.9" 2023-10-17', 17],
    ['старая схема 1.x', 'java version "1.8.0_392"', 8],
    ['голый номер от ядра', '21.0.2', 21],
    ['пусто', '', null],
  ]
  for (const [why, line, expected] of majors) {
    test('Java: ' + why, () => {
      expect(javaMajorOf(line)).toBe(expected)
    })
  }

  const rams: Array<[string, Parameters<typeof ramChoice>, ReturnType<typeof ramChoice>]> = [
    ['ползунок игрока главнее всего', [4096, 3072, true, 6144], { ramMb: 4096, ramSource: 'slider' }],
    ['память, закреплённая кнопкой из окна вылета', [0, 3072, true, 6144], { ramMb: 3072, ramSource: 'pinned' }],
    ['автоподбор', [0, 0, true, 6144], { ramMb: 6144, ramSource: 'auto' }],
    ['автоподбор выключен — ядро берёт половину машины', [0, 0, false, 6144], { ramMb: null, ramSource: 'half-of-machine' }],
  ]
  for (const [why, args, expected] of rams) {
    test('ОЗУ: ' + why, () => {
      expect(ramChoice(...args)).toEqual(expected)
    })
  }

  test('хвост режется с начала: причина вылета в конце лога', () => {
    const tail = 'x'.repeat(STACK_MAX) + '\nCaused by: java.lang.OutOfMemoryError'
    const cut = tailForReport(tail)
    expect(cut.length).toBe(STACK_MAX)
    expect(cut.endsWith('Caused by: java.lang.OutOfMemoryError')).toBe(true)
  })
})
