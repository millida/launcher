import { onRenderGate, renderLive } from './renderGate'

/**
 * Таймер для всего, что рисует или опрашивает ради экрана: часы, карусели, обратные
 * отсчёты, опросы списков. Пока окно не видно (свёрнуто, в трее) или поверх идёт игра
 * (lib/renderGate), он не тикает вовсе — а не тикает вхолостую, как `if (!renderLive()) return`
 * внутри setInterval: холостые срабатывания держат процесс вебвью живым и не дают ему уснуть.
 * Окно вернулось — один тик сразу (часы и списки догоняют) и дальше по расписанию.
 *
 * Не для того, что должно идти и в фоне: телеметрия, сердцебиение присутствия, звонок, обновление.
 * Возвращает отмену: `const stop = liveInterval(...); return stop`.
 */
export function liveInterval(fn: () => void, ms: number): () => void {
  let id = 0
  const start = () => {
    if (!id) id = window.setInterval(fn, ms)
  }
  const stop = () => {
    if (!id) return
    window.clearInterval(id)
    id = 0
  }
  if (renderLive()) start()
  const off = onRenderGate(() => {
    if (!renderLive()) return stop()
    if (id) return
    fn()
    start()
  })
  return () => {
    stop()
    off()
  }
}
