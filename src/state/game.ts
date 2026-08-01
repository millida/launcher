import { create } from 'zustand'
import { hasTauri } from '../ipc/tauri'
import { runningGames, stopGame } from '../ipc/commands'
import { showToast } from './ui'

interface GameState {
  running: string | null
  stopping: boolean
  setRunning: (p: string | null) => void
  setStopping: (v: boolean) => void
}

export const useGame = create<GameState>((set) => ({
  running: null,
  stopping: false,
  setRunning: (running) => set({ running, stopping: false }),
  setStopping: (stopping) => set({ stopping }),
}))

// The game outlives a launcher window reload, so button state comes from the core.
export function syncRunningGame() {
  if (!hasTauri()) return
  void runningGames()
    .then((list) => useGame.getState().setRunning(list[0] || null))
    .catch(() => {})
}

export function stopRunningGame() {
  const { running, stopping } = useGame.getState()
  if (!running || stopping) return
  useGame.getState().setStopping(true)
  void stopGame(running)
    .then(() => showToast('Останавливаем игру…'))
    .catch((e) => {
      useGame.getState().setStopping(false)
      showToast('Не удалось остановить игру: ' + e, 'error')
      syncRunningGame()
    })
}
