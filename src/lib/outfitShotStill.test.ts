import { expect, test } from 'bun:test'

const rows = new Map<string, unknown>()
const shots = {
  get(key: string) {
    const q: { result?: unknown; onsuccess?: () => void } = {}
    queueMicrotask(() => {
      q.result = rows.get(key)
      q.onsuccess?.()
    })
    return q
  },
  put: (value: unknown, key: string) => void rows.set(key, value),
  delete: (key: string) => void rows.delete(key),
}
;(globalThis as { indexedDB?: unknown }).indexedDB = {
  open() {
    const r: { result: unknown; onsuccess?: () => void } = { result: { transaction: () => ({ objectStore: () => shots }) } }
    queueMicrotask(() => r.onsuccess?.())
    return r
  },
}

const { saveShot } = await import('./outfitShotStore')
const settled = () => new Promise((ok) => setTimeout(ok, 0))
const blob = new Blob(['x'])

test('saving the loop removes the frame kept for it, so disk does not grow by one frame per item', async () => {
  saveShot('emote', { blob, dressed: 1, pending: true })
  await settled()
  expect([...rows.keys()].some((k) => k.endsWith('|emote|still')), 'the first frame waits under its own key').toBe(true)

  saveShot('emote', { blob, dressed: 1, frames: 12, seconds: 1.5 })
  await settled()
  const left = [...rows.keys()]
  expect(left.some((k) => k.endsWith('|still')), 'the frame must go once its loop is saved').toBe(false)
  expect(left.some((k) => k.endsWith('|emote')), 'the loop itself stays').toBe(true)
})
