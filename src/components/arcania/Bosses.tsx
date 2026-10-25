import { useCallback, useRef, type CSSProperties } from 'react'
import { ART, BOSSES, TOTAL_BOSSES, bossesLeft } from './content'
import { useLoopCarousel } from './useLoopCarousel'
import './bosses.css'

const N = BOSSES.length
const HOLD_MS = 1600
const ROWS = [...BOSSES, ...BOSSES, ...BOSSES]
const SWIPE_PX = 40

// Искры над именем: позиция, длительность, задержка, снос — ручной разброс.
const SPARKS = [
  [8, 2.6, 0, -10], [17, 3.1, 0.9, 6], [26, 2.4, 1.7, -4], [35, 2.9, 0.4, 9], [44, 3.3, 1.2, -7],
  [53, 2.5, 2.1, 5], [62, 3, 0.6, -9], [71, 2.7, 1.5, 7], [80, 3.2, 0.2, -5], [89, 2.8, 1.9, 8],
] as const

/**
 * Боссы — как на arcania.fun: кадр по центру, соседние выглядывают по краям. Имя босса
 * снизу светится его цветом, от имени летят искры; под лентой — полоски с прогрессом.
 */
export function Bosses() {
  const hold = useCallback(() => HOLD_MS, [])
  const { rootRef, pos, active, animated, playing, settle, go } = useLoopCarousel<HTMLElement>(N, hold)
  const touch = useRef({ x: 0, swiped: false })

  return (
    // data-snap: тихая перестановка между копиями — без переходов, иначе кадры мигали и прыгали.
    <section ref={rootRef} className="arc-boss" data-snap={!animated || undefined}>
      <header className="arc-boss-head">
        <span className="arc-eyebrow">Боссы</span>
        <h2>Захватывающие боссы</h2>
      </header>

      <div
        className="arc-boss-track"
        onPointerDown={(e) => (touch.current = { x: e.clientX, swiped: false })}
        onPointerUp={(e) => {
          const dx = e.clientX - touch.current.x
          if (Math.abs(dx) < SWIPE_PX) return
          touch.current.swiped = true
          go(dx < 0 ? pos + 1 : pos - 1)
        }}
      >
        <div
          className={'arc-boss-belt' + (animated ? ' is-animated' : '')}
          onTransitionEnd={(e) => e.target === e.currentTarget && settle()}
          style={{ transform: `translateX(calc(${-pos} * (var(--w) + var(--gap)) - var(--w) / 2))` }}
        >
          {ROWS.map((b, row) => {
            const on = row === pos
            return (
              <button
                key={row}
                className={'arc-boss-slide' + (on ? ' is-on' : '')}
                tabIndex={on ? 0 : -1}
                aria-label={on ? undefined : b.name}
                style={{ '--c': b.color } as CSSProperties}
                onClick={() => {
                  if (touch.current.swiped || on) return
                  go(row)
                }}
              >
                <img src={ART + 'boss-' + b.id + '.webp'} alt="" loading="lazy" decoding="async" draggable={false} />
                <span className="arc-boss-shade" />
                {on ? (
                  <span key={pos} className="arc-boss-caption">
                    {SPARKS.map(([x, t, d, dx], i) => (
                      <span
                        key={i}
                        className="arc-boss-spark"
                        aria-hidden="true"
                        style={{ '--x': x, '--t': t + 's', '--d': d + 's', '--dx': dx + 'px' } as CSSProperties}
                      />
                    ))}
                    <span className="arc-boss-badge">Новый в 2.0</span>
                    <span className="arc-boss-name">{b.name}</span>
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="arc-boss-dots">
        {BOSSES.map((b, i) => (
          <button key={b.id} aria-label={b.name} aria-current={i === active} onClick={() => go(pos - active + i)}>
            <span>
              {i === active ? (
                playing ? (
                  <i key={pos} className="is-run" style={{ animationDuration: HOLD_MS + 'ms', background: b.color }} />
                ) : (
                  <i style={{ background: b.color }} />
                )
              ) : null}
            </span>
          </button>
        ))}
      </div>
      <p className="arc-boss-more">{bossesLeft(TOTAL_BOSSES - N)}</p>
    </section>
  )
}
