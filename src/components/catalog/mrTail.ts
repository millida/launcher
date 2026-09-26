import { MR_CATEGORY, displayName } from './site'
import type { SiteCard, SiteSlug } from './site'
import type { ModHit } from '../../state/mods'

const MR_TYPE: Partial<Record<SiteSlug, string>> = {
  mods: 'mod',
  modpacks: 'modpack',
  'texture-packs': 'resourcepack',
  shaders: 'shader',
  'data-packs': 'datapack',
}

const ICON_ONLY = new Set(['scroll-text', 'shield', 'castle', 'tree-pine', 'theater'])

const RESOLUTIONS = new Set(['8x-', '16x', '32x', '48x', '64x', '128x', '256x', '512x+'])

export function mrCategory(value: string): string | null {
  const key = value.trim().toLowerCase()
  const mapped = MR_CATEGORY[key]
  if (mapped && !ICON_ONLY.has(mapped)) return mapped
  return RESOLUTIONS.has(key) ? key : null
}

const RU_CATEGORY: Record<string, string> = Object.entries(MR_CATEGORY).reduce<Record<string, string>>((acc, [ru, mr]) => {
  if (!ICON_ONLY.has(mr) && !acc[mr]) acc[mr] = ru
  return acc
}, {})

export interface MrTarget {
  type: string
  category: string | null
}

export function mrTarget(section: SiteSlug, category: string | null): MrTarget | null {
  const type = MR_TYPE[section]
  if (!type) return null
  if (!category) return { type, category: null }
  const mapped = mrCategory(category)
  return mapped ? { type, category: mapped } : null
}

const RELEASE = /^\d+\.\d+(?:\.\d+)?$/

export function cardFromMrHit(h: ModHit, section: SiteSlug): SiteCard | null {
  if (!h.slug) return null
  return {
    slug: h.slug,
    section,
    title: h.title,
    summary: h.desc,
    cover: h.cover || null,
    icon: h.icon || null,
    side: null,
    launcherOnly: false,
    author: h.author || null,
    downloads: null,
    versions: (h.gameVers || []).filter((v) => RELEASE.test(v)).reverse(),
    loaders: h.loaders || [],
    categories: h.cats.map((c) => RU_CATEGORY[c]).filter((c): c is string => !!c),
    publishedAt: null,
    updatedAt: null,
    mrHit: h,
  }
}

const KIND_TAIL = /\s*[—–-]\s*(?:плагин|мод|карта|сборка|шейдер|ресурс-?пак|дата-?пак)\s*$/i
const VERSION_TAIL = /\s+v?\d+(?:\.\d+)+[a-z0-9.+-]*$/i

export function titleKey(title: string): string {
  const base = displayName(title).replace(KIND_TAIL, '').replace(VERSION_TAIL, '')
  return base.toLowerCase().replace(/[^a-z0-9а-яё]+/g, '')
}

function slugKeys(slug: string): string[] {
  const s = slug.toLowerCase()
  return [s, s.replace(/-dlya-minecraft$/, ''), s.replace(/-\d+$/, '')]
}

export function millidaKeys(card: SiteCard, resolved: ModHit | null | undefined): string[] {
  const keys = slugKeys(card.slug).map((s) => 's:' + s)
  const t = titleKey(card.title)
  if (t) keys.push('t:' + t)
  if (resolved && resolved.slug) keys.push('s:' + resolved.slug.toLowerCase())
  if (resolved && resolved.pid) keys.push('p:' + resolved.pid)
  return keys
}

function mrKeys(card: SiteCard): string[] {
  const keys = ['s:' + card.slug.toLowerCase()]
  const t = titleKey(card.title)
  if (t) keys.push('t:' + t)
  if (card.mrHit && card.mrHit.pid) keys.push('p:' + card.mrHit.pid)
  return keys
}

export function appendMr(shown: SiteCard[], got: SiteCard[]): SiteCard[] {
  const seen = new Set(shown.map((c) => c.slug))
  const out = shown.slice()
  for (const c of got) {
    if (seen.has(c.slug)) continue
    seen.add(c.slug)
    out.push(c)
  }
  return out
}

export function millidaExhausted(page: number, pages: number): boolean {
  return page > 0 && page >= pages
}

export function mrTail(
  items: SiteCard[],
  mr: SiteCard[],
  page: number,
  pages: number,
  resolved: (card: SiteCard) => ModHit | null | undefined,
): SiteCard[] {
  if (!mr.length || !millidaExhausted(page, pages)) return []
  const taken = new Set<string>()
  for (const c of items) for (const k of millidaKeys(c, resolved(c))) taken.add(k)
  return mr.filter((c) => !mrKeys(c).some((k) => taken.has(k)))
}

export function mrHasMore(offset: number, got: number, total: number, pageSize: number): boolean {
  return got >= pageSize && offset + got < total
}

export type NextLoad = 'millida' | 'modrinth' | null

export function nextLoad(st: { page: number; pages: number; mrMore: boolean }): NextLoad {
  if (st.page < st.pages) return 'millida'
  return st.mrMore ? 'modrinth' : null
}
