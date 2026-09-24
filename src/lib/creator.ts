import { api } from './api'
import { apiErrorText } from './apiError'
import type { ChestTier } from './rubies'

/**
 * Код автора (как Support-a-Creator в Fortnite, 24.09.2026). Контракт службы:
 *   GET    /launcher/creator-code         → CreatorSupport | { code: null }
 *   POST   /launcher/creator-code { code } → CreatorSupport (+ bonus) | 404 «Код не найден» | 400 { message }
 *   DELETE /launcher/creator-code         → { code: null }
 *   GET    /creator-codes/public/:code    → { code, name, avatarUrl? }
 * Код хранится на службе, а не в лаунчере: автору засчитываются покупки с сайта тоже.
 */

export interface CreatorSupport {
  code: string
  name: string
  avatarUrl?: string | null
  /** С какого момента человек поддерживает автора (ISO). */
  since: string
}

/** Бесплатный сундук за первый введённый код (правка владельца 24.09.2026). */
export interface CreatorBonus {
  chestId: string
  tier: ChestTier
}

export type CreatorAnswer = CreatorSupport & { bonus?: CreatorBonus | null }

/** Лендинг «Стать автором» (делается параллельно). */
export const CREATORS_URL = 'https://millida.net/creators?utm_source=launcher&utm_medium=shop&utm_campaign=creator_code'

const PATH = '/launcher/creator-code'

const orNull = <T extends { code: string | null }>(r: T | null | undefined) => (r && r.code ? r : null)

export const loadCreator = () => api<CreatorSupport | { code: null }>(PATH).then((r) => orNull(r) as CreatorSupport | null)

export const setCreator = (code: string) =>
  api<CreatorAnswer>(PATH, { method: 'POST', body: JSON.stringify({ code: code.trim() }) })

export const clearCreator = () => api<{ code: null }>(PATH, { method: 'DELETE' })

export const publicCreator = (code: string) =>
  api<{ code: string; name: string; avatarUrl?: string | null }>('/creator-codes/public/' + encodeURIComponent(code.trim()))

const rawOf = (e: unknown) => String((e as { message?: string } | null)?.message ?? e ?? '').replace(/^Error:\s*/, '')

/** Ответ «такого адреса нет»: служба ещё не выкатила коды авторов (или код не найден — смотря где). */
export const isNotFound = (e: unknown) => /\bhttp 404\b|^cannot (get|post|delete)\b|^not found$/i.test(rawOf(e).trim())

export const SOON = 'Коды авторов скоро заработают'

/**
 * Текст ошибки ввода. `live` — служба ответила на GET, значит 404 на POST —
 * это «код не найден», а не отсутствие адреса.
 */
export function creatorErrorText(e: unknown, live: boolean): string {
  if (isNotFound(e)) return live ? 'Код не найден' : SOON
  return apiErrorText(e, 'Не получилось, попробуй позже')
}

/** Подарок за первый код уже получен в этом лаунчере — плашку «+ сундук» больше не показываем. */
const BONUS_KEY = 'm-cc-bonus-used'
export function bonusUsed(): boolean {
  try {
    return localStorage.getItem(BONUS_KEY) === '1'
  } catch {
    return false
  }
}
export function markBonusUsed() {
  try {
    localStorage.setItem(BONUS_KEY, '1')
    // Старый способ (промокодом) помнил код в лаунчере — больше не нужен.
    localStorage.removeItem('m-creator-code')
  } catch {}
}
