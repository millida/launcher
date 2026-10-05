import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ChestTier } from '../../lib/rubies'
import { ChestArt } from './ChestArt'
import { Chest3D } from './Chest3D'
import { gpuLite } from '../../lib/gpuLite'
import type { ChestLook } from './chestScene'

/** Сколько 3D-сундуков живёт одновременно; остальные — плоский рисунок. */
const MAX_LIVE = 6
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
  look,
}: {
  ready: boolean
  size: number
  opening?: boolean
  tier?: ChestTier
  look?: ChestLook
}) {
  const box = useRef<HTMLSpanElement>(null)
  const id = useRef(Symbol('chest')).current
  const [seen, setSeen] = useState(false)
  const [, bump] = useState(0)
  const [on, setOn] = useState(false)

  useEffect(() => {
    const el = box.current
    if (!el || gpuLite() || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setSeen(es.some((e) => e.isIntersecting)), { rootMargin: '40px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const tryTake = () => {
      if (seen && !live.has(id) && live.size < MAX_LIVE) live.add(id)
      setOn(seen && live.has(id))
      bump((n) => n + 1)
    }
    if (!seen) {
      release(id)
      setOn(false)
      return
    }
    tryTake()
    waiting.add(tryTake)
    return () => {
      waiting.delete(tryTake)
      release(id)
    }
  }, [seen, id])

  const k = Math.round(size * 1.5)
  return (
    <span ref={box} className="cl" style={{ '--cl-size': size + 'px', '--cl-k': k + 'px' } as CSSProperties} aria-hidden="true">
      {on ? (
        <Chest3D className="cl-3d" tier={tier} mode={ready || opening ? 'ready' : 'closed'} flatSize={size} look={look} />
      ) : (
        <ChestArt ready={ready} opening={opening} tier={tier} size={size} />
      )}
    </span>
  )
}
