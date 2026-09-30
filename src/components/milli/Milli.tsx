import { memo } from 'react'
import {
  MILLI_ARMS,
  MILLI_BEVEL,
  MILLI_CHEEKS,
  MILLI_DOTS,
  MILLI_EYES,
  MILLI_FRAME,
  MILLI_FRAME_BOX,
  MILLI_GLINT,
  MILLI_GLINT2,
  MILLI_IRIS,
  MILLI_PUPIL,
  MILLI_SPROUT,
  milliLashes,
  MILLI_GLYPH_LIFT,
  MILLI_LEGS,
  MILLI_MOUTH_OPEN,
  MILLI_MOUTH_SHUT,
  MILLI_NOSE,
  MILLI_RIM,
  MILLI_SHADOW_SHIFT,
  MILLI_STEPS,
  MILLI_TILE,
  MILLI_TONGUE,
  milliCut,
  milliGrow,
  milliJoy,
  type MilliArm,
  type MilliBox,
  type MilliMode,
} from './milliMascot'

export type { MilliMode }

/**
 * Милли — персонаж из логотипа Millida: ручки в белых перчатках, ножки в
 * кедах. Покачивается, моргает, машет (`wave`), чешет в затылке (`think`),
 * прыгает от радости (`happy`, прежнее имя `dance`), говорит, пока идёт ответ
 * (`talk`). Всё движение — CSS-ключи на transform и opacity (`.milli-*` в
 * styles/pixel/milli.css), без таймеров в JS: десяток маскотов на странице не
 * держит ни одного setInterval. При reduced-motion стоит.
 *
 * Поле — квадрат `MILLI_FRAME_BOX` (544): тело занимает ~69% ширины, остальное —
 * ручки, кеды и точки «думает». `size` — сторона квадрата.
 */
function Box({ b, className }: { b: MilliBox; className?: string }) {
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} className={className} />
}

const JOY = MILLI_EYES.map(milliJoy)
const VIEW_BOX = `${MILLI_FRAME_BOX.x} ${MILLI_FRAME_BOX.y} ${MILLI_FRAME_BOX.size} ${MILLI_FRAME_BOX.size}`

function Arm({ a, side }: { a: MilliArm; side: 'l' | 'r' }) {
  return (
    <g className={'milli-arm is-' + side}>
      <Box b={a.arm} className="milli-limb" />
      <Box b={{ x: a.arm.x, y: a.arm.y + a.arm.h - 9, w: a.arm.w, h: 9 }} className="milli-limb-sh" />
      <path d={milliCut(milliGrow(a.hand, 6), 14)} className="milli-outline" />
      <Box b={milliGrow(a.thumb, 6)} className="milli-outline" />
      <path d={milliCut(a.hand, 10)} className="milli-glove" />
      <Box b={a.thumb} className="milli-glove" />
      <Box b={{ x: a.hand.x + 6, y: a.hand.y + a.hand.h - 10, w: a.hand.w - 12, h: 10 }} className="milli-glove-sh" />
    </g>
  )
}

