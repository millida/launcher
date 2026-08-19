import { overlaySetToasts, overlayState, overlayToast } from '../ipc/commands'
import type { OverlayCard } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

let enabled = true

export const desktopToastsEnabled = () => enabled

export async function initDesktopToasts() {
  if (!hasTauri()) {
    enabled = false
    return
  }
  enabled = await overlayState()
    .then((s) => s.toasts)
    .catch(() => enabled)
}

export async function setDesktopToasts(on: boolean) {
  enabled = on
  await overlaySetToasts(on)
}

// A focused launcher already shows its own card; the desktop toast exists for
// the case the window is behind a game, minimised or in the tray.
const launcherHasUser = () => !document.hidden && document.hasFocus()

export function showDesktopToast(card: OverlayCard): boolean {
  if (!enabled || !hasTauri() || launcherHasUser()) return false
  void overlayToast(card).catch(() => {})
  return true
}
