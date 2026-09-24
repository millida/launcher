import type { ReactElement } from 'react'
import { Icon } from '../Icon'
import { fmtN } from '../../lib/format'
import { blockArt } from './data'

/**
 * Баннер OneBlock — первая карточка «Режимов», на две колонки (приказ
 * владельца 23.09.2026). Сервер партнёрский: баннер нигде не говорит, чей он.
 *
 * Картинка собрана кодом, без чужих артов и нейросети: пиксельное небо
 * полосами, облака из квадратов, один травяной блок в изометрии (SVG, чёткий
 * на любом экране) и блоки Millida, «выпадающие» из него, — сама механика
 * режима: ломаешь один блок, он даёт следующий. Рендеры блоков — 64px, не
 * крупнее: исходники 96px и на Retina крупнее мылятся.
 */

/** 8×8 текстура грани: травяной верх и земляной бок с зелёной кромкой. */
const GRASS = ['#5fa83a', '#6fbf45', '#4f9530', '#7ccb52']
const DIRT = ['#8a5a36', '#7a4e2d', '#9b6a42', '#6b4426']

function noise(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453
  return v - Math.floor(v)
}

function Face({ matrix, side, shade, seed }: { matrix: string; side: boolean; shade: number; seed: number }) {
  const px: ReactElement[] = []
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      // Бок: верхние два ряда трава, третий — рваная кромка, ниже земля.
      const grass = !side || y < 2 || (y === 2 && noise(x, y, seed) > 0.5)
      const pal = grass ? GRASS : DIRT
      px.push(
        <rect key={x + '-' + y} x={x} y={y} width="1.02" height="1.02" fill={pal[Math.floor(noise(x, y, seed) * pal.length)]} />,
      )
    }
  return (
    <g transform={matrix}>
      {px}
      {shade ? <rect width="8" height="8" fill="#000" opacity={shade} /> : null}
    </g>
  )
}

/** Изометрический травяной блок: вершина в (cx, top), ребро s. */
function GrassBlock({ cx, top, s }: { cx: number; top: number; s: number }) {
  const w = s * 0.866
  const k = 1 / 8
  const Lx = cx - w
  const Ly = top + s / 2
  const Bx = cx
  const By = top + s
  const Rx = cx + w
  const Ry = top + s / 2
  const m = (a: number, b: number, c: number, d: number, e: number, f: number) =>
    'matrix(' + [a * k, b * k, c * k, d * k, e, f].join(' ') + ')'
  return (
    <g shapeRendering="crispEdges">
      <Face matrix={m(Rx - cx, Ry - top, Lx - cx, Ly - top, cx, top)} side={false} shade={0} seed={1} />
      <Face matrix={m(Bx - Lx, By - Ly, 0, s, Lx, Ly)} side shade={0.18} seed={2} />
      <Face matrix={m(Rx - Bx, Ry - By, 0, s, Bx, By)} side shade={0.34} seed={3} />
    </g>
  )
}

/** Облако из квадратов: пиксельное, без размытия. */
function Cloud({ x, y, u }: { x: number; y: number; u: number }) {
  return (
    <g fill="#fff" opacity="0.9" shapeRendering="crispEdges">
      <rect x={x + u} y={y} width={u * 3} height={u} />
      <rect x={x} y={y + u} width={u * 6} height={u} />
      <rect x={x + u * 2} y={y - u} width={u * 2} height={u} opacity="0.8" />
    </g>
  )
}

export function OneBlockBanner({ online, onPlay }: { online: number | null; onPlay: () => void }) {
  return (
    <div className="ph-ob" role="group" aria-label="OneBlock">
      <svg className="ph-ob-sky" viewBox="0 0 720 300" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
        {/* Небо полосами: пиксельный переход без градиента. */}
        <rect width="720" height="300" fill="#5ab4f0" />
        <rect y="90" width="720" height="210" fill="#6cc0f4" />
        <rect y="170" width="720" height="130" fill="#80cbf6" />
        <rect y="235" width="720" height="65" fill="#97d6f8" />
        <Cloud x={60} y={40} u={14} />
        <Cloud x={330} y={70} u={10} />
        <Cloud x={600} y={30} u={12} />
        <Cloud x={200} y={220} u={8} />
        <GrassBlock cx={520} top={62} s={88} />
        {/* Тень-осколки под блоком: остров висит в воздухе. */}
        <g fill="#6b4426" shapeRendering="crispEdges">
          <rect x="504" y="244" width="12" height="12" />
          <rect x="528" y="254" width="8" height="8" opacity="0.8" />
        </g>
      </svg>
      <span className="ph-ob-drops" aria-hidden="true">
        <img className="d1" src={blockArt(33)} alt="" draggable={false} />
        <img className="d2" src={blockArt(15)} alt="" draggable={false} />
        <img className="d3" src={blockArt(3)} alt="" draggable={false} />
      </span>
      <span className="ph-ob-body">
        <b className="ph-ob-name">OneBlock</b>
        {online && online >= 20 ? (
          <span className="ph-ob-online">
            <span className="ph-dot" aria-hidden="true"></span>
            {fmtN(online)} играют
          </span>
        ) : null}
        <button className="btn lg primary ph-ob-cta" data-sound="open" onClick={onPlay}>
          <Icon id="i-play" /> Играть
        </button>
      </span>
    </div>
  )
}
