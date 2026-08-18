import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { msSessionForget } from '../ipc/commands'
import { hasAccountSession, refreshSessionState } from '../lib/secure'

export interface Account {
  id: string
  nick: string
  kind: string
  uuid?: string
  xuid?: string
  avatar?: string
  balance?: number
  exp?: number
}

type AccountInput = Partial<Account> & { nick: string; kind: string }

const isHeadAvatar = (v?: string): boolean => !!v && v.startsWith('data:image/')

export const isMillidaKind = (kind: string) => kind === 'millida' || kind === 'tg'

function readAccounts(): Account[] {
  try {
    const list = JSON.parse(localStorage.getItem('m-accounts') || 'null') || []
    return Array.isArray(list)
      ? list.map((a: Account & { token?: string }) => {
          const { token: _drop, avatar, ...rest } = a
          return (isHeadAvatar(avatar) ? { ...rest, avatar } : rest) as Account
        })
      : []
  } catch {
    return []
  }
}

function persist(list: Account[]) {
  const clean = list.map((a) => (isHeadAvatar(a.avatar) ? a : { ...a, avatar: undefined }))
  localStorage.setItem('m-accounts', JSON.stringify(clean))
}

function readActive(): string {
  return localStorage.getItem('m-active') || ''
}

/// The Millida session lives in one vault slot for the whole launcher, so a second
/// sign-in replaces the first one instead of adding to it. Rows written before that
/// was enforced still sit in storage: they all point at the current session and show
/// its nick, so the list reads as the same account twice.
function collapseMillida(list: Account[], active: string): { list: Account[]; active: string } {
  const millida = list.filter((a) => isMillidaKind(a.kind))
  if (millida.length < 2) return { list, active }
  const keep = millida.find((a) => a.id === active) || millida[millida.length - 1]
  const next = list.filter((a) => !isMillidaKind(a.kind) || a.id === keep.id)
  return { list: next, active: list.some((a) => a.id === active) && !next.some((a) => a.id === active) ? keep.id : active }
}

export function loadState(): { list: Account[]; active: string } {
  const stored = readAccounts()
  const state = collapseMillida(stored, readActive())
  if (state.list.length !== stored.length) {
    persist(state.list)
    localStorage.setItem('m-active', state.active)
  }
  return state
}

interface AccountsState {
  list: Account[]
  active: string
  setActive: (id: string) => void
  add: (a: AccountInput) => Account
  remove: (id: string) => void
  save: (list: Account[]) => void
}

const initial = loadState()

export const useAccounts = create<AccountsState>((set, get) => ({
  list: initial.list,
  active: initial.active,
  setActive: (id) => {
    localStorage.setItem('m-active', id)
    set({ active: id })
  },
  add: (input) => {
    const l = get().list.slice()
    const acc: Account = { ...(input as Account) }
    acc.id = acc.id || 'acc' + Date.now() + Math.floor(Math.random() * 1000)
    const i = isMillidaKind(acc.kind)
      ? l.findIndex((x) => isMillidaKind(x.kind))
      : l.findIndex((x) => x.nick === acc.nick && x.kind === acc.kind)
    if (i >= 0) {
      // A Millida row is replaced, not merged: keeping the previous balance, avatar
      // or uuid would show one user's facts under another user's login.
      l[i] = isMillidaKind(acc.kind) ? { ...acc, id: l[i].id } : Object.assign(l[i], acc)
      acc.id = l[i].id
    } else {
      l.push(acc)
    }
    persist(l)
    localStorage.setItem('m-active', acc.id)
    set({ list: l, active: acc.id })
    return acc
  },
  remove: (id) => {
    const l = get().list.filter((a) => a.id !== id)
    if (hasTauri())
      void msSessionForget(id)
        .catch(() => {})
        .then(() => refreshSessionState())
    persist(l)
    let active = get().active
    if (active === id) {
      active = (l[0] && l[0].id) || ''
      localStorage.setItem('m-active', active)
    }
    set({ list: l, active })
  },
  save: (list) => {
    persist(list)
    set({ list: list.slice() })
  },
}))

export function getAccount(): Account | null {
  const { list, active } = useAccounts.getState()
  if (!list.length) return null
  return list.find((a) => a.id === active) || list[0]
}

export function getMillidaAccount(): Account | null {
  const { list } = useAccounts.getState()
  return list.find((a) => isMillidaKind(a.kind)) || null
}

/// The Millida game profile carries its own name, and the game uses that one — the site
/// login is not the in-game nick. Read from cache so callers stay synchronous.
export const GAME_NICK_KEY = 'm-game-nick'

/// The public profile lives at /u/<publicSlug>, and that slug is not the nick:
/// it can be taken, renamed or missing entirely when the profile is hidden.
export const PROFILE_SLUG_KEY = 'm-profile-slug'

/// Which user the cached game nick and profile slug belong to, so a sign-in with a
/// different Millida account is told apart from a renamed one.
export const MILLIDA_USER_KEY = 'm-millida-uid'

export function profileSlug(): string {
  const a = getAccount()
  if (!a || !isMillidaKind(a.kind)) return ''
  return localStorage.getItem(PROFILE_SLUG_KEY) || ''
}

export function effectiveNick(): string {
  const a = getAccount()
  if (a && isMillidaKind(a.kind)) {
    const game = localStorage.getItem(GAME_NICK_KEY) || ''
    if (game) return game
  }
  return (a && a.nick) || 'Player' + Math.floor(Math.random() * 9999)
}

export type LaunchAuthKind = 'offline' | 'microsoft' | 'millida'

/// An offline account is an explicit choice of nick: issuing a Millida session for it would
/// replace that nick with the one bound to the site login, so only a Millida account gets one.
export function launchAuthKind(acc: Account | null, millidaSession: boolean): LaunchAuthKind {
  if (acc && acc.kind === 'microsoft') return 'microsoft'
  if (acc && !isMillidaKind(acc.kind)) return 'offline'
  return millidaSession ? 'millida' : 'offline'
}

export function hasLicenseSession(a: Account): boolean {
  return hasAccountSession(a.id)
}

// Refresh ahead of real expiry: a token this close to the edge dies mid-launch.
const MS_TOKEN_SKEW_MS = 5 * 60 * 1000

export function msTokenFresh(a: Account): boolean {
  return hasAccountSession(a.id) && !!a.exp && a.exp - Date.now() > MS_TOKEN_SKEW_MS
}

export function msTokenExpired(a: Account): boolean {
  return hasAccountSession(a.id) && !!a.exp && a.exp - Date.now() <= MS_TOKEN_SKEW_MS
}

localStorage.removeItem('m-nick-override')

if (!useAccounts.getState().list.length) {
  try {
    const old = JSON.parse(localStorage.getItem('m-account') || 'null')
    if (old && old.nick) useAccounts.getState().add(old)
  } catch {}
}
