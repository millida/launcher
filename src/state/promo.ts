import { create } from 'zustand'
import { LAUNCHER_API } from '../lib/api'

export const ANARCHY_ID = 'MCRU_ANARCHY'
export const FOR_YOU_CARDS = ['hosting', ANARCHY_ID, 'ONEBLOCK'] as const
export type ForYouCard = (typeof FOR_YOU_CARDS)[number]

export interface ServerPromo {
  name?: string
  fullName?: string
  tagline?: string
  addr?: string
  version?: string
}

/**
 * Placements the API can change without a launcher release. The built-in
 * defaults are what the last release shipped, so an offline launcher or an
 * empty server answer looks exactly as before.
 */
export interface Promo {
  anarchy: ServerPromo
  lobby: typeof ANARCHY_ID | null
  forYou: readonly ForYouCard[]
  modesLead: typeof ANARCHY_ID | null
}

export const DEFAULT_PROMO: Promo = {
  anarchy: {},
  lobby: ANARCHY_ID,
  forYou: ['hosting', ANARCHY_ID, 'ONEBLOCK'],
  modesLead: ANARCHY_ID,
}

const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::\d{1,5})?$/
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/
const VERSION = /^\d{1,2}\.\d{1,3}(?:\.\d{1,3})?$/

const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined

function readServer(raw: unknown): ServerPromo {
  if (!raw || typeof raw !== 'object') return {}
  const v = raw as Record<string, unknown>
  const addr = typeof v.addr === 'string' ? v.addr.trim().toLowerCase() : ''
  const version = typeof v.version === 'string' ? v.version.trim() : ''
  const out: ServerPromo = {}
  const name = text(v.name, 40)
  const fullName = text(v.fullName, 60)
  const tagline = text(v.tagline, 80)
  if (name) out.name = name
  if (fullName) out.fullName = fullName
  if (tagline) out.tagline = tagline
  if (addr.includes('.') && HOST.test(addr) && !IP_LITERAL.test(addr)) out.addr = addr
  if (VERSION.test(version)) out.version = version
  return out
}

const readSlot = (v: unknown, fallback: Promo['lobby']): Promo['lobby'] => (v === null || v === ANARCHY_ID ? v : fallback)

function readForYou(v: unknown): readonly ForYouCard[] {
  if (!Array.isArray(v)) return DEFAULT_PROMO.forYou
  const cards = FOR_YOU_CARDS.filter((c) => v.includes(c))
  return [...cards].sort((a, b) => v.indexOf(a) - v.indexOf(b))
}

/**
 * Field by field over the defaults: one bad field from the network must not
 * blank the other placements.
 */
export function readPromo(raw: unknown): Promo {
  if (!raw || typeof raw !== 'object') return DEFAULT_PROMO
  const v = raw as Record<string, unknown>
  return {
    anarchy: readServer(v.anarchy),
    lobby: 'lobby' in v ? readSlot(v.lobby, DEFAULT_PROMO.lobby) : DEFAULT_PROMO.lobby,
    forYou: 'forYou' in v ? readForYou(v.forYou) : DEFAULT_PROMO.forYou,
    modesLead: 'modesLead' in v ? readSlot(v.modesLead, DEFAULT_PROMO.modesLead) : DEFAULT_PROMO.modesLead,
  }
}

const CACHE_KEY = 'm-promo'

function cachedPromo(): Promo {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? readPromo(JSON.parse(raw)) : DEFAULT_PROMO
  } catch {
    return DEFAULT_PROMO
  }
}

export const usePromo = create<{ promo: Promo }>(() => ({ promo: cachedPromo() }))

const EVERY = 3 * 60_000
const FOCUS_GAP = 30_000
let seq = 0
let lastAt = 0

async function refresh(): Promise<void> {
  const mine = ++seq
  lastAt = Date.now()
  try {
    const r = await fetch(LAUNCHER_API + '/launcher/promo')
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const body = (await r.json()) as { promo?: unknown }
    if (mine !== seq) return
    const promo = readPromo(body.promo)
    usePromo.setState({ promo })
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(promo))
    } catch (e) {
      console.warn('[promo] cache', e)
    }
  } catch (e) {
    console.warn('[promo] refresh', e)
  }
}

/** Pulls the placements now, every few minutes and when the window comes back. */
export function watchPromo(): () => void {
  void refresh()
  const timer = window.setInterval(() => void refresh(), EVERY)
  const onFocus = () => {
    if (Date.now() - lastAt >= FOCUS_GAP) void refresh()
  }
  window.addEventListener('focus', onFocus)
  return () => {
    window.clearInterval(timer)
    window.removeEventListener('focus', onFocus)
  }
}
