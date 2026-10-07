import { ShotImg } from './LoopShot'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LobbyCharacter } from '../lobby/LobbyCharacter'
import { loadWardrobe } from '../../lib/gameProfile'
import { nickSkinUrl } from '../../lib/characterStage'
import { outfitShot, shotAspect, type OutfitShot } from '../../lib/outfitSnapshot'
import { getAccount } from '../../state/accounts'
import { useHasMillida } from '../../state/auth'
import type { ItemRef } from '../../lib/rubies'
import { PxThumb } from './Sets'
import { toneStyle } from './parts'
import { rarityRank } from './rarity'

/**
 * Набор «на тебе» (магазин v3, 06.10.2026).
 *
 * ShopStage — живая 3D-сцена лобби (LobbyCharacter в режиме `shop`): вещи
 * набора поверх скина самого игрока, крутится мышью. SetShot — снимок той же
 * фигуры для карточек: один невидимый движок рендерит набор в PNG
 * (lib/outfitSnapshot). Не вышло 3D (модели не пришли, нет WebGL) — вместо
 * голого персонажа плоские превью вещей.
 */

/** Скин игрока: из гардероба, иначе по нику. */
let skinAsked: Promise<{ url: string; slim: boolean } | null> | null = null
export function usePlayerSkin(): { url: string; slim: boolean } | null {
  const signed = useHasMillida()
  const [skin, setSkin] = useState<{ url: string; slim: boolean } | null>(null)
  useEffect(() => {
    let alive = true
    if (!skinAsked)
      skinAsked = loadWardrobe()
        .then((w) => (w.active.skinUrl ? { url: w.active.skinUrl, slim: w.active.model === 'slim' } : null))
        .catch(() => null)
    void skinAsked.then((r) => {
      if (!alive) return
      setSkin(r ?? { url: nickSkinUrl((getAccount() || { nick: '' }).nick || 'MHF_Steve'), slim: false })
    })
    return () => {
      alive = false
    }
  }, [signed])
  return skin
}

/** Главные вещи набора для запасной картинки: самые редкие, до четырёх. */
const lead = (items: ItemRef[], n: number) => [...items].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity)).slice(0, n)

/** Запасная картинка: плоские превью вещей ровной сеткой. */
export function ItemsFallback({ items }: { items: ItemRef[] }) {
  const shown = lead(items, 4)
  return (
    <span className={'sv-fb n' + shown.length} aria-hidden="true">
      {shown.map((it) => (
        <span key={it.code} className="sv-fb-i" style={toneStyle(it)}>
          <PxThumb item={it} />
        </span>
      ))}
    </span>
  )
}

/** Где у фигуры ноги (доля высоты кадра): кадр живой сцены и снимка — в lobbyShopFrame / outfitSnapshot. */
export const STAGE_FEET = 0.86
export const SHOT_FEET = 0.82

const SPARKS: [number, number, number][] = [
  [12, 18, 6], [22, 52, 4], [80, 14, 6], [88, 44, 4], [70, 30, 4], [30, 30, 4], [8, 70, 4], [93, 72, 6], [60, 8, 4],
]

/**
 * Задник сцены как у лобби: цвет темы набора, лучи и свет за фигурой, пол и
 * пиксельный подиум под ногами, редкие пиксели-искры. Свет — только в сцене
 * (docs/DESIGN-JUICE.md), UI вокруг остаётся плотным.
 */
export function SceneBack({ feet }: { feet: number }) {
  return (
    <span className="sv-scene" style={{ ['--feet' as string]: feet * 100 + '%' }} aria-hidden="true">
      <i className="sv-rays" />
      <i className="sv-glow" />
      {SPARKS.map(([x, y, s], i) => (
        <i key={i} className="sv-spark" style={{ left: x + '%', top: y + '%', width: s, height: s }} />
      ))}
    </span>
  )
}

/** Живая сцена набора. Засыпает, пока её не видно. */
export function ShopStage({ on, items, className = '' }: { on: boolean; items: ItemRef[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [vis, setVis] = useState(true)
  const [dressed, setDressed] = useState<{ key: string; n: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setVis(es.some((e) => e.isIntersecting)), { rootMargin: '160px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const key = items.map((it) => it.code).join(',')
  const dress = useMemo(() => items.map((it) => ({ code: it.code })), [key])
  const failed = !!items.length && dressed?.key === key && dressed.n === 0
  return (
    <div ref={ref} className={'sv-stage ' + className + (failed ? ' is-flat' : '')}>
      <SceneBack feet={STAGE_FEET} />
      <LobbyCharacter on={on && vis} shop dress={dress} onDressed={(n) => setDressed({ key, n })} />
      {failed ? <ItemsFallback items={items} /> : null}
    </div>
  )
}

/** Снимок «ты в наборе» для карточки: скелетон, пока движок до неё не дошёл. */
export function SetShot({ items }: { items: ItemRef[] }) {
  const skin = usePlayerSkin()
  const ref = useRef<HTMLSpanElement>(null)
  const [near, setNear] = useState(false)
  const [shot, setShot] = useState<OutfitShot | null | undefined>(undefined)
  const codes = items.map((it) => it.code)
  const key = codes.join(',')
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return setNear(true)
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '60px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!skin || !near) return
    let alive = true
    setShot(undefined)
    const box = ref.current?.getBoundingClientRect()
    void outfitShot(skin.url, skin.slim, codes, 'full', shotAspect(box?.width ?? 0, box?.height ?? 0), ref.current).then((r) => alive && setShot(r))
    return () => {
      alive = false
    }
  }, [skin?.url, skin?.slim, near, key])
  const flat = shot === null || (shot && shot.dressed === 0)
  return (
    <span ref={ref} className="sv-shot" aria-hidden="true">
      <SceneBack feet={SHOT_FEET} />
      {/* Пока 3D-снимок рендерится — плоские превью вещей, а не пустая плитка. */}
      {shot === undefined || flat ? <ItemsFallback items={items} /> : <ShotImg shot={shot!} />}
    </span>
  )
}
