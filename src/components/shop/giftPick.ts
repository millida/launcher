import { create } from 'zustand'
import { setScreen, showToast } from '../../state/ui'
import { openGiftFor, type GiftWant } from '../../state/giftFor'
import { t } from '../../i18n'

export interface GiftTarget {
  userId: string
  nickname: string
}

const PRESET_MS = 15 * 60_000

interface PickerState {
  ask: { name: string; onPick: (friend: GiftTarget) => void } | null
  preset: { friend: GiftTarget; at: number } | null
  open: (name: string, onPick: (friend: GiftTarget) => void) => void
  close: () => void
}

export const useGiftPick = create<PickerState>((set, get) => ({
  ask: null,
  preset: null,
  open: (name, onPick) => {
    const preset = get().preset
    if (preset && Date.now() - preset.at < PRESET_MS) {
      set({ preset: null })
      onPick(preset.friend)
      return
    }
    set({ ask: { name, onPick }, preset: null })
  },
  close: () => set({ ask: null }),
}))

export const openGiftPicker = (name: string, onPick: (friend: GiftTarget) => void) => useGiftPick.getState().open(name, onPick)

export const openProductGift = (name: string, want: GiftWant) => openGiftPicker(name, (friend) => openGiftFor(friend, want))

/** «Подарить» у друга: магазин открывается, а выбор друга при подарке пропускается — получатель уже известен. */
export function giftToFriend(friend: GiftTarget) {
  useGiftPick.setState({ preset: { friend, at: Date.now() } })
  setScreen('rubies')
  showToast(t('Выбери вещь и нажми «Подарить» — она уйдёт {nick}', { nick: friend.nickname }), 'ok', false)
}
