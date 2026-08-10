import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BODY_H, BODY_W, renderSkinBody } from '../lib/skinBody'
import type { BodyModel } from '../lib/skinBody'

export function SkinBody({
  url,
  model = 'auto-detect',
  height = 132,
  fallback,
}: {
  url: string
  model?: BodyModel
  height?: number
  fallback?: ReactNode
}) {
  const holder = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const width = (height * BODY_W) / BODY_H

  useEffect(() => {
    const el = holder.current
    if (!el || near) return
    if (typeof IntersectionObserver !== 'function') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true)
          io.disconnect()
        }
      },
      { rootMargin: '320px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [near])

  useEffect(() => {
    if (!near || !url) return
    let alive = true
    setSrc('')
    setFailed(false)
    renderSkinBody(url, model)
      .then((data) => {
        if (alive) setSrc(data)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [near, url, model])

  if (failed && fallback) return <>{fallback}</>

  return (
    <span
      ref={holder}
      className={'skin-body3d-slot' + (src ? '' : ' is-loading')}
      style={{ width: width + 'px', height: height + 'px' }}
    >
      {src ? <img className="skin-body3d" src={src} alt="" style={{ height: height + 'px' }} /> : null}
    </span>
  )
}
