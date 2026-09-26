import { useEffect, useRef, useState } from 'react'
import { textureSource } from '../../lib/textureSource'
import { detectSlim, drawFront } from '../../lib/skinFlat'

function loadSkin(url: string): Promise<HTMLImageElement> {
  return textureSource(url).then(
    (src) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        if (!/^(data|blob):/i.test(src)) i.crossOrigin = 'anonymous'
        i.onload = () => res(i)
        i.onerror = () => rej(new Error('скин недоступен'))
        i.src = src
      }),
  )
}

/**
 * Скин спереди, 16×32 пикселя скина, растянутых без сглаживания. Без WebGL:
 * замена 3D-фигуры в лёгкой графике (lib/gpuLite).
 */
export function FlatFigure({
  url,
  slim,
  height,
  className,
  onReady,
}: {
  url: string
  slim?: boolean
  /** Высота в CSS px; без неё фигура заполняет высоту родителя. */
  height?: number
  className?: string
  onReady?: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let alive = true
    setOk(false)
    loadSkin(url)
      .then((img) => {
        const cv = ref.current
        const g = cv?.getContext('2d')
        if (!alive || !cv || !g) return
        cv.width = 16
        cv.height = 32
        drawFront(g, img, slim === undefined ? detectSlim(img) : slim)
        setOk(true)
        onReady?.()
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [url, slim])
  return (
    <canvas
      ref={ref}
      className={'flat-figure' + (className ? ' ' + className : '')}
      aria-hidden="true"
      style={{
        height: height ? height + 'px' : '100%',
        aspectRatio: '1 / 2',
        imageRendering: 'pixelated',
        display: 'block',
        visibility: ok ? 'visible' : 'hidden',
      }}
    />
  )
}
