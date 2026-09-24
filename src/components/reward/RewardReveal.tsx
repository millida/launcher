import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { hasPx } from '../pxArt'
import { Ruby } from '../Ruby'
import { playSound } from '../../lib/sound'
import { itemTone, rarityWord, rewardTone, useReward, type RewardEntry, type RewardShown } from './rewardBus'
import '../../styles/pixel/reward.css'

export { showReward } from './rewardBus'
export type { RewardCall, RewardEntry, RewardLevel } from './rewardBus'

/*
 * Миг награды — рецепт docs/DESIGN-JUICE.md:
 *   вещь влетает сверху и «плюхается» (rv-plop, 520 мс, cubic-bezier(.2,1.5,.4,1)),
 *   на ударе — белая вспышка, пиксельный взрыв, лучи с жёсткими стопами
 *   цвета редкости раскрываются за 500 мс и крутятся 0,25 рад/с,
 *   сверху сыплется конфетти; вещей несколько — веером, по одной каждые 460 мс.
 * Свет только в сцене: сами плашки — плотные заливки со ступенчатой рамкой
 * из двух слоёв (рамка + плита с той же ступенькой 10 px).
 */

const BEAT_MS = 460
/** Момент удара в анимации влёта: 55% от 520 мс. */
const HIT_MS = 290
const FAN_MAX = 7
/** От вылета последней карточки до текста: влёт 520 мс минус запас. */
const LAND_MS = 480
const MID_MS = 3200
const SMALL_MS = 2600

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

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

function Twinkles() {
  return (
    <span className="rw-tws" aria-hidden="true">
      <i className="t1" />
      <i className="t2" />
      <i className="t3" />
      <i className="t4" />
    </span>
  )
}

/** Картинка награды: превью вещи, рубины, свой рисунок или пиксельный значок. */
function Art({ it, size }: { it: RewardEntry; size: number }) {
  const [broken, setBroken] = useState(false)
  if (it.art) return <span className="rw-art-own">{it.art}</span>
  if (it.rubies != null)
    return (
      <span className="rw-art-ruby">
        <Ruby size={Math.round(size * 0.62)} />
        <b style={{ fontSize: Math.max(12, Math.round(size * 0.2)) }}>+{it.rubies.toLocaleString('ru-RU')}</b>
      </span>
    )
  if (it.preview && !broken)
    return (
      <img
        className="rw-art-img"
        src={it.preview}
        alt=""
        draggable={false}
        width={size}
        height={size}
        onError={() => setBroken(true)}
      />
    )
  const name = (it.icon || 'gift').replace(/^i-/, '')
  // Кратно 6/12 px: клетка значка ложится ровно в пиксели.
  const px = size <= 40 ? 24 : size <= 72 ? 48 : Math.round((size * 0.56) / 12) * 12
  return hasPx(name) ? (
    <PxIcon name={name} size={px} className="rw-art-ic" />
  ) : (
    <Icon id={'i-' + name} className="rw-art-ic" style={{ width: px, height: px }} />
  )
}

/** Плашка со ступенчатой рамкой: рамка цвета редкости → плита с той же ступенькой. */
function Plate({ tone, children, className = '' }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span className={'rw-frame ' + className} style={tone ? ({ '--rw-it': tone } as CSSProperties) : undefined}>
      <span className="rw-plate">
        <i className="rw-edge-t" />
        <i className="rw-edge-b" />
        {children}
      </span>
    </span>
  )
}

/* ─────────────────────────── Большой ─────────────────────────── */

