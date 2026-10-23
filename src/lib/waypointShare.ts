import { t } from '../i18n'

// The game mod writes and reads this line (millida-mod WaypointShare.java); the
// rules below mirror its parser exactly, so a line the game would refuse never
// becomes a card here. A changed layout gets a new marker, never a looser pattern.
export const MARK_PREFIX = '⟪mark⟫'

export interface SharedMark {
  name: string
  x: number
  y: number
  z: number
  dimension: string
  address: string
}

const LINE =
  /^⟪mark⟫ «([^«»]{1,64})» (-?[0-9]{1,8}) (-?[0-9]{1,5}) (-?[0-9]{1,8}) · ([a-z0-9_.:/-]{1,114}) · ([^ \t\n\v\f\r«»]{1,96})$/
const DIMENSION = /^[a-z0-9_.-]{1,48}:[a-z0-9_./-]{1,64}$/
const HOST = /^[a-z0-9._\-[\]]{1,90}$/
const MAX_NAME = 32
const MAX_HORIZONTAL = 30_000_000
const MAX_Y = 4096
const SHORT_DIMENSIONS: Record<string, string> = {
  overworld: 'minecraft:overworld',
  nether: 'minecraft:the_nether',
  end: 'minecraft:the_end',
}

const isJavaWhitespace = (c: number): boolean => {
  if (c === 0xa0 || c === 0x2007 || c === 0x202f) return false
  if ((c >= 0x09 && c <= 0x0d) || (c >= 0x1c && c <= 0x1f)) return true
  return /[\p{Zs}\p{Zl}\p{Zp}]/u.test(String.fromCodePoint(c))
}

const isHidden = (c: number): boolean =>
  c <= 0x1f ||
  (c >= 0x7f && c <= 0x9f) ||
  c === 0xad ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x2028 && c <= 0x202e) ||
  (c >= 0x2060 && c <= 0x206f) ||
  c === 0xfeff ||
  /[\p{Co}\p{Cn}]/u.test(String.fromCodePoint(c))

function safeClean(raw: string, max: number): string {
  let out = ''
  let space = false
  let kept = 0
  let i = 0
  while (i < raw.length && kept < max) {
    const c = raw.codePointAt(i) as number
    i += c > 0xffff ? 2 : 1
    if (c === 0xa7) {
      if (i < raw.length) i += (raw.codePointAt(i) as number) > 0xffff ? 2 : 1
      continue
    }
    if (isJavaWhitespace(c) || isHidden(c)) {
      space = out.length > 0
      continue
    }
    if (space) {
      out += ' '
      kept++
      space = false
      if (kept >= max) break
    }
    out += String.fromCodePoint(c)
    kept++
  }
  return out
}

const cleanName = (raw: string): string => safeClean(raw, MAX_NAME).replace(/[«»]/g, '').trim()

function asciiHost(host: string): string | null {
  let ascii = host
  if (/[^\x00-\x7f]/.test(host)) {
    try {
      ascii = new URL('http://' + host + '/').hostname
    } catch {
      return null
    }
  }
  const labels = ascii.split('.')
  return labels.every((l) => l.length > 0 && l.length <= 63) ? ascii : null
}

/** Mirrors WaypointScope.server: lower case host, numeric port, null for anything else. */
function serverKey(raw: string): string | null {
  let address = raw.trim().toLowerCase()
  while (address.endsWith('.')) address = address.slice(0, -1)
  if (!address || address.length > 96) return null
  let host = address
  let port = '25565'
  const colon = address.lastIndexOf(':')
  if (colon > 0 && address.indexOf(':') === colon) {
    host = address.slice(0, colon)
    port = address.slice(colon + 1)
    if (!/^[0-9]{1,5}$/.test(port)) return null
  }
  const ascii = asciiHost(host)
  if (!ascii || !HOST.test(ascii)) return null
  const number = parseInt(port, 10)
  if (number < 1 || number > 65535) return null
  return ascii + ':' + number
}

function fullDimension(token: string): string | null {
  return SHORT_DIMENSIONS[token] || (DIMENSION.test(token) ? token : null)
}

export function parseMark(text: string): SharedMark | null {
  if (!text || !text.startsWith(MARK_PREFIX)) return null
  const match = LINE.exec(text)
  if (!match) return null
  const [, name, xs, ys, zs, dim, addr] = match
  if (name !== cleanName(name)) return null
  const x = Number(xs) || 0
  const y = Number(ys) || 0
  const z = Number(zs) || 0
  if (Math.abs(x) > MAX_HORIZONTAL || Math.abs(z) > MAX_HORIZONTAL || Math.abs(y) > MAX_Y) return null
  const dimension = fullDimension(dim)
  const server = serverKey(addr)
  if (!dimension || !server) return null
  const address = server.endsWith(':25565') ? server.slice(0, -6) : server
  return { name, x, y, z, dimension, address }
}

export const markCoords = (m: SharedMark): string => m.x + ' ' + m.y + ' ' + m.z

export function markDimension(dimension: string): string {
  if (dimension === 'minecraft:overworld') return t('Верхний мир')
  if (dimension === 'minecraft:the_nether') return t('Незер')
  if (dimension === 'minecraft:the_end') return t('Энд')
  return dimension
}

export const markPreview = (m: SharedMark): string => t('Метка «{name}»', { name: m.name })
