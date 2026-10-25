import { useCallback, useEffect, useRef, type CSSProperties } from 'react'
import { ART, BOSSES, CAST, MOSAIC, NEWS, TOTAL_BOSSES, type News } from './content'
import { useLoopCarousel } from './useLoopCarousel'
import './release.css'

const N = NEWS.length
const ROWS = [...NEWS, ...NEWS, ...NEWS]
// Строк в барабане: при четырёх новинках видно три — пятая повторила бы верхнюю.
const VISIBLE = N >= 5 ? 5 : 3

const glowOf = (n: News) => ART + ('image' in n ? n.image : 'video' in n ? n.poster : 'boss-malora.webp')

/**
 * Что нового в 2.0 — как на arcania.fun: барабан названий слева сам едет вверх, текущая
 * строка горит, справа меняется кадр, за ним светится его размытая копия. Нажатие на
 * строку переключает на неё и останавливает автопоказ.
 */
export function Release() {
  const hold = useCallback((i: number) => NEWS[i]!.ms, [])
  const { rootRef, pos, active, animated, playing, settle, go } = useLoopCarousel<HTMLElement>(N, hold)

  return (
    // data-snap: тихая перестановка между копиями — без переходов, иначе строки мигали.
    <section ref={rootRef} className="arc-rel" data-snap={!animated || undefined} style={{ '--vis': VISIBLE } as CSSProperties}>
      <div className="arc-rel-side">
        <span className="arc-eyebrow">Что нового в 2.0</span>
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
                    {n.title}
                  </button>
                </li>
              )
            })}
          </ol>
        </div>
        <div className="arc-rel-texts">
          {NEWS.map((n, i) => (
            <p key={n.title} data-on={i === active || undefined} aria-hidden={i !== active}>
              {n.text}
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
  const cls = 'arc-rel-shot' + (on ? ' is-on' : '')
  if ('mosaic' in news)
    return (
      <div className={cls + ' arc-mosaic'}>
        {MOSAIC.map((b, k) => (
          <span key={b} className="arc-mosaic-tile">
            <img src={ART + 'boss-' + b + '.webp'} alt="" loading="lazy" decoding="async" style={on ? { animationDelay: k * 70 + 'ms' } : undefined} />
          </span>
        ))}
        {/* «Закрытая» плитка: за размытыми силуэтами прячутся остальные боссы. */}
        <span className="arc-mosaic-tile arc-mosaic-more">
          <span className="arc-mosaic-blur" aria-hidden="true">
            {BOSSES.slice(0, 4).map((b) => (
              <img key={b.id} src={ART + 'boss-' + b.id + '.webp'} alt="" />
            ))}
          </span>
          <b>+{TOTAL_BOSSES - MOSAIC.length}</b>
          <small>боссов ждут в игре</small>
        </span>
      </div>
    )
  if ('video' in news) return <ReleaseVideo className={cls} src={ART + news.video} poster={ART + news.poster} on={on} />
  if ('lineup' in news)
    return (
      <div className={cls + ' arc-lineup'}>
        {CAST.map((c) =>
          'play' in c ? null : (
            <img key={c.id} src={ART + c.id + '.webp'} alt="" style={{ '--c': c.color } as CSSProperties} />
          ),
        )}
      </div>
    )
  return <img className={cls} src={ART + news.image} alt={news.title} loading="lazy" decoding="async" />
}

// Видео играет с начала, когда кадр стал текущим, и стоит, когда его не видно.
function ReleaseVideo({ src, poster, on, className }: { src: string; poster: string; on: boolean; className: string }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v) return
    if (on) {
      v.currentTime = 0
      void v.play().catch(() => {})
    } else v.pause()
  }, [on])
  // AV1 (webm) в 2 раза легче при том же качестве и размере кадра; где AV1 не декодируется
  // (WebKit без аппаратного AV1), берётся mp4. Пока кадр не текущий, видео не грузится — виден постер.
  return (
    <video ref={ref} className={className} poster={poster} muted playsInline loop preload={on ? 'auto' : 'none'}>
      <source src={src.replace(/\.mp4$/, '.webm')} type='video/webm; codecs="av01.0.08M.08"' />
      <source src={src} type="video/mp4" />
    </video>
  )
}
