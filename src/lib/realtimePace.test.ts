import { expect, test } from 'bun:test'
import { POLL_AFTER_WAIT_MS, POLL_BASE_MS, pollDelayMs } from './pollPace'
import {
  REALTIME_STRETCHED_MS,
  friendsPollDelayMs,
  friendsPollWait,
  idleBeforePollMs,
  pokeGate,
  pokeTopic,
  readRealtimeGrant,
  realtimePaceMs,
  refreshDue,
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
  ['без данных', 'personal:#42', null, null],
]

for (const [name, channel, data, topic] of pokes) {
  test(`пинок: ${name}`, () => {
    expect(pokeTopic(channel, data)).toBe(topic)
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

test('при живом realtime запасной опрос друзей раз в две минуты, даже после ответа «ждал»', () => {
  expect(friendsPollDelayMs(true, POLL_BASE_MS, 0, false, half, true)).toBe(REALTIME_STRETCHED_MS)
  expect(friendsPollDelayMs(true, POLL_BASE_MS, 0, true, half, false)).toBe(REALTIME_STRETCHED_MS)
})

test('ошибка при живом realtime не превращается в шторм и не ждёт дольше страховки', () => {
  const d = friendsPollDelayMs(true, POLL_BASE_MS, 9, false, half, false)
  expect(d).toBeGreaterThanOrEqual(POLL_BASE_MS)
  expect(d).toBeLessThanOrEqual(REALTIME_STRETCHED_MS)
})

// Вход → вердикт для таймера опроса по теме: живое соединение растягивает частый опрос
// до страховки, но редкий не учащает, а без соединения темп прежний.
const paces: Array<[string, boolean, number, number]> = [
  ['без realtime частый опрос как был', false, 5_000, 5_000],
  ['без realtime редкий опрос как был', false, 600_000, 600_000],
  ['живой realtime растягивает частый опрос до страховки', true, 5_000, REALTIME_STRETCHED_MS],
  ['живой realtime не учащает опрос реже страховки', true, 600_000, 600_000],
]

for (const [name, live, ms, expected] of paces) {
  test(`темп опроса: ${name}`, () => {
    expect(realtimePaceMs(live, ms)).toBe(expected)
  })
}

// Вход → вердикт для ящика звонков: без соединения долгий опрос уходит сразу, как раньше;
// с соединением ящик ждёт толчка, а толчок забирает входящий звонок без паузы.
const callIdle: Array<[string, boolean, boolean, number]> = [
  ['без realtime долгий опрос без паузы', false, false, 0],
  ['без realtime толчок ничего не меняет', false, true, 0],
  ['живой realtime без толчка ждёт страховку', true, false, REALTIME_STRETCHED_MS],
  ['живой realtime с толчком забирает ящик сразу', true, true, 0],
]

for (const [name, live, poked, expected] of callIdle) {
  test(`ящик звонков: ${name}`, () => {
    expect(idleBeforePollMs(live, poked)).toBe(expected)
  })
}

test('без realtime обновление экрана идёт каждым тиком таймера, как раньше', () => {
  expect(refreshDue(false, 1_000, 1_001)).toBe(true)
})

test('при живом realtime таймер экрана растянут до двух минут', () => {
  expect(refreshDue(true, 0, REALTIME_STRETCHED_MS - 1)).toBe(false)
  expect(refreshDue(true, 0, REALTIME_STRETCHED_MS)).toBe(true)
})

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
