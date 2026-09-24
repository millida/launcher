import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { BODY_H, BODY_W, renderSkinBody } from '../lib/skinBody'
import type { BodyModel } from '../lib/skinBody'

export function SkinBody({
  url,
  model = 'auto-detect',
  height = 132,
  fallback,
  yaw = 0,
}: {
  url: string
  model?: BodyModel
  height?: number
  fallback?: ReactNode
  /** Поворот фигуры, рад. */
  yaw?: number
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

  // Неудача 3D-рендера чаще всего временная (контекст WebGL занят другой
  // сценой): пробуем ещё дважды, а плоская заглушка стоит только в промежутке.
  const [tries, setTries] = useState(0)
  useEffect(() => setTries(0), [url, model, yaw])
  useEffect(() => {
    if (!near || !url) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setSrc('')
    renderSkinBody(url, model, yaw)
      .then((data) => {
        if (!alive) return
        setFailed(false)
        setSrc(data)
      })
      .catch(() => {
        if (!alive) return
        setFailed(true)
        if (tries < 2) timer = setTimeout(() => setTries((n) => n + 1), 4500)
      })
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [near, url, model, yaw, tries])

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
