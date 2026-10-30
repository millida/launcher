import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useT } from '../../i18n'
import { BOSSES, CAST, MOSAIC, NEWS, TOTAL_BOSSES, art, artClip, type News } from './content'
import { useArcaniaArt } from './useArcaniaArt'
import { useMedia } from '../../lib/media'
import { useLoopCarousel } from './useLoopCarousel'
import './release.css'

const N = NEWS.length
const ROWS = [...NEWS, ...NEWS, ...NEWS]
// With four items a five-row drum would show the top row twice, so it shows three.
const VISIBLE = N >= 5 ? 5 : 3

const glowOf = (n: News) => art('image' in n ? n.image : 'video' in n ? n.poster : 'boss-malora.webp')

export function Release() {
  const t = useT()
  useArcaniaArt()
  const hold = useCallback((i: number) => NEWS[i]!.ms, [])
  const { rootRef, pos, active, animated, playing, settle, go } = useLoopCarousel<HTMLElement>(N, hold)

  return (
    // data-snap: the silent jump between copies runs without transitions, otherwise rows flash.
    <section ref={rootRef} className="arc-rel" data-snap={!animated || undefined} style={{ '--vis': VISIBLE } as CSSProperties}>
      <div className="arc-rel-side">
        <span className="arc-eyebrow">{t('Что нового в 2.0')}</span>
        <div className="arc-rel-drum">
          <ol
            className={animated ? 'is-animated' : undefined}
            onTransitionEnd={(e) => e.target === e.currentTarget && settle()}
            style={{ transform: `translateY(calc(var(--row) * ((var(--vis) - 1) / 2 - ${pos})))` }}
          >
            {ROWS.map((n, row) => {
              const d = Math.abs(row - pos)
              return (
                <li key={row}>
                  <button
                    tabIndex={d === 0 || (row >= N && row < 2 * N) ? 0 : -1}
                    aria-current={d === 0}
                    onClick={() => go(row)}
                    style={{ opacity: d === 0 ? 1 : d === 1 ? 0.5 : 0.32 }}
                  >
                    {t(n.title)}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
        <div className="arc-rel-texts">
          {NEWS.map((n, i) => (
            <p key={n.title} data-on={i === active || undefined} aria-hidden={i !== active}>
              {t(n.text)}
            </p>
          ))}
        </div>
        <span className="arc-rel-bar" aria-hidden="true">
          {playing ? <span key={pos} style={{ animationDuration: NEWS[active]!.ms + 'ms' }} /> : null}
        </span>
      </div>

      <div className="arc-rel-stage">
        <div className="arc-rel-glow" aria-hidden="true">
          {NEWS.map((n, i) => (
            <img key={n.title} src={glowOf(n)} alt="" loading="lazy" decoding="async" data-on={i === active || undefined} />
          ))}
        </div>
        <div className="arc-rel-frame">
          {NEWS.map((n, i) => (
            <Frame key={n.title} news={n} on={i === active} />
          ))}
          <span className="arc-rel-count">
            {String(active + 1).padStart(2, '0')} / {String(N).padStart(2, '0')}
          </span>
        </div>
      </div>
    </section>
  )
}

function Frame({ news, on }: { news: News; on: boolean }) {
  const t = useT()
  const cls = 'arc-rel-shot' + (on ? ' is-on' : '')
  if ('mosaic' in news)
    return (
      <div className={cls + ' arc-mosaic'}>
        {MOSAIC.map((b, k) => (
          <span key={b} className="arc-mosaic-tile">
            <img src={art('boss-' + b + '.webp')} alt="" loading="lazy" decoding="async" style={on ? { animationDelay: k * 70 + 'ms' } : undefined} />
          </span>
        ))}
        <span className="arc-mosaic-tile arc-mosaic-more">
          <span className="arc-mosaic-blur" aria-hidden="true">
            {BOSSES.slice(0, 4).map((b) => (
              <img key={b.id} src={art('boss-' + b.id + '.webp')} alt="" />
            ))}
          </span>
          <b>+{TOTAL_BOSSES - MOSAIC.length}</b>
          <small>{t('боссов ждут в игре')}</small>
        </span>
      </div>
    )
  if ('video' in news) return <ReleaseVideo className={cls} file={news.video} poster={art(news.poster)} on={on} />
  if ('lineup' in news)
    return (
      <div className={cls + ' arc-lineup'}>
        {CAST.map((c) =>
          'play' in c ? null : (
            <img key={c.id} src={art(c.id + '.webp')} alt="" style={{ '--c': c.color } as CSSProperties} />
          ),
        )}
      </div>
    )
  return <img className={cls} src={art(news.image)} alt={t(news.title)} loading="lazy" decoding="async" />
}

// AV1 webm is half the size; WebKit without hardware AV1 plays the mp4 instead. Only one of the two is ever fetched.
const AV1 = (() => {
  try {
    return typeof document !== 'undefined' && document.createElement('video').canPlayType('video/webm; codecs="av01.0.08M.08"') !== ''
  } catch {
    return false
  }
})()

function ReleaseVideo({ file, poster, on, className }: { file: string; poster: string; on: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  // The clip is fetched the first time its frame comes on, and stays after that.
  const [wanted, setWanted] = useState(on)
  useEffect(() => {
    if (on) setWanted(true)
  }, [on])
  const src = useMedia(wanted ? artClip(AV1 ? file.replace(/\.mp4$/, '.webm') : file) : null)
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    if (on) {
      v.currentTime = 0
      void v.play().catch(() => {})
    } else v.pause()
  }, [on, src])
  return <video ref={ref} className={className} poster={poster} src={src ?? undefined} muted playsInline loop preload={on ? 'auto' : 'none'} />
}
