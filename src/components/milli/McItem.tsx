import { memo } from 'react'
import { MC_ITEMS, type McItemName } from './milliItems'

/**
 * Предмет Minecraft 16×16 (рисунки — milliItems.ts). `crispEdges` и целый
 * масштаб: при 32px клетка — ровно 2×2. Огонёк и блеск — отдельные группы,
 * их анимирует milli.css (только opacity, steps()).
 */
export const McItem = memo(function McItem({ name, size = 32, className }: { name: McItemName; size?: number; className?: string }) {
  const art = MC_ITEMS[name]
  return (
    <svg
      className={'mci mci-' + name + (className ? ' ' + className : '')}
      width={size}
      height={size}
      viewBox={'0 0 ' + art.size + ' ' + art.size}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {art.px.map((p, i) => (
        <rect key={i} x={p.x} y={p.y} width={p.w} height={1} fill={p.c} />
      ))}
      {art.glow ? (
        <g className="mci-glow">
          {art.glow.map((p, i) => (
            <rect key={i} x={p.x} y={p.y} width={p.w} height={1} fill={p.c} />
          ))}
        </g>
      ) : null}
      {art.glint ? (
        <g className="mci-glint">
          {art.glint.map((g, i) => (
            // fill/opacity атрибутами: без правила из milli.css (или до его загрузки) SVG красит rect
            // чёрным по умолчанию — книга превращалась в чёрный квадрат. CSS их перекрывает.
            <rect key={i} x={g.x} y={g.y} width={g.w} height={1} fill="#b46bff" opacity={0} className={'mci-g' + g.band} />
          ))}
        </g>
      ) : null}
    </svg>
  )
})

/** Ячейка инвентаря: тёмная, с вдавленной фаской, как слот в игре; предмет внутри. */
export function McSlot({ name, size = 32, className }: { name: McItemName; size?: number; className?: string }) {
  return (
    <span className={'mcs' + (className ? ' ' + className : '')} aria-hidden="true">
      <McItem name={name} size={size} />
    </span>
  )
}
