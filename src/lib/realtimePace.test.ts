import { expect, test } from 'bun:test'
import { POLL_AFTER_WAIT_MS, POLL_BASE_MS, pollDelayMs } from './pollPace'
import {
  LOGIN_SAFETY_POLL_MS,
  PURCHASE_LIVE_SAFETY_MS,
  REALTIME_SOCKET_URL,
  carriesData,
  catchUpListeners,
  friendsPollDelayMs,
  friendsPollWait,
  loginPollDelayMs,
  loginPushed,
  needsCatchUp,
  ownSocketUrl,
  pokeGate,
  pokeTopic,
  presenceModeAfter,
  presenceRollback,
  purchaseWaitMs,
  readLoginChannel,
  readRealtimeGrant,
  readRelayMessage,
  realtimePaceMs,
  realtimeTokenPath,
  refreshDue,
  socketPresence,
  type RealtimeTopic,
  type ServerSub,
} from './realtimePace'

const half = () => 0.5

// Вход → вердикт. Токен сокета уходит только на наш адрес: иначе подменённый
// ответ увёл бы его на чужой хост, а выключенный realtime не должен подключаться.
const grants: Array<[string, unknown, boolean]> = [
  ['сервер выключил realtime', { enabled: false }, false],
  ['пустой ответ', null, false],
  ['без токена', { enabled: true, url: 'wss://api.millida.net/v2/realtime/connection/websocket' }, false],
  ['пустой токен', { enabled: true, url: 'wss://api.millida.net/x', token: '' }, false],
  ['чужой хост', { enabled: true, url: 'wss://evil.example/ws', token: 'jwt' }, false],
  ['похожий хост', { enabled: true, url: 'wss://api.millida.net.evil.example/ws', token: 'jwt' }, false],
  ['без шифрования', { enabled: true, url: 'ws://api.millida.net/ws', token: 'jwt' }, false],
  ['свой порт', { enabled: true, url: 'wss://api.millida.net:8000/ws', token: 'jwt' }, false],
  ['логин в адресе', { enabled: true, url: 'wss://a:b@api.millida.net/ws', token: 'jwt' }, false],
  ['мусор вместо адреса', { enabled: true, url: 'не адрес', token: 'jwt' }, false],
  ['enabled строкой', { enabled: 'true', url: 'wss://api.millida.net/ws', token: 'jwt' }, false],
  ['настоящий ответ', { enabled: true, url: 'wss://api.millida.net/v2/realtime/connection/websocket', token: 'jwt' }, true],
]

for (const [name, input, enabled] of grants) {
  test(`токен: ${name}`, () => {
    expect(readRealtimeGrant(input).enabled).toBe(enabled)
  })
}

test('адрес анонимного сокета входа проходит ту же проверку хоста, что и выданный сервером', () => {
  expect(ownSocketUrl(REALTIME_SOCKET_URL)).toBe(REALTIME_SOCKET_URL)
})

// Вход → вердикт для параметров токена: сервер молча выбрасывает неверный
// параметр, поэтому неверный не отправляется вовсе, а верные доходят все.
const tokenPaths: Array<[string, Parameters<typeof realtimeTokenPath>[0], string]> = [
  ['старый сервер ничего не ждёт: без данных путь прежний', {}, '/realtime/token'],
  [
    'все три поля уходят',
    { installId: 'abcd-1234_EFGH', version: '2.0.0', os: 'windows' },
    '/realtime/token?installId=abcd-1234_EFGH&v=2.0.0&os=windows',
  ],
  ['телеметрия выключена: без installId', { installId: null, version: '2.0.0', os: 'linux' }, '/realtime/token?v=2.0.0&os=linux'],
  ['короткий installId не уходит', { installId: 'abc', version: '2.0.0', os: 'macos' }, '/realtime/token?v=2.0.0&os=macos'],
  [
    'installId с чужими символами не уходит',
    { installId: 'abcd/../1234', os: 'macos' },
    '/realtime/token?os=macos',
  ],
  ['версия с пробелом не уходит', { version: '2.0 beta', os: 'linux' }, '/realtime/token?os=linux'],
  ['версия длиннее 32 не уходит', { version: '1'.repeat(33), os: 'linux' }, '/realtime/token?os=linux'],
  ['неизвестная ОС не уходит', { version: '2.0.0+build.7', os: 'android' }, '/realtime/token?v=2.0.0%2Bbuild.7'],
]

