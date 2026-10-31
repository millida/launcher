import { useMemo, type CSSProperties } from 'react'
import '../../styles/pixel/reward.css'

// Конфетти, пиксельный взрыв и лучи: нужны и заставке входа (Welcome, в стартовом бандле),
// и окну награды (RewardReveal, отдельный чанк) — поэтому живут отдельно от второго.

/** Детерминированный «шум», чтобы частицы не менялись от перерисовки. */
function rand(seed: number) {
  let s = seed * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

const PALETTE = [
  'var(--rw-tone)',
  '#ffffff',
  'var(--m-rarity-legendary)',
  'var(--m-accent)',
  'var(--m-ruby)',
  'var(--rw-tone)',
]

/** Пиксельный взрыв из центра родителя: квадраты 4–12 px разлетаются и гаснут. */
export function Burst({ n = 28, spread = 260, seed = 1 }: { n?: number; spread?: number; seed?: number }) {
  const parts = useMemo(() => {
    const r = rand(seed)
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + r() * 0.5
      const d = spread * (0.45 + r() * 0.55)
      const s = [4, 6, 8, 12][Math.floor(r() * 4)]
      return {
        '--dx': Math.round(Math.cos(a) * d) + 'px',
        '--dy': Math.round(Math.sin(a) * d) + 'px',
        '--s': s + 'px',
        '--c': PALETTE[i % PALETTE.length],
        '--t': Math.round(620 + r() * 420) + 'ms',
      } as CSSProperties
    })
  }, [n, spread, seed])
  return (
    <span className="rw-burst" aria-hidden="true">
      {parts.map((st, i) => (
        <i key={i} style={st} />
      ))}
    </span>
  )
}

/** Конфетти: пиксельные листки падают сверху и переворачиваются. */
export function Confetti({ n = 46, seed = 7 }: { n?: number; seed?: number }) {
  const parts = useMemo(() => {
    const r = rand(seed)
    return Array.from({ length: n }, (_, i) => {
      const w = [6, 8, 10][Math.floor(r() * 3)]
      return {
        left: Math.round(r() * 100) + '%',
        '--w': w + 'px',
        '--h': (r() > 0.5 ? w : w + 6) + 'px',
        '--c': PALETTE[i % PALETTE.length],
        '--dx': Math.round((r() - 0.5) * 160) + 'px',
        '--t': Math.round(2100 + r() * 1400) + 'ms',
        '--d': Math.round(r() * 700) + 'ms',
        '--f': Math.round(380 + r() * 420) + 'ms',
      } as CSSProperties
    })
  }, [n, seed])
  return (
    <span className="rw-confetti" aria-hidden="true">
      {parts.map((st, i) => (
        <i key={i} style={st}>
          <b />
        </i>
      ))}
    </span>
  )
}

/** Крутящиеся лучи с жёсткими стопами — как `.ht-rays` на плитках лобби. */
export function Rays({ className = '' }: { className?: string }) {
  return (
    <span className={'rw-rays ' + className} aria-hidden="true">
      <i className="a" />
      <i className="b" />
    </span>
  )
}

