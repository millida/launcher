export const INVITE_PREFIX = '⟪mc-invite⟫'

const JOIN_PAGE = 'https://millida.net/join'
const ADDR_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{1,118})?(:\d{1,5})?$/

/** An invite may point at any Minecraft server, so the address is the only gate. */
export function isServerAddr(addr: string): boolean {
  return ADDR_RE.test((addr || '').trim())
}

const VERSION_RE = /^\d{1,4}(\.\d{1,3}){1,2}$/

/**
 * Версия сборки, из которой зовут: без неё принимающий лаунчер знает только
 * адрес и запускает что выбрано. Формат общий с `trade-web/src/lib/chat/invite.ts`.
 */
const cleanVersion = (v?: string | null): string => {
  const t = (v || '').trim()
  return VERSION_RE.test(t) ? t : ''
}

/** Public page that hands the address back to the launcher over `millida://join`. */
export function joinPageUrl(addr: string, name?: string | null, version?: string | null): string {
  const host = (addr || '').trim()
  if (!isServerAddr(host)) return ''
  const qs = new URLSearchParams({ addr: host })
  const label = (name || '').trim()
  if (label && label !== host) qs.set('name', label.slice(0, 48))
  const ver = cleanVersion(version)
  if (ver) qs.set('version', ver)
  return JOIN_PAGE + '?' + qs.toString()
}

export function encodeInvite(addr: string, name: string, version?: string | null): string {
  const ver = cleanVersion(version)
  return INVITE_PREFIX + JSON.stringify(ver ? { addr, name, version: ver } : { addr, name })
}

export function parseInvite(text: string): { addr: string; name: string; version?: string } | null {
  if (!text || !text.startsWith(INVITE_PREFIX)) return null
  try {
    const o = JSON.parse(text.slice(INVITE_PREFIX.length))
    if (!o || !o.addr) return null
    const ver = cleanVersion(typeof o.version === 'string' ? o.version : '')
    const base = { addr: String(o.addr), name: String(o.name || 'Сервер') }
    return ver ? { ...base, version: ver } : base
  } catch {}
  return null
}
