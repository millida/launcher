// Mounts a screen from the website bundle (src/lib/remoteUi.ts) into a plain div. If the bundle is
// missing, unsigned or crashes, onFail tells the parent to render its built-in screen instead.
import { useEffect, useRef, useState } from 'react'
import { loadRemoteUi, markRemoteUiBad, onRemoteUiStale, recoverRemoteUi } from '../lib/remoteUi'
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
  // One move to the live version per screen: a second loss in a row means the site itself is broken.
  const recovered = useRef(false)
  const [attempt, setAttempt] = useState(0)
  bridgeRef.current = bridge
  failRef.current = onFail

  useEffect(() => {
    const t0 = performance.now()
    let off = false
    let handle: { unmount: () => void } | null = null
    let running: string | null = null
    let recovering = false
    // A lost chunk or a screen that gave up: switch to the live bundle once, otherwise the built-in screen.
    const recover = () => {
      if (off || recovering || !running) return
      recovering = true
      const version = running
      void recoverRemoteUi(version)
        .catch(() => false)
        .then((moved) => {
          if (off) return
          if (moved && !recovered.current) {
            recovered.current = true
            setAttempt((n) => n + 1)
          } else failRef.current()
        })
    }
    const stopStale = onRemoteUiStale((version) => {
      if (version === running) recover()
    })
    void loadRemoteUi()
      .then((r) => {
        if (off) return
        const loadMs = Math.round(performance.now() - t0)
        if (!r || !ref.current) return failRef.current()
        // A bundle built before this screen existed is still good for the others: fall back without marking it bad.
        if (!Object.prototype.hasOwnProperty.call(r.module.screens ?? {}, screen)) return failRef.current()
        running = r.version
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
            onFail: recover,
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
      stopStale()
      const h = handle
      handle = null
      if (h) queueMicrotask(() => h.unmount())
    }
  }, [screen, attempt])

  // The host tokens sit on the wrapper: on the mount node itself they would point at themselves.
  return (
    <div className="remote-ui">
      <div ref={ref} />
    </div>
  )
}