for (const [name, info, path] of tokenPaths) {
  test(`путь токена: ${name}`, () => {
    expect(realtimeTokenPath(info)).toBe(path)
  })
}

// Пинок принимается только из личного канала и только с известной темой.
const pokes: Array<[string, unknown, unknown, ReturnType<typeof pokeTopic>]> = [
  ['друзья', 'personal:#42', { t: 'friends' }, 'friends'],
  ['статус друга: сервер шлёт его отдельно от сообщений', 'personal:#42', { t: 'presence' }, 'presence'],
  ['звонки', 'personal:#42', { t: 'calls' }, 'calls'],
  ['статус сервера хостинга', 'personal:#42', { t: 'hosting' }, 'hosting'],
  ['счётчики сайта', 'personal:#42', { t: 'inbox' }, 'inbox'],
  ['рубины, PLUS или купленная косметика', 'personal:#42', { t: 'account' }, 'account'],
  ['неизвестная тема', 'personal:#42', { t: 'wallet' }, null],
  ['чужой канал', 'news', { t: 'friends' }, null],
  ['канал присутствия не пинает темы', 'lp:3', { t: 'presence' }, null],
  ['без данных', 'personal:#42', null, null],
]

for (const [name, channel, data, topic] of pokes) {
  test(`пинок: ${name}`, () => {
    expect(pokeTopic(channel, data)).toBe(topic)
  })
}

// Вход → вердикт: публикация с данными применяется сама, и слушатели, которые
// умеют только перезапрашивать, молчат. Толчок без данных (старый сервер) обязан
// дать один запрос, иначе изменение так и не дойдёт до экрана.
const carried: Array<[string, RealtimeTopic, unknown, boolean]> = [
  ['статус друга с данными', 'presence', { t: 'presence', u: { id: 'u1', status: 'online', server: null, at: 1 } }, true],
  ['статус друга толчком (старый сервер)', 'presence', { t: 'presence' }, false],
  ['статус друга с битым статусом — перезапрос', 'presence', { t: 'presence', u: { id: 'u1', status: 'away' } }, false],
  ['«печатает» с данными', 'friends', { t: 'friends', typing: { from: 'u1', until: 5 } }, true],
  ['сообщение толчком', 'friends', { t: 'friends' }, false],
  ['«печатает» без until — перезапрос', 'friends', { t: 'friends', typing: { from: 'u1' } }, false],
  ['аккаунт всегда толчок', 'account', { t: 'account' }, false],
  ['звонки разбирает свой слушатель, перезапрос не глушится', 'calls', { t: 'calls', e: {} }, false],
]

for (const [name, topic, data, want] of carried) {
  test(`данные в публикации: ${name}`, () => {
    expect(carriesData(topic, data)).toBe(want)
  })
}

const sub = (channel: string, recovered = false): ServerSub => ({ channel, recovered })

const URL_OK = 'wss://api.millida.net/v2/realtime/connection/websocket'

// Вход → вердикт: таймер HTTP-сердцебиения можно остановить, только если последний
// токен прямо разрешил присутствие по сокету. Старый сервер поля не знает — таймер
// обязан остаться, иначе игрок пропадёт у друзей и перестанут идти часы.
const grantPresence: Array<[string, unknown, boolean]> = [
  ['раскатка включила присутствие', { enabled: true, url: URL_OK, token: 'jwt', presence: true }, true],
  ['раскатка не включила', { enabled: true, url: URL_OK, token: 'jwt', presence: false }, false],
  ['старый сервер без поля', { enabled: true, url: URL_OK, token: 'jwt' }, false],
  ['presence строкой не считается', { enabled: true, url: URL_OK, token: 'jwt', presence: 'true' }, false],
]

