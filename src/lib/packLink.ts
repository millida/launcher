/// The alphabet of share codes (src-tauri share.rs CODE_ALPHABET): no O/0, I/1, no lowercase.
const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/

/// A Millida share link (millida.net/p/<code>) or a bare code pasted where a pack.toml
/// link is expected. Such a link is a page of the site, not a pack file, so it belongs
/// in "install by code". Returns the code, or null for anything else.
export function millidaPackCode(text: string): string | null {
  const raw = text.trim()
  if (!raw) return null
  if (!raw.includes('/')) {
    const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return raw.length <= 12 && CODE.test(code) ? code : null
  }
  let u: URL
  try {
    u = new URL(raw.includes('://') ? raw : 'https://' + raw)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (host !== 'millida.net' && host !== 'www.millida.net') return null
  const seg = u.pathname.split('/').filter(Boolean)
  if (seg.length !== 2 || seg[0] !== 'p') return null
  const code = seg[1].toUpperCase().replace(/[^A-Z0-9]/g, '')
  return CODE.test(code) ? code : null
}
