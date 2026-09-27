import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { getProfileGroups, listContent, listProfiles, protectedBuilds } from '../ipc/commands'
import type { Profile, ProfileGroups } from '../ipc/commands'
import { setInventory } from '../lib/telemetry'
import { DEMO_USER } from '../lib/demo'

const DEMO_PROFILES: Profile[] = [
  { name: 'Выживание с друзьями', version: '1.21.1', fabric: true, loader: 'fabric', icon: '/build-icons/grass.png#bg=1f3b22' },
  { name: 'Техно 1.20.1', version: '1.20.1', fabric: false, loader: 'forge', icon: '/block-icons/Block30Millida.png#bg=16304a' },
  { name: 'Minecraft 26.2', version: '26.2', fabric: true, loader: 'fabric', icon: null },
]

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
  /** Builds whose author keeps the contents to themselves: the launcher does not show their files. */
  guarded: string[]
  selected: string | null
  groups: ProfileGroups
  ctxLocked: boolean
  setSelected: (name: string | null) => void
  setCtxLocked: (v: boolean) => void
  refresh: () => Promise<void>
}

export const useProfiles = create<ProfilesState>((set, get) => ({
  profiles: [],
  guarded: [],
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
    } else if (DEMO_USER) {
      // Демо-вход в браузере: пара сборок, чтобы «Мои сборки» было что показать.
      profiles = get().profiles.length ? get().profiles : DEMO_PROFILES
    }
    if (!profiles.length) {
      set({ profiles: [], guarded: [], groups: {} })
      void reportInventory([])
      return
    }
    void reportInventory(profiles)
    let groups: ProfileGroups = {}
    let guarded: string[] = []
    if (hasTauri()) {
      try {
        groups = await getProfileGroups()
      } catch {}
      // Unreadable means shown as before: the files are on the player's disk either way.
      guarded = await protectedBuilds().catch(() => [])
    }
    const selected = get().selected || profiles[0].name
    set({ profiles, guarded, groups, selected })
  },
}))

export const refreshProfiles = () => useProfiles.getState().refresh()
export const selectedProfile = () => useProfiles.getState().selected
export const profilesList = () => useProfiles.getState().profiles
export const useGuarded = (name: string | null | undefined): boolean =>
  useProfiles((s) => !!name && s.guarded.includes(name))
export const findProfile = (name: string | null) =>
  useProfiles.getState().profiles.find((p) => p.name === name) || null
