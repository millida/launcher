import { api } from './api'
import type { ItemRef } from './rubies'

export interface GiftPerson {
  userId: string
  nickname: string
}

export interface ReceivedGift {
  id: string
  from: GiftPerson | null
  item: ItemRef | null
  message: string | null
  at: string
  opened: boolean
}

export interface SentGift {
  id: string
  to: GiftPerson | null
  item: ItemRef | null
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
