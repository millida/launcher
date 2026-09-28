import { describe, expect, test } from 'bun:test'
import { createEnvelopeLog, pushedEnvelope } from './envelopes'
import type { CallEvent } from './signal'

const env = (over: Partial<CallEvent> = {}): CallEvent => ({
  seq: 5,
  callId: 'c1',
  from: 'u1',
  kind: 'invite',
  data: {},
  ts: 1000,
  ...over,
})

describe('pushedEnvelope: конверт из сокета', () => {
  const CASES: Array<[string, unknown, boolean]> = [
    ['настоящий конверт — звонок звенит без похода в ящик', { t: 'calls', e: env() }, true],
    ['голый толчок старого сервера — нужно сходить в ящик', { t: 'calls' }, false],
    ['пустая публикация', null, false],
    ['конверт без seq не дедуплицируется, пусть его отдаст ящик', { t: 'calls', e: { ...env(), seq: undefined } }, false],
    ['seq строкой', { t: 'calls', e: { ...env(), seq: '5' } }, false],
    ['без отправителя обработчик не поймёт, от кого звонок', { t: 'calls', e: { ...env(), from: 1 } }, false],
    ['без времени нельзя отличить конверт после сброса счётчика', { t: 'calls', e: { ...env(), ts: undefined } }, false],
  ]
  test.each(CASES)('%s', (_why, input, ok) => {
    expect(pushedEnvelope(input) !== null).toBe(ok)
  })

  test('data не объект — обработчик получает пустой объект, а не падает на чтении полей', () => {
    expect(pushedEnvelope({ e: { ...env(), data: 'x' } })?.data).toEqual({})
  })
})

describe('createEnvelopeLog: один конверт — одна обработка', () => {
  test('повтор из догоняющего запроса отбрасывается: второй offer ломает соединение', () => {
    const log = createEnvelopeLog()
    expect(log.admit(env())).toBe(true)
    expect(log.admit(env())).toBe(false)
  })

  test('конверты, пришедшие не по порядку, оба принимаются: курсор их не глотает', () => {
    const log = createEnvelopeLog()
    expect(log.admit(env({ seq: 9 }))).toBe(true)
    expect(log.admit(env({ seq: 8 }))).toBe(true)
  })

  test('тот же seq после сброса хранилища на сервере — новый конверт, а не повтор', () => {
    const log = createEnvelopeLog()
    expect(log.admit(env({ seq: 1, ts: 1000 }))).toBe(true)
    expect(log.admit(env({ seq: 1, ts: 9000 }))).toBe(true)
  })

  test('память не растёт бесконечно, но свежие конверты помнятся', () => {
    let now = 0
    const log = createEnvelopeLog(() => now)
    for (let i = 0; i < 300; i++) log.admit(env({ seq: i }))
    now = 10 * 60_000
    log.admit(env({ seq: 1000 }))
    expect(log.admit(env({ seq: 1 }))).toBe(true)
    expect(log.admit(env({ seq: 1000 }))).toBe(false)
  })
})
