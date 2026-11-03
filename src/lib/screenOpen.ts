// How long a screen takes to open: from the click on the sidebar (or any other jump) to the first
// frame with the screen's content on it. The stopwatch starts in setScreen and stops in the probe
// that App renders inside the screen's Suspense boundary, so the time includes loading the screen's
// code and the render. Data that arrives later (skeletons first) is not part of it. Sent as
// `perf what=screen_open`, screen names and numbers only.
import type { ScreenId } from '../state/ui'

/** A click older than this never got its screen: the player gave up, or the jump was cancelled. */
const STALE_MS = 15_000
/// Enough to see a screen's median without letting a restless session fill the queue.
const MAX_PER_SESSION = 60

interface Click {
  screen: ScreenId
  from: ScreenId
  at: number
}

export interface ScreenOpen {
  screen: ScreenId
  from: ScreenId
  ms: number
  visit: 'first' | 'repeat'
}

let click: Click | null = null
const visited = new Set<ScreenId>()
let reported = 0

/** The jump to `screen` starts now. Called by setScreen before it hands the change to React. */
export function screenClicked(screen: ScreenId, from: ScreenId, now = performance.now()): void {
  if (screen === from) return
  click = { screen, from, at: now }
}

/**
 * The screen's content is on the screen. Returns what to report, or null when no click is waiting
 * for this screen (the first screen of a session, a redraw of the same screen), the click is too
 * old, or the session already sent enough.
 */
export function screenPainted(screen: ScreenId, now = performance.now()): ScreenOpen | null {
  const c = click
  if (!c || c.screen !== screen) {
    visited.add(screen)
    return null
  }
  click = null
  const ms = Math.round(now - c.at)
  const visit = visited.has(screen) ? 'repeat' : 'first'
  visited.add(screen)
  if (ms < 0 || ms > STALE_MS || reported >= MAX_PER_SESSION) return null
  reported += 1
  return { screen, from: c.from, ms, visit }
}

/** Only for tests: a clean session. */
export function resetScreenOpen(): void {
  click = null
  visited.clear()
  reported = 0
}
