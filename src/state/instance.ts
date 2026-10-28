import { create } from 'zustand'
import { openModal } from './ui'

/// Tab of the build page. Matches the identifiers used in InstancePage.
export type InstanceTab = 'content' | 'worlds' | 'shots' | 'logs' | 'opts'

interface InstanceState {
  profile: string | null
  /// Which tab to open on: quick actions lead straight to the right section.
  tab: InstanceTab
  /// Put the caret into the rename field: the "Rename" action opens the same
  /// Settings tab, and without focus people have to hunt for the input.
  focusRename: boolean
  /// Open the share window immediately: the quick action leads to the code
  /// itself, not to "the tab that has the button".
  share: boolean
  setProfile: (p: string | null) => void
  set: (patch: Partial<InstanceState>) => void
}

export const useInstance = create<InstanceState>((set) => ({
  profile: null,
  tab: 'content',
  focusRename: false,
  share: false,
  setProfile: (p) => set({ profile: p }),
  set: (patch) => set(patch),
}))

export function openBuildSettings(profile: string, tab: InstanceTab = 'content', focusRename = false) {
  useInstance.getState().set({ profile, tab, focusRename, share: false })
  openModal('bsModal')
}

export function openBuildShare(profile: string) {
  useInstance.getState().set({ profile, tab: 'content', focusRename: false, share: true })
  openModal('bsModal')
}
