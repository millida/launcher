import type { PendingChest } from '../../lib/rubies'
import { MILLIDA_USER_KEY } from '../../state/accounts'
import { isTier } from './chestDrops'

const KEY = 'm-chest-unseen:'
const KEEP = 20

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const isChest = (c: unknown): c is PendingChest => {
  const v = c as Partial<PendingChest> | null
  return (
    !!v &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    isTier(v.tier) &&
    typeof v.source === 'string' &&
    typeof v.title === 'string' &&
    typeof v.createdAt === 'string'
  )
}

export function parseUnseen(raw: string | null): PendingChest[] {
  try {
    const list: unknown = JSON.parse(raw || '[]')
    return Array.isArray(list) ? list.filter(isChest).slice(-KEEP) : []
  } catch {
    return []
  }
}

export function withUnseen(list: PendingChest[], chest: PendingChest): PendingChest[] {
  return [...list.filter((c) => c.id !== chest.id), chest].slice(-KEEP)
}

export function withoutUnseen(list: PendingChest[], id: string): PendingChest[] {
  return list.filter((c) => c.id !== id)
}

/**
 * A chest whose open was sent but whose rewards never reached the summary, and
 * which the server no longer lists as pending: the server already opened it,
 * so a repeat open replays the stored rewards instead of rolling new ones.
 */
export function chestsToReplay(unseen: PendingChest[], pending: PendingChest[], offered: ReadonlySet<string>): PendingChest[] {
  const waiting = new Set(pending.map((c) => c.id))
  return unseen.filter((c) => !waiting.has(c.id) && !offered.has(c.id))
}

function keyOf(store: Store): string | null {
  const uid = store.getItem(MILLIDA_USER_KEY)
  return uid ? KEY + uid : null
}

function edit(change: (list: PendingChest[]) => PendingChest[], store: Store): void {
  try {
    const key = keyOf(store)
    if (!key) return
    const next = change(parseUnseen(store.getItem(key)))
    if (next.length) store.setItem(key, JSON.stringify(next))
    else store.removeItem(key)
  } catch {
    /* without storage the rewards are still shown in this window, only not after a restart */
  }
}

export const markUnseen = (chest: PendingChest, store: Store = localStorage) => edit((list) => withUnseen(list, chest), store)

export const forgetUnseen = (id: string, store: Store = localStorage) => edit((list) => withoutUnseen(list, id), store)

export function readUnseen(store: Store = localStorage): PendingChest[] {
  try {
    const key = keyOf(store)
    return key ? parseUnseen(store.getItem(key)) : []
  } catch {
    return []
  }
}
