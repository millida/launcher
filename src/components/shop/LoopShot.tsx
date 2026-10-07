import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { OutfitShot } from '../../lib/outfitSnapshot'
import { useViewPrefs } from '../../state/viewPrefs'

/**
 * Снимок карточки магазина. Эмоции и движущиеся вещи приходят лентой кадров
 * (outfitSnapshot, 06.10.2026: «анимации должны играть, а не стоять одним
 * кадром»): лента едет шагами через transform — без своего WebGL, только на
 * видимой карточке. За краем экрана, при «Персонаж танцует: выкл» и при
 * reduced motion стоит первый кадр.
 */
export function ShotImg({ shot }: { shot: OutfitShot }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  const dance = useViewPrefs((s) => s.charAnim)
  const loop = !!shot.frames && shot.frames > 1
  useEffect(() => {
    const el = ref.current
    if (!loop || !el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setSeen(es.some((e) => e.isIntersecting)))
    io.observe(el)
    return () => io.disconnect()
  }, [loop])
  if (!loop) return <img src={shot.url} alt="" draggable={false} />
  const style = { ['--n' as string]: shot.frames, ['--dur' as string]: (shot.seconds || 1) + 's' } as CSSProperties
  return (
    <span ref={ref} className={'sv-loop' + (seen && dance ? ' is-on' : '')} style={style}>
      <img src={shot.url} alt="" draggable={false} />
    </span>
  )
}
