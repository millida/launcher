import { create } from 'zustand'
import { readPref, writePref } from '../lib/prefs'
import { api, hasMillidaAccount } from '../lib/api'

const KEY = 'm-hint-hosting'

export const HINT_LOUD_RUNS = 2
export const HINT_MAX_RUNS = 6
export const HINT_MAX_OPENS = 2
export const HINT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const OWNED_CHECK_MS = 20 * 60 * 60 * 1000

export type HintStage = 'loud' | 'quiet' | 'off'

export interface NavHint {
  runs: number
  opens: number
  firstAt: number
  checkedAt: number
  owned: boolean
  hidden: boolean
}

const EMPTY: NavHint = { runs: 0, opens: 0, firstAt: 0, checkedAt: 0, owned: false, hidden: false }

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

function read(): NavHint {
  try {
    const raw = readPref(KEY, '')
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as Partial<NavHint>
    if (!v || typeof v !== 'object') return EMPTY
    return {
      runs: num(v.runs),
      opens: num(v.opens),
      firstAt: num(v.firstAt),
      checkedAt: num(v.checkedAt),
      owned: v.owned === true,
      hidden: v.hidden === true,
    }
  } catch {
    return EMPTY
  }
}

export function hostingStage(h: NavHint, now: number): HintStage {
  if (h.hidden || h.owned) return 'off'
  if (h.opens >= HINT_MAX_OPENS || h.runs > HINT_MAX_RUNS) return 'off'
  if (h.firstAt && now - h.firstAt > HINT_MAX_AGE_MS) return 'off'
  if (h.opens > 0 || h.runs > HINT_LOUD_RUNS) return 'quiet'
  return 'loud'
}

interface NavHintState {
  hosting: HintStage
}

export const useNavHint = create<NavHintState>(() => ({ hosting: hostingStage(read(), Date.now()) }))

function patch(fn: (h: NavHint) => NavHint) {
  const next = fn(read())
  writePref(KEY, JSON.stringify(next))
  useNavHint.setState({ hosting: hostingStage(next, Date.now()) })
  return next
}

export function noteAppRun() {
  const now = Date.now()
  patch((h) => ({ ...h, runs: h.runs + 1, firstAt: h.firstAt || now }))
  void syncHostingOwned().catch(() => {})
}

export function noteHostingOpen() {
  patch((h) => ({ ...h, opens: h.opens + 1 }))
}

export function noteHostingServers(count: number) {
  patch((h) => ({ ...h, owned: count > 0, checkedAt: Date.now() }))
}

export function hideNavHint() {
  patch((h) => ({ ...h, hidden: true }))
}

export function restoreNavHint() {
  patch((h) => ({ ...h, hidden: false, opens: 0, runs: 1, firstAt: Date.now() }))
}

/// The sidebar cannot wait for the hosting screen to answer "does this player
/// already own a server" — without the check the badge keeps selling a thing the
/// player has. One cheap request per day, and only while the badge is still shown.
export async function syncHostingOwned(): Promise<void> {
  const h = read()
  if (hostingStage(h, Date.now()) === 'off' || !hasMillidaAccount()) return
  if (h.checkedAt && Date.now() - h.checkedAt < OWNED_CHECK_MS) return
  const list = await api<unknown>('/hosting/servers/me')
  noteHostingServers(Array.isArray(list) ? list.length : 0)
}