for (const [name, input, want] of grantPresence) {
  test(`присутствие в токене: ${name}`, () => {
    const g = readRealtimeGrant(input)
    expect(g.enabled && g.presence).toBe(want)
  })
}

// Вход → вердикт для режима присутствия: каждый токен решает заново (доля раскатки
// меняется на сервере в любой момент), публикация отката выключает режим сразу.
const modes: Array<[string, Parameters<typeof presenceModeAfter>[0], boolean]> = [
  ['токен с presence:true', { kind: 'grant', presence: true }, true],
  ['токен без присутствия (старый сервер или вне доли)', { kind: 'grant', presence: false }, false],
  ['откат из lp: — сразу на HTTP', { kind: 'rollback' }, false],
]

for (const [name, event, want] of modes) {
  test(`режим присутствия: ${name}`, () => {
    expect(presenceModeAfter(event)).toBe(want)
  })
}

test('после отката следующий токен с presence:true возвращает режим сокета', () => {
  const afterRollback = presenceModeAfter({ kind: 'rollback' })
  expect(socketPresence(true, afterRollback)).toBe(false)
  const afterGrant = presenceModeAfter({ kind: 'grant', presence: true })
  expect(socketPresence(true, afterGrant)).toBe(true)
})

// Вход → вердикт: таймер останавливается только при живом сокете И разрешении в токене.
const timerStops: Array<[string, boolean, boolean, boolean]> = [
  ['сокет жив, presence:true — таймер стоит', true, true, true],
  ['сокет жив, presence нет — таймер идёт', true, false, false],
  ['сокет упал, presence:true — таймер идёт', false, true, false],
  ['ни сокета, ни разрешения — таймер идёт', false, false, false],
]

for (const [name, live, mode, want] of timerStops) {
  test(`таймер сердцебиения: ${name}`, () => {
    expect(socketPresence(live, mode)).toBe(want)
  })
}

// Вход → вердикт для публикаций в lp: принимается только откат присутствия,
// всё остальное из этого канала игнорируется.
const rollbacks: Array<[string, unknown, unknown, boolean]> = [
  ['откат', 'lp:3', { t: 'realtime', presence: false }, true],
  ['presence:true в lp: не откат', 'lp:3', { t: 'realtime', presence: true }, false],
  ['без поля presence не откат', 'lp:3', { t: 'realtime' }, false],
  ['другой тип в lp: игнорируется', 'lp:3', { t: 'friends' }, false],
  ['тот же кадр из личного канала — не наш откат', 'personal:#42', { t: 'realtime', presence: false }, false],
  ['пусто', 'lp:3', null, false],
]

for (const [name, channel, data, want] of rollbacks) {
  test(`откат присутствия: ${name}`, () => {
    expect(presenceRollback(channel, data)).toBe(want)
  })
}

test('публикации lp: других типов не превращаются в темы', () => {
  for (const t of ['friends', 'presence', 'account', 'realtime']) expect(pokeTopic('lp:3', { t })).toBeNull()
})

// Вход → вердикт для догона после подключения: личный канал, который восстановил
// пропущенное из истории, догона не требует; всё остальное — один догон.
const catchUps: Array<[string, ServerSub[], boolean]> = [
  ['первое подключение', [sub('personal:#42')], true],
  ['переподключение с восстановлением', [sub('personal:#42', true), sub('lp:1')], false],
  ['история не покрыла разрыв', [sub('personal:#42', false), sub('lp:1')], true],
  ['личного канала нет вовсе', [sub('lp:1', true)], true],
]

for (const [name, subs, want] of catchUps) {
  test(`догон: ${name}`, () => {
    expect(needsCatchUp(subs)).toBe(want)
  })
}

