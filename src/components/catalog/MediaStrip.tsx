import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { openImage } from '../ImageLightbox'

/*
 * Мини-плеер над описанием (владелец 05.10.2026: «чтобы игроку не нужно было
 * переключаться на Галерею»). Большой кадр 16:9 + ряд миниатюр; кадры листаются
 * сами раз в 5 с, пока курсор не над плеером. Ролик — первым кадром: обложка
 * с кнопкой, по клику плеер YouTube прямо здесь. Клик по кадру — на весь экран,
 * «+N» в последней миниатюре — вся галерея.
 */

type Frame = { kind: 'video'; id: string } | { kind: 'img'; src: string }

const THUMBS = 5
const STEP_MS = 5000

export function MediaStrip({ urls, video, onAll }: { urls: string[]; video?: string | null; onAll?: () => void }) {
  const frames: Frame[] = [...(video ? [{ kind: 'video' as const, id: video }] : []), ...urls.map((src) => ({ kind: 'img' as const, src }))]
  const [at, setAt] = useState(0)
  const [playing, setPlaying] = useState(false)
  const hover = useRef(false)
  const n = frames.length
  const key = frames.map((f) => (f.kind === 'img' ? f.src : f.id)).join('|')
  useEffect(() => {
    setAt(0)
    setPlaying(false)
    // Все кадры качаем сразу, пока игрок читает: листание без пустого чёрного кадра.
    for (const f of frames) if (f.kind === 'img') {
      const im = new Image()
      im.decoding = 'async'
      im.src = f.src
    }
  }, [key])
  useEffect(() => {
    if (n < 2 || playing) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => {
      if (!hover.current && document.visibilityState === 'visible') setAt((i) => (i + 1) % n)
    }, STEP_MS)
    return () => window.clearInterval(t)
  }, [n, playing, key])
  if (!n) return null
  const cur = frames[Math.min(at, n - 1)]!
  const go = (d: number) => {
    setPlaying(false)
    setAt((i) => (i + d + n) % n)
  }
  const thumbs = frames.slice(0, THUMBS)
  const more = n - thumbs.length
  return (
    <section
      className="card ci-media"
      aria-label="Кадры"
      onMouseEnter={() => (hover.current = true)}
      onMouseLeave={() => (hover.current = false)}
    >
      <div className="ci-media-stage">
        {cur.kind === 'video' && playing ? (
          <iframe
            className="ci-media-video"
            src={'https://www.youtube-nocookie.com/embed/' + cur.id + '?autoplay=1&playsinline=1&rel=0'}
            title="Трейлер"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : cur.kind === 'video' ? (
          <button className="ci-media-frame is-video" data-track="item_media_play" aria-label="Смотреть трейлер" onClick={() => setPlaying(true)}>
            <img key={cur.id} src={'https://i.ytimg.com/vi/' + cur.id + '/hqdefault.jpg'} alt="" draggable={false} />
            <span className="ci-media-play">
              <Icon id="i-play" />
            </span>
          </button>
        ) : (
          <button className="ci-media-frame" data-track="item_media_zoom" aria-label="На весь экран" onClick={() => openImage(cur.src)}>
            {/* Кадр целиком по центру, по бокам — он же размытый: без чёрных полос и без обрезки субтитров. */}
            <img key={'bg' + cur.src} className="ci-media-bg" src={cur.src} alt="" aria-hidden="true" decoding="async" draggable={false} />
            <img key={cur.src} className="ci-media-img" src={cur.src} alt="" decoding="async" draggable={false} />
          </button>
        )}
        {n > 1 ? (
          <>
            <button className="ci-media-nav is-prev" aria-label="Назад" data-track="item_media_prev" onClick={() => go(-1)}>
              <Icon id="i-chev-l" />
            </button>
            <button className="ci-media-nav is-next" aria-label="Дальше" data-track="item_media_next" onClick={() => go(1)}>
              <Icon id="i-chev-r" />
            </button>
            <span className="ci-media-n">
              {Math.min(at, n - 1) + 1} / {n}
            </span>
          </>
        ) : null}
      </div>
      {n > 1 ? (
        <div className="ci-media-thumbs">
          {thumbs.map((f, i) => {
            const last = i === thumbs.length - 1 && more > 0
            return (
              <button
                key={f.kind === 'img' ? f.src : f.id}
                className={'ci-media-thumb' + (i === at ? ' on' : '')}
                aria-label={last ? 'Вся галерея' : 'Кадр ' + (i + 1)}
                data-track={last ? 'item_media_all' : 'item_media_thumb'}
                onClick={() => {
                  if (last && onAll) return onAll()
                  setPlaying(false)
                  setAt(i)
                }}
              >
                <img src={f.kind === 'img' ? f.src : 'https://i.ytimg.com/vi/' + f.id + '/mqdefault.jpg'} alt="" decoding="async" draggable={false} />
                {f.kind === 'video' ? (
                  <span className="ci-media-tplay">
                    <Icon id="i-play" />
                  </span>
                ) : null}
                {last ? <span className="ci-media-more">+{more + 1}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
