import { create } from 'zustand'
import { hasMillidaAccount } from '../lib/api'
import { SECRETS_CHANGED_EVENT } from '../lib/secure'

interface AuthState {
  millida: boolean
  sync: () => void
}

export const useAuth = create<AuthState>((set) => ({
  millida: hasMillidaAccount(),
  sync: () => {
    const millida = hasMillidaAccount()
    set((s) => (s.millida === millida ? s : { ...s, millida }))
  },
}))

export const syncAuth = () => useAuth.getState().sync()

export const useHasMillida = () => useAuth((s) => s.millida)

if (typeof window !== 'undefined') window.addEventListener(SECRETS_CHANGED_EVENT, syncAuth)
