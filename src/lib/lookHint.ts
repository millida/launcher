import type { AppliedTexture, WornCosmetic } from './gameProfile'

/**
 * Что лаунчер сам только что надел (04.11.2026: «почему скины так долго одеваются»). После
 * «Надеть» лобби перечитывало образ со службы — гардероб, профиль и затем надетые вещи, — хотя
 * всё это только что ушло отсюда же. Теперь применённое запоминается и лобби надевает его сразу.
 * Подсказка живёт недолго: дальше снова служба, чтобы смена на сайте или с другого ПК не терялась.
 */

/** Сколько подсказка годна, мс. */
export const HINT_FRESH_MS = 30_000

export interface LookHint {
  /** Аккаунт, на котором надели. */
  who: string
  at: number
  /** Активные скин, плащ и руки после применения. */
  texture?: AppliedTexture
  /** Надетые вещи — как их отправили службе. */
  worn?: WornCosmetic[]
}

let hint: LookHint | null = null

const fresh = (h: LookHint | null, who: string, now: number): h is LookHint => !!h && h.who === who && now - h.at <= HINT_FRESH_MS

/** Подсказка этого аккаунта, пока свежа; иначе null — образ читается со службы. */
export function lookHint(who: string, now = Date.now()): LookHint | null {
  return fresh(hint, who, now) ? hint : null
}

/** Скин и плащ после применения; надетые вещи свежей подсказки сохраняются. */
export function noteTexture(texture: AppliedTexture, who: string, now = Date.now()): void {
  hint = { ...(fresh(hint, who, now) ? hint : {}), who, at: now, texture }
}

/** Вещи после применения; скин и плащ свежей подсказки сохраняются. */
export function noteWorn(worn: WornCosmetic[], who: string, now = Date.now()): void {
  hint = { ...(fresh(hint, who, now) ? hint : {}), who, at: now, worn: worn.slice() }
}

/** Служба приняла не всё: прежний список вещей больше не правда, лобби спросит службу. */
export function forgetWorn(who: string, now = Date.now()): void {
  if (!fresh(hint, who, now) || !hint.worn) return
  const { worn: _drop, ...rest } = hint
  hint = rest.texture ? rest : null
}

/** Только для тестов. */
export function _resetLookHint(): void {
  hint = null
}
