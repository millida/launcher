import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createOpenOnce } from './openOnce'

type Answer = { ok: string } | { error: string }

function harness() {
  const calls: Array<{ id: string; settle: (a: Answer) => void }> = []
  const open = createOpenOnce<Answer>(
    (id) =>
      new Promise<Answer>((resolve) => {
        calls.push({ id, settle: resolve })
      }),
  )
  return { calls, open }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('chest open requests', () => {
  test('two windows share one request for the same chest', () => {
    const { calls, open } = harness()
    const a = open('c1')
    const b = open('c1')
    expect(a, 'a double mount must not open the chest twice').toBe(b)
    expect(calls.length).toBe(1)
  })

  test('a retry sends a new request instead of waiting on the hung one', () => {
    const { calls, open } = harness()
    const hung = open('c1')
    const retried = open('c1', true)
    expect(retried, 'the retry button would otherwise wait on the same dead socket').not.toBe(hung)
    expect(calls.length).toBe(2)
  })

  test('a late failure of the hung request does not evict the retry', async () => {
    const { calls, open } = harness()
    open('c1')
    const retried = open('c1', true)
    calls[0]!.settle({ error: 'timeout' })
    await tick()
    expect(open('c1'), 'a second window must join the live retry, not start a third request').toBe(retried)
    expect(calls.length).toBe(2)
  })

  test('a failed request can be reopened later', async () => {
    const { calls, open } = harness()
    open('c1')
    calls[0]!.settle({ error: 'boom' })
    await tick()
    open('c1')
    expect(calls.length, 'after an error the next window must send a new request').toBe(2)
  })

  test('the opening window asks for a fresh request on retry', () => {
    const host = readFileSync(new URL('./ChestOpen.tsx', import.meta.url), 'utf8')
    expect(host, 'retry must bypass the cached in-flight request').toContain('openOnce(chest.id, attempt > 0)')
  })
})
