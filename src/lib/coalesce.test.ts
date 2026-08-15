import { describe, expect, it } from 'bun:test'
import { coalesce } from './coalesce'

const deferred = () => {
  let resolve: (v: number) => void = () => {}
  const promise = new Promise<number>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

// Вход → вердикт. Экран друзей открывали вход, оболочка и сам экран разом:
// три одинаковых запроса за кадр вместо одного.
describe('склейка одинаковых загрузок', () => {
  it('вызовы во время полёта ждут один запрос', async () => {
    let runs = 0
    const gate = deferred()
    const load = coalesce(() => {
      runs++
      return gate.promise
    })
    const all = Promise.all([load(), load(), load()])
    gate.resolve(7)
    expect(await all).toEqual([7, 7, 7])
    expect(runs).toBe(1)
  })

  it('следующий вызов после ответа идёт на сервер: обновление после действия не теряется', async () => {
    let runs = 0
    const load = coalesce(async () => {
      runs++
    })
    await load()
    await load()
    expect(runs).toBe(2)
  })

  it('упавшая загрузка не запирает следующую', async () => {
    let runs = 0
    const load = coalesce(async () => {
      runs++
      throw new Error('offline')
    })
    await expect(load()).rejects.toThrow('offline')
    await expect(load()).rejects.toThrow('offline')
    expect(runs).toBe(2)
  })
})
