import { create } from 'zustand'
import { openModal } from './ui'

interface InstanceState {
  profile: string | null
  setProfile: (p: string | null) => void
}

export const useInstance = create<InstanceState>((set) => ({
  profile: null,
  setProfile: (p) => set({ profile: p }),
}))

export function openBuildSettings(profile: string) {
  useInstance.getState().setProfile(profile)
  openModal('bsModal')
}
