/** Описание клика по элементу — чистая функция, тестируется без браузера. См. uiTrack.ts. */

/** Минимум от DOM-элемента, который нужен описанию клика (так его можно тестировать без браузера). */
export interface TrackNode {
  tagName: string
  textContent: string | null
  getAttribute(name: string): string | null
  hasAttribute(name: string): boolean
  closest(selector: string): TrackNode | null
}

export interface ClickInfo {
  screen: string
  section?: string
  el: string
  id?: string
  kind?: string
  pos?: number
  src?: string
  mode?: string
}

export const CLICKABLE =
  '[data-track], button, a[href], [role="button"], [role="tab"], [role="option"], [role="menuitem"], .nav-item, .tgl, summary, input[type="checkbox"], input[type="radio"], select'

const LABEL_MAX = 40
const ID_MAX = 80

export function cleanLabel(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s.includes('@')) return ''
  return s.replace(/\d+([.,:]\d+)*/g, '#').slice(0, LABEL_MAX)
}

const cleanId = (raw: string | null | undefined): string | undefined => {
  const s = (raw || '').trim()
  return s ? s.slice(0, ID_MAX) : undefined
}

const attrUp = (node: TrackNode, name: string): string | null => {
  const own = node.getAttribute(name)
  if (own) return own
  const host = node.closest('[' + name + ']')
  return host ? host.getAttribute(name) : null
}

/** Описание клика по элементу; null — клик не пишем. */
export function describeClick(target: TrackNode, screen: string): ClickInfo | null {
  const el = target.closest(CLICKABLE)
  if (!el) return null
  if (el.closest('[data-notrack]')) return null
  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null

  const privateZone = !!el.closest('[data-private]')
  let label = cleanLabel(el.getAttribute('data-track'))
  if (!label) label = cleanLabel(el.getAttribute('aria-label'))
  if (!label && !privateZone) label = cleanLabel(el.getAttribute('title'))
  if (!label && !privateZone) label = cleanLabel(el.textContent)
  if (!label) label = privateZone ? 'private' : el.tagName.toLowerCase()

  const info: ClickInfo = { screen, el: label }
  const section = attrUp(el, 'data-section')
  if (section) info.section = section.slice(0, 32)
  // Приватная зона (чат, друзья, профиль): id собеседника, вид и режим
  // элемента не пишем — по ним можно восстановить, с кем и что делал игрок.
  if (privateZone) return info
  const id = cleanId(attrUp(el, 'data-id'))
  if (id) info.id = id
  const kind = attrUp(el, 'data-kind')
  if (kind) info.kind = kind.slice(0, 16)
  const pos = parseInt(attrUp(el, 'data-pos') || '', 10)
  if (Number.isFinite(pos) && pos >= 0) info.pos = pos
  const src = el.getAttribute('data-src') || (el.closest('[data-src]')?.getAttribute('data-src') ?? null)
  if (src) info.src = src.slice(0, 24)
  const mode = attrUp(el, 'data-mode')
  if (mode) info.mode = mode.slice(0, 24)
  return info
}

