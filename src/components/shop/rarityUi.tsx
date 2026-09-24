import type { CSSProperties } from 'react'
import type { Rarity } from '../../lib/rubies'
import { RARITY_SHORT, RARITY_TONE, normRarity } from './rarity'
import '../../styles/pixel/rarity.css'

/*
 * Кирпичики единой системы редкости (модель предметов v2, 24.09.2026):
 * слой эффекта, плашка, значок фрагмента и полоса «7/20». Стили — rarity.css.
 */

/** Слой эффекта редкости: кладётся прямым потомком корня с data-rar (rarityProps). */
export function RarityFx() {
  return (
    <i className="rar-fx" aria-hidden="true">
      <i className="rar-bar" />
      <i className="rar-rv l" />
      <i className="rar-rv r" />
      <i className="rar-sp s1" />
      <i className="rar-sp s2" />
      <i className="rar-sp s3" />
      <i className="rar-gl" />
    </i>
  )
}

/** Плашка «ЭПИЧЕСКАЯ»: квадрат цвета + слово. Легендарная и мифическая — плотной заливкой. */
export function RarityPlate({ rarity, small }: { rarity?: string | null; small?: boolean }) {
  const r = normRarity(rarity)
  if (!r) return null
  return (
    <span className={'rar-plate' + (small ? ' sm' : '')} data-rar={r} style={{ ['--rar' as string]: RARITY_TONE[r] } as CSSProperties}>
      {RARITY_SHORT[r]}
    </span>
  )
}

/*
 * Фрагмент — кусочек пазла цвета редкости вещи. Осколок (Shard) — голубой
 * кристалл-валюта. Разные предметы — разные силуэты: фрагмент принадлежит
 * одной вещи, осколок — кошельку. Сетка 12×12, тёмный контур в клетку
 * достраивается сам (как в pxArt), блик — белым.
 */
const FRAG_ART = [
  '....##......',
  '...####.....',
  '.########...',
  '.#hhh####...',
  '.#h#######..',
  '..########..',
  '..#########.',
  '.#########..',
  '.########...',
  '.#######dd..',
  '.dddddddd...',
  '............',
]
const cells = (ch: string) => {
  const out: [number, number][] = []
  FRAG_ART.forEach((row, y) => [...row].forEach((c, x) => ch.includes(c) && out.push([x, y])))
  return out
}
const FILL = cells('#hd')
const FILLED = new Set(FILL.map(([x, y]) => x + ':' + y))
const OUTLINE = (() => {
  const seen = new Set<string>()
  const out: [number, number][] = []
  for (const [x, y] of FILL)
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const k = x + dx + ':' + (y + dy)
      if (!FILLED.has(k) && !seen.has(k)) {
        seen.add(k)
        out.push([x + dx, y + dy])
      }
    }
  return out
})()
const HI = cells('h')
const SH = cells('d')

export function FragmentIcon({ rarity, size = 16 }: { rarity?: Rarity | string | null; size?: number }) {
  const r = normRarity(rarity as string)
  const tone = r ? RARITY_TONE[r] : 'var(--m-rarity-rare)'
  return (
    <svg className="rar-frag" width={size} height={size} viewBox="-1 -1 14 14" aria-hidden="true" shapeRendering="crispEdges">
      {OUTLINE.map(([x, y]) => (
        <rect key={'o' + x + ':' + y} x={x} y={y} width={1} height={1} fill="#101418" />
      ))}
      {FILL.map(([x, y]) => (
        <rect key={'f' + x + ':' + y} x={x} y={y} width={1} height={1} fill={tone} />
      ))}
      {SH.map(([x, y]) => (
        <rect key={'s' + x + ':' + y} x={x} y={y} width={1} height={1} fill="rgba(0,0,0,.32)" />
      ))}
      {HI.map(([x, y]) => (
        <rect key={'h' + x + ':' + y} x={x} y={y} width={1} height={1} fill="rgba(255,255,255,.7)" />
      ))}
    </svg>
  )
}

/**
 * Прогресс фрагментов вещи: значок, «7/20», полоса с делениями. Собрано —
 * полоса акцентом. `gain` — сколько пришло сейчас (в сундуке): рисуется ярче.
 */
export function FragBar({ have, need, rarity, gain = 0 }: { have: number; need: number; rarity?: string | null; gain?: number }) {
  const r = normRarity(rarity)
  const done = have >= need
  const pct = need > 0 ? Math.min(100, (have / need) * 100) : 0
  const ticks = need > 0 ? Math.min(9, Math.max(1, Math.round(need / 5) - 1)) : 0
  return (
    <span
      className={'rar-fbar' + (done ? ' done' : '')}
      style={r ? ({ ['--rar' as string]: RARITY_TONE[r] } as CSSProperties) : undefined}
      aria-label={'Фрагменты: ' + have + ' из ' + need}
    >
      <FragmentIcon rarity={r} size={14} />
      <b>
        {have}
        <s>/{need}</s>
      </b>
      <span className="rar-fbar-track">
        <i style={{ width: pct + '%' }} />
        {gain > 0 && !done ? (
          <i
            style={{ left: Math.max(0, pct - (gain / need) * 100) + '%', width: (gain / need) * 100 + '%', background: '#fff', opacity: 0.55 }}
          />
        ) : null}
        {Array.from({ length: ticks }, (_, k) => (
          <u key={k} style={{ left: ((k + 1) * 100) / (ticks + 1) + '%' }} />
        ))}
      </span>
    </span>
  )
}
