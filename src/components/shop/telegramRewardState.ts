import type { TelegramReward } from '../../lib/rubies'

export type TelegramStep = 'hidden' | 'link' | 'subscribe'

export function telegramStep(view: TelegramReward | null): TelegramStep {
  if (!view || typeof view !== 'object' || view.claimed) return 'hidden'
  if (!view.available || !(view.amount > 0)) return 'hidden'
  return view.linked ? 'subscribe' : 'link'
}

export function telegramLink(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname === 't.me' ? parsed.toString() : null
  } catch {
    return null
  }
}
