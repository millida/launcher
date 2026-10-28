import { memo, useEffect, useRef, useState } from 'react'
import '../../styles/pixel/milli-events.css'
import { milliCue, milliLean } from './Milli'
import { milliPixels, milliPixelSize } from './milliMascot'
import {
  MILLI_EVENTS,
  MILLI_EVENT_TYPING_GAP,
  milliEventDelay,
  milliPickEvent,
  type MilliEventDef,
  type MilliEventKind,
} from './milliEventData'

/**
 * Случайные события в пустой сцене (04.10.2026): мимо пролетает что-то из
 * Minecraft — Милли следит глазами, тянется и говорит «ух ты!». Первое — через
 * 2,5–4 с после открытия, дальше раз в 40–90 с; не во время ввода и ожидания
 * ответа, не два одинаковых подряд, изредка — особое (дракон Края). Слой
 * растягивается на родителя (сцену) и не ловит мышь. Невидим (панель закрыта,
 * окно свёрнуто) — событий нет; reduced-motion — выключено.
 *
 * `milliEvent(kind?)` — сыграть событие сейчас (для отладки и особых моментов).
 */

const triggers = new Set<(k?: MilliEventKind) => void>()
export function milliEvent(kind?: MilliEventKind): void {
  for (const t of triggers) t(kind)
}

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Искры фейерверка за элитрами, перья курицы, искры дракона: [x, y] в px от спрайта. */
const BITS: Partial<Record<MilliEventKind, readonly (readonly [number, number])[]>> = {
  elytra: [
    [-6, 8],
    [-14, 6],
    [-22, 10],
    [-31, 7],
    [-40, 9],
    [-50, 6],
  ],
  chicken: [
    [-4, -4],
    [26, 2],
    [8, -8],
    [28, 14],
  ],
  dragon: [
    [20, 30],
    [44, 32],
    [58, 28],
  ],
}

const Sprite = memo(function Sprite({ def, kind }: { def: MilliEventDef; kind: MilliEventKind }) {
  const { w, h } = milliPixelSize(def.frames[0] ?? [])
  const W = w * def.px
  const H = h * def.px
  return (
    <div className={'mev-s' + (def.frames.length > 1 && kind !== 'pearl' && kind !== 'creeper' ? ' mev-flap' : '')} style={{ width: W, height: H, marginLeft: -W / 2, marginTop: -H / 2 }}>
      {def.frames.map((rows, i) => (
        <svg key={i} className={'mev-f' + (i + 1)} width={W} height={H} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges">
          {Object.entries(milliPixels(rows, 1)).map(([ch, d]) => (
            <path key={ch} d={d} fill={def.palette[ch]} />
          ))}
        </svg>
      ))}
      {(BITS[kind] ?? []).map(([x, y], i) => (
        <i key={i} style={{ left: x, top: y, animationDelay: i * 0.06 + 's' }} />
      ))}
    </div>
  )
})

export const MilliEvents = memo(function MilliEvents({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ev, setEv] = useState<{ kind: MilliEventKind; n: number } | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const typedAt = useRef(0)
  const off = reduced()

  // Расписание: один таймер; не время — откладываем на 5 с.
  useEffect(() => {
    if (off) return
    let prev: MilliEventKind | null = null
    let n = 0
    let t: ReturnType<typeof setTimeout> | undefined
    let first = true
    const onKey = () => {
      typedAt.current = Date.now()
    }
    document.addEventListener('keydown', onKey, true)
    const shown = () => {
      const el = ref.current
      return !!el && !document.hidden && el.getBoundingClientRect().width > 0
    }
    const start = (kind?: MilliEventKind) => {
      const k = kind ?? milliPickEvent(prev, Math.random(), Math.random())
      prev = k
      setEv({ kind: k, n: ++n })
    }
    const go = () => {
      const busy = !activeRef.current || !shown() || Date.now() - typedAt.current < MILLI_EVENT_TYPING_GAP
      if (busy) {
        t = setTimeout(go, 5000)
        return
      }
      start()
      first = false
      t = setTimeout(go, milliEventDelay(false, Math.random()))
    }
    t = setTimeout(go, milliEventDelay(first, Math.random()))
    const manual = (k?: MilliEventKind) => {
      if (shown()) start(k)
    }
    triggers.add(manual)
    return () => {
      clearTimeout(t)
      triggers.delete(manual)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [off])

  // Само событие: взгляд и наклон следят за спрайтом, в нужный миг — «ух ты!».
  useEffect(() => {
    if (!ev) return
    const def = MILLI_EVENTS[ev.kind]
    const layer = ref.current
    const sprite = () => layer?.querySelector('.mev-s') ?? null
    const follow = setInterval(() => milliLean(sprite()), 120)
    milliLean(sprite())
    const wow = setTimeout(() => milliCue('wow', layer?.parentElement ?? undefined), def.ms * def.wow)
    const end = setTimeout(() => setEv(null), def.ms + 60)
    return () => {
      clearInterval(follow)
      clearTimeout(wow)
      clearTimeout(end)
      milliLean(null)
    }
  }, [ev])

  if (off) return null
  const def = ev ? MILLI_EVENTS[ev.kind] : null
  return (
    <div ref={ref} className="mev" aria-hidden="true">
      {ev && def ? (
        <div key={ev.n} className={'mev-ev mev-' + ev.kind}>
          <div className="mev-x">
            <div className="mev-y">
              <Sprite def={def} kind={ev.kind} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})
