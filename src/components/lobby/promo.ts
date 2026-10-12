import { RECS_UID_KEY, dayIndex, hashStr } from '../../lib/recsMix'

/**
 * Баннер справа в лобби — карусель (владелец 11.10.2026: «реклама, которая раз
 * в минуту меняется»): чат игроков в Discord, подписка на Telegram, наша анархия, Аркания, PrisonRPG и
 * сервер PvP-тиров. Порядок — как сказал владелец.
 */
export type PromoSlide = 'discord' | 'telegram' | 'anarchy' | 'arcania' | 'prisonrpg' | 'smp'

export const PROMO_ORDER: PromoSlide[] = ['discord', 'telegram', 'anarchy', 'arcania', 'prisonrpg', 'smp']
/** Слайд держится 7 секунд (владелец 11.10.2026: «минута — слишком долго»); наведение держит. */
export const PROMO_ROTATE_MS = 7_000

/** Отдельное вечное приглашение лаунчера: по числу входов видно, сколько привёл баннер. */
export const DISCORD_INVITE = 'https://discord.gg/ec8xAhDSH7'
/** Канал Millida в Telegram: баннер зовёт подписаться. */
export const TELEGRAM_CHAT = 'https://t.me/millida'
export const ARCANIA_SLUG = 'arcania'

/** Слайды, которые сейчас можно показать: сборка без карточки в каталоге выпадает. */
export function promoSlides(ready: { arcania: boolean; prisonrpg: boolean }): PromoSlide[] {
  return PROMO_ORDER.filter((s) => (s === 'arcania' ? ready.arcania : s === 'prisonrpg' ? ready.prisonrpg : true))
}

/** С какого слайда начать: у каждого игрока свой день — так все слайды получают показы поровну. */
export function promoStart(count: number, day: number, salt: number): number {
  if (count <= 0 || !Number.isFinite(day) || !Number.isFinite(salt)) return 0
  return (((Math.floor(day) + Math.floor(salt)) % count) + count) % count
}

export function promoAt(slides: PromoSlide[], start: number, step: number): PromoSlide | null {
  if (!slides.length) return null
  const n = slides.length
  const i = (((Math.floor(start) + Math.floor(Number.isFinite(step) ? step : 0)) % n) + n) % n
  return slides[i] ?? null
}

let seed: { day: number; salt: number } | null = null

/** Заморожено при первом вызове: полночь или перерисовка не меняют слайд под курсором. */
export function promoSeed(): { day: number; salt: number } {
  if (seed) return seed
  let uid = 'anon'
  try {
    uid = localStorage.getItem(RECS_UID_KEY) || 'anon'
  } catch {}
  seed = { day: dayIndex(), salt: hashStr(uid) }
  return seed
}
