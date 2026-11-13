import { hasTauri } from '../ipc/tauri'
import type { TextScale } from './a11y'

/// The whole interface scales, not only the text: most sizes in the launcher are in px,
/// so a bigger font alone would overflow every button.
/// In the app the webview itself is zoomed, like Ctrl+ in a browser: the viewport shrinks in CSS pixels
/// and every 100vw/100vh layout reflows into the window. CSS `zoom` on the root multiplies those units
/// instead, so the window grew a horizontal scrollbar; it stays only for the browser preview, where
/// --ui-zoom divides the window box back.
/// The zoom never shrinks the layout below the window's own minimum size: past that the lobby and the
/// play bar get cut off, so a small window gets as much of the chosen size as fits.
/// Kept out of the startup bundle: at 100% nothing here runs.
const LAYOUT_MIN_W = 980
const LAYOUT_MIN_H = 640

export function fittedZoom(scale: TextScale, windowW: number, windowH: number): number {
  const want = scale / 100
  if (want <= 1 || windowW <= 0 || windowH <= 0) return 1
  const fit = Math.min(windowW / LAYOUT_MIN_W, windowH / LAYOUT_MIN_H)
  return Math.round(Math.max(1, Math.min(want, fit)) * 100) / 100
}

let webviewZoom = 1
let zoomPending: Promise<unknown> = Promise.resolve()

function zoomWebview(scale: TextScale) {
  zoomPending = zoomPending
    .then(async () => {
      const next = fittedZoom(scale, window.innerWidth * webviewZoom, window.innerHeight * webviewZoom)
      if (next === webviewZoom) return
      const m = await import('@tauri-apps/api/webview')
      await m.getCurrentWebview().setZoom(next)
      webviewZoom = next
    })
    .catch((e) => console.warn('[a11y] webview zoom', e))
}

function zoomPage(scale: TextScale) {
  const root = document.documentElement
  const z = fittedZoom(scale, window.innerWidth, window.innerHeight)
  root.style.setProperty('zoom', z === 1 ? '' : String(z))
  root.style.setProperty('--ui-zoom', String(z))
}

let resizeWatched = false

export function applyUiZoom(scale: TextScale, current: () => TextScale) {
  if (hasTauri()) zoomWebview(scale)
  else zoomPage(scale)
  if (resizeWatched) return
  resizeWatched = true
  let frame = 0
  window.addEventListener('resize', () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => applyUiZoom(current(), current))
  })
}
