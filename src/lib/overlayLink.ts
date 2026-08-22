import { hasTauri, tauri } from '../ipc/tauri'
import type { OverlayCard } from '../ipc/commands'
import { setScreen } from '../state/ui'
import { openChat, openRoomChat } from '../state/friends'
import { restoreLauncher } from './window'

/// A click on an overlay card that the core decided the launcher should answer:
/// the window is already coming up natively, the webview only has to land on
/// the conversation the card was about.
function handle(card: OverlayCard) {
  restoreLauncher()
  setScreen('friends')
  if (card.open === 'room' && card.uid) {
    void openRoomChat(card.uid, card.nick || 'Группа').catch(() => {})
    return
  }
  if (card.open === 'chat' && card.uid) void openChat(card.uid, card.nick || '').catch(() => {})
}

export function initOverlayLink() {
  if (!hasTauri()) return
  const T = tauri()
  if (!T) return
  void T.event.listen<OverlayCard>('overlay-open', (e) => handle(e.payload)).catch(() => {})
}
