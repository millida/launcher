import { useSyncExternalStore } from 'react'
import { listenWindowVisibility } from '../ipc/events'
import { hasTauri, tauri } from '../ipc/tauri'
import { useGame } from '../state/game'

/**
 * Одна пауза для всей отрисовки лаунчера.
 *
 * Жалоба игрока 25.09.2026: «месяц назад 100+ FPS, сейчас не больше 50».
 * Окно лаунчера рисовало лобби (холст фона с искрами, 3D-персонажа, ник над
 * головой, CSS-анимации плиток) каждый кадр монитора и тогда, когда поверх шла
 * игра: убранное в трей окно для WebView2 остаётся «видимым», а фон и ник не
 * слушали даже blur. На встроенной видеокарте эти кадры забирает у игры.
 *
 * Тихо (ничего не анимируется), когда:
 *  - окно не видно: свёрнуто, в трее, вкладка скрыта;
 *  - идёт игра, а лаунчер не в фокусе — человек смотрит в игру.
 * Пока в лаунчере работают руками (фокус), он живой даже при запущенной игре:
 * Minecraft без фокуса сам сбрасывает частоту кадров.
 *
 * Без игры потеря фокуса сцену не останавливает — это решает каждый экран сам
 * (3D-персонаж останавливается и на blur).
 */

interface GateState {
  hidden: boolean
  /** Окно показано нативно (трей прячет окно без visibilitychange). */
  shown: boolean
  focused: boolean
  game: boolean
}

const state: GateState = {
  hidden: typeof document !== 'undefined' ? document.hidden : false,
  shown: true,
  focused: typeof document !== 'undefined' ? document.hasFocus() || !hasTauri() : true,
  game: false,
}

export const quietFor = (s: GateState) => s.hidden || !s.shown || (s.game && !s.focused)

let quiet = quietFor(state)
const subs = new Set<() => void>()

function update(patch: Partial<GateState>) {
  Object.assign(state, patch)
  const next = quietFor(state)
  if (next === quiet) return
  quiet = next
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('m-quiet', quiet)
  subs.forEach((f) => f())
}

/** Можно ли сейчас рисовать анимацию. */
export const renderLive = () => !quiet

/** Подписка на смену «рисуем / тихо». Возвращает отписку. */
export function onRenderGate(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

/** Хук: true — рисуем, false — окно не видно или игра поверх. */
export function useRenderLive(): boolean {
  return useSyncExternalStore(onRenderGate, renderLive, renderLive)
}

let started = false

/** Вызывается один раз при старте окна лаунчера (не оверлея). */
export function initRenderGate() {
  if (started || typeof window === 'undefined') return
  started = true
  document.addEventListener('visibilitychange', () => update({ hidden: document.hidden }))
  window.addEventListener('focus', () => update({ focused: true }))
  window.addEventListener('blur', () => update({ focused: false }))
  update({ game: useGame.getState().list.length > 0 })
  useGame.subscribe((s) => update({ game: s.list.length > 0 }))
  void listenWindowVisibility((visible) => update({ shown: visible, focused: visible ? state.focused : false }))
  // Фокус самого окна: DOM-события WebView2 приходят не всегда, когда
  // фокус уходит в игру из соседнего процесса.
  const T = tauri()
  const w = T?.window?.getCurrentWindow() as unknown as
    | { onFocusChanged?: (h: (e: { payload: boolean }) => void) => Promise<() => void> }
    | undefined
  if (w?.onFocusChanged) void w.onFocusChanged((e) => update({ focused: !!e.payload })).catch(() => {})
}

/** Только для тестов. */
export function _resetRenderGate(patch: Partial<GateState> = {}) {
  Object.assign(state, { hidden: false, shown: true, focused: true, game: false }, patch)
  quiet = quietFor(state)
}
