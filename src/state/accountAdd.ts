import { create } from 'zustand'
import { openModal } from './ui'

export type AccountAddKind = 'microsoft' | 'offline' | 'millida'

export const useAccountAdd = create<{ kind: AccountAddKind | null }>(() => ({ kind: null }))

/// Without a kind the window offers the choice; with one it opens straight on
/// that sign-in, which is how the purchase and assistant gates reach Millida.
export function openAccountAdd(kind?: AccountAddKind) {
  useAccountAdd.setState({ kind: kind ?? null })
  openModal('accModal')
}
