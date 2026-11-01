// The state and the listener of the live launch log. They live apart from the window (LiveLog.tsx), which is a lazy
// chunk: the log must be heard from the first launch, but the window's code is needed only when it is opened.
import { create } from 'zustand'
import { listenGameLogStart, type CrashInfo } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { followGameLog } from '../lib/gameLogFeed'
import { LIVE_LOG_MAX } from '../lib/liveLog'
import { readPref } from '../lib/prefs'
import { lastCrash } from '../lib/repair'
import { useCrash } from '../state/crash'

export const LIVE_LOG_PREF = 'm-live-log'
const REDRAW_MS = 150

export interface LiveLogState {
  open: boolean
  profile: string
  lines: string[]
  crash: CrashInfo | null
}

export const useLiveLog = create<LiveLogState>(() => ({ open: false, profile: '', lines: [], crash: null }))

let buffer: string[] = []
let redraw: ReturnType<typeof setTimeout> | null = null

const flush = () => {
  redraw = null
  useLiveLog.setState({ lines: buffer })
}

export const openLiveLog = () => useLiveLog.setState({ open: true, lines: buffer })

let started = false

/** Слушает лог с первого запуска: окно может открыться позже, а строки нужны с начала. */
export function startLiveLog() {
  if (started || !hasTauri()) return
  started = true
  void listenGameLogStart((profile) => {
    // A build that crashed last time opens the log by itself: that is when the player wants to watch it.
    const open = readPref(LIVE_LOG_PREF, '0') === '1' || !!lastCrash(profile)
    useLiveLog.setState((s) => ({ profile, lines: [], crash: null, open: s.open || open }))
  })
  followGameLog(LIVE_LOG_MAX, (lines, profile) => {
    buffer = lines
    if (profile && profile !== useLiveLog.getState().profile) useLiveLog.setState({ profile })
    if (useLiveLog.getState().open && !redraw) redraw = setTimeout(flush, REDRAW_MS)
  })
  useCrash.subscribe((s) => {
    if (s.info && s.info.profile === useLiveLog.getState().profile) useLiveLog.setState({ crash: s.info })
  })
}
