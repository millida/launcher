export const INVITE_PREFIX = '⟪mc-invite⟫'

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
