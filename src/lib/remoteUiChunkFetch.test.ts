import { describe, expect, test } from 'bun:test'
import { CHUNK_RETRY_MS, RemoteChunkGone, fetchChunkText, sha256Hex } from './remoteUi'

const BODY = 'export const a = 1'
const resp = (status: number, body = BODY) => new Response(body, { status })

type Step = number | 'net' | 'bad'

async function run(steps: Step[]) {
  const sha = await sha256Hex(BODY)
  const waits: number[] = []
  const inits: (RequestInit | undefined)[] = []
  let i = 0
  const get = (async (_url: string, init?: RequestInit) => {
    inits.push(init)
    const s = steps[Math.min(i++, steps.length - 1)]!
    if (s === 'net') throw new TypeError('Failed to fetch')
    if (s === 'bad') return resp(200, 'tampered')
    return resp(s)
  }) as unknown as typeof fetch
  const out = await fetchChunkText('https://x/v/c.js', 'v/c.js', sha, async (ms) => void waits.push(ms), get).then(
    (t) => ({ ok: t }),
    (e: unknown) => ({ err: e }),
  )
  return { out, waits, calls: i, inits }
}

describe('lazy chunk download: a one-off failure must not leave the screen dead', () => {
  const cases: { why: string; steps: Step[]; ok: boolean; gone?: boolean; calls: number }[] = [
    { why: 'the normal case: one request', steps: [200], ok: true, calls: 1 },
    { why: 'the reported c-easy-data case: one timeout, then 200', steps: ['net', 200], ok: true, calls: 2 },
    { why: 'a 502 while replicas roll over is retried', steps: [502, 503, 200], ok: true, calls: 3 },
    { why: 'a truncated or tampered answer is fetched again, never run', steps: ['bad', 200], ok: true, calls: 2 },
    { why: 'a version removed from the site: no point hammering the same URL', steps: [404], ok: false, gone: true, calls: 1 },
    { why: '404 after a network blip still means gone', steps: ['net', 404], ok: false, gone: true, calls: 2 },
    { why: 'a site that stays down gives up after the backoff', steps: ['net'], ok: false, calls: CHUNK_RETRY_MS.length + 1 },
  ]
  for (const c of cases)
    test(c.why, async () => {
      const r = await run(c.steps)
      expect('ok' in r.out, c.why).toBe(c.ok)
      expect(r.calls, 'requests made: ' + c.why).toBe(c.calls)
      if (!c.ok) expect((r.out as { err: unknown }).err instanceof RemoteChunkGone, 'a gone chunk must be told apart so the screen moves to the live version').toBe(!!c.gone)
    })

  test('backoff grows between attempts', async () => {
    const r = await run(['net'])
    expect(r.waits, 'retries must back off, not spin').toEqual(CHUNK_RETRY_MS)
  })

  test('every attempt revalidates instead of trusting a cached 404', async () => {
    const r = await run(['net', 200])
    expect(r.inits.every((x) => x?.cache === 'no-cache'), 'the webview kept a year-long 404 and every retry was answered from it').toBe(true)
  })
})
