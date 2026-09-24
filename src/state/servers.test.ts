import { expect, test } from 'bun:test'

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
  configurable: true,
})

const { toCard } = await import('./servers')
type RatingServer = Parameters<typeof toCard>[0]

/* Вход → вердикт. Закреплено жалобой игрока 12.09.2026: у карточек мёртвых
   адресов стояла зелёная точка, «49 742 онлайн» и активная кнопка «Играть»,
   а на месте MOTD — «Сервер не в сети». */
const CASES: Array<[string, RatingServer, { isOnline: boolean; online: number; approx: boolean }]> = [
  [
    'ответил на пинг, игроков нет — сервер включён',
    { name: 'A', slug: 'a', isOnline: true, online: 0 },
    { isOnline: true, online: 0, approx: false },
  ],
  [
    'не ответил, но есть приблизительное число — офлайн',
    { name: 'B', slug: 'b', isOnline: false, online: 49742, onlineApprox: true },
    { isOnline: false, online: 49742, approx: true },
  ],
  [
    'ответ без поля isOnline: живое число игроков судим как раньше',
    { name: 'C', slug: 'c', online: 12 },
    { isOnline: true, online: 12, approx: false },
  ],
  [
    'ответ без поля isOnline: приблизительное число живым не считаем',
    { name: 'D', slug: 'd', online: 40000, onlineApprox: true },
    { isOnline: false, online: 40000, approx: true },
  ],
]

for (const [name, input, want] of CASES) {
  test(name, () => {
    const card = toCard(input, 1)
    expect(card.isOnline, `${name}: включённость`).toBe(want.isOnline)
    expect(card.online, `${name}: число онлайна`).toBe(want.online)
    expect(card.onlineApprox === true, `${name}: пометка «~»`).toBe(want.approx)
  })
}
