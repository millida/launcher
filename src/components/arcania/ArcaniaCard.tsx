import { useEffect, useRef, type CSSProperties, type RefObject } from 'react'
import { liteOn, useLiteMode } from '../../lib/liteMode'
import { useT } from '../../i18n'
import { ARCANIA_POSTER, ARCANIA_VERSION, artClip } from './content'
import { ensureMedia, mediaUrl, useMedia } from '../../lib/media'
import './arcania.css'

export function ArcaniaName() {
  return (
    <>
      Arcania <span className="arc2-ver">{ARCANIA_VERSION}</span>
    </>
  )
}

const COVER_VIDEO = artClip('cover.mp4')

// Held at module level: a detached video nobody references is collected and its download stops.
let warmCover: HTMLVideoElement | null = null

/** Pulls the live cover into the cache before the first card shows; runs only once 2.0 is released. */
export function warmArcaniaCover(): void {
  if (warmCover || typeof document === 'undefined') return
  const poster = document.createElement('link')
  poster.rel = 'preload'
  poster.as = 'image'
  poster.type = 'image/webp'
  poster.href = ARCANIA_POSTER
  poster.setAttribute('fetchpriority', 'high')
  document.head.appendChild(poster)
  // Слабое железо живой ролик не показывает (лёгкий режим): 3 МБ видео ему не нужны.
  if (liteOn()) return
  void ensureMedia([COVER_VIDEO]).then(() => {
    const url = mediaUrl(COVER_VIDEO)
    if (warmCover || !url) return
    warmCover = document.createElement('video')
    warmCover.preload = 'auto'
    warmCover.muted = true
    warmCover.src = url
    warmCover.load()
  })
}

export function ArcaniaCover({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  const lite = useLiteMode()
  // The live cover comes from the media cache; until it lands the poster is the picture. Weak machines never fetch it.
  const clip = useMedia(lite ? null : COVER_VIDEO)

  // The tilt follows the pointer over the whole card, not only over the video.
  useEffect(() => {
    const card = ref.current?.closest<HTMLElement>('.arc2-skin')
    if (!card) return
    const move = (e: PointerEvent) => {
      const r = card.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      card.style.setProperty('--arc2-ry', (x * 8).toFixed(2) + 'deg')
      card.style.setProperty('--arc2-rx', (-y * 6).toFixed(2) + 'deg')
    }
    const leave = () => {
      card.style.setProperty('--arc2-ry', '0deg')
      card.style.setProperty('--arc2-rx', '0deg')
    }
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerleave', leave)
    return () => {
      card.removeEventListener('pointermove', move)
      card.removeEventListener('pointerleave', leave)
    }
  }, [])

  if (lite) {
    // Лёгкий режим: тот же кадр, что был постером ролика, без декодирования видео.
    return <img ref={ref as unknown as RefObject<HTMLImageElement>} className={'arc2-video ' + className} src={ARCANIA_POSTER} alt="" aria-hidden="true" />
  }
  return (
    <video
      ref={ref}
      className={'arc2-video ' + className}
      src={clip ?? undefined}
      poster={ARCANIA_POSTER}
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-hidden="true"
    />
  )
}

export function ArcaniaTag() {
  const t = useT()
  return <span className="arc2-tag">{t('Новое')}</span>
}

const SPARKS = [
  ['8%', 3, 3.2, 0, '#b6f09c'],
  ['21%', 4, 3.8, 1.1, '#ffe08a'],
  ['35%', 3, 2.9, 2.0, '#7bd35a'],
  ['50%', 4, 3.5, 0.5, '#b6f09c'],
  ['64%', 3, 3.1, 1.6, '#ffe08a'],
  ['79%', 4, 3.9, 2.6, '#7bd35a'],
  ['92%', 3, 3.3, 0.9, '#b6f09c'],
] as const

/** Effects layer over any Arcania card; the card root carries the arc2-skin class. */
export function ArcaniaFx() {
  return (
    <span className="arc2-fx" aria-hidden="true">
      <span className="arc2-glow" />
      <span className="arc2-shine" />
      <span className="arc2-sparks">
        {SPARKS.map(([x, s, t, d, c]) => (
          <i key={x} style={{ '--x': x, '--s': s + 'px', '--t': t + 's', '--d': d + 's', '--c': c } as CSSProperties} />
        ))}
      </span>
      <span className="px-run-ring" />
    </span>
  )
}

export function ArcaniaCard({ meta, pos, onClick }: { meta: string; pos: number; onClick: () => void }) {
  return (
    <button className="ph-card fy-card arc2-skin" data-sound="open" data-kind="premium" data-id="arcania" data-pos={pos} data-src="foryou" onClick={onClick}>
      <span className="ph-card-art arc2-art">
        <ArcaniaCover />
        <ArcaniaTag />
      </span>
      <span className="ph-card-body">
        <b>
          <ArcaniaName />
        </b>
        <span className="ph-card-meta">{meta}</span>
      </span>
      <ArcaniaFx />
    </button>
  )
}
