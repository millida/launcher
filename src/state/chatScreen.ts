import { create } from 'zustand'
import { useFriends } from './friends'
import { setScreen, useUi } from './ui'
import type { ScreenId } from './ui'

/**
 * Сообщения — отдельный экран, а не панель сбоку (владелец 24.09.2026, 13:33:
 * «должен быть полноценный, как Telegram: заходишь в чат и проваливаешься в
 * него»). Все, кто открывает переписку — строка друга, уведомление, звонок,
 * хостинг, ссылка millida:// — по-прежнему зовут openChat / openRoomChat;
 * экран включается здесь, по факту открытия, одним местом на лаунчер.
 *
 * `chatOpen` теперь значит «переписка на экране»: пока он true, пришедшее
 * сообщение считается прочитанным (App.tsx), поэтому уход с экрана его снимает.
 */
interface ChatScreenState {
  /// Откуда пришли: «Назад» ведёт туда, а не всегда в лобби.
  from: ScreenId
}

export const useChatScreen = create<ChatScreenState>(() => ({ from: 'play' }))

/** Открыть экран сообщений, не выбирая переписку (кнопка в лобби). */
export function openMessages() {
  const cur = useUi.getState().screen
  if (cur !== 'chat') useChatScreen.setState({ from: cur })
  setScreen('chat')
}

let wired = false

export function initChatScreen() {
  if (wired) return
  wired = true
  useFriends.subscribe((s, p) => {
    if (!s.chatOpen) return
    const moved = !p.chatOpen || s.chatWith !== p.chatWith || s.chatRoom !== p.chatRoom
    if (moved && useUi.getState().screen !== 'chat') openMessages()
  })
  useUi.subscribe((s, p) => {
    if (p.screen === 'chat' && s.screen !== 'chat' && useFriends.getState().chatOpen) {
      useFriends.getState().set({ chatOpen: false })
    }
  })
}
