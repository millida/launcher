import { hasTauri } from '../ipc/tauri'
import { showFromTray } from '../ipc/commands'
import { registerUnloadHold } from './unloadHold'

// «Играть» нажата, а ядро ещё не получило запуск: страница обновляет сборку, ставит пресет
// графики, входит в аккаунт. Крестик в этот момент уничтожал окно вместе с подготовкой —
// игра не стартовала, а ошибку запуска (вход, сеть) никто не видел. Пока подготовка идёт,
// окно только прячется (страница не засыпает), а выгружается, когда запуск ушёл в ядро.
let busy = false
const subs = new Set<() => void>()

export const launchBusy = (): boolean => busy

export function setLaunchBusy(next: boolean): void {
  if (busy === next) return
  busy = next
  subs.forEach((cb) => cb())
}

registerUnloadHold(
  () => (busy ? 'launch' : null),
  (cb) => {
    subs.add(cb)
    return () => {
      subs.delete(cb)
    }
  },
)

/// Запуск не удался, пока окно спрятано в трей: тост в спрятанном окне никто не увидит, и оно выгрузится
/// следом. Поэтому окно показывается — игрок узнаёт, почему игра не открылась.
export function surfaceLaunchFailure(): void {
  if (!hasTauri() || typeof document === 'undefined' || document.visibilityState !== 'hidden') return
  void showFromTray().catch((e) => console.warn('[launch] the window was not shown after a failed launch', e))
}
