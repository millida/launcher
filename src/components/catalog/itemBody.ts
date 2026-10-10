import { ruLabel } from '../../lib/format'
import { weaveMarkdown } from './weave'

const CYR = /[а-яё]/gi
const LAT = /[a-z]/gi
const VERSION = /^\d+(\.\d+)*[a-z0-9.-]*$/i

export function readsRussian(text: string | null | undefined): boolean {
  if (!text) return false
  const plain = text.replace(/\]\([^)]*\)|https?:\S+/g, ' ')
  const cyr = (plain.match(CYR) || []).length
  return cyr > 0 && cyr >= (plain.match(LAT) || []).length
}

// Imported cards keep the source blurb as their article body until an AI text exists;
// the Russian retelling written for search pages carries the same facts.
export function russianText(desc: string, seoText: string | null | undefined, summary: string | null | undefined): string {
  for (const t of [desc, seoText, summary]) if (readsRussian(t)) return t!.trim()
  return ''
}

export const MAX_INLINE_SHOTS = 5

export function sliderKeep(total: number): number {
  if (total >= 5) return 3
  if (total === 4) return 2
  return 1
}

// Same split as the site catalog page: the strip keeps the first shots, the tail goes into the text,
// and every shot appears on the page once.
export function planMedia(body: string, shots: string[]): { body: string; strip: string[] } {
  const room = Math.min(MAX_INLINE_SHOTS, Math.max(0, shots.length - sliderKeep(shots.length)))
  if (!body || !room) return { body, strip: shots }
  const tail = shots.slice(shots.length - room)
  const woven = weaveMarkdown(body, tail, { every: 2, max: room })
  const placed = new Set(tail.filter((u) => woven.includes('](' + u + ')')))
  return { body: woven, strip: shots.filter((u) => !placed.has(u)) }
}

export function tagLabels(tags: string[], limit: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of tags) {
    const t = raw.trim()
    const known = ruLabel(t.toLowerCase())
    const label = known || (VERSION.test(t) || readsRussian(t) ? t : null)
    if (!label) continue
    const shown = label.charAt(0).toUpperCase() + label.slice(1)
    const key = shown.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(shown)
    if (out.length >= limit) break
  }
  return out
}
