import { realtimeRelay, realtimeRelayState } from '../ipc/commands'
import { listenRealtimeRelay } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { injectRealtime, retainRealtime, setRealtimeRelay } from './realtime'
import { readRelayMessage } from './realtimePace'

/** Main window: every friend publication and socket state change also goes to the overlay. */
export function initRealtimeRelay(): () => void {
  if (!hasTauri()) return () => {}
  setRealtimeRelay((message) => void realtimeRelay(message).catch(() => {}))
  return () => setRealtimeRelay(null)
}

/**
 * Overlay: listens to the main window instead of opening a second socket. Its own
 * connection is opened only when no main window relays.
 */
export function retainOverlayRealtime(): () => void {
  if (!hasTauri()) return retainRealtime()
  let released = false
  let own: (() => void) | null = null
  let unlisten: (() => void) | null = null
  const fallback = () => {
    if (!released && !own) own = retainRealtime()
  }
  void listenRealtimeRelay((payload) => {
    if (own) return
    const message = readRelayMessage(payload)
    if (message) injectRealtime(message)
  })
    .then((u) => {
      if (released) {
        u?.()
        return null
      }
      unlisten = u
      return u ? realtimeRelayState() : null
    })
    .then((state) => {
      if (released) return
      if (state && state.relay) injectRealtime({ kind: 'live', live: state.live })
      else fallback()
    })
    .catch(fallback)
  return () => {
    released = true
    unlisten?.()
    unlisten = null
    if (own) own()
    else injectRealtime({ kind: 'live', live: false })
  }
}
