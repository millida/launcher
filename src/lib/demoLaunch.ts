/**
 * ТОЛЬКО DEV, браузерный предпросмотр: замороженные состояния запуска для
 * проверки глазами без Tauri. Подключается из preview.ts под import.meta.env.DEV.
 *
 *   ?preview=user&launch=installing           — «Играть» с ходом подготовки и крестиком
 *   ?preview=user&launch=running              — выбранная сборка в игре, «Остановить»
 *   ?preview=user&launch=installing&screen=playhub — тот же ход тостом вне лобби
 */
import { useUi } from '../state/ui'
import type { ScreenId } from '../state/ui'
import { useGame } from '../state/game'
import { useLobby } from '../state/lobbyMode'
import { useProfiles } from '../state/profiles'

const SCREENS: ScreenId[] = ['play', 'playhub', 'builds', 'skins', 'rubies', 'friends', 'settings', 'hosting', 'premium']

function whenProfiles(run: (name: string) => void) {
  const first = useProfiles.getState().profiles[0]
  if (first) return run(first.name)
  const stop = useProfiles.subscribe((s) => {
    if (!s.profiles[0]) return
    stop()
    run(s.profiles[0].name)
  })
  void useProfiles.getState().refresh()
}

export function installLaunchDemo(kind: string | null, screen: string | null) {
  whenProfiles((name) => {
    useLobby.getState().pick({ kind: 'build', name })
    if (kind === 'installing')
      useUi.getState().setPrelaunch({ open: true, sub: name, stage: 2, pct: 82, msg: null, mode: 'launch' })
    if (kind === 'running') useGame.getState().setList([name])
    const target = SCREENS.find((s) => s === screen)
    if (target) useUi.getState().setScreen(target)
  })
}
