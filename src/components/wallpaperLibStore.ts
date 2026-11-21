import { create } from 'zustand'
import type { CustomWp } from '../state/wallpaper'

export type LibrarySort = 'popular' | 'new' | 'liked'
export type LibraryTab = LibrarySort | 'mine'

interface WallpaperLibraryState {
  open: boolean
  tab: LibraryTab
  draft: CustomWp | null
}

export const useWallpaperLibrary = create<WallpaperLibraryState>(() => ({ open: false, tab: 'popular', draft: null }))

export const openWallpaperLibrary = (tab: LibraryTab = 'popular', draft: CustomWp | null = null) =>
  useWallpaperLibrary.setState({ open: true, tab, draft })

export const closeWallpaperLibrary = () => useWallpaperLibrary.setState({ open: false, draft: null })