test('догон зовёт каждого слушателя один раз, даже если он подписан на две темы', () => {
  const a = () => {}
  const b = () => {}
  expect(catchUpListeners([new Set([a, b]), new Set([a])])).toEqual([a, b])
})

// Вход → вердикт для ретрансляции в оверлей: туда уходят только друзья и
// состояние сокета; конверты звонков и всё прочее остаются в главном окне.
const relays: Array<[string, unknown, ReturnType<typeof readRelayMessage>]> = [
  ['состояние сокета', { kind: 'live', live: true }, { kind: 'live', live: true }],
  ['состояние строкой отвергается', { kind: 'live', live: 'true' }, null],
  ['догон', { kind: 'catchup' }, { kind: 'catchup' }],
  [
    'публикация друзей',
    { kind: 'pub', topic: 'friends', data: { t: 'friends' } },
    { kind: 'pub', topic: 'friends', data: { t: 'friends' } },
  ],
  ['звонки не ретранслируются', { kind: 'pub', topic: 'calls', data: { t: 'calls' } }, null],
  ['публикация без данных', { kind: 'pub', topic: 'presence' }, null],
  ['неизвестный вид', { kind: 'eval', code: 'x' }, null],
  ['не объект', 'live', null],
]

for (const [name, input, want] of relays) {
  test(`ретрансляция: ${name}`, () => {
    expect(readRelayMessage(input)).toEqual(want)
  })
}

test('при живом realtime долгий опрос не держится на сервере', () => {
  expect(friendsPollWait(true)).toBe(0)
  expect(friendsPollWait(false)).toBe(1)
})

test('без realtime темп опроса прежний, до единицы', () => {
  for (const failures of [0, 1, 3]) {
    for (const hidden of [false, true]) {
      for (const waited of [false, true]) {
        expect(friendsPollDelayMs(false, 20_000, failures, hidden, half, waited)).toBe(
          pollDelayMs(20_000, failures, hidden, half, waited),
        )
      }
    }
  }
  expect(friendsPollDelayMs(false, 20_000, 0, false, half, true)).toBe(POLL_AFTER_WAIT_MS)
  expect(friendsPollDelayMs(false, POLL_BASE_MS, 0, false, half, false)).toBe(POLL_BASE_MS)
})

test('при живом realtime опрос друзей не взводит таймер: следующий запрос только по публикации', () => {
  expect(friendsPollDelayMs(true, POLL_BASE_MS, 0, false, half, true)).toBeNull()
  expect(friendsPollDelayMs(true, POLL_BASE_MS, 0, true, half, false)).toBeNull()
})

test('ошибка при живом realtime повторяется с нарастающей паузой, а не ждёт публикации вечно', () => {
  expect(friendsPollDelayMs(true, POLL_BASE_MS, 1, false, half, false)).toBe(POLL_BASE_MS)
  const d = friendsPollDelayMs(true, POLL_BASE_MS, 9, false, half, false)
  expect(d).not.toBeNull()
  expect(d as number).toBeGreaterThan(POLL_BASE_MS)
})

// Вход → вердикт для таймера опроса по теме: при живом сокете таймера нет вовсе,
// без сокета темп прежний.
const paces: Array<[string, boolean, number, number | null]> = [
  ['без realtime частый опрос как был', false, 5_000, 5_000],
  ['без realtime редкий опрос как был', false, 600_000, 600_000],
  ['живой realtime убирает частый опрос', true, 5_000, null],
  ['живой realtime убирает и редкий', true, 600_000, null],
]

for (const [name, live, ms, expected] of paces) {
  test(`темп опроса: ${name}`, () => {
    expect(realtimePaceMs(live, ms)).toBe(expected)
  })
}

test('без realtime обновление экрана идёт каждым тиком таймера, как раньше', () => {
  expect(refreshDue(false)).toBe(true)
})

test('при живом realtime таймер экрана не стреляет: обновляет публикация', () => {
  expect(refreshDue(true)).toBe(false)
})

