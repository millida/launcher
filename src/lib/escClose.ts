import type { ModalId } from '../state/ui'

/** Окна из useUi: их закрывает общий Esc (у остальных слоёв он свой). */
export const STORE_MODALS: readonly ModalId[] = [
  'nbModal',
  'bsModal',
  'impModal',
  'mvModal',
  'pjModal',
  'setModal',
  'accModal',
  'shotOverlay',
  'mpOverlay',
  'mgModal',
  'wnModal',
]

type Layer = { id: string; z: number }

/**
 * Какое окно закрывает Esc: только верхнее из открытых. Подтверждение, меню и
 * прочие слои закрываются своим обработчиком — если сверху они, общий Esc не
 * трогает окно под ними, иначе одно нажатие закрывало бы оба.
 * Слои — в порядке документа: при равном z-index выше тот, что позже.
 */
export function modalToClose(layers: Layer[]): ModalId | null {
  let top: Layer | null = null
  for (const l of layers) if (!top || l.z >= top.z) top = l
  if (!top) return null
  return (STORE_MODALS as readonly string[]).includes(top.id) ? (top.id as ModalId) : null
}

/** Видимые подложки окон из DOM. */
export function openLayers(doc: Document = document): Layer[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('.modal-bg.vis')).map((el) => ({
    id: el.id,
    z: Number.parseInt(getComputedStyle(el).zIndex, 10) || 0,
  }))
}
