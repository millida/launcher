import { create } from 'zustand'

export interface GiftFriend {
  userId: string
  nickname: string
}

export const useGiftFor = create<{ friend: GiftFriend | null }>(() => ({ friend: null }))

export const openGiftFor = (friend: GiftFriend) => useGiftFor.setState({ friend })
export const closeGiftFor = () => useGiftFor.setState({ friend: null })
