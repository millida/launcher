// Translation fixes shipped from the website. millida.net/launcher-ui/i18n.json lists one table per language
// (Russian key -> text, Russian included), signed with the same Ed25519 key as the remote screens; the tables
// are laid over the built-in dictionaries, so a wrong or missing translation is fixed with a site deploy.
// The source is src/launcher-ui/i18n/<code>.json in the millida-web repo.
// Network: GET of i18n.json once per session and language at most every CHECK_EVERY_MS, plus the table itself
// only when its hash changed. A fix can change words but never a {placeholder}: such entries are dropped.
import { REMOTE_UI_BASE, sha256Hex, verifySigned } from '../lib/remoteOrigin'
import { placeholdersOf, type Table } from './core'

export const I18N_TAG = 'millida-launcher-i18n/1'
const I18N_API = 1
const OFF_KEY = 'm-i18n-remote'
const CACHE_PREFIX = 'm-i18n-fix:'
const CHECKED_PREFIX = 'm-i18n-checked:'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const MAX_TABLE_CHARS = 2_000_000
const TABLE_FILE = /^i18n\/[\w-]+-[0-9a-f]{16}\.json$/

export interface I18nTableRef {
  file: string
  sha256: string
}

export interface I18nManifest {
  api: number
  builtAt: string
  tables: Record<string, I18nTableRef>
  sig: string | null
}

export function i18nSignedText(m: Pick<I18nManifest, 'api' | 'builtAt' | 'tables'>): string {
  const rows = Object.keys(m.tables)
    .sort()
    .map((code) => `${code}:${m.tables[code]!.file}:${m.tables[code]!.sha256}`)
  return [I18N_TAG, m.api, m.builtAt, ...rows].join('\n')
}

export async function verifyI18nManifest(m: I18nManifest, key?: CryptoKey | null): Promise<boolean> {
  if (!m || m.api !== I18N_API || typeof m.sig !== 'string' || typeof m.builtAt !== 'string') return false
  if (!m.tables || typeof m.tables !== 'object' || Array.isArray(m.tables)) return false
  for (const [code, ref] of Object.entries(m.tables)) {
    if (!/^[\w-]+$/.test(code) || !ref || typeof ref.file !== 'string' || !TABLE_FILE.test(ref.file) || !/^[0-9a-f]{64}$/.test(ref.sha256)) return false
  }
  return verifySigned(i18nSignedText(m), m.sig, key)
}

/** Keeps the non-empty strings whose placeholders match the key's. */
export function cleanTable(raw: unknown): Table {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [key, text] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof text !== 'string' || !text || placeholdersOf(key).join() !== placeholdersOf(text).join()) continue
    out[key] = text
  }
  return out
}

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // no localStorage or it is full: the fixes are fetched again next time
  }
}

/// Only inside the app (a Vite build sets DEV or PROD): unit tests never reach the network.
export const remoteI18nEnabled = (): boolean => !!(import.meta.env.DEV || import.meta.env.PROD) && read(OFF_KEY) !== '0'

interface Stored {
  sha256: string
  table: Table
}

function stored(code: string): Stored | null {
  try {
    const v = JSON.parse(read(CACHE_PREFIX + code) || 'null') as Stored | null
    return v && typeof v.sha256 === 'string' ? { sha256: v.sha256, table: cleanTable(v.table) } : null
  } catch {
    return null
  }
}

/** Fixes saved by an earlier run: applied at once, before any network. */
export function cachedFixes(code: string): Table | null {
  return remoteI18nEnabled() ? (stored(code)?.table ?? null) : null
}

let manifestRun: Promise<I18nManifest | null> | null = null

function manifest(): Promise<I18nManifest | null> {
  manifestRun ??= fetch(REMOTE_UI_BASE + '/i18n.json')
    .then(async (r) => {
      if (!r.ok) return null
      const m = (await r.json()) as I18nManifest
      return (await verifyI18nManifest(m)) ? m : null
    })
    .catch(() => null)
  return manifestRun
}

const asked = new Set<string>()

/** New fixes for one language: a table when they changed ({} when the site dropped them), null otherwise. */
export async function fetchFixes(code: string, now = Date.now()): Promise<Table | null> {
  if (!remoteI18nEnabled() || asked.has(code)) return null
  asked.add(code)
  const last = Number(read(CHECKED_PREFIX + code) || 0)
  if (now - last < CHECK_EVERY_MS && now >= last) return null
  const m = await manifest()
  if (!m) return null
  write(CHECKED_PREFIX + code, String(now))
  const ref = m.tables[code]
  const have = stored(code)
  if (!ref) {
    if (!have) return null
    write(CACHE_PREFIX + code, null)
    return {}
  }
  if (have?.sha256 === ref.sha256) return null
  try {
    const r = await fetch(REMOTE_UI_BASE + '/' + ref.file)
    if (!r.ok) return null
    const text = await r.text()
    if (text.length > MAX_TABLE_CHARS || (await sha256Hex(text)) !== ref.sha256) return null
    const table = cleanTable(JSON.parse(text))
    write(CACHE_PREFIX + code, JSON.stringify({ sha256: ref.sha256, table }))
    return table
  } catch {
    return null
  }
}
