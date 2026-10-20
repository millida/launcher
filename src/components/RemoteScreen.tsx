// Mounts a screen from the website bundle (src/lib/remoteUi.ts) into a plain div. If the bundle is
// missing, unsigned or crashes, onFail tells the parent to render its built-in screen instead.
import { useEffect, useRef } from 'react'
import { loadRemoteUi, markRemoteUiBad } from '../lib/remoteUi'
import type { RemoteUiBridge } from '../lib/remoteUiRules'
import '../styles/pixel/remote-ui.css'

export interface RemoteUiTiming {
  screen: string
  version: string
  source: 'disk' | 'network'
  loadMs: number
  readyMs: number
  firstFrameMs: number
}

declare global {
  interface Window {
    __mluTimings?: RemoteUiTiming[]
  }
}

export function RemoteScreen({ screen, bridge, onFail }: { screen: string; bridge: () => RemoteUiBridge; onFail: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef(bridge)
  const failRef = useRef(onFail)
  bridgeRef.current = bridge
  failRef.current = onFail

  useEffect(() => {
    const t0 = performance.now()
    let off = false
    let handle: { unmount: () => void } | null = null
    void loadRemoteUi()
      .then((r) => {
        if (off) return
        const loadMs = Math.round(performance.now() - t0)
        if (!r || !ref.current) return failRef.current()
        try {
          handle = r.module.mount(ref.current, bridgeRef.current(), {
            screen,
            onReady: () => {
              const readyMs = Math.round(performance.now() - t0)
              requestAnimationFrame(() => {
                const t: RemoteUiTiming = { screen, version: r.version, source: r.source, loadMs, readyMs, firstFrameMs: Math.round(performance.now() - t0) }
                ;(window.__mluTimings ??= []).push(t)
                console.info('[remote-ui]', t)
              })
            },
          })
        } catch (e) {
          console.error('[remote-ui] mount', e)
          void markRemoteUiBad(r.version)
          failRef.current()
        }
      })
      .catch((e) => {
        console.error('[remote-ui] load', e)
        if (!off) failRef.current()
      })
    return () => {
      off = true
      const h = handle
      handle = null
      if (h) queueMicrotask(() => h.unmount())
    }
  }, [screen])

  // The host tokens sit on the wrapper: on the mount node itself they would point at themselves.
  return (
    <div className="remote-ui">
      <div ref={ref} />
    </div>
  )
}
