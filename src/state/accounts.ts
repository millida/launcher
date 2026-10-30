// List of launcher accounts (nickname, type, uuid) in localStorage (m-accounts) and the chosen active one (m-active). No tokens here:
// they are in the core store. On logout the core deletes the session (msSessionForget).
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
  /// Из какого скина нарисовано лицо: по нему видно, что оно устарело.
  avatarFrom?: string
  balance?: number
  exp?: number
}

type AccountInput = Partial<Account> & { nick: string; kind: string }

/// Faces drawn before 05.10.2026 came off a GPU canvas, which after a GPU crash
/// returns white pixels; only faces carrying this mark were drawn on the CPU.
export const HEAD_FROM_CPU = 'cpu:'

const isHeadAvatar = (v?: string, from?: string): boolean =>
  !!v && v.startsWith('data:image/') && !!from && from.startsWith(HEAD_FROM_CPU)

export const isMillidaKind = (kind: string) => kind === 'millida' || kind === 'tg'

/// A licence or an offline nick is what the first-run screen offers to play with,
/// so such an account opens the launcher without a Millida sign-in.
export const isGameAccountKind = (kind: string) => kind === 'microsoft' || kind === 'offline'

function readAccounts(): Account[] {
  try {
    const list = JSON.parse(localStorage.getItem('m-accounts') || 'null') || []
    return Array.isArray(list)
      ? list.map((a: Account & { token?: string }) => {
          const { token: _drop, avatar, avatarFrom, ...rest } = a
          return (isHeadAvatar(avatar, avatarFrom) ? { ...rest, avatar, avatarFrom } : rest) as Account
        })
      : []
  } catch {
    return []
  }
}

function persist(list: Account[]) {
  const clean = list.map((a) => (isHeadAvatar(a.avatar, a.avatarFrom) ? a : { ...a, avatar: undefined, avatarFrom: undefined }))
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

const RETIRED_ELYBY = 'elyby'

/// Ely.by sign-in is gone from the launcher. Its rows become offline nicks instead
/// of vanishing: the player keeps the name they played under and Play keeps working,
/// while the core has no way left to use the stored Ely.by session.
export function retireElyby(list: Account[], active: string): { list: Account[]; active: string; retired: string[] } {
  const retired: string[] = []
  const next: Account[] = []
  let current = active
  for (const a of list) {
    if (a.kind !== RETIRED_ELYBY) {
      next.push(a)
      continue
    }
    retired.push(a.id)
    const twin = list.find((x) => x.kind === 'offline' && x.nick === a.nick)
    if (twin) {
      if (current === a.id) current = twin.id
      continue
    }
    next.push({ id: a.id, nick: a.nick, kind: 'offline', avatar: a.avatar, avatarFrom: a.avatarFrom })
  }
  return { list: next, active: current, retired }
}

/// Guest mode is gone (owner 27.10.2026): the launcher needs a Millida sign-in. "Play as
/// guest" rows from earlier versions are dropped, or they would linger in the account list.
export const dropGuests = (list: Account[]): Account[] => list.filter((a) => a.kind !== 'guest')

export function loadState(): { list: Account[]; active: string } {
  const stored = readAccounts()
  const migrated = retireElyby(dropGuests(stored), readActive())
  const state = collapseMillida(migrated.list, migrated.active)
  if (migrated.retired.length || state.list.length !== stored.length) {
    persist(state.list)
    localStorage.setItem('m-active', state.active)
  }
  if (migrated.retired.length && hasTauri())
    for (const id of migrated.retired)
      void msSessionForget(id).catch((e: unknown) => console.warn('[accounts] stale Ely.by session was not removed', e))
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

const OFFLINE_NICK = /^[A-Za-z0-9_]{3,16}$/

export const isOfflineNick = (nick: string): boolean => OFFLINE_NICK.test(nick)

export const millidaGameNick = (): string => localStorage.getItem(GAME_NICK_KEY) || ''

/// While a Millida login is present an offline account is created under the
/// Millida profile name: that name is held by the account on the server, and a
/// launch under it can carry the Millida session into servers with Millida sign-in.
export function pinnedOfflineNick(millidaSession: boolean, profileNick: string): string {
  return millidaSession && isOfflineNick(profileNick) ? profileNick : ''
}

/// A Millida session names the player after the Millida profile, so an offline
/// account takes it only when its nick is exactly that name: the offline UUID is
/// derived from the exact spelling, and a new profile's UUID is that same one.
/// Any other offline nick starts plain offline and keeps its own name.
/// A server that checks sessions only against our Yggdrasil turns away a licence
/// and an offline nick alike, so its build always starts on the Millida session.
export function launchAuthKind(acc: Account | null, millidaSession: boolean, millidaOnly = false, profileNick = ''): LaunchAuthKind {
  if (millidaOnly) return millidaSession ? 'millida' : 'offline'
  if (acc && acc.kind === 'microsoft') return 'microsoft'
  if (acc && acc.kind === 'offline') return millidaSession && !!profileNick && acc.nick === profileNick ? 'millida' : 'offline'
  if (acc && !isMillidaKind(acc.kind)) return 'offline'
  return millidaSession ? 'millida' : 'offline'
}

export function hasLicenseSession(a: Account): boolean {
  return hasAccountSession(a.id)
}

// Refresh ahead of real expiry: a token this close to the edge dies mid-launch.
const MS_TOKEN_SKEW_MS = 5 * 60 * 1000

/// `ahead` — renew earlier than the usual margin (the lobby renews a token that ends within ten minutes, so a
/// token with seven left must not count as fresh there).
export function msTokenFresh(a: Account, ahead = 0): boolean {
  return hasAccountSession(a.id) && !!a.exp && a.exp - Date.now() > Math.max(MS_TOKEN_SKEW_MS, ahead)
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
