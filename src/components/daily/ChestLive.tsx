import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ChestTier } from '../../lib/rubies'
import { ChestArt } from './ChestArt'
import { Chest3D } from './Chest3D'
import { gpuLite } from '../../lib/gpuLite'
import { useScreenSettled } from '../../lib/screenSettle'
import type { ChestLook } from './chestScene'
import { onShelfHold, shelfYields } from './chestShelf'

/**
 * How many 3D chests are live at once; the rest are a flat drawing. Every live chest copies its
 * frame out of the shared WebGL canvas on every frame, which holds the main thread on a slow core.
 */
const MAX_LIVE = 4
const live = new Set<symbol>()
const waiting = new Set<() => void>()

function release(id: symbol) {
  if (!live.delete(id)) return
  waiting.forEach((w) => w())
}

/**
 * Сундук для витрины, треков и плашек: 3D-модель из «Рентген-кейса» с цветом
 * и свечением редкости. Холст заводится, только пока сундук на экране и есть
 * свободное место из MAX_LIVE; иначе (и без WebGL) стоит прежний рисунок.
 */
export function ChestLive({
  ready,
  size,
  opening,
  tier = 'COMMON',
  look = 'model',
  tint,
  inScene = false,
}: {
  ready: boolean
  size: number
  opening?: boolean
  tier?: ChestTier
  look?: ChestLook
  /** Свой цвет модели сундука (ящики магазина). */
  tint?: string
  /** Part of the reveal scene itself, not of the shelf behind it: stays 3D during a reveal. */
  inScene?: boolean
}) {
  const box = useRef<HTMLSpanElement>(null)
  const id = useRef(Symbol('chest')).current
  const [seen, setSeen] = useState(false)
  const [, bump] = useState(0)
  const [on, setOn] = useState(false)
  const settled = useScreenSettled()

  useEffect(() => {
    const el = box.current
    if (!el || gpuLite() || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setSeen(es.some((e) => e.isIntersecting)), { rootMargin: '40px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const tryTake = () => {
      // During a reveal the shelf behind it stops drawing. The slot frees silently: the hold notifies everyone anyway.
      if (shelfYields(inScene)) live.delete(id)
      else if (seen && !live.has(id) && live.size < MAX_LIVE) live.add(id)
      setOn(seen && live.has(id))
      bump((n) => n + 1)
    }
    if (!seen || !settled) {
      release(id)
      setOn(false)
      return
    }
    tryTake()
    waiting.add(tryTake)
    const offHold = onShelfHold(tryTake)
    return () => {
      offHold()
      waiting.delete(tryTake)
      release(id)
    }
  }, [seen, settled, id, inScene])

  const k = Math.round(size * 1.5)
  return (
    <span ref={box} className="cl" style={{ '--cl-size': size + 'px', '--cl-k': k + 'px' } as CSSProperties} aria-hidden="true">
      {on ? (
        <Chest3D className="cl-3d" tier={tier} mode={ready || opening ? 'ready' : 'closed'} flatSize={size} look={look} tint={tint} />
      ) : (
        <ChestArt ready={ready} opening={opening} tier={tier} tint={tint} size={size} />
      )}
    </span>
  )
}
