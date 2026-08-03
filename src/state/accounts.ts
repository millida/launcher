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

interface AccountsState {
  list: Account[]
  active: string
  setActive: (id: string) => void
  add: (a: AccountInput) => Account
  remove: (id: string) => void
  save: (list: Account[]) => void
}

export const useAccounts = create<AccountsState>((set, get) => ({
  list: readAccounts(),
  active: readActive(),
  setActive: (id) => {
    localStorage.setItem('m-active', id)
    set({ active: id })
  },
  add: (input) => {
    const l = get().list.slice()
    const acc: Account = { ...(input as Account) }
    acc.id = acc.id || 'acc' + Date.now() + Math.floor(Math.random() * 1000)
    const i = l.findIndex((x) => x.nick === acc.nick && x.kind === acc.kind)
    if (i >= 0) {
      l[i] = Object.assign(l[i], acc)
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
  return list.find((a) => a.kind === 'millida' || a.kind === 'tg') || null
}

/// The Millida game profile carries its own name, and the game uses that one — the site
/// login is not the in-game nick. Read from cache so callers stay synchronous.
export const GAME_NICK_KEY = 'm-game-nick'

export const isMillidaKind = (kind: string) => kind === 'millida' || kind === 'tg'

export function effectiveNick(): string {
  const a = getAccount()
  if (a && isMillidaKind(a.kind)) {
    const game = localStorage.getItem(GAME_NICK_KEY) || ''
    if (game) return game
  }
  return (a && a.nick) || 'Player' + Math.floor(Math.random() * 9999)
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
