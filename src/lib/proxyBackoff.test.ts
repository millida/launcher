import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { clearCatalogCache } from './catalogCache'
import { cfProjectId } from './millidaCatalog'
import { PROXY_TIMINGS, ProxyBackoff, cfProxyBackoff, proxyVerdict, type ProxyVerdict } from './proxyBackoff'

describe('proxyVerdict', () => {
  const cases: { status: number | null; retryAfter: string | null; want: ProxyVerdict; why: string }[] = [
    { status: 200, retryAfter: null, want: { kind: 'answered' }, why: 'успех снимает память о сбое' },
    { status: 502, retryAfter: null, want: { kind: 'key-failed' }, why: 'CurseForge режет адрес прокси: 96% ответов, запоминаем по ключу' },
    { status: 504, retryAfter: null, want: { kind: 'key-failed' }, why: 'таймаут CurseForge за прокси' },
    { status: null, retryAfter: null, want: { kind: 'key-failed' }, why: 'ответа не было вовсе' },
    { status: 503, retryAfter: '120', want: { kind: 'outage', waitMs: 120_000 }, why: 'предохранитель сервера назвал срок' },
    { status: 503, retryAfter: null, want: { kind: 'outage', waitMs: PROXY_TIMINGS.OUTAGE_DEFAULT_MS }, why: '503 без срока — всё равно пауза для всех путей' },
    { status: 429, retryAfter: '99999', want: { kind: 'outage', waitMs: PROXY_TIMINGS.RETRY_AFTER_CAP_MS }, why: 'огромный срок не запирает прокси на сутки' },
    { status: 429, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT', want: { kind: 'outage', waitMs: PROXY_TIMINGS.OUTAGE_DEFAULT_MS }, why: 'дата вместо секунд' },
    { status: 404, retryAfter: null, want: { kind: 'ignored' }, why: '404 — ответ про путь, а не сбой прокси' },
  ]
  for (const c of cases) {
    it(c.why, () => {
      expect(proxyVerdict(c.status, c.retryAfter), c.why).toEqual(c.want)
    })
  }
})

describe('ProxyBackoff', () => {
  it('сбой ключа держит прокси закрытым только для этого ключа и только до срока', () => {
    let now = 0
    const b = new ProxyBackoff(() => now)
    b.note('a', { kind: 'key-failed' })
    now = 5_000
    expect(b.skipped('a'), 'сразу после 502 тот же запрос не должен снова идти в прокси').toBe(true)
    expect(b.skipped('b'), 'сбой одного ключа не трогает остальные').toBe(false)
    now = PROXY_TIMINGS.FAILURE_TTL_MS
    expect(b.skipped('a'), 'после срока прокси пробуется снова, иначе он не вернётся до перезапуска').toBe(false)
  })

  it('пауза предохранителя закрывает все ключи и не сокращается более коротким сроком', () => {
    let now = 0
    const b = new ProxyBackoff(() => now)
    b.note('a', { kind: 'outage', waitMs: 300_000 })
    b.note('b', { kind: 'outage', waitMs: 10_000 })
    now = 200_000
    expect(b.skipped('c'), 'Retry-After касается всех путей прокси').toBe(true)
    now = 300_001
    expect(b.skipped('c'), 'после срока прокси снова доступен').toBe(false)
  })

  it('память сбоев ограничена по размеру', () => {
    let now = 0
    const b = new ProxyBackoff(() => now)
    for (let i = 0; i < PROXY_TIMINGS.LIMIT + 10; i++) {
      now = i
      b.note('k' + i, { kind: 'key-failed' })
    }
    expect(b.size, 'листание каталога не должно растить память без конца').toBeLessThanOrEqual(PROXY_TIMINGS.LIMIT)
  })
})

describe('cfProjectId', () => {
  const realFetch = globalThis.fetch
  const ref = { classId: 4471, slug: 'biohazard-project-genesis' }
  let calls = 0

  const serve = (res: () => Response) => {
    globalThis.fetch = (async () => {
      calls++
      return res()
    }) as unknown as typeof fetch
  }

  beforeEach(() => {
    calls = 0
    clearCatalogCache()
    cfProxyBackoff.clear()
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('502 запоминается: повтор того же поиска в сессии не идёт в прокси', async () => {
    serve(() => new Response('', { status: 502 }))
    expect(await cfProjectId(ref)).toBeNull()
    expect(await cfProjectId(ref)).toBeNull()
    expect(calls, 'тысячи клиентов подряд спрашивали одну сборку через сломанный прокси').toBe(1)
  })

  it('503 с Retry-After закрывает и другие поиски', async () => {
    serve(() => new Response('', { status: 503, headers: { 'retry-after': '60' } }))
    expect(await cfProjectId(ref)).toBeNull()
    expect(await cfProjectId({ classId: 6, slug: 'jei' })).toBeNull()
    expect(calls, 'предохранитель сервера просит паузу для всех путей').toBe(1)
  })

  it('успешный ответ берётся из памяти', async () => {
    serve(() => new Response(JSON.stringify({ data: [{ id: 1082278, slug: 'biohazard-project-genesis' }] })))
    expect(await cfProjectId(ref)).toBe(1082278)
    expect(await cfProjectId(ref)).toBe(1082278)
    expect(calls, 'одна и та же карточка не должна стоить поиска на каждом экране').toBe(1)
  })
})
