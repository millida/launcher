import { Component, memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { Milli, type MilliMode } from './Milli'
import { MilliEvents } from './MilliEvents'
import { MOTES, PARTICLES, SHADOW } from './milliSceneArt'
import { ENCHANT_GLYPHS } from './milliItems'
import { useMilli } from '../../state/milli'
import { milliLook } from '../../lib/milli'

/** Корона Милли по тарифу: PLUS — золотая, Diamond — алмазная, без PLUS — нет (часть спрайта, не наклейка). */
function useTierCrown(): 'gold' | 'diamond' | null {
  const look = useMilli((s) => milliLook(s.status))
  return look === 'diamond' ? 'diamond' : look === 'plus' ? 'gold' : null
}

/*
 * Сцена Милли (04.10.2026). Владелец: «просто и чисто, без декораций»: Милли,
 * мягкая пиксельная тень и несколько медленных частиц. Мышь чуть сдвигает
 * слои по-разному (глубина). Только transform/opacity и steps();
 * панель закрыта (display: none) — ключи стоят; reduced-motion — стоит всё.
 */

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Предохранитель: ошибка в новой детали (сцена, глобус, «генерация мира») не
 * роняет панель — на её месте остаётся запасной вариант.
 */
export class MilliSafe extends Component<{ fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.error('[milli] деталь панели упала', e)
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

/** Тык в Милли: частицы разлетаются (реакцию самой Милли играет маскот). */
export function usePoke(ms = 1_000) {
  const [n, setN] = useState(0)
  const [on, setOn] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const poke = useCallback(() => {
    setN((x) => x + 1)
    setOn(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOn(false), ms)
  }, [ms])
  return { n, on, poke }
}

/**
 * Разлёт частиц, как у сломанного блока в игре: каждая летит вбок и вверх,
 * потом падает (внешний слой — по горизонтали, внутренний — вверх-вниз).
 * `k` перезапускает.
 */
export const MilliBurst = memo(function MilliBurst({ k, size = 90 }: { k: number; size?: number }) {
  return (
    <span key={k} className="mlb" aria-hidden="true">
      {PARTICLES.map((p, i) => (
        <i
          key={i}
          style={
            {
              '--dx': Math.round(p.dx * size) + 'px',
              '--up': Math.round(-p.up * size * 0.7) + 'px',
              '--fall': Math.round(p.fall * size * 0.5) + 'px',
              width: p.s,
              height: p.s,
              animationDelay: p.d + 'ms',
            } as CSSProperties
          }
        >
          <b style={{ animationDelay: p.d + 'ms' }} />
        </i>
      ))}
    </span>
  )
})

/** Мягкая пиксельная тень под Милли: три ступенчатых эллипса. */
const Shadow = memo(function Shadow() {
  return (
    <svg className="mls-shadow" viewBox="-48 -10 96 20" width={96} height={20} shapeRendering="crispEdges" aria-hidden="true">
      {SHADOW.map((d, i) => (
        <path key={i} d={d} className={'mls-shadow-' + i} />
      ))}
    </svg>
  )
})

/**
 * Пустой чат: Милли и мягкая тень под ней, вокруг — несколько медленных
 * частиц. Тык в Милли — частицы разлетаются (реакцию играет маскот).
 */
export function MilliScene({ mode, busy, crown = null }: { mode: MilliMode; busy?: boolean; crown?: 'gold' | 'diamond' | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const raf = useRef(0)
  const { n, on, poke } = usePoke()
  const sceneCrown = useTierCrown()
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const move = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el || reduced()) return
    const r = el.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * 2 - 1
    const y = ((e.clientY - r.top) / r.height) * 2 - 1
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      el.style.setProperty('--mx', x.toFixed(3))
      el.style.setProperty('--my', y.toFixed(3))
    })
  }
  const leave = () => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--mx', '0')
    el.style.setProperty('--my', '0')
  }
  return (
    <div
      ref={ref}
      className={'mls' + (busy ? ' is-busy' : '') + (on ? ' is-poke' : '')}
      onMouseMove={move}
      onMouseLeave={leave}
    >
      <MilliSafe>
        <MilliEvents active={!busy && (mode === 'wave' || mode === 'idle')} />
      </MilliSafe>
      <span className="mls-l mls-l-mid">
        <Shadow />
        <span className="mls-float">
          <span className="mls-hero" onClick={poke}>
            <Milli size={112} mode={mode} crown={crown ?? sceneCrown} />
          </span>
          {n ? <MilliBurst k={n} size={84} /> : null}
        </span>
      </span>
      <span className="mls-l mls-l-near" aria-hidden="true">
        {MOTES.map((m, i) => (
          <i key={i} className="mls-mote" style={{ left: m.x + '%', top: m.y + '%', animationDelay: m.d + 's', animationDuration: m.t + 's' }} />
        ))}
      </span>
    </div>
  )
}

/** Глиф зачарования 5×5. */
function Glyph({ g }: { g: readonly string[] }) {
  return (
    <svg viewBox="0 0 5 5" width={10} height={10} shapeRendering="crispEdges">
      {g.flatMap((row, y) => [...row].map((c, x) => (c === '#' ? <rect key={y * 5 + x} x={x} y={y} width={1} height={1} /> : null)))}
    </svg>
  )
}

/** Пока Милли думает — как у стола зачарования: глифы слетаются к ней и гаснут. */
const GlyphStream = memo(function GlyphStream() {
  return (
    <span className="mlg" aria-hidden="true">
      {ENCHANT_GLYPHS.map((g, i) => (
        <i key={i} style={{ '--a': i * 45 + 20 + 'deg', animationDelay: i * 0.27 + 's' } as CSSProperties}>
          <Glyph g={g} />
        </i>
      ))}
    </span>
  )
})

/** Аватарка Милли в ленте: думает — к ней слетаются глифы, сборка готова — частицы. */
export function MilliAva({ mode = 'idle', spin, cheer }: { mode?: MilliMode; spin?: boolean; cheer?: boolean }) {
  const crown = useTierCrown()
  return (
    <span className={'mla' + (spin ? ' is-spin' : '') + (cheer ? ' is-cheer' : '')}>
      {spin ? <GlyphStream /> : null}
      <Milli size={40} mode={cheer ? 'happy' : mode} className="ml-ava" crown={crown} />
      {cheer ? <MilliBurst k={1} size={44} /> : null}
    </span>
  )
}

/** Милли в шапке: тык — радуется. */
export function MilliHead({ mode }: { mode: MilliMode }) {
  const crown = useTierCrown()
  const { n, poke } = usePoke(900)
  return (
    <span className="mlh" onClick={poke}>
      <Milli size={44} mode={mode} className="ml-head-art" crown={crown} />
      {n ? <MilliBurst k={n} size={40} /> : null}
      {mode === 'happy' ? <MilliBurst k={-1} size={46} /> : null}
    </span>
  )
}
