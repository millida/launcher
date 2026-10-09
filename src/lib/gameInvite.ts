import { hasTauri } from '../ipc/tauri'
import { claimGameInvites, setGameInvite } from '../ipc/commands'
import { useLobby } from '../state/lobbyMode'
import { setScreen, showToast } from '../state/ui'

export function openGameCard(slug: string): void {
  useLobby.setState({ hubTarget: { pack: slug } })
  setScreen('playhub')
}

/** A malformed or foreign code is dropped silently: the link still leads to the game. */
export function openGameFromLink(slug: string, code: string): void {
  openGameCard(slug)
  if (!code) return
  void setGameInvite(slug, code).catch((e) =>
    showToast('Не удалось сохранить код приглашения — открой ссылку ещё раз: ' + e, 'error'),
  )
}

export function initGameInvites(): void {
  if (!hasTauri()) return
  void claimGameInvites()
    .then((slugs) => {
      if (slugs[0]) openGameCard(slugs[0])
    })
    .catch(() => {})
}
