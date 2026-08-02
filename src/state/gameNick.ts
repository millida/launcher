import { create } from 'zustand'
import { gameProfile } from '../lib/gameProfile'
import { hasMillidaAccount } from '../lib/api'
import { GAME_NICK_KEY } from './accounts'

interface GameNickState {
  name: string
  accountNick: string
  conflict: boolean
  load: () => Promise<void>
}

export const useGameNick = create<GameNickState>((set) => ({
  name: localStorage.getItem(GAME_NICK_KEY) || '',
  accountNick: '',
  conflict: false,
  load: async () => {
    if (!hasMillidaAccount()) {
      localStorage.removeItem(GAME_NICK_KEY)
      set({ name: '', accountNick: '', conflict: false })
      return
    }
    try {
      const p = await gameProfile()
      const name = p.name || ''
      set({ name, accountNick: p.accountNick || '', conflict: !!p.nameConflict })
      if (name) localStorage.setItem(GAME_NICK_KEY, name)
    } catch {}
  },
}))

export const refreshGameNick = () => useGameNick.getState().load()
