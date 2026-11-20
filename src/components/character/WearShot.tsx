import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ShotImg } from '../shop/LoopShot'
import { usePlayerSkin } from '../shop/ShopStage'
import { focusOf, outfitShot, shotAspect, type OutfitShot } from '../../lib/outfitShotLazy'

const FLAT_SLOTS = new Set(['PET', 'SPRAY', 'BANNER', 'ICON'])

export function WearShot({ code, slot, fallback }: { code: string; slot: string; fallback: ReactNode }) {
  const skin = usePlayerSkin()
  const ref = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  const [hover, setHover] = useState(false)
  const [shot, setShot] = useState<OutfitShot | null | undefined>(undefined)
  const flat = FLAT_SLOTS.has(slot)

  useEffect(() => {
    const el = ref.current
    if (flat || !el) return
    if (typeof IntersectionObserver === 'undefined') return setNear(true)
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [flat])

  useEffect(() => {
    const tile = ref.current?.closest('.ch-tile')
    if (!tile) return
    const enter = () => setHover(true)
    const leave = () => setHover(false)
    tile.addEventListener('pointerenter', enter)
    tile.addEventListener('pointerleave', leave)
    return () => {
      tile.removeEventListener('pointerenter', enter)
      tile.removeEventListener('pointerleave', leave)
    }
  }, [])

  useEffect(() => {
    if (flat || !skin || !near) return
    let alive = true
    const box = ref.current?.getBoundingClientRect()
    const show = (r: OutfitShot | null) => alive && setShot(r)
    // The loop strip costs a GPU pass per item, so it is made only for a tile the pointer is on.
    void outfitShot(skin.url, skin.slim, [code], focusOf(slot), shotAspect(box?.width ?? 0, box?.height ?? 0), ref.current, hover ? show : undefined).then(show)
    return () => {
      alive = false
    }
  }, [skin?.url, skin?.slim, near, code, slot, flat, hover])

  return (
    <span ref={ref} className="ch-shot">
      {shot && shot.dressed > 0 ? <ShotImg shot={shot} play={hover} /> : fallback}
    </span>
  )
}
