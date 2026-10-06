import { create } from 'zustand'
import type { MilliItem, MilliLooks } from '../lib/milli'
import { benchOp } from './milliBench'
import { sendMilli } from './milli'
import { milliEmote } from '../components/milli/milliEmotions'

/*
 * Выбор ресурс-пака или шейдера — часть разговора: Милли присылает варианты
 * (message.looks), игрок наводит и выбирает. Выбранный «улетает» в сборку,
 * остальные гаснут; «ещё» и «другой стиль» — обычные сообщения Милли.
 */

export type PickKind = MilliLooks['kind']

/** Сообщения, где выбор уже сделан или закрыт (id сообщения → projectId или ''). */
export const useMilliPicker = create<{ done: Record<string, string> }>(() => ({ done: {} }))

/** Плитка стиля / уровня во вкладке — просьба к Милли, чтобы показ стал частью диалога. */
export function openPicker(kind: PickKind, _key: string, label: string) {
  void sendMilli(kind === 'rp' ? 'Покажи ресурс-паки в стиле «' + label + '»' : 'Покажи ' + label.toLowerCase() + ' шейдеры')
}

export function closePicker(msgId: string) {
  useMilliPicker.setState((s) => ({ done: { ...s.done, [msgId]: '' } }))
}

/** Выбор: карточка улетает (~420 мс), потом обычная правка сборки (видна строкой в ленте). */
export function pickLook(msgId: string, kind: PickKind, item: MilliItem) {
  if (useMilliPicker.getState().done[msgId] !== undefined) return
  useMilliPicker.setState((s) => ({ done: { ...s.done, [msgId]: item.projectId } }))
  window.setTimeout(() => {
    void benchOp({ op: 'add', tab: kind === 'rp' ? 'resourcepacks' : 'shaders', ref: item.slug || item.projectId })
    milliEmote('joy')
  }, 420)
}
