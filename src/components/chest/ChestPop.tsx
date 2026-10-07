import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ItemRef } from '../../lib/rubies'
import { PxThumb } from '../shop/Sets'
import { toneStyle } from '../shop/parts'
import { RarityChip } from '../shop/rarityUi'
import { useVariantPreview } from '../../lib/variantArt'
import { artFit } from '../../lib/artFit'
import { Ruby } from '../Ruby'
import { Shard } from '../shop/parts'
import { shardWord } from '../shop/rarity'
import '../../styles/pixel/chest.css'

/** Перемешанный мешок: вещи идут по одной, без повторов, пока пул не кончится. */
export function bagOrder(n: number, random: () => number = Math.random): number[] {
  const out = Array.from({ length: n }, (_, i) => i)
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Превью вещи, увеличенное по её непрозрачной части (artFit): ~80% плашки. */
function FitThumb({ item }: { item: ItemRef }) {
  const src = useVariantPreview(item.preview, item.tintFrom, item.tintFrom ? item.color : null)
  const [zoom, setZoom] = useState('')
  const [cors, setCors] = useState(true)
  if (!src) return <PxThumb item={item} />
  // Без CORS (картинка уже в кэше без заголовка) — та же картинка без подгонки, а не битая.
  return (
    <span className="px-thumb">
      <img
        key={cors ? 'c' : 'n'}
        src={src}
        alt=""
        draggable={false}
        crossOrigin={cors && !src.startsWith('data:') ? 'anonymous' : undefined}
        style={zoom ? { transform: zoom } : undefined}
        onLoad={(e) => cors && setZoom(artFit(e.currentTarget))}
        onError={() => setCors(false)}
      />
    </span>
  )
}

/** Сколько живёт одна выскочившая вещь (мс) — совпадает с анимацией cpop-fly. */
const LIFE_MS = 1250

/** Кучка валюты, которая тоже выпадает из ящика: «+80 ◆», «+40 осколков». */
export interface PopCoin {
  kind: 'rubies' | 'shards'
  amount: number
}

type Pop = { n: number; side: number } & ({ item: ItemRef; coin?: undefined } | { coin: PopCoin; item?: undefined })

/** Порядок вылетов: каждая третья — валюта (если она есть в ящике), остальные — вещи мешком. */
export function popKind(n: number, coins: number, items: number): 'coin' | 'item' {
  if (!coins) return 'item'
  if (!items) return 'coin'
  return n % 3 === 0 ? 'coin' : 'item'
}

/**
 * «Что выпадает» без слов (06.10.2026): вещи пула вылетают из сундука одна
 * за другой (по умолчанию раз в 1,3 с — в полёте всегда одна, они не наезжают друг на друга), каждый раз другая, без повторов, пока
 * пул не пройден. Вещь — на плашке цвета редкости со словом редкости, крупно
 * (около 70% ширины сундука): взлёт с дугой и поворотом, свечение и искры,
 * зависание, падение с исчезновением. Крышка подпрыгивает. Только transform и
 * opacity; стоит вне экрана и при prefers-reduced-motion. `silhouette` — вещь
 * ещё не известна: тёмный силуэт без плашки.
 */
export function ChestPop({
  items,
  coins = [],
  every = 1300,
  delay = 0,
  silhouette,
  className = '',
  children,
}: {
  items: ItemRef[]
  coins?: PopCoin[]
  every?: number
  delay?: number
  silhouette?: boolean
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const chest = useRef<HTMLSpanElement>(null)
  const [seen, setSeen] = useState(false)
  const [pops, setPops] = useState<Pop[]>([])
  const list = useRef(items)
  list.current = items
  const cash = useRef(coins)
  cash.current = coins
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver((es) => setSeen(es.some((e) => e.isIntersecting)))
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!seen || (!items.length && !coins.length)) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let n = 0
    let c = 0
    let bag: number[] = []
    let timer = 0
    const next = () => {
      const pool = list.current
      const money = cash.current
      if (pool.length || money.length) {
        const at = ++n
        const side = at % 2 ? 1 : -1
        let pop: Pop
        if (popKind(at, money.length, pool.length) === 'coin') pop = { n: at, side, coin: money[c++ % money.length]! }
        else {
          if (!bag.length) bag = bagOrder(pool.length)
          pop = { n: at, side, item: pool[bag.pop()! % pool.length]! }
        }
        // Влево и вправо по очереди — дуга полёта разная у соседних вещей.
        setPops((was) => [...was.filter((p) => at - p.n < Math.ceil(LIFE_MS / every) + 1), pop])
        // Крышка подбрасывает вещь: короткое сжатие и отскок, плавно.
        chest.current?.animate?.(
          [{ transform: 'none' }, { transform: 'translateY(3px) scale(1.04, 0.95)', offset: 0.3 }, { transform: 'translateY(-5px) scale(0.98, 1.03)', offset: 0.6 }, { transform: 'none' }],
          { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        )
      }
      timer = window.setTimeout(next, every)
    }
    timer = window.setTimeout(next, delay + 300)
    return () => {
      window.clearTimeout(timer)
      setPops([])
    }
  }, [seen, items.length > 0, coins.length > 0, every, delay])
  return (
    <span ref={ref} className={'cpop ' + className}>
      <span className="cpop-chest" ref={chest}>
        {children}
      </span>
      {pops.map((p) => (
        <span
          key={p.n}
          className={'cpop-item' + (silhouette && p.item ? ' is-shadow' : '') + (p.coin ? ' is-coin k-' + p.coin.kind : '')}
          style={{ ...(p.item ? toneStyle(p.item) : { ['--sh-tone' as string]: p.coin!.kind === 'rubies' ? 'var(--m-ruby, #e8364f)' : '#36b3ff' }), ['--side' as string]: p.side }}
          aria-hidden="true"
        >
          <i className="cpop-glow" />
          {p.item ? (
            <span className="cpop-plate">
              <FitThumb item={p.item} />
              {silhouette ? null : <RarityChip rarity={p.item.rarity} />}
            </span>
          ) : (
            <span className="cpop-plate cpop-coin">
              {p.coin!.kind === 'rubies' ? <Ruby size={56} /> : <Shard size={56} />}
              <b className="cpop-sum">+{p.coin!.amount.toLocaleString('ru-RU')}</b>
              {p.coin!.kind === 'shards' ? <small className="cpop-word">{shardWord(p.coin!.amount)}</small> : null}
            </span>
          )}
          <i className="cpop-spark s1" />
          <i className="cpop-spark s2" />
          <i className="cpop-spark s3" />
          <i className="cpop-spark s4" />
        </span>
      ))}
    </span>
  )
}
