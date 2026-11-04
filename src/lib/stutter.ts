import { openSettings, showToast, type ScreenId } from '../state/ui'
import { track } from './telemetry'
import { perfOverride } from './deviceTier'
import { SLOW_LITE_KEY, STUTTER_GRACE_MS, slowLite } from './slowLite'
import { t } from '../i18n'

/*
 * Counts fits of stutter (lib/slowLite). Its own chunk: jank.ts loads it STUTTER_GRACE_MS after
 * start, since frames do not count before that anyway.
 */

/** A fit: this many long frames (50 ms and up) within the window, and this much time in all. */
export const STUTTER_WINDOW_MS = 10_000
export const STUTTER_FRAMES = 8
export const STUTTER_SUM_MS = 1500
/** Fits in a session that turn on light graphics. */
export const STUTTER_EPISODES = 3

/** Whether the long frames of one window are a fit. Frames are start time and duration, ms. */
export function isStutter(frames: readonly { start: number; duration: number }[], now: number): boolean {
  let n = 0
  let sum = 0
  for (const f of frames) {
    if (f.start < now - STUTTER_WINDOW_MS || f.start > now) continue
    n += 1
    sum += f.duration
  }
  return n >= STUTTER_FRAMES && sum >= STUTTER_SUM_MS
}

/**
 * The fit counter of a session. `frame` takes a long frame and the moment frames start to count
 * (after start and a screen change, while the window is visible and no game runs). It returns
 * true once: when the last fit is reached and light graphics turn on.
 */
export function stutterWatch(): { frame(start: number, duration: number, calmSince: number): boolean } {
  let frames: { start: number; duration: number }[] = []
  let episodes = 0
  let fired = false
  return {
    frame(start, duration, calmSince) {
      if (fired || start < calmSince + STUTTER_GRACE_MS) return false
      frames.push({ start, duration })
      frames = frames.filter((f) => f.start >= start - STUTTER_WINDOW_MS)
      if (!isStutter(frames, start)) return false
      // One fit is one window: the next one counts from scratch.
      episodes += 1
      frames = []
      if (episodes < STUTTER_EPISODES) return false
      fired = true
      return true
    },
  }
}

/** Turns on light graphics and says so. A manual choice in Settings is not overridden. */
export function demoteSlowPc(screen: ScreenId): void {
  if (slowLite() || perfOverride()) return
  try {
    localStorage.setItem(SLOW_LITE_KEY, String(Date.now()))
  } catch {
    // Without storage the switch cannot be remembered: the mode stays as it was.
  }
  // liteMode recalculates on this event, as after a change in Settings.
  window.dispatchEvent(new Event('m-view-prefs'))
  track('perf', { what: 'slow_demote', screen })
  showToast(t('Включили облегчённую графику: лаунчер тормозил на этом ПК'), 'ok', undefined, {
    label: t('Настроить'),
    run: () => openSettings('look'),
  })
}
