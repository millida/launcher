import { create } from 'zustand'

export interface PickOpts {
  title?: string
  sub?: string
  /** Версии сервера: подходящие сборки идут первыми, остальные помечены. */
  wanted?: string[]
}

interface State {
  open: boolean
  kindLabel: string
  title: string
  sub: string
  wanted: string[]
  resolve: ((name: string | null) => void) | null
  show: (kindLabel: string, opts?: PickOpts) => Promise<string | null>
  choose: (name: string | null) => void
}

export const useBuildPicker = create<State>((set, get) => ({
  open: false,
  kindLabel: 'контент',
  title: '',
  sub: '',
  wanted: [],
  resolve: null,
  show: (kindLabel, opts) =>
    new Promise((res) => {
      const prev = get().resolve
      if (prev) prev(null)
      set({
        open: true,
        kindLabel,
        title: opts?.title || '',
        sub: opts?.sub || '',
        wanted: opts?.wanted || [],
        resolve: res,
      })
    }),
  choose: (name) => {
    const r = get().resolve
    set({ open: false, resolve: null })
    if (r) r(name)
  },
}))

export const pickBuild = (kindLabel: string): Promise<string | null> =>
  useBuildPicker.getState().show(kindLabel)

export const pickBuildForJoin = (serverName: string, wanted: string[]): Promise<string | null> =>
  useBuildPicker.getState().show('сборку', {
    title: 'Чем зайти на «' + serverName + '»?',
    sub: wanted.length
      ? 'Сервер работает на ' + wanted.join(', ') + ' — выбери сборку этой версии.'
      : 'Версию сервера узнать не удалось — выбери сборку сам.',
    wanted,
  })
