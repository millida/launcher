import { expect, mock, test } from 'bun:test'

const realApi = await import('../lib/api')
mock.module('../lib/api', () => ({ ...realApi, hasMillidaAccount: () => true }))

const realMilli = await import('../lib/milli')
const extras: { action?: string }[] = []
let failNext = true
mock.module('../lib/milli', () => ({
  ...realMilli,
  milliSend: async (_text: string, _sid: string | null, _enhanced: boolean, extra: { action?: string }) => {
    extras.push(extra)
    if (failNext) throw new Error('http 400 bad')
    return { sessionId: 'ms_qa', user: { id: 'u', role: 'user', text: 'Accept', createdAt: '', pack: null, suggestions: [] }, reply: { id: 'r', role: 'assistant', text: 'ok', createdAt: '', pack: null, suggestions: [] } }
  },
  milliProgress: () => new Promise(() => {}),
  milliStatus: async () => null,
  milliPc: async () => null,
}))

const { useMilli, sendMilli, retryMilli } = await import('./milli')

test('retry after a failed accept sends the accept code again, so the plan is built whatever the label language', async () => {
  useMilli.setState({ sessionId: 'ms_qa', messages: [], pending: false })
  await sendMilli('Accept', { action: 'accept' })
  expect(useMilli.getState().failedAction).toBe('accept')
  const failed = extras.length
  failNext = false
  retryMilli()
  for (let i = 0; i < 500 && extras.length === failed; i++) await Bun.sleep(2)
  expect(extras.length, 'retry must reach the server').toBe(failed + 1)
  expect(extras.every((x) => x.action === 'accept'), 'every attempt, retries included, must carry the accept code').toBe(true)
})
