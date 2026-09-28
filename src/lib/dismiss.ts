import type { MouseEvent } from 'react'

/**
 * Закрытие окна кликом по подложке — ОДНА реализация на лаунчер.
 *
 * Наивная проверка `e.target === e.currentTarget` в `onClick` закрывает окно и
 * тогда, когда кнопку мыши нажали ВНУТРИ окна, а отпустили снаружи: браузер
 * отдаёт click общему предку, то есть подложке. Так окно «Новая сборка»
 * захлопывалось у любого, кто выделял текст в поле и увёл курсор за край —
 * вместе со всем, что человек успел набрать.
 *
 * Закрытием считаем только жест, который НАЧАЛСЯ и закончился на подложке.
 * Начало помним на самом элементе, а не в состоянии компонента: подложку рисуют
 * и там, где перерисовка между нажатием и отпусканием стёрла бы ref.
 */
const STARTED = 'backdropDown'

/**
 * React bubbles events from a portal through the component tree, so a click in
 * a window portaled out of a clickable row still reaches the row's handler.
 * The row acts only on clicks that landed inside its own DOM and not on a button.
 */
export function rowClickOpens(e: Pick<MouseEvent, 'target' | 'currentTarget'>): boolean {
  const row = e.currentTarget as Node
  const target = e.target as Element
  return row.contains(target) && !target.closest('button')
}

export function backdropClose(close: () => void) {
  return {
    onPointerDown: (e: MouseEvent) => {
      ;(e.currentTarget as HTMLElement).dataset[STARTED] = e.target === e.currentTarget ? '1' : ''
    },
    onClick: (e: MouseEvent) => {
      const el = e.currentTarget as HTMLElement
      const started = el.dataset[STARTED] === '1'
      delete el.dataset[STARTED]
      if (started && e.target === e.currentTarget) close()
    },
  }
}
