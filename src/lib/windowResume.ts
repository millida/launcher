// A rebuilt main window (the launcher unloads it into the tray and for the game, see
// src-tauri/src/background.rs) comes back on the screen it left and gets the millida://
// links that arrived while there was no page. The core keeps both; nothing is stored here.
import { hasTauri } from '../ipc/tauri'
import { takeWindowResume } from '../ipc/commands'
import { useUi, type ScreenId } from '../state/ui'

// Разбор ссылок тянет за собой установку из каталога и страницы проектов: отдельный чанк.
const initDeepLinks = (pending?: string[]) =>
  void import('./deeplink').then((m) => m.initDeepLinks(pending)).catch((e) => console.error('[deeplink]', e))

const SCREENS: readonly ScreenId[] = [
  'play', 'premium', 'plus', 'builds', 'servers', 'mods', 'skins', 'rubies',
  'friends', 'top', 'chat', 'hosting', 'playhub', 'pvp', 'settings',
]

export const resumeScreen = (s: string | null | undefined): ScreenId | null =>
  s && (SCREENS as readonly string[]).includes(s) ? (s as ScreenId) : null

let reopened: Promise<boolean> = Promise.resolve(false)

/// Is this page a rebuilt window rather than the start of the launcher? Answers after the core has.
export const windowReopened = (): Promise<boolean> => reopened

export function initWindowResume(): void {
  if (!hasTauri()) {
    initDeepLinks()
    return
  }
  const taken = takeWindowResume()
  reopened = taken.then((r) => r.reopened).catch(() => false)
  void taken
    .then((r) => {
      const screen = resumeScreen(r.screen)
      if (screen) useUi.getState().setScreen(screen)
      // The first window reads the start link; a rebuilt one would re-run that old link.
      initDeepLinks(r.reopened ? r.links : undefined)
    })
    .catch(() => initDeepLinks())
}
