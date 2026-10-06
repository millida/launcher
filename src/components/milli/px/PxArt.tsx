import { memo } from 'react'
import { PX_GLYPHS, pxSprite, type PxName } from './pxSprites'
import { PX_GLINT_BANDS, PX_GRID, pxGlintRuns, pxRuns } from './pxTypes'

/**
 * Пиксельный предмет 16×16 как встроенный SVG.
 *
 *   <PxArt name="clock" size={32} />
 *
 * Размер лучше брать кратным 16 (16, 32, 48, 64): тогда клетка — ровно N×N
 * пикселей. `crispEdges` не даёт браузеру сглаживать стыки, одинаковые клетки в
 * ряд слиты в один <rect>.
 *
 * Блеск зачарования (`glint` в рисунке) — фиолетовые диагональные полосы на
 * SMIL-анимации прямо в SVG: не зависит от CSS. Цвет и прозрачность заданы
 * атрибутами, поэтому без стилей слой просто невидим, а не чёрный. Выключить
 * блеск — `glint={false}` (или `.px-glint { display: none }` при reduced motion).
 */
export const PxArt = memo(function PxArt({
  name,
  size = 32,
  className,
  title,
  glint = true,
}: {
  /** Имя из PX_ART. Неизвестное имя не роняет панель: рисуется пустое поле того же размера. */
  name: PxName | (string & {})
  size?: number
  className?: string
  title?: string
  glint?: boolean
}) {
  const art = pxSprite(name)
  const shine = art && glint ? pxGlintRuns(art) : []
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${PX_GRID} ${PX_GRID}`}
      shapeRendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {(art ? pxRuns(art) : []).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
      {shine.length ? <Glint runs={shine} /> : null}
    </svg>
  )
})

function Glint({ runs }: { runs: { x: number; y: number; w: number; band: number }[] }) {
  const bands = Array.from({ length: PX_GLINT_BANDS }, (_, b) => runs.filter((r) => r.band === b))
  return (
    <g className="px-glint" fill="#b46bff">
      {bands.map((band, b) =>
        band.length ? (
          <g key={b} opacity={0}>
            <animate
              attributeName="opacity"
              values="0;0;0.2;0.5;0.3;0.12;0"
              dur="2.4s"
              begin={`${-(PX_GLINT_BANDS - b) * 0.3}s`}
              repeatCount="indefinite"
              calcMode="discrete"
            />
            {band.map((r, i) => (
              <rect key={i} x={r.x} y={r.y} width={r.w} height={1} />
            ))}
          </g>
        ) : null,
      )}
    </g>
  )
}

/** Руна зачарования 5×7 (для частиц). Цвет — `fill` родителя (currentColor). */
export const PxGlyph = memo(function PxGlyph({ index, size = 10, className }: { index: number; size?: number; className?: string }) {
  const g = PX_GLYPHS[index % Math.max(1, PX_GLYPHS.length)] ?? []
  return (
    <svg className={className} width={(size * 5) / 7} height={size} viewBox="0 0 5 7" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      <g fill="currentColor">
        {g.flatMap((row, y) =>
          [...row].map((c, x) => (c === '#' ? <rect key={y * 5 + x} x={x} y={y} width={1} height={1} /> : null)),
        )}
      </g>
    </svg>
  )
})

/** Кадры сферы опыта по порядку. */
export const XP_ORB_FRAMES = ['xp_orb_0', 'xp_orb_1', 'xp_orb_2', 'xp_orb_3'] as const satisfies readonly PxName[]

/**
 * Сфера опыта: четыре кадра по кругу (SMIL, ступенчато — как в игре).
 * `delay` в секундах разводит соседние сферы по фазе.
 */
export const PxXpOrb = memo(function PxXpOrb({ size = 16, className, delay = 0 }: { size?: number; className?: string; delay?: number }) {
  const n = XP_ORB_FRAMES.length
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${PX_GRID} ${PX_GRID}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {XP_ORB_FRAMES.map((f, i) => {
        const art = pxSprite(f)
        if (!art) return null
        return (
          <g key={f} opacity={i === 0 ? 1 : 0}>
            <animate
              attributeName="opacity"
              values={XP_ORB_FRAMES.map((_, j) => (j === i ? 1 : 0)).join(';')}
              keyTimes={XP_ORB_FRAMES.map((_, j) => j / n).join(';')}
              dur="0.8s"
              begin={`${-delay}s`}
              repeatCount="indefinite"
              calcMode="discrete"
            />
            {pxRuns(art).map((r, k) => (
              <rect key={k} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
            ))}
          </g>
        )
      })}
    </svg>
  )
})
