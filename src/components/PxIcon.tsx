import type { CSSProperties } from 'react'
import { pxRects, pxSize, PX_NAMES } from './pxArt'

/**
 * Пиксельный значок. Рисунки — в `pxArt.ts`; здесь только отрисовка.
 *
 *   <PxIcon name="clock" />            — встроенный svg (12×12 клеток)
 *   <Icon id="i-clock" />              — то же через общий спрайт
 *
 * `crispEdges` не даёт браузеру сглаживать стыки клеток. Цвет «c» берётся из
 * `color` родителя — крестик в красной кнопке красный, галочка в зелёной зелёная.
 */
export function PxIcon({
  name,
  size,
  className = 'px-icon',
  style,
  title,
}: {
  name: string
  size?: number
  className?: string
  style?: CSSProperties
  title?: string
}) {
  const { w, h } = pxSize(name)
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox={'0 0 ' + w + ' ' + h}
      shapeRendering="crispEdges"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      <PxBody name={name} />
    </svg>
  )
}

function PxBody({ name }: { name: string }) {
  return (
    <g stroke="none">
      {pxRects(name).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} fillOpacity={r.op} />
      ))}
    </g>
  )
}

/**
 * Символы для спрайта: `#i-<имя>` на каждый рисунок. Общий `Icon` ссылается на
 * них через <use>, поэтому все старые места `Icon id="i-…"` стали пиксельными
 * без правки разметки.
 */
export function PxSymbols() {
  return (
    <>
      {PX_NAMES.map((n) => {
        const { w, h } = pxSize(n)
        return (
          <symbol key={n} id={'i-' + n} viewBox={'0 0 ' + w + ' ' + h} shapeRendering="crispEdges">
            <PxBody name={n} />
          </symbol>
        )
      })}
    </>
  )
}
