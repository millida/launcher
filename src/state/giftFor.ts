import { create } from 'zustand'

export interface GiftFriend {
  userId: string
  nickname: string
}

export interface GiftWant {
  kind: 'PLUS' | 'RUBIES'
  product: string
}

export const useGiftFor = create<{ friend: GiftFriend | null; want: GiftWant | null }>(() => ({ friend: null, want: null }))

export const openGiftFor = (friend: GiftFriend, want: GiftWant | null = null) => useGiftFor.setState({ friend, want })
export const closeGiftFor = () => useGiftFor.setState({ friend: null, want: null })
