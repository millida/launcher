import { hasTauri } from '../ipc/tauri'
import { millidaApi, openUrl } from '../ipc/commands'
import { hasMillidaSession } from './secure'

export const LAUNCHER_API = localStorage.getItem('m-api') || 'https://api.millida.net/v2'

/// Modrinth и CurseForge недоступны в России без VPN, поэтому и каталог, и
/// картинки идут через наш API: он же отдаёт их с собственного адреса.
export const MODRINTH_API = LAUNCHER_API + '/launcher/mr'

const MIRRORED_ASSET_HOSTS = [
  'cdn.modrinth.com',
  'edge.forgecdn.net',
  'mediafilez.forgecdn.net',
  'media.forgecdn.net',
]

/// Адрес картинки с заблокированного CDN — через наш API; всё остальное как есть.
export function mirrorAsset(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  let host = ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return url
    host = parsed.hostname.toLowerCase()
  } catch {
    return url
  }
  if (!MIRRORED_ASSET_HOSTS.includes(host)) return url
  return LAUNCHER_API + '/launcher/dl?url=' + encodeURIComponent(url)
}

export const WALLET_URL = 'https://millida.net/profile?tab=wallet'

export const PROFILE_URL = 'https://millida.net/profile'

// No Authorization here: authenticated calls go through the core, which holds
// the token. The plain fetch path is the unauthenticated browser fallback.
export function apiHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

export function hasMillidaAccount(): boolean {
  return hasMillidaSession()
}

/// Signalled by event rather than calling session.ts directly, which would be a circular import.
export const SESSION_EXPIRED_EVENT = 'millida-session-expired'

export async function api<T = any>(pathname: string, opts?: RequestInit): Promise<T> {
  if (hasTauri()) {
    let body: unknown
    if (opts && typeof opts.body === 'string') {
      try {
        body = JSON.parse(opts.body)
      } catch {
        body = undefined
      }
    }
    try {
      return await millidaApi<T>(pathname, (opts && opts.method) || 'GET', body)
    } catch (e) {
      if (String(e).includes('unauthorized')) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      throw e
    }
  }
  const r = await fetch(LAUNCHER_API + pathname, {
    ...opts,
    headers: { ...apiHeaders(), ...((opts && (opts.headers as Record<string, string>)) || {}) },
  })
  if (!r.ok) throw new Error('http ' + r.status)
  return r.json()
}

export function openExt(u: string) {
  if (hasTauri()) openUrl(u)
  else window.open(u, '_blank')
}
