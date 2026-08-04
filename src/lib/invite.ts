export const INVITE_PREFIX = '⟪mc-invite⟫'

const JOIN_PAGE = 'https://millida.net/join'
const ADDR_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{1,118})?(:\d{1,5})?$/

/** An invite may point at any Minecraft server, so the address is the only gate. */
export function isServerAddr(addr: string): boolean {
  return ADDR_RE.test((addr || '').trim())
}

/** Public page that hands the address back to the launcher over `millida://join`. */
export function joinPageUrl(addr: string, name?: string | null): string {
  const host = (addr || '').trim()
  if (!isServerAddr(host)) return ''
  const qs = new URLSearchParams({ addr: host })
  const label = (name || '').trim()
  if (label && label !== host) qs.set('name', label.slice(0, 48))
  return JOIN_PAGE + '?' + qs.toString()
}

export function encodeInvite(addr: string, name: string): string {
  return INVITE_PREFIX + JSON.stringify({ addr, name })
}

export function parseInvite(text: string): { addr: string; name: string } | null {
  if (!text || !text.startsWith(INVITE_PREFIX)) return null
  try {
    const o = JSON.parse(text.slice(INVITE_PREFIX.length))
    if (o && o.addr) return { addr: String(o.addr), name: String(o.name || 'Сервер') }
  } catch {}
  return null
}
