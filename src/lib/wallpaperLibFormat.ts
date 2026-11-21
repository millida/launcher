import type { LibrarySort } from '../components/wallpaperLibStore'
import { t, tx } from '../i18n'

export type WallpaperStatus = 'PENDING' | 'ACTIVE' | 'REJECTED'

export interface WallpaperCard {
  id: string
  name: string
  author: string
  thumbUrl: string
  imageUrl: string
  width: number
  height: number
  downloads: number
  likes: number
  liked: boolean
  mine: boolean
  createdAt: string
}

export interface OwnWallpaper extends WallpaperCard {
  status: WallpaperStatus
  moderationNote: string | null
}

export interface WallpaperPage {
  items: WallpaperCard[]
  total: number
}

export const LIBRARY_PAGE = 24
export const NAME_MAX = 64

export const LIBRARY_BASE = '/launcher/wallpapers'

export function libraryPath(sort: LibrarySort, q: string, offset: number): string {
  const params = new URLSearchParams({ sort, limit: String(LIBRARY_PAGE), offset: String(Math.max(0, offset)) })
  const query = q.trim()
  if (query) params.set('q', query)
  return LIBRARY_BASE + '?' + params.toString()
}

export function statusText(w: Pick<OwnWallpaper, 'status' | 'moderationNote'>): string {
  if (w.status === 'ACTIVE') return t('Опубликован')
  if (w.status === 'REJECTED') {
    const reason = (w.moderationNote ?? '').trim()
    return reason ? t('Отклонён: {reason}', { reason: tx(reason) }) : t('Отклонён')
  }
  return t('На проверке')
}

export function countText(n: number, locale: string): string {
  const value = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** A picked file is named after itself on disk; the extension says nothing to other players. */
export function draftName(fileName: string | undefined): string {
  return (fileName ?? '')
    .replace(/\.(png|jpe?g|webp)$/i, '')
    .trim()
    .slice(0, NAME_MAX)
}
