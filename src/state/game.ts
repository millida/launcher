import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { runningGames, stopGame } from '../ipc/commands'
import { showToast } from './ui'

interface GameState {
  list: string[]
  stopping: boolean
  setList: (l: string[]) => void
  addRunning: (p: string) => void
  removeRunning: (p: string) => void
  setStopping: (v: boolean) => void
}

export const useGame = create<GameState>((set) => ({
  list: [],
  stopping: false,
  setList: (list) => set({ list, stopping: false }),
  addRunning: (p) => set((s) => ({ list: s.list.concat(p), stopping: false })),
  removeRunning: (p) =>
    set((s) => {
      const i = s.list.indexOf(p)
      if (i < 0) return s
      const list = s.list.slice()
      list.splice(i, 1)
      return { list, stopping: list.length ? s.stopping : false }
    }),
  setStopping: (stopping) => set({ stopping }),
}))

export const anyGameRunning = () => useGame.getState().list.length > 0

export const isGameRunning = (profile: string) => useGame.getState().list.includes(profile)

// The game outlives a launcher window reload, so button state comes from the core.
export function syncRunningGame() {
  if (!hasTauri()) return
  void runningGames()
    .then((list) => useGame.getState().setList(list || []))
    .catch(() => {})
}

export function stopRunningGame(profile?: string | null) {
  const { list, stopping } = useGame.getState()
  if (!list.length || stopping) return
  useGame.getState().setStopping(true)
  void stopGame(profile || null)
    .then(() => showToast('Останавливаем игру…'))
    .catch((e) => {
      useGame.getState().setStopping(false)
      showToast('Не удалось остановить игру: ' + e, 'error')
      syncRunningGame()
    })
}
