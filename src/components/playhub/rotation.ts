/**
 * Ротация хаба «Во что играем» (ресёрч analysis/2026-09-24_хаб-во-что-играем-и-каталог.md, §1 и §3):
 * «Сегодня» меняется раз в сутки, hero-слот — раз за сессию, без автокарусели.
 * Всё детерминированно: у всех игроков в один день одни и те же карточки дня.
 */

/** Номер местных суток: меняется в полночь по часам игрока. */
export function dayNumber(now = Date.now()): number {
  return Math.floor((now - new Date(now).getTimezoneOffset() * 60000) / 86400000)
}

/** Номер недели (от понедельника): для «Подборки недели». */
export const weekNumber = (now = Date.now()): number => Math.floor((dayNumber(now) + 3) / 7)

/**
 * Позиция в списке длины n по номеру дня и «соли» карточки: соседние дни не
 * идут подряд по списку, а разные карточки дня не совпадают по номеру.
 */
export function pickIndex(day: number, n: number, salt: number): number {
  if (n <= 0) return 0
  let x = (day * 2654435761 + salt * 40503) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 2246822519) >>> 0
  x = (x ^ (x >>> 13)) >>> 0
  return x % n
}

/** Сколько осталось до полуночи: «05:12». */
export function untilMidnight(now = Date.now()): string {
  const d = new Date(now)
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
  const min = Math.max(0, Math.ceil((next - now) / 60000))
  const hh = Math.floor(min / 60)
  const mm = min % 60
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')
}

export type HeroSlot = 'arcania' | 'oneblock' | 'week'
export const HERO_ORDER: HeroSlot[] = ['arcania', 'oneblock', 'week']

const HERO_KEY = 'm-hub-hero'
/**
 * Номер hero-слота на сегодня: одна реклама в день, завтра — следующая
 * (владелец 24.09.2026: не менять слот с каждым запуском). Хранится
 * «дата:номер»; новый день — сдвиг на следующий слот.
 */
const sessionHero: number = (() => {
  const today = new Date().toDateString()
  let n = 0
  try {
    const [day, num] = (localStorage.getItem(HERO_KEY) || '').split(':')
    const was = Number(num) || 0
    n = day === today ? was : day ? (was + 1) % HERO_ORDER.length : 0
    localStorage.setItem(HERO_KEY, today + ':' + n)
  } catch {}
  return n % HERO_ORDER.length
})()

/** Слоты в порядке показа: первый — этой сессии, дальше — запасные, если у него нет данных. */
export const heroQueue = (): HeroSlot[] => HERO_ORDER.map((_, i) => HERO_ORDER[(sessionHero + i) % HERO_ORDER.length]!)
