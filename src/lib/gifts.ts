import { api } from './api'
import type { MoneyCurrency } from './money'
import type { ItemRef } from './rubies'

export type GiftContent = 'ITEM' | 'RUBIES' | 'PLUS'
export type GiftTier = 'PLUS' | 'DIAMOND'

export interface GiftPerson {
  userId: string
  nickname: string
}

export interface ReceivedGift {
  id: string
  kind?: GiftContent
  from: GiftPerson | null
  item: ItemRef | null
  rubies?: number
  tier?: GiftTier | null
  message: string | null
  at: string
  opened: boolean
}

export interface SentGift {
  id: string
  kind?: GiftContent
  to: GiftPerson | null
  item: ItemRef | null
  rubies?: number
  tier?: GiftTier | null
  money?: { currency: MoneyCurrency; minor: number } | null
  message: string | null
  price: number
  at: string
}

export interface GiftHistory {
  received: ReceivedGift[]
  sent: SentGift[]
  unopened: number
}

export const loadGiftHistory = () => api<GiftHistory>('/rubies/gifts')

export const openGiftOnServer = (id: string) =>
  api<ReceivedGift>('/rubies/gifts/' + encodeURIComponent(id) + '/open', { method: 'POST' })

export interface FriendGiftOffer {
  kind: 'PLUS' | 'RUBIES'
  product: string
  title: string
  rubies: number
  currency: MoneyCurrency
  priceMinor: number
}

export const loadFriendGiftOffers = () => api<{ items: FriendGiftOffer[] }>('/gifts/friend/offers')

export const giveFriendGift = (body: { kind: FriendGiftOffer['kind']; product: string; to: string; requestId: string; message?: string }) =>
  api<{ id: string; to: { userId: string; nickname: string } }>('/gifts/friend', { method: 'POST', body: JSON.stringify(body) })