// Вход → вердикт для ожидания оплаты: без сокета прежние 5 с / 3 с; с сокетом
// ждём толчка account, а редкая проверка страхует сервер, который ещё не
// объявляет выдачу доступа.
const purchase: Array<[string, boolean, number, number]> = [
  ['без сокета PLUS как был', false, 5_000, 5_000],
  ['без сокета подписка как была', false, 3_000, 3_000],
  ['с сокетом только редкая страховка', true, 5_000, PURCHASE_LIVE_SAFETY_MS],
  ['с сокетом страховка не учащает редкий таймер', true, 600_000, 600_000],
]

for (const [name, live, every, want] of purchase) {
  test(`ожидание оплаты: ${name}`, () => {
    expect(purchaseWaitMs(live, every)).toBe(want)
  })
}

// Вход → вердикт для канала входа по коду: анонимно подписаться можно только на
// канал входа правильной формы, иначе ответ сервера уводил бы в чужие каналы.
const loginChannels: Array<[string, unknown, string | null]> = [
  ['правильный канал', 'login:0123456789abcdef0123456789abcdef', 'login:0123456789abcdef0123456789abcdef'],
  ['старый сервер без канала', undefined, null],
  ['личный канал', 'personal:#42', null],
  ['заглавные буквы', 'login:0123456789ABCDEF0123456789ABCDEF', null],
  ['короткий хеш', 'login:abc', null],
  ['хвост после хеша', 'login:0123456789abcdef0123456789abcdef:x', null],
]

for (const [name, input, want] of loginChannels) {
  test(`канал входа: ${name}`, () => {
    expect(readLoginChannel(input)).toBe(want)
  })
}

const CH = 'login:0123456789abcdef0123456789abcdef'
const loginPushes: Array<[string, unknown, unknown, boolean]> = [
  ['подтверждение', CH, { t: 'login', status: 'ok' }, true],
  ['отказ тоже повод спросить сервер', CH, { t: 'login', status: 'denied' }, true],
  ['чужой канал', 'login:ffffffffffffffffffffffffffffffff', { t: 'login', status: 'ok' }, false],
  ['другая тема', CH, { t: 'account' }, false],
  ['пусто', CH, null, false],
]

for (const [name, channel, data, want] of loginPushes) {
  test(`толчок входа: ${name}`, () => {
    expect(loginPushed(CH, channel, data)).toBe(want)
  })
}

// Вход → вердикт для опроса входа: без сокета темп сервера, с подпиской —
// страховка раз в 15 с, но не чаще, чем просит сервер.
const loginPaces: Array<[string, boolean, number, number]> = [
  ['без подписки темп сервера', false, 3_000, 3_000],
  ['с подпиской страховка', true, 3_000, LOGIN_SAFETY_POLL_MS],
  ['с подпиской не чаще, чем просит сервер', true, 30_000, 30_000],
]

for (const [name, subscribed, interval, want] of loginPaces) {
  test(`опрос входа: ${name}`, () => {
    expect(loginPollDelayMs(subscribed, interval)).toBe(want)
  })
}

test('пинок в простое запускает запрос сразу', () => {
  let fired = 0
  const gate = pokeGate(
    () => false,
    () => void (fired += 1),
  )
  gate.poke()
  expect(fired).toBe(1)
  expect(gate.take()).toBe(false)
})

test('пачка пинков во время запроса даёт ровно один повтор после него', () => {
  let busy = true
  let fired = 0
  const gate = pokeGate(
    () => busy,
    () => void (fired += 1),
  )
  gate.poke()
  gate.poke()
  gate.poke()
  expect(fired).toBe(0)
  busy = false
  expect(gate.take()).toBe(true)
  expect(gate.take()).toBe(false)
})

test('пинок после повтора снова стреляет сразу, а не теряется в очереди', () => {
  let busy = true
  let fired = 0
  const gate = pokeGate(
    () => busy,
    () => void (fired += 1),
  )
  gate.poke()
  busy = false
  gate.take()
  gate.poke()
  expect(fired).toBe(1)
})
