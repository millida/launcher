import type { ReactNode } from 'react'
import { create } from 'zustand'

/**
 * Единый «миг награды» лаунчера. Любое место, где человек что-то получил,
 * зовёт `showReward(...)` — рисует `RewardHost` (он один, в App).
 *
 *   big   — весь экран: лучи цвета редкости, вещь влетает, вспышка, конфетти;
 *   mid   — карточка сверху: арт на лучах, вспышка, искры, уходит сама;
 *   small — плашка сверху, из значка брызгают пиксельные искры.
 *
 * Большие становятся в очередь (одно раскрытие за раз), средний и малый
 * стоят в одном месте и сменяют друг друга.
 */

export type RewardLevel = 'big' | 'mid' | 'small'

export type RewardRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'

export interface RewardEntry {
  name: string
  /** Превью вещи 160×160 (каталог, CDN). */
  preview?: string | null
  rarity?: RewardRarity | string | null
  /** Пиксельный значок вместо превью: имя из pxArt (`server`, `users`, `trophy`…) или id спрайта `i-*`. */
  icon?: string
  /** Рубины: рисуется камень и число. */
  rubies?: number
  /** Свой рисунок (скин, плащ, аватар) — если превью-картинки нет. */
  art?: ReactNode
}

export interface RewardCall {
  level?: RewardLevel
  /** Крупное название. По умолчанию — имя единственной вещи или «Твоё: N». */
  title?: string
  /** Одна строка под названием. По умолчанию — редкость вещи. */
  sub?: string
  /** Маленькая надпись над названием цветом редкости («Новая вещь», «PLUS»). */
  kicker?: string
  items?: RewardEntry[]
  /** Цвет лучей, если редкости нет: CSS-цвет или var(--…). */
  tone?: string
  /** Кнопка «Надеть» (большой) или действие (средний, малый). */
  onWear?: () => void
  wearLabel?: string
  doneLabel?: string
  onDone?: () => void
}

export interface RewardShown extends RewardCall {
  id: number
  level: RewardLevel
  items: RewardEntry[]
}

interface RewardState {
  big: RewardShown[]
  mid: RewardShown | null
  small: RewardShown | null
  push: (r: RewardShown) => void
  close: (id: number) => void
}

export const useReward = create<RewardState>((set, get) => ({
  big: [],
  mid: null,
  small: null,
  push: (r) => {
    // Большое раскрытие гасит мелкие — под затемнением их всё равно не видно.
    if (r.level === 'big') set({ big: [...get().big, r], mid: null, small: null })
    // Средний и малый живут в одном месте сверху — новый сменяет старый.
    else if (r.level === 'mid') set({ mid: r, small: null })
    else set({ small: r, mid: null })
  },
  close: (id) => {
    const s = get()
    if (s.big.some((b) => b.id === id)) set({ big: s.big.filter((b) => b.id !== id) })
    if (s.mid?.id === id) set({ mid: null })
    if (s.small?.id === id) set({ small: null })
  },
}))

let seq = 0

export function showReward(call: RewardCall): number {
  const id = ++seq
  useReward.getState().push({ ...call, id, level: call.level || 'big', items: call.items || [] })
  return id
}

const TONE: Record<RewardRarity, string> = {
  COMMON: 'var(--m-rarity-common)',
  UNCOMMON: 'var(--m-rarity-uncommon)',
  RARE: 'var(--m-rarity-rare)',
  EPIC: 'var(--m-rarity-epic)',
  LEGENDARY: 'var(--m-rarity-legendary)',
}
const ORDER: RewardRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY']

export const RARITY_WORD: Record<RewardRarity, string> = {
  COMMON: 'Обычная',
  UNCOMMON: 'Необычная',
  RARE: 'Редкая',
  EPIC: 'Эпическая',
  LEGENDARY: 'Легендарная',
}

const asRarity = (r?: string | null): RewardRarity | null =>
  r && (ORDER as string[]).includes(r) ? (r as RewardRarity) : null

/** Самая высокая редкость среди вещей — она красит лучи. */
export function topRarity(items: RewardEntry[]): RewardRarity | null {
  let best = -1
  for (const it of items) {
    const r = asRarity(it.rarity)
    if (r) best = Math.max(best, ORDER.indexOf(r))
  }
  return best >= 0 ? ORDER[best] : null
}

export function rewardTone(r: RewardShown): string {
  if (r.tone) return r.tone
  const top = topRarity(r.items)
  if (top) return TONE[top]
  if (r.items.some((i) => i.rubies)) return 'var(--m-ruby)'
  return 'var(--m-accent)'
}

export const itemTone = (it: RewardEntry): string | undefined => {
  const r = asRarity(it.rarity)
  return r ? TONE[r] : it.rubies ? 'var(--m-ruby)' : undefined
}

export const rarityWord = (it?: RewardEntry): string | undefined => {
  const r = asRarity(it?.rarity)
  return r ? RARITY_WORD[r] : undefined
}