function BigReveal({ r, onClose }: { r: RewardShown; onClose: () => void }) {
  const reduced = useMemo(reducedMotion, [])
  const items: RewardEntry[] = r.items.length ? r.items : [{ name: r.title || '', icon: 'trophy' }]
  const many = items.length > 1
  const cards = items.slice(0, FAN_MAX)
  const extra = items.length - cards.length
  const [shown, setShown] = useState(reduced ? cards.length : 0)
  const [hit, setHit] = useState(reduced)
  const [leaving, setLeaving] = useState(false)
  const allOut = shown >= cards.length
  // Текст и кнопки — когда последняя вещь уже «плюхнулась».
  const [finished, setFinished] = useState(reduced)
  const tone = rewardTone(r)
  const closeRef = useRef(false)

  // Первая карточка вылетает сразу; удар — на 290-й мс её полёта.
  useEffect(() => {
    if (reduced) {
      playSound('achievement')
      return
    }
    const a = window.setTimeout(() => setShown(1), 80)
    const b = window.setTimeout(() => {
      setHit(true)
      playSound('achievement')
    }, 80 + HIT_MS)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [])

  useEffect(() => {
    if (reduced || shown === 0 || shown >= cards.length) return
    const id = window.setTimeout(() => {
      playSound('success')
      setShown((n) => n + 1)
    }, BEAT_MS)
    return () => window.clearTimeout(id)
  }, [shown])

  useEffect(() => {
    if (!allOut || finished) return
    const id = window.setTimeout(() => setFinished(true), LAND_MS)
    return () => window.clearTimeout(id)
  }, [allOut])

  const done = () => {
    if (closeRef.current) return
    closeRef.current = true
    setLeaving(true)
    window.setTimeout(
      () => {
        onClose()
        r.onDone?.()
      },
      reduced ? 0 : 160,
    )
  }
  const wear = () => {
    r.onWear?.()
    done()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        done()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const one = items[0]
  const title = r.title ?? (many ? 'Твоё: ' + items.length : one.name)
  const sub = r.sub ?? (many ? undefined : rarityWord(one))
  const kicker = r.kicker ?? (many ? 'Новые вещи' : one.preview || one.rarity ? 'Новая вещь' : undefined)
  const mid = (cards.length - 1) / 2

  return createPortal(
    <div
      className={
        'rw' + (hit ? ' hit' : '') + (many ? ' many' : '') + (finished ? ' done' : '') + (leaving ? ' out' : '')
      }
      style={{ '--rw-tone': tone } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => {
        if (!finished) {
          setShown(cards.length)
          setHit(true)
          setFinished(true)
        } else done()
      }}
    >
      {hit ? <span className="rw-flash" aria-hidden="true" /> : null}
      {hit && !reduced ? <Confetti /> : null}

      <div className="rw-stage">
        <Rays />
        <div className="rw-cards">
          {cards.slice(0, shown).map((it, i) => {
            const off = i - mid
            const st = {
              '--rw-rot': (many ? off * 6 : 0) + 'deg',
              '--rw-lift': (many ? Math.abs(off) * 12 : 0) + 'px',
              '--rw-it': itemTone(it) || tone,
              '--rw-i': i,
            } as CSSProperties
            return (
              <span key={i} className="rw-card" style={st} title={it.name}>
                <span className="rw-card-pop">
                  <span className="rw-card-bob">
                    <Plate>
                      <span className="rw-card-flash" />
                      <span className="rw-card-art">
                        <Art it={it} size={many ? 96 : 176} />
                      </span>
                      {many ? <b className="rw-card-name">{it.name}</b> : null}
                      {many && extra > 0 && i === cards.length - 1 ? <b className="rw-card-more">+{extra}</b> : null}
                    </Plate>
                  </span>
                </span>
                {!many ? <Twinkles /> : null}
              </span>
            )
          })}
        </div>
        {hit && !reduced ? <Burst n={34} spread={many ? 380 : 300} /> : null}
      </div>

      {finished ? (
        <div className="rw-text">
          {kicker ? <span className="rw-kicker">{kicker}</span> : null}
          <b className="rw-title">{title}</b>
          {sub ? <span className="rw-sub">{sub}</span> : null}
        </div>
      ) : null}
      {finished ? (
        <div className="rw-acts" onClick={(e) => e.stopPropagation()}>
          {r.onWear ? (
            <button className="btn md secondary" onClick={wear}>
              <Icon id="i-shirt" />
              {r.wearLabel || 'Надеть'}
            </button>
          ) : null}
          <button className="btn md primary" autoFocus onClick={done}>
            {r.doneLabel || 'Круто'}
          </button>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

/* ─────────────────────────── Средний ─────────────────────────── */

function MidCard({ r, onClose }: { r: RewardShown; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const reduced = useMemo(reducedMotion, [])
  const one: RewardEntry = r.items[0] || { name: r.title || '', icon: 'check' }
  const tone = rewardTone(r)
  const done = () => {
    setLeaving(true)
    window.setTimeout(onClose, reduced ? 0 : 160)
  }
  useEffect(() => {
    playSound('success')
    const id = window.setTimeout(done, MID_MS)
    return () => window.clearTimeout(id)
  }, [])
  const title = r.title ?? one.name
  const sub = r.sub ?? rarityWord(one)
  return createPortal(
    <div
      className={'rw-mid' + (leaving ? ' out' : '')}
      style={{ '--rw-tone': tone } as CSSProperties}
      role="status"
      onClick={done}
    >
      <Plate className="rw-mid-frame">
        <span className="rw-card-flash" />
        <span className="rw-mid-art">
          <Rays className="sm" />
          <Art it={one} size={60} />
        </span>
        <span className="rw-mid-text">
          {r.kicker ? <span className="rw-kicker">{r.kicker}</span> : null}
          <b>{title}</b>
          {sub ? <small>{sub}</small> : null}
        </span>
        {r.onWear ? (
          <button
            className="btn sm primary"
            onClick={(e) => {
              e.stopPropagation()
              r.onWear?.()
              done()
            }}
          >
            {r.wearLabel || 'Открыть'}
          </button>
        ) : null}
      </Plate>
      {!reduced ? <Burst n={18} spread={110} seed={3} /> : null}
    </div>,
    document.body,
  )
}

/* ─────────────────────────── Малый ─────────────────────────── */

function SmallToast({ r, onClose }: { r: RewardShown; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false)
  const reduced = useMemo(reducedMotion, [])
  const one: RewardEntry = r.items[0] || { name: r.title || '', icon: 'check' }
  const done = () => {
    setLeaving(true)
    window.setTimeout(onClose, reduced ? 0 : 160)
  }
  useEffect(() => {
    playSound('success')
    const id = window.setTimeout(done, SMALL_MS)
    return () => window.clearTimeout(id)
  }, [])
  return createPortal(
    <div
      className={'rw-small' + (leaving ? ' out' : '')}
      style={{ '--rw-tone': rewardTone(r) } as CSSProperties}
      role="status"
      onClick={done}
    >
      <Plate className="rw-small-frame">
        <span className="rw-small-art">
          <Art it={one} size={30} />
        </span>
        <span className="rw-small-text">
          <b>{r.title ?? one.name}</b>
          {r.sub ? <small>{r.sub}</small> : null}
        </span>
      </Plate>
      {!reduced ? <Burst n={12} spread={60} seed={5} /> : null}
    </div>,
    document.body,
  )
}

/** Единственная точка отрисовки наград — стоит в App рядом с тостом. */
export function RewardHost() {
  const big = useReward((s) => s.big[0])
  const mid = useReward((s) => s.mid)
  const small = useReward((s) => s.small)
  const close = useReward((s) => s.close)

  useEffect(() => {
    if (import.meta.env.DEV) void import('./demoReward').then((m) => m.installRewardDemo())
  }, [])

  return (
    <>
      {big ? <BigReveal key={big.id} r={big} onClose={() => close(big.id)} /> : null}
      {mid ? <MidCard key={mid.id} r={mid} onClose={() => close(mid.id)} /> : null}
      {small ? <SmallToast key={small.id} r={small} onClose={() => close(small.id)} /> : null}
    </>
  )
}
