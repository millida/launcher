import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { getProfileGroups, listContent, listProfiles } from '../ipc/commands'
import type { Profile, ProfileGroups } from '../ipc/commands'
import { setInventory } from '../lib/telemetry'

async function reportInventory(profiles: Profile[]) {
  if (!hasTauri()) return
  let mods = 0
  for (const p of profiles) {
    try {
      mods += (await listContent(p.name, 'mod')).length
    } catch {}
  }
  setInventory(profiles.length, mods)
}

interface ProfilesState {
  profiles: Profile[]
  selected: string | null
  groups: ProfileGroups
  ctxLocked: boolean
  setSelected: (name: string | null) => void
  setCtxLocked: (v: boolean) => void
  refresh: () => Promise<void>
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [],
  selected: null,
  groups: {},
  ctxLocked: true,
  setSelected: (name) => set({ selected: name }),
  setCtxLocked: (v) => set({ ctxLocked: v }),
  refresh: async () => {
    let profiles: Profile[] = []
    if (hasTauri()) {
      try {
        profiles = await listProfiles()
      } catch {
        profiles = []
      }
    }
    if (!profiles.length) {
      set({ profiles: [], groups: {} })
      void reportInventory([])
      return
    }
    void reportInventory(profiles)
    let groups: ProfileGroups = {}
    if (hasTauri()) {
      try {
        groups = await getProfileGroups()
      } catch {}
    }
    const selected = get().selected || profiles[0].name
    set({ profiles, groups, selected })
  },
}))

export const refreshProfiles = () => useProfiles.getState().refresh()
export const selectedProfile = () => useProfiles.getState().selected
export const profilesList = () => useProfiles.getState().profiles
export const findProfile = (name: string | null) =>
  useProfiles.getState().profiles.find((p) => p.name === name) || null
