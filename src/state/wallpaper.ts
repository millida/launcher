import { create } from 'zustand'
import { showToast } from './ui'

const VIDS = ['bg1', 'bg2', 'bg3', 'bg4']
// Legacy canvas scenes were dropped; fall back if one is still stored.
const SCENE_IDS = ['taiga', 'sunset', 'cave', 'end']
const notScene = (id: string) => (SCENE_IDS.includes(id) ? 'bg4' : id)

export interface CustomWp {
  kind: string
  path: string
  name?: string
}
function readCustom(): CustomWp | null {
  try {
    const v = JSON.parse(localStorage.getItem('m-wp-custom') || 'null')
    return v && v.path ? v : null
  } catch {
    return null
  }
}
function readGallery(): CustomWp[] {
  try {
    const v = JSON.parse(localStorage.getItem('m-wp-gallery') || 'null')
    if (Array.isArray(v) && v.length) return v.filter((x) => x && x.path).slice(0, 4)
  } catch {}
  const single = readCustom()
  return single ? [single] : []
}
const initGallery = readGallery()
const initCustom = readCustom() || initGallery[0] || null

const firstRun = localStorage.getItem('m-wp-seen') !== '1'
localStorage.setItem('m-wp-seen', '1')
const initMode = firstRun ? 'fixed' : localStorage.getItem('m-wp-mode') || 'random'
const storedCur = localStorage.getItem('m-wp') || 'bg4'
const initCur = notScene(
  firstRun
    ? 'bg4'
    : storedCur === 'custom' && initCustom
      ? 'custom'
      : initMode === 'random'
        ? VIDS[Math.floor(Math.random() * 4)]
        : storedCur === 'custom'
          ? 'bg4'
          : storedCur,
)
// WebKitGTK decodes video in software by default, so an animated wallpaper costs
// a full core on Linux. Default it to a still frame; the toggle still overrides.
const IS_LINUX =
  typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)
const storedAnim = localStorage.getItem('m-wp-anim')
const initAnim =
  (storedAnim === null ? !IS_LINUX : storedAnim !== '0') &&
  !matchMedia('(prefers-reduced-motion: reduce)').matches

interface WallpaperState {
  wpCur: string
  wpMode: string
  wpAnimOn: boolean
  custom: CustomWp | null
  gallery: CustomWp[]
  popOpen: boolean
  setPopOpen: (v: boolean) => void
  setCur: (id: string) => void
  pick: (id: string, name: string) => void
  setCustom: (c: CustomWp) => void
  addCustom: (c: CustomWp) => void
  removeCustom: (path: string) => void
  setMode: (m: string) => void
  toggleAnim: () => void
}

export const useWallpaper = create<WallpaperState>((set) => ({
  wpCur: initCur,
  wpMode: initMode,
  wpAnimOn: initAnim,
  custom: initCustom,
  gallery: initGallery,
  popOpen: false,
  setPopOpen: (v) => set({ popOpen: v }),
  setCur: (id) => set({ wpCur: id }),
  pick: (id, name) => {
    localStorage.setItem('m-wp', id)
    localStorage.setItem('m-wp-mode', 'fixed')
    set({ wpCur: id, wpMode: 'fixed' })
    showToast('Фон: ' + name)
  },
  setCustom: (c) => {
    localStorage.setItem('m-wp-custom', JSON.stringify(c))
    localStorage.setItem('m-wp', 'custom')
    localStorage.setItem('m-wp-mode', 'fixed')
    set({ custom: c, wpCur: 'custom', wpMode: 'fixed' })
    showToast('Фон: ' + (c.name || 'свой фон'))
  },
  addCustom: (c) =>
    set((s) => {
      const gallery = [c, ...s.gallery.filter((x) => x.path !== c.path)].slice(0, 4)
      localStorage.setItem('m-wp-gallery', JSON.stringify(gallery))
      localStorage.setItem('m-wp-custom', JSON.stringify(c))
      localStorage.setItem('m-wp', 'custom')
      localStorage.setItem('m-wp-mode', 'fixed')
      showToast('Свой фон установлен')
      return { gallery, custom: c, wpCur: 'custom', wpMode: 'fixed' }
    }),
  removeCustom: (path) =>
    set((s) => {
      const gallery = s.gallery.filter((x) => x.path !== path)
      localStorage.setItem('m-wp-gallery', JSON.stringify(gallery))
      const wasActive = s.custom && s.custom.path === path
      const custom = wasActive ? gallery[0] || null : s.custom
      if (wasActive) {
        if (custom) localStorage.setItem('m-wp-custom', JSON.stringify(custom))
        else {
          localStorage.removeItem('m-wp-custom')
          localStorage.setItem('m-wp', 'bg4')
        }
      }
      return {
        gallery,
        custom,
        wpCur: wasActive && !custom ? 'bg4' : s.wpCur,
      }
    }),
  setMode: (m) => {
    localStorage.setItem('m-wp-mode', m)
    if (m === 'random') {
      const id = ['bg1', 'bg2', 'bg3', 'bg4'][Math.floor(Math.random() * 4)]
      set({ wpMode: m, wpCur: id })
      showToast('Фон теперь случайный при каждом запуске')
    } else {
      set({ wpMode: m })
    }
  },
  toggleAnim: () =>
    set((s) => {
      const v = !s.wpAnimOn
      localStorage.setItem('m-wp-anim', v ? '1' : '0')
      return { wpAnimOn: v }
    }),
}))
