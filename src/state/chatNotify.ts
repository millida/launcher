import { create } from 'zustand'
import { playNotifySound } from '../lib/sound'

export interface ChatNotify {
  id: number
  uid: string
  nick: string
  text: string
  kind?: 'msg' | 'play' | 'request'
  actionLabel?: string
  action?: () => void
}

interface State {
  items: ChatNotify[]
  push: (n: Omit<ChatNotify, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 1

export const useChatNotify = create<State>((set) => ({
  items: [],
  push: (n) =>
    set((s) => {
      const id = seq++
      const items = [...s.items.filter((x) => !(x.uid === n.uid && x.kind === (n.kind || 'msg'))), { ...n, id }].slice(-3)
      playNotifySound()
      return { items }
    }),
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}))

export const pushChatNotify = (n: Omit<ChatNotify, 'id'>) => useChatNotify.getState().push(n)