export const Milli = memo(function Milli({
  mode = 'idle',
  size = 60,
  className = '',
}: {
  mode?: MilliMode
  size?: number
  className?: string
}) {
  const m = mode === 'dance' ? 'happy' : mode
  return (
    <span className={'milli milli-' + m + (className ? ' ' + className : '')} style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size} height={size} viewBox={VIEW_BOX} shapeRendering="crispEdges" focusable="false">
        <g className="milli-jump">
          <g className="milli-legs">
            {MILLI_LEGS.map((l, i) => (
              <g key={i} className="milli-leg">
                <Box b={l.leg} className="milli-limb" />
                <Box b={{ x: l.leg.x + l.leg.w - 10, y: l.leg.y, w: 10, h: l.leg.h }} className="milli-limb-sh" />
                <path d={milliCut(milliGrow(l.boot, 6), 12)} className="milli-outline" />
                <path d={milliCut(l.boot, 8)} className="milli-glove" />
                <Box b={l.sole} className="milli-boot" />
              </g>
            ))}
          </g>
          <g className="milli-rig">
            <g className="milli-sprout">
              <Box b={milliGrow(MILLI_SPROUT.stem, 4)} className="milli-outline" />
              <path d={milliCut(milliGrow(MILLI_SPROUT.leafR, 4), 8)} className="milli-outline" />
              <path d={milliCut(milliGrow(MILLI_SPROUT.leafL, 4), 8)} className="milli-outline" />
              <Box b={MILLI_SPROUT.stem} className="milli-leaf-dk" />
              <path d={milliCut(MILLI_SPROUT.leafR, 6)} className="milli-leaf" />
              <path d={milliCut(MILLI_SPROUT.leafL, 6)} className="milli-leaf" />
              <Box b={{ x: MILLI_SPROUT.leafR.x + 6, y: MILLI_SPROUT.leafR.y + 12, w: MILLI_SPROUT.leafR.w - 12, h: 8 }} className="milli-leaf-dk" />
              <Box b={{ x: MILLI_SPROUT.leafL.x + 6, y: MILLI_SPROUT.leafL.y + 12, w: MILLI_SPROUT.leafL.w - 12, h: 8 }} className="milli-leaf-dk" />
            </g>
            <Arm a={MILLI_ARMS.l} side="l" />
            <Arm a={MILLI_ARMS.r} side="r" />
            <path d={MILLI_TILE} className="milli-body" />
            <Box b={MILLI_BEVEL.top} className="milli-hi" />
            <Box b={MILLI_BEVEL.left} className="milli-hi2" />
            <Box b={MILLI_BEVEL.right} className="milli-sh" />
            <path d={MILLI_BEVEL.bottom} className="milli-sh2" />
            <path d={MILLI_RIM} fillRule="evenodd" className="milli-rim" />
            <g transform={`translate(0 ${MILLI_GLYPH_LIFT})`}>
              <g transform={`translate(${MILLI_SHADOW_SHIFT} ${MILLI_SHADOW_SHIFT})`} className="milli-gsh">
                <path d={MILLI_FRAME} />
                <path d={MILLI_STEPS} />
                <Box b={MILLI_NOSE} />
              </g>
              <path d={MILLI_FRAME} className="milli-glyph" />
              <path d={MILLI_STEPS} className="milli-glyph" />
              <Box b={MILLI_NOSE} className="milli-glyph" />
              {MILLI_CHEEKS.map((b, i) => (
                <Box key={i} b={b} className="milli-cheek" />
              ))}
              <g className="milli-look">
                {MILLI_EYES.map((b, i) => (
                  <g key={i} className="milli-eye">
                    {milliLashes(b, i === 0 ? -1 : 1).map((l, j) => (
                      <Box key={j} b={l} className="milli-ink" />
                    ))}
                    <Box b={b} className="milli-ink" />
                    <rect x={b.x + MILLI_IRIS.inset} y={b.y + MILLI_IRIS.top} width={b.w - MILLI_IRIS.inset * 2} height={MILLI_IRIS.bottom - MILLI_IRIS.top} className="milli-iris-hi" />
                    <rect x={b.x + MILLI_IRIS.inset} y={b.y + (MILLI_IRIS.top + MILLI_IRIS.bottom) / 2} width={b.w - MILLI_IRIS.inset * 2} height={(MILLI_IRIS.bottom - MILLI_IRIS.top) / 2} className="milli-iris" />
                    <rect x={b.x + MILLI_PUPIL.dx} y={b.y + MILLI_PUPIL.dy} width={MILLI_PUPIL.w} height={MILLI_PUPIL.h} className="milli-ink" />
                    <rect x={b.x + MILLI_GLINT2.dx} y={b.y + MILLI_GLINT2.dy} width={MILLI_GLINT2.size} height={MILLI_GLINT2.size} className="milli-glint" />
                    <rect x={b.x + MILLI_GLINT.dx} y={b.y + MILLI_GLINT.dy} width={MILLI_GLINT.size} height={MILLI_GLINT.size} className="milli-glint" />
                  </g>
                ))}
              </g>
              <g className="milli-joy">
                {JOY.flat().map((b, i) => (
                  <Box key={i} b={b} className="milli-ink" />
                ))}
              </g>
              <Box b={MILLI_MOUTH_SHUT} className="milli-ink milli-shut" />
              <g className="milli-open">
                <Box b={MILLI_MOUTH_OPEN} className="milli-ink" />
                <Box b={MILLI_TONGUE} className="milli-tongue" />
              </g>
            </g>
          </g>
        </g>
        {m === 'think' ? (
          <g className="milli-dots">
            {MILLI_DOTS.map((b, i) => (
              <Box key={i} b={b} />
            ))}
          </g>
        ) : null}
      </svg>
    </span>
  )
})
