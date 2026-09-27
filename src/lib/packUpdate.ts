import { PACK_ACCESS_PREFIX, type ProfileSettings } from '../ipc/commands'
import type { PackView } from '../components/premium/packView'
import { apiErrorText } from './apiError'

export interface PackUpdate {
  slug: string
  from: string
  to: string
}

export type PackSettings = Pick<ProfileSettings, 'catalogPackSlug' | 'catalogPackVersion' | 'catalogPackReviewFile'>

// Same shape the core accepts: the settings file sits on the player's disk and the slug goes into an API path.
const SLUG = /^[a-z0-9-]{1,80}$/

export function catalogPackSlug(s: PackSettings | null | undefined): string | null {
  const slug = (s?.catalogPackSlug || '').trim()
  return SLUG.test(slug) ? slug : null
}

/**
 * Any difference from the published version is offered, not only a higher
 * number: a version the catalogue stopped serving (pulled as broken) gives way
 * to the one it serves now. A reviewer's candidate install is left alone, since
 * the published version is the one it is meant to replace.
 */
export function packUpdateFor(
  s: PackSettings | null | undefined,
  view: Pick<PackView, 'slug' | 'version'> | null | undefined,
): PackUpdate | null {
  const slug = catalogPackSlug(s)
  if (!slug || !view) return null
  if ((s?.catalogPackReviewFile || '').trim()) return null
  if (view.slug && view.slug !== slug) return null
  const from = (s?.catalogPackVersion || '').trim()
  const to = (view.version || '').trim()
  if (!from || !to || from === to) return null
  return { slug, from, to }
}

/** A reviewer's candidate install is never checked: the published version is what it is meant to replace. */
export function packNeedsCheck(s: PackSettings | null | undefined): boolean {
  return !!catalogPackSlug(s) && !(s?.catalogPackReviewFile || '').trim()
}

export type PackCard = { view: Pick<PackView, 'slug' | 'version'> | null } | { error: unknown }

export type PackLaunchStep =
  | { kind: 'launch' }
  | { kind: 'update'; update: PackUpdate }
  | { kind: 'launch-unchecked'; reason: string }

export function packLaunchStep(s: PackSettings | null | undefined, card: PackCard): PackLaunchStep {
  if (!packNeedsCheck(s)) return { kind: 'launch' }
  if ('error' in card) return { kind: 'launch-unchecked', reason: apiErrorText(card.error, 'каталог Millida не ответил') }
  const update = packUpdateFor(s, card.view)
  return update ? { kind: 'update', update } : { kind: 'launch' }
}

export type PackUpdateOutcome = { kind: 'done' } | { kind: 'failed'; error: unknown } | { kind: 'cancelled' }

export interface AfterPackUpdate {
  launch: boolean
  toast: string | null
}

function failureReason(e: unknown): string {
  const text = String((e as { message?: string } | null)?.message ?? e ?? '')
    .replace(/^Error:\s*/, '')
    .trim()
  const at = text.indexOf(PACK_ACCESS_PREFIX)
  const reason = (at >= 0 ? text.slice(at + PACK_ACCESS_PREFIX.length) : text).trim()
  return reason || 'причина неизвестна'
}

/**
 * A failed update never costs the player the evening: the core keeps the
 * installed version whole, so the game starts on it and the reason is shown.
 * Only a cancel stops the launch, since the player asked for exactly that.
 */
export function afterPackUpdate(u: PackUpdate, outcome: PackUpdateOutcome): AfterPackUpdate {
  if (outcome.kind === 'done') return { launch: true, toast: null }
  if (outcome.kind === 'cancelled') return { launch: false, toast: null }
  return {
    launch: true,
    toast: 'Сборку не удалось обновить до ' + u.to + ': ' + failureReason(outcome.error) + '. Запускаем установленную версию ' + u.from,
  }
}
