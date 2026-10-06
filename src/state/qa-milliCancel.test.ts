import { expect, mock, test } from 'bun:test'

/*
 * QA (qa.md §6.2, SPEC §0.5): «Стоп» обязан звать сервер — `milliCancel(sessionId)`,
 * иначе попытка списывается. Плюс старое поведение: вопрос возвращается в поле
 * (`restore`), ответ после отмены отбрасывается (turnSeq).
 */

const realApi = await import('../lib/api')
mock.module('../lib/api', () => ({ ...realApi, hasMillidaAccount: () => true }))

const realMilli = await import('../lib/milli')
const cancelled: (string | null | undefined)[] = []
let release: (v: unknown) => void = () => {}
mock.module('../lib/milli', () => ({
  ...realMilli,
  milliSend: () => new Promise((r) => (release = r)),
  milliCancel: async (sid?: string | null) => {
    cancelled.push(sid)
    return { ok: true, cancelled: 'running' }
  },
  milliProgress: () => new Promise(() => {}),
  milliStatus: async () => null,
}))

// Клики верстака ещё «едут»: benchSettled держим вручную (гонка «Стоп» до отправки).
const realBench = await import('./milliBench')
let settle: Promise<void> = Promise.resolve()
mock.module('./milliBench', () => ({ ...realBench, benchSettled: () => settle }))

const { useMilli, sendMilli, cancelMilli } = await import('./milli')

test('«Стоп» во время хода зовёт milliCancel с текущим sessionId, вопрос возвращается в поле, поздний ответ отброшен', async () => {
  useMilli.setState({ sessionId: 'ms_qa', messages: [], pending: false })
  const turn = sendMilli('хоррор на 250 модов')
  await Bun.sleep(5)
  expect(useMilli.getState().pending).toBe(true)
  const seq = useMilli.getState().restore.seq
  cancelMilli()
  await Bun.sleep(5)
  expect(cancelled).toEqual(['ms_qa'])
  const st = useMilli.getState()
  expect(st.pending).toBe(false)
  expect(st.restore).toEqual({ text: 'хоррор на 250 модов', seq: seq + 1 })
  expect(st.messages.some((m) => m.text === 'хоррор на 250 модов')).toBe(false)
  // Сервер всё же ответил — в ленту не попадает.
  release({ sessionId: 'ms_qa', user: { id: 'u', role: 'user', text: 'x', createdAt: '', pack: null, suggestions: [] }, reply: { id: 'r', role: 'assistant', text: 'поздно', createdAt: '', pack: null, suggestions: [] } })
  await turn
  expect(useMilli.getState().messages.some((m) => m.text === 'поздно')).toBe(false)
})

test('«Стоп» в новом разговоре (sessionId ещё нет) — milliCancel без sessionId', async () => {
  cancelled.length = 0
  useMilli.setState({ sessionId: null, messages: [], pending: false })
  const turn = sendMilli('техно')
  await Bun.sleep(5)
  cancelMilli()
  await Bun.sleep(5)
  expect(cancelled).toHaveLength(1)
  expect(cancelled[0] ?? null).toBeNull()
  release({ sessionId: 'ms_new', user: null, reply: null, cancelled: true })
  await turn
})

test('«Стоп», пока клики верстака не доехали (запрос ещё не ушёл) — сервер не зовём: иначе он удалит прошлую пару', async () => {
  cancelled.length = 0
  let go: () => void = () => {}
  settle = new Promise<void>((r) => (go = r))
  useMilli.setState({ sessionId: 'ms_prev', messages: [], pending: false })
  const turn = sendMilli('добавь шейдеры')
  await Bun.sleep(5)
  expect(useMilli.getState().pending).toBe(true)
  cancelMilli()
  await Bun.sleep(5)
  expect(cancelled).toEqual([])
  go()
  await turn
  settle = Promise.resolve()
})
