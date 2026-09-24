import { hasTauri } from '../ipc/tauri'
import { millidaApi, openUrl } from '../ipc/commands'
import { hasMillidaSession } from './secure'
import { DEMO_USER, ECONOMY_SHOWCASE, demoAnswer } from './demo'

// Dev-приложение открыто с http://localhost:5173, а прод по CORS пускает только
// tauri://localhost — прямые запросы (каталог Modrinth, скины в WebGL) падали.
// В dev с localhost ходим через прокси Vite (/papi → api.millida.net).
const DEV_LOCAL =
  import.meta.env.DEV && typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
// Подмена адреса API через localStorage — только в dev: в релизе запись в
// localStorage (XSS, чужое расширение) иначе увела бы все запросы с токеном.
const API_OVERRIDE = import.meta.env.DEV ? localStorage.getItem('m-api') : null
export const LAUNCHER_API = API_OVERRIDE || (DEV_LOCAL ? '/papi/v2' : 'https://api.millida.net/v2')

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

export const PLUS_MANAGE_URL = 'https://millida.net/profile#plus'

export const SUPPORT_URL = 'https://millida.net/chats?tab=support'

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
  // Витрина экономики в dev-приложении (VITE_ECONOMY_SHOWCASE): на проде новых
  // адресов магазина ещё нет, поэтому подменяем их и в Tauri, а не только в
  // браузере — иначе магазин в приложении пустой. Только dev-сборка.
  if (import.meta.env.DEV && ECONOMY_SHOWCASE && !DEMO_USER) {
    const demo = demoAnswer(pathname, opts)
    if (demo) return (await demo) as T
  }
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
  // Демо-просмотр в браузере (?preview=user, только dev): подменяем лишь то,
  // что сервер отдаёт вошедшему. Для всего остального ответа нет, и запрос
  // уходит на прод живым — рейтинг, каталог, тарифы и цены остаются настоящими.
  if (import.meta.env.DEV && (DEMO_USER || ECONOMY_SHOWCASE)) {
    const demo = demoAnswer(pathname, opts)
    if (demo) return (await demo) as T
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
