import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import '../../styles/pixel/milli-mascot.css'
import '../../styles/pixel/milli-emotions.css'
import {
  MILLI_ARMS,
  MILLI_BANG,
  MILLI_BEVEL,
  MILLI_CHEEKS,
  MILLI_CUE_MS,
  MILLI_CX,
  MILLI_DOTS,
  MILLI_DUST,
  MILLI_EYES,
  MILLI_CROWN_DY,
  MILLI_FRAME,
  MILLI_FRAME_BOX,
  MILLI_GAZE_FRESH,
  MILLI_GLINT,
  MILLI_GLINT2,
  MILLI_GLYPH_LIFT,
  MILLI_GROUND,
  MILLI_HEART,
  MILLI_HEARTS,
  MILLI_IRIS,
  MILLI_LEGS,
  MILLI_NOSE,
  MILLI_NOTE,
  MILLI_NOTES,
  MILLI_PUFF,
  MILLI_PUPIL,
  MILLI_PUPIL_SMALL,
  MILLI_RIM,
  MILLI_SHADOW,
  MILLI_SHADOW_SHIFT,
  MILLI_SHOULDER_Y,
  MILLI_SLEEP_AFTER,
  MILLI_SPARK,
  MILLI_SPARKS,
  MILLI_SPROUT,
  MILLI_STEPS,
  MILLI_TILE,
  MILLI_TOTEM,
  MILLI_Z,
  MILLI_ZZZ,
  milliBlinkPlan,
  milliCut,
  milliEyeArt,
  milliGaze,
  milliGazeOffsets,
  milliGrow,
  milliLashes,
  milliLeanAngle,
  milliLeanStep,
  milliMouth,
  milliPixels,
  milliPixelSize,
  milliPoke,
  milliState,
  type MilliArm,
  type MilliBox,
  type MilliCue,
  type MilliMode,
  type MilliMouth,
  type MilliParticle,
  type MilliState,
  type MilliStep,
} from './milliMascot'
import {
  ART_ARROW,
  ART_BLUSH,
  ART_BRUSH,
  ART_BULB,
  ART_BURST,
  ART_CHEST,
  ART_CHEST_IN,
  ART_CLOCK,
  ART_DISCO,
  ART_GEAR,
  ART_GEM,
  ART_HA,
  ART_HAMMER,
  ART_LENS,
  ART_LID_OPEN,
  ART_LID_SHUT,
  ART_PUFF_W,
  ART_QUESTION,
  ART_RAY_H,
  ART_RAY_V,
  ART_STAR,
  ART_SUN,
  ART_SWEAT,
  ART_TEAR,
  ART_VEIN,
  MILLI_COMBO_GAP,
  MILLI_EMOTE,
  MILLI_EMOTIONS,
  MILLI_EYE_L,
  MILLI_EYE_R,
  MILLI_MOUTHS_EX,
  milliComboReaction,
  milliDragOffset,
  milliEmoteSubscribe,
  milliEmotionName,
  milliEyeRows,
  milliFidget,
  milliIsStroke,
  milliMouthExBox,
  milliTypingLevel,
  type MilliEmoteState,
  type MilliEyeKind,
  type MilliMouthEx,
} from './milliEmotions'

export type { MilliCue, MilliMode }

/**
 * Милли — персонаж из логотипа Millida: ручки в белых варежках, ножки в кедах.
 *
 * Анимация (04.10.2026) — покадровая, как спрайт в Minecraft: CSS-ключи со
 * steps() на transform/opacity (styles/pixel/milli-mascot.css), позы и лица —
 * готовые кадры, которые включаются по очереди. Живое поверх режима:
 * дышит, моргает в случайный момент, следит глазами за курсором и кареткой,
 * тянется к элементу с `data-milli-lean`, засыпает в покое, на тык отвечает
 * одной из трёх реакций. Всё это ведёт один общий «режиссёр» (ниже) — одна
 * подписка на указатель и один таймер на все маскоты; невидимые стоят на паузе,
 * при reduced-motion — статичные позы.
 *
 * Поле — квадрат `MILLI_FRAME_BOX` (544); `size` — сторона квадрата.
 */

export interface MilliProps {
  mode?: MilliMode
  size?: number
  className?: string
  /** Глаза следят за курсором и кареткой. По умолчанию — от 28 px. */
  track?: boolean
  /** Тык мышкой — игривая реакция (три по кругу). Клик не перехватывается. */
  poke?: boolean
  /** Корона — часть персонажа (PLUS — золотая, Diamond — алмазная): прыгает и наклоняется вместе с Милли. */
  crown?: 'gold' | 'diamond' | null
  /** Тень под ногами (на сцене со своей тенью — не нужна). */
  shadow?: boolean
  /** Разовая реакция: играет, когда значение меняется. */
  cue?: MilliCue | null
  onPoke?: (cue: MilliCue) => void
}

/* ── Спрайт ────────────────────────────────────────────────────────────── */

function Box({ b, className }: { b: MilliBox; className?: string }) {
  return <rect x={b.x} y={b.y} width={b.w} height={b.h} className={className} />
}

/** Группа, которую CSS крутит/масштабирует вокруг точки (x, y): transform-origin не нужен. */
function Pivot({ x, y, className, children }: { x: number; y: number; className: string; children: ReactNode }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={className}>
        <g transform={`translate(${-x} ${-y})`}>{children}</g>
      </g>
    </g>
  )
}

/** Пиксельная картинка с центром в 0,0; символ → класс `mm-c-<символ>`. */
function Pixels({ rows, px }: { rows: readonly string[]; px: number }) {
  const { w, h } = milliPixelSize(rows)
  const parts = milliPixels(rows, px, (-w * px) / 2, (-h * px) / 2)
  return (
    <>
      {Object.entries(parts).map(([ch, d]) => (
        <path key={ch} d={d} className={'mm-c-' + ch} />
      ))}
    </>
  )
}

function Arm({ a, side, prop }: { a: MilliArm; side: 'l' | 'r'; prop?: ReactNode }) {
  const px = side === 'l' ? a.arm.x + a.arm.w : a.arm.x
  return (
    <Pivot x={px} y={MILLI_SHOULDER_Y} className={'mm-arm mm-arm-' + side}>
      <Box b={a.arm} className="mm-limb" />
      <Box b={{ x: a.arm.x, y: a.arm.y + a.arm.h - 9, w: a.arm.w, h: 9 }} className="mm-limb-sh" />
      {prop}
      <g className="mm-hand">
        <path d={milliCut(milliGrow(a.hand, 6), 14)} className="mm-outline" />
        <Box b={milliGrow(a.thumb, 6)} className="mm-outline" />
        <path d={milliCut(a.hand, 10)} className="mm-glove" />
        <Box b={a.thumb} className="mm-glove" />
        <Box b={{ x: a.hand.x + 6, y: a.hand.y + a.hand.h - 10, w: a.hand.w - 12, h: 10 }} className="mm-glove-sh" />
      </g>
    </Pivot>
  )
}

function Eye({ b, side }: { b: MilliBox; side: -1 | 1 }) {
  const ih = MILLI_IRIS.bottom - MILLI_IRIS.top
  return (
    <Pivot x={b.x + b.w / 2} y={b.y + b.h / 2} className="mm-eye">
      {milliLashes(b, side).map((l, j) => (
        <Box key={j} b={l} className="mm-ink" />
      ))}
      <Box b={b} className="mm-ink" />
      <g className="mm-iris">
        <rect x={b.x + MILLI_IRIS.inset} y={b.y + MILLI_IRIS.top} width={b.w - MILLI_IRIS.inset * 2} height={ih} className="mm-iris-hi" />
        <rect x={b.x + MILLI_IRIS.inset} y={b.y + MILLI_IRIS.top + ih / 2} width={b.w - MILLI_IRIS.inset * 2} height={ih / 2} className="mm-iris-lo" />
      </g>
      <g className="mm-pupil">
        <rect x={b.x + MILLI_PUPIL.dx} y={b.y + MILLI_PUPIL.dy} width={MILLI_PUPIL.w} height={MILLI_PUPIL.h} className="mm-ink mm-pupil-n" />
        <rect
          x={b.x + MILLI_PUPIL_SMALL.dx}
          y={b.y + MILLI_PUPIL_SMALL.dy}
          width={MILLI_PUPIL_SMALL.w}
          height={MILLI_PUPIL_SMALL.h}
          className="mm-ink mm-pupil-s"
        />
      </g>
      <rect x={b.x + MILLI_GLINT2.dx} y={b.y + MILLI_GLINT2.dy} width={MILLI_GLINT2.size} height={MILLI_GLINT2.size} className="mm-glint" />
      <rect x={b.x + MILLI_GLINT.dx} y={b.y + MILLI_GLINT.dy} width={MILLI_GLINT.size} height={MILLI_GLINT.size} className="mm-glint" />
    </Pivot>
  )
}

const [EYE_L, EYE_R] = MILLI_EYES as [MilliBox, MilliBox]

function EyeArt({ kind }: { kind: 'joy' | 'sleep' | 'shut' | 'squeeze' }) {
  return (
    <g className={'mm-e-' + kind}>
      <path d={milliEyeArt(kind, EYE_L, -1) + milliEyeArt(kind, EYE_R, 1)} className="mm-ink" />
    </g>
  )
}

const MOUTHS: MilliMouth[] = ['smile', 'hmm', 'o', 'open', 'grin']
function Mouth({ kind }: { kind: MilliMouth }) {
  const p = milliMouth(kind)
  return (
    <g className={'mm-m-' + kind}>
      {p.X ? <path d={p.X} className="mm-ink" /> : null}
      {p.T ? <path d={p.T} className="mm-tongue" /> : null}
    </g>
  )
}

const VIEW_BOX = `${MILLI_FRAME_BOX.x} ${MILLI_FRAME_BOX.y} ${MILLI_FRAME_BOX.size} ${MILLI_FRAME_BOX.size}`
/** Ось наклона и прыжка — середина подошв; оборот и сальто — центр фигуры. */
const TURN_Y = 200

/* ── Эмоции: лишние части (глаза, рты, предметы) — только в своём состоянии ── */

type Play = MilliCue | MilliEmoteState
interface Slots {
  face?: ReactNode
  prop?: ReactNode
  rig?: ReactNode
}

/** Пиксельная картинка с левым верхним углом в (x, y); внутренняя группа крутится вокруг её центра. */
function Art({ rows, px, x, y, className }: { rows: readonly string[]; px: number; x: number; y: number; className?: string }) {
  const { w, h } = milliPixelSize(rows)
  return (
    <g transform={`translate(${x + (w * px) / 2} ${y + (h * px) / 2})`}>
      <g className={className}>
        <Pixels rows={rows} px={px} />
      </g>
    </g>
  )
}

function EyePair({ kind, className }: { kind: MilliEyeKind; className: string }) {
  const l = milliEyeRows(kind, -1)
  const r = milliEyeRows(kind, 1)
  return (
    <g className={className}>
      <Art rows={l.rows} px={10} x={l.x} y={l.y} className="mm-xe mm-xe-l" />
      <Art rows={r.rows} px={10} x={r.x} y={r.y} className="mm-xe mm-xe-r" />
    </g>
  )
}

function MouthEx({ kind }: { kind: MilliMouthEx }) {
  const b = milliMouthExBox(kind)
  const p = milliPixels(MILLI_MOUTHS_EX[kind], 7, b.x, b.y)
  return (
    <g className={'mm-xm mm-xm-' + kind}>
      {p.X ? <path d={p.X} className="mm-ink" /> : null}
      {p.W ? <path d={p.W} className="mm-glint" /> : null}
      {p.T ? <path d={p.T} className="mm-tongue" /> : null}
    </g>
  )
}

const BLUSH = (
  <g className="mm-blush">
    {MILLI_CHEEKS.map((b, i) => (
      <g key={i}>
        <rect x={b.x - 8} y={b.y - 4} width={b.w + 16} height={b.h + 8} className="mm-blush-r" />
        <Art rows={ART_BLUSH} px={4} x={b.x + b.w / 2 - 18} y={b.y - 2} className="mm-blush-l" />
      </g>
    ))}
  </g>
)
const TEARS_CORNER = (
  <g className="mm-tears-c">
    <Art rows={ART_TEAR} px={8} x={MILLI_EYE_L.x - 14} y={MILLI_EYE_L.y + 102} className="mm-tear is-a" />
    <Art rows={ART_TEAR} px={8} x={MILLI_EYE_R.x + MILLI_EYE_R.w - 10} y={MILLI_EYE_R.y + 102} className="mm-tear is-b" />
  </g>
)
const TEARS_FALL = (
  <g className="mm-tears-f">
    <Art rows={ART_TEAR} px={8} x={MILLI_EYE_L.x + 62} y={MILLI_EYE_L.y + 120} className="mm-drop is-a" />
    <Art rows={ART_TEAR} px={8} x={MILLI_EYE_R.x + 14} y={MILLI_EYE_R.y + 120} className="mm-drop is-b" />
  </g>
)
const SWEAT = <Art rows={ART_SWEAT} px={8} x={360} y={20} className="mm-sweat" />
const VEIN = <Art rows={ART_VEIN} px={9} x={14} y={-52} className="mm-vein" />
const QUESTION = <Art rows={ART_QUESTION} px={9} x={6} y={-92} className="mm-ask" />
const TING = <Art rows={ART_STAR} px={8} x={40} y={50} className="mm-ting" />
const SHOCK_LINES = (
  <g className="mm-shockl">
    <rect x={-56} y={20} width={28} height={8} />
    <rect x={-44} y={-24} width={8} height={28} />
    <rect x={404} y={20} width={28} height={8} />
    <rect x={412} y={-24} width={8} height={28} />
  </g>
)
const FLASH = <path d={MILLI_TILE} className="mm-flash" />
const ORBIT = (
  <g className="mm-orbit">
    {(['a', 'b', 'c'] as const).map((v) => (
      <g key={v} transform={`translate(${MILLI_CX} -96)`}>
        <g className={'mm-orb is-' + v}>
          <Pixels rows={ART_STAR} px={7} />
        </g>
      </g>
    ))}
  </g>
)
const BULB = (
  <g className="mm-bulb">
    <Art rows={ART_BULB} px={8} x={-4} y={-108} className="mm-bulb-b" />
    <g className="mm-rays">
      <Art rows={ART_RAY_V} px={8} x={20} y={-136} />
      <Art rows={ART_RAY_H} px={8} x={-36} y={-80} />
      <Art rows={ART_RAY_H} px={8} x={56} y={-80} />
      <Art rows={ART_RAY_H} px={8} x={-28} y={-120} className="mm-ray-d" />
      <Art rows={ART_RAY_H} px={8} x={48} y={-120} className="mm-ray-d" />
    </g>
  </g>
)
const GEAR = <Art rows={ART_GEAR} px={8} x={-4} y={-84} className="mm-gear" />
const CLOCK = (
  <g className="mm-clock">
    <Art rows={ART_CLOCK} px={8} x={-12} y={-100} />
    <g transform="translate(24 -64)">
      <g className="mm-clock-h">
        <rect x={-4} y={-26} width={8} height={26} className="mm-c-K" />
      </g>
    </g>
    <Art rows={ART_ARROW} px={8} x={-60} y={-112} className="mm-arrow" />
  </g>
)
const HAMMER = <Art rows={ART_HAMMER} px={8} x={393} y={182} className="mm-tool" />
const LENS = <Art rows={ART_LENS} px={8} x={389} y={150} className="mm-tool mm-lens" />
const BRUSH = <Art rows={ART_BRUSH} px={8} x={405} y={180} className="mm-tool" />

const lids = (k: MilliEyeKind) => <EyePair kind={k} className={'mm-lids mm-lids-' + k} />
const eyes = (k: MilliEyeKind) => <EyePair kind={k} className={'mm-xeyes mm-xeyes-' + k} />

function slotsFor(s: Play | MilliState): Slots | null {
  switch (s) {
    case 'starry':
      return { face: eyes('star') }
    case 'love':
      return { face: <>{eyes('heart')}{BLUSH}</> }
    case 'shock':
      return { face: <>{eyes('blank')}<MouthEx kind="teeth" /></>, rig: <>{FLASH}{SWEAT}{SHOCK_LINES}</> }
    case 'dizzy':
      return { face: <>{eyes('spiral')}<MouthEx kind="wobble" /></>, rig: ORBIT }
    case 'proud':
      return { face: <>{lids('half')}<MouthEx kind="smug" /></>, rig: TING }
    case 'laugh':
      return { face: <><MouthEx kind="laugh" />{TEARS_CORNER}</> }
    case 'shy':
      return { face: <>{BLUSH}<MouthEx kind="wobble" /></> }
    case 'purr':
      return { face: <>{BLUSH}<MouthEx kind="cat" /></> }
    case 'sad':
      return { face: <>{lids('sad')}<MouthEx kind="frown" />{TEARS_FALL}</> }
    case 'worry':
      return { face: <>{lids('sad')}<MouthEx kind="wobble" /></>, rig: SWEAT }
    case 'grumpy':
      return { face: <>{lids('angry')}<MouthEx kind="pout" /></>, rig: VEIN }
    case 'yawn':
      return { face: <>{lids('sleepy')}<MouthEx kind="yawn" />{TEARS_CORNER}</> }
    case 'fix':
      return { face: <MouthEx kind="blep" />, prop: HAMMER, rig: GEAR }
    case 'search':
      return { prop: LENS }
    case 'paint':
      return { face: <MouthEx kind="blep" />, prop: BRUSH }
    case 'rewind':
      return { rig: CLOCK }
    case 'idea':
      return { rig: BULB }
    case 'ponder':
      return { face: <MouthEx kind="smug" />, rig: QUESTION }
    case 'wobble':
    case 'drag':
      return { face: <MouthEx kind="wobble" /> }
    default:
      return null
  }
}

/**
 * Пиксельная корона на макушке (сетка 8): обод с камнями и три зубца, средний выше.
 * Рисуется в том же «рисунке», что и тело: обводка, свет сверху, тень снизу.
 */
const CROWN_PARTS: MilliBox[] = [
  { x: 100, y: -16, w: 176, h: 32 }, // обод
  { x: 100, y: -48, w: 32, h: 32 }, // левый зубец
  { x: 172, y: -60, w: 32, h: 44 }, // средний
  { x: 244, y: -48, w: 32, h: 32 }, // правый
  { x: 136, y: -32, w: 32, h: 16 }, // зубчики между
  { x: 208, y: -32, w: 32, h: 16 },
]
const CROWN_TIPS: MilliBox[] = [
  { x: 108, y: -60, w: 16, h: 12 },
  { x: 180, y: -72, w: 16, h: 12 },
  { x: 252, y: -60, w: 16, h: 12 },
]
function Crown({ kind }: { kind: 'gold' | 'diamond' }) {
  const all = [...CROWN_PARTS, ...CROWN_TIPS]
  return (
    <g className={'mm-crown is-' + kind} transform={'translate(0 ' + MILLI_CROWN_DY + ')'}>
      {all.map((b, i) => (
        <Box key={'o' + i} b={milliGrow(b, 6)} className="mm-crown-ol" />
      ))}
      {all.map((b, i) => (
        <Box key={'b' + i} b={b} className="mm-crown-base" />
      ))}
      <Box b={{ x: 100, y: -16, w: 176, h: 8 }} className="mm-crown-hi" />
      <Box b={{ x: 100, y: -48, w: 8, h: 32 }} className="mm-crown-hi" />
      <Box b={{ x: 172, y: -60, w: 8, h: 44 }} className="mm-crown-hi" />
      <Box b={{ x: 244, y: -48, w: 8, h: 32 }} className="mm-crown-hi" />
      <Box b={{ x: 100, y: 8, w: 176, h: 8 }} className="mm-crown-sh" />
      <Box b={{ x: 124, y: -2, w: 20, h: 14 }} className="mm-crown-gem is-side" />
      <Box b={{ x: 178, y: -6, w: 20, h: 18 }} className="mm-crown-gem" />
      <Box b={{ x: 232, y: -2, w: 20, h: 14 }} className="mm-crown-gem is-side" />
      <Box b={{ x: 182, y: -2, w: 6, h: 6 }} className="mm-crown-spark" />
      {CROWN_TIPS.map((b, i) => (
        <Box key={'t' + i} b={{ x: b.x + 4, y: b.y + 2, w: 6, h: 4 }} className="mm-crown-spark" />
      ))}
    </g>
  )
}

/** Сам персонаж: одинаков для всех экземпляров одного состояния, собирается один раз. */
function sprite(sl: Slots, crown: 'gold' | 'diamond' | null = null) {
  return (
  <g className="mm-lean">
   <Pivot x={MILLI_CX} y={MILLI_GROUND} className="mm-wob">
    <Pivot x={MILLI_CX} y={MILLI_GROUND} className="mm-jump">
      <Pivot x={MILLI_CX} y={TURN_Y} className="mm-turn">
        <g className="mm-legs">
          {MILLI_LEGS.map((l, i) => (
            <g key={i} className={'mm-leg mm-leg-' + (i ? 'r' : 'l')}>
              <Box b={l.leg} className="mm-limb" />
              <Box b={{ x: l.leg.x + l.leg.w - 10, y: l.leg.y, w: 10, h: l.leg.h }} className="mm-limb-sh" />
              <path d={milliCut(milliGrow(l.boot, 6), 12)} className="mm-outline" />
              <path d={milliCut(l.boot, 8)} className="mm-glove" />
              <Box b={l.sole} className="mm-boot" />
            </g>
          ))}
        </g>
        <g className="mm-rig">
          <Pivot x={MILLI_SPROUT.stem.x + MILLI_SPROUT.stem.w / 2} y={MILLI_SPROUT.stem.y + MILLI_SPROUT.stem.h} className="mm-sprout">
            <Box b={milliGrow(MILLI_SPROUT.stem, 4)} className="mm-outline" />
            <path d={milliCut(milliGrow(MILLI_SPROUT.leafR, 4), 8)} className="mm-outline" />
            <path d={milliCut(milliGrow(MILLI_SPROUT.leafL, 4), 8)} className="mm-outline" />
            <Box b={MILLI_SPROUT.stem} className="mm-leaf-dk" />
            <path d={milliCut(MILLI_SPROUT.leafR, 6)} className="mm-leaf" />
            <path d={milliCut(MILLI_SPROUT.leafL, 6)} className="mm-leaf" />
            <Box b={{ x: MILLI_SPROUT.leafR.x + 6, y: MILLI_SPROUT.leafR.y + 12, w: MILLI_SPROUT.leafR.w - 12, h: 8 }} className="mm-leaf-dk" />
            <Box b={{ x: MILLI_SPROUT.leafL.x + 6, y: MILLI_SPROUT.leafL.y + 12, w: MILLI_SPROUT.leafL.w - 12, h: 8 }} className="mm-leaf-dk" />
          </Pivot>
          <g className="mm-back mm-back-l">
            <Arm a={MILLI_ARMS.l} side="l" />
          </g>
          <g className="mm-back mm-back-r">
            <Arm a={MILLI_ARMS.r} side="r" />
          </g>
          <path d={MILLI_TILE} className="mm-body" />
          <Box b={MILLI_BEVEL.top} className="mm-hi" />
          <Box b={MILLI_BEVEL.left} className="mm-hi2" />
          <Box b={MILLI_BEVEL.right} className="mm-sh" />
          <path d={MILLI_BEVEL.bottom} className="mm-sh2" />
          <path d={MILLI_RIM} fillRule="evenodd" className="mm-rim" />
          <g className="mm-face">
            <g transform={`translate(0 ${MILLI_GLYPH_LIFT})`}>
              <g transform={`translate(${MILLI_SHADOW_SHIFT} ${MILLI_SHADOW_SHIFT})`} className="mm-gsh">
                <path d={MILLI_FRAME} />
                <path d={MILLI_STEPS} />
                <Box b={MILLI_NOSE} />
              </g>
              <path d={MILLI_FRAME} className="mm-glyph" />
              <path d={MILLI_STEPS} className="mm-glyph" />
              <Box b={MILLI_NOSE} className="mm-glyph" />
              <g className="mm-cheeks">
                {MILLI_CHEEKS.map((b, i) => (
                  <Box key={i} b={b} className="mm-cheek" />
                ))}
              </g>
              <g className="mm-e-open">
                <Eye b={EYE_L} side={-1} />
                <Eye b={EYE_R} side={1} />
              </g>
              <EyeArt kind="shut" />
              <EyeArt kind="joy" />
              <EyeArt kind="sleep" />
              <EyeArt kind="squeeze" />
              {MOUTHS.map((k) => (
                <Mouth key={k} kind={k} />
              ))}
              {sl.face}
            </g>
          </g>
          {crown ? <Crown kind={crown} /> : null}
          {/* Поднятая ручка — перед телом: те же классы и ключи, что у задней, видна только в позах «рука вверх». */}
          <g className="mm-front mm-front-l">
            <Arm a={MILLI_ARMS.l} side="l" />
          </g>
          <g className="mm-front mm-front-r">
            <Arm a={MILLI_ARMS.r} side="r" prop={sl.prop} />
          </g>
          {sl.rig}
        </g>
      </Pivot>
    </Pivot>
   </Pivot>
  </g>
  )
}

const SPRITE = sprite({})
const sprites = new Map<string, ReactNode>()
function spriteFor(s: Play | MilliState, crown: 'gold' | 'diamond' | null = null): ReactNode {
  const sl = slotsFor(s)
  if (!sl && !crown) return SPRITE
  const key = s + (crown ? ':' + crown : '')
  let n = sprites.get(key)
  if (!n) sprites.set(key, (n = sprite(sl ?? {}, crown)))
  return n
}

const SHADOW = (
  <Pivot x={MILLI_CX} y={MILLI_GROUND + 8} className="mm-shadow">
    <path d={MILLI_SHADOW} />
  </Pivot>
)

/* ── Частицы ───────────────────────────────────────────────────────────── */

function Particles({ list, kind, art, px }: { list: readonly MilliParticle[]; kind: string; art: ReactNode | readonly string[]; px?: number }) {
  return (
    <g className={'mm-fx-' + kind}>
      {list.map((p, i) => {
        const s = p.s ?? 1
        const t = `translate(${p.x} ${p.y})${p.r ? ` rotate(${p.r})` : ''} scale(${p.flip ? -s : s} ${s})`
        return (
          <g key={i} transform={t}>
            <g className={`mm-p mm-${kind} is-${p.v}`}>{Array.isArray(art) ? <Pixels rows={art as readonly string[]} px={px ?? 8} /> : (art as ReactNode)}</g>
          </g>
        )
      })}
    </g>
  )
}

const FX_DUST = <Particles list={MILLI_DUST} kind="dust" art={MILLI_PUFF} px={9} />
const FX_TOTEM = <Particles list={MILLI_TOTEM} kind="totem" art={<rect x={-8} y={-8} width={16} height={16} />} />
const FX_SPARKS = <Particles list={MILLI_SPARKS} kind="spark" art={MILLI_SPARK} px={9} />
const FX_HEARTS = <Particles list={MILLI_HEARTS} kind="heart" art={MILLI_HEART} px={8} />
const FX_NOTES = <Particles list={MILLI_NOTES} kind="note" art={MILLI_NOTE} px={8} />
const FX_ZZZ = <Particles list={MILLI_ZZZ} kind="z" art={MILLI_Z} px={9} />
const FX_BANG = <Particles list={[{ x: 330, y: -60, v: 'a' }]} kind="bang" art={MILLI_BANG} px={10} />
const FX_DOTS = (
  <g className="mm-dots">
    {MILLI_DOTS.map((b, i) => (
      <Box key={i} b={b} className="mm-dot" />
    ))}
  </g>
)

const STARS: readonly MilliParticle[] = [
  { x: -50, y: 40, v: 'a' },
  { x: 424, y: 70, v: 'b' },
  { x: -30, y: 260, v: 'c', s: 0.8 },
  { x: 418, y: 300, v: 'a', s: 0.8 },
  { x: 60, y: -70, v: 'b', s: 0.7 },
  { x: 330, y: -80, v: 'c', s: 0.9 },
]
const FX_STARS = <Particles list={STARS} kind="star" art={ART_STAR} px={8} />
const FX_LOVE = <Particles list={[...MILLI_HEARTS, { x: -40, y: 120, v: 'b', s: 0.7 }, { x: 410, y: 200, v: 'a', s: 0.6 }]} kind="heart" art={MILLI_HEART} px={8} />
const FX_PURR = <Particles list={[{ x: 330, y: -40, v: 'a', s: 0.7 }, { x: 40, y: -30, v: 'c', s: 0.6 }]} kind="heart" art={MILLI_HEART} px={8} />
const FX_HA = <Particles list={[{ x: 380, y: -30, v: 'a' }, { x: -30, y: 10, v: 'b', s: 0.7 }]} kind="ha" art={ART_HA} px={6} />
const FX_PUFFW = <Particles list={[{ x: -24, y: 40, v: 'a', flip: true }, { x: 400, y: 40, v: 'b' }]} kind="steam" art={ART_PUFF_W} px={10} />
const FX_SPARK_HIT = <Particles list={[{ x: 452, y: 236, v: 'a' }, { x: 470, y: 214, v: 'b', s: 0.7 }, { x: 440, y: 262, v: 'c', s: 0.6 }]} kind="hit" art={ART_STAR} px={6} />
const FX_DABS = (
  <Particles
    list={[
      { x: 448, y: 176, v: 'a' },
      { x: 468, y: 140, v: 'b' },
      { x: 476, y: 100, v: 'c' },
      { x: 468, y: 60, v: 'a', s: 0.9 },
      { x: 446, y: 26, v: 'b', s: 0.8 },
    ]}
    kind="dab"
    art={ART_DISCO}
    px={9}
  />
)
const FX_DISCO = (
  <Particles
    list={[
      { x: -56, y: 110, v: 'a' },
      { x: 430, y: 140, v: 'b' },
      { x: -46, y: 300, v: 'c' },
      { x: 426, y: 320, v: 'a' },
      { x: 20, y: -60, v: 'b' },
      { x: 360, y: -70, v: 'c' },
    ]}
    kind="disco"
    art={ART_DISCO}
    px={8}
  />
)
const FX_SUN = <Art rows={ART_SUN} px={8} x={-80} y={-74} className="mm-sun" />
const FX_BURST = <Art rows={ART_BURST} px={8} x={318} y={102} className="mm-burst" />
const FX_CHEST = (
  <g className="mm-chest">
    <Art rows={ART_GEM} px={8} x={408} y={300} className="mm-gem" />
    <Art rows={ART_CHEST_IN} px={8} x={384} y={386} className="mm-chest-in" />
    <Art rows={ART_LID_OPEN} px={8} x={384} y={370} className="mm-lid-open" />
    <Art rows={ART_CHEST} px={8} x={384} y={402} />
    <Art rows={ART_LID_SHUT} px={8} x={384} y={386} className="mm-lid-shut" />
    <Art rows={ART_STAR} px={5} x={410} y={396} className="mm-lock" />
  </g>
)
const FX_NOTE1 = <Particles list={[{ x: 380, y: 10, v: 'a', s: 0.7 }]} kind="note" art={MILLI_NOTE} px={8} />

/** Какие частицы нужны состоянию (остальных нет в DOM). */
function fxFor(s: Play | MilliState): ReactNode[] {
  switch (s) {
    case 'joy':
      return [FX_SPARKS, FX_DUST]
    case 'starry':
      return [FX_STARS]
    case 'laugh':
      return [FX_HA]
    case 'surprise':
      return [FX_BANG]
    case 'shock':
      return [FX_BANG, FX_DUST]
    case 'grumpy':
      return [FX_PUFFW]
    case 'yawn':
      return [FX_ZZZ]
    case 'love':
      return [FX_LOVE]
    case 'purr':
      return [FX_PURR]
    case 'fix':
      return [FX_SPARK_HIT]
    case 'paint':
      return [FX_SUN, FX_DABS]
    case 'save':
      return [FX_CHEST]
    case 'disco':
      return [FX_NOTES, FX_DISCO, FX_DUST]
    case 'five':
      return [FX_BURST, FX_DUST]
    case 'wobble':
    case 'flip':
      return [FX_DUST]
    case 'tap':
      return [FX_NOTE1]
    case 'happy':
      return [FX_DUST, FX_SPARKS]
    case 'hop':
    case 'poke3':
      return [FX_DUST]
    case 'spin':
      return [FX_TOTEM, FX_DUST]
    case 'poke1':
      return [FX_HEARTS]
    case 'poke2':
      return [FX_NOTES, FX_DUST]
    case 'wake':
      return [FX_BANG, FX_DUST]
    case 'wow':
      return [FX_BANG]
    case 'sleep':
      return [FX_ZZZ]
    case 'think':
      return [FX_DOTS]
    default:
      return []
  }
}

/* ── Режиссёр: один на все маскоты ─────────────────────────────────────── */

interface Inst {
  root: HTMLSpanElement
  svg: SVGSVGElement
  pupils: SVGGElement[]
  irises: SVGGElement[]
  face: SVGGElement | null
  lean: SVGGElement | null
  track: boolean
  sleepy: boolean
  fx: boolean
  visible: boolean
  asleep: boolean
  gazeKey: string
  glance: MilliStep | null
  leanCur: number
  leanTarget: number
  leanAt: number
  nextBlink: number
  nextGlance: number
  flip: boolean
  state: () => MilliState | Play
  play: (k: Play) => void
  nextFidget: number
  setAsleep: (v: boolean) => void
}

const insts = new Set<Inst>()
const byEl = new Map<Element, Inst>()
const ptr = { x: 0, y: 0, t: 0 }
let typedAt = 0
let lastActive = Date.now()
let asleep = false
let manualLean: Element | null = null
let hoverLean: Element | null = null
let raf = 0
let schedT: ReturnType<typeof setTimeout> | undefined
let sleepT: ReturnType<typeof setTimeout> | undefined
let leanT: ReturnType<typeof setTimeout> | undefined
let io: IntersectionObserver | null = null
let measure: CanvasRenderingContext2D | null = null

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const hidden = () => typeof document !== 'undefined' && document.hidden
const rnd = (a: number, b: number) => a + Math.random() * (b - a)

function isField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|email|url|tel|password|)$/.test(el.type))
}

/** Где каретка в поле ввода (экранные px): ширина текста до неё канвасом, без зеркал DOM. */
function caretPoint(): { x: number; y: number } | null {
  const el = document.activeElement
  if (isField(el)) {
    const r = el.getBoundingClientRect()
    if (!r.width) return null
    const cs = getComputedStyle(el)
    const before = el.value.slice(0, el.selectionStart ?? el.value.length)
    const lines = before.split('\n')
    if (!measure) measure = document.createElement('canvas').getContext('2d')
    let w = 0
    if (measure) {
      measure.font = cs.font || `${cs.fontSize} ${cs.fontFamily}`
      w = measure.measureText(lines[lines.length - 1] ?? '').width
    }
    const x = Math.min(r.right, Math.max(r.left, r.left + (parseFloat(cs.paddingLeft) || 0) + w - el.scrollLeft))
    let y = r.top + r.height / 2
    if (el instanceof HTMLTextAreaElement) {
      const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 14) * 1.3
      y = Math.min(r.bottom, Math.max(r.top, r.top + (parseFloat(cs.paddingTop) || 0) + (lines.length - 0.5) * lh - el.scrollTop))
    }
    return { x, y }
  }
  if (el instanceof HTMLElement && el.isContentEditable) {
    const sel = window.getSelection()
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r.width || r.height || r.left) return { x: r.left, y: r.top + r.height / 2 }
    }
  }
  return null
}

function setT(el: Element | null, t: string) {
  if (!el) return
  if (t) el.setAttribute('transform', t)
  else el.removeAttribute('transform')
}

function applyGaze(inst: Inst, g: MilliStep) {
  const key = g.x + ',' + g.y
  if (key === inst.gazeKey) return
  inst.gazeKey = key
  const o = milliGazeOffsets(g)
  const tr = (s: MilliStep) => (s.x || s.y ? `translate(${s.x} ${s.y})` : '')
  for (const p of inst.pupils) setT(p, tr(o.pupil))
  for (const p of inst.irises) setT(p, tr(o.iris))
  setT(inst.face, tr(o.face))
}

function queue() {
  if (!raf && typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(tick)
}

function tick() {
  raf = 0
  const now = Date.now()
  const leanEl = (manualLean?.isConnected ? manualLean : null) ?? (hoverLean?.isConnected ? hoverLean : null)
  const lr = leanEl ? leanEl.getBoundingClientRect() : null
  const typing = typedAt > ptr.t && now - typedAt < MILLI_GAZE_FRESH
  const caret = !lr && typing ? caretPoint() : null
  const pointer = ptr.t && now - ptr.t < MILLI_GAZE_FRESH ? ptr : null
  let more = false
  for (const inst of insts) {
    if (!inst.visible || hidden()) continue
    const r = inst.root.getBoundingClientRect()
    if (!r.width) continue
    const ex = r.left + r.width / 2
    const ey = r.top + r.height * 0.14
    const target = lr ? { x: lr.left + lr.width / 2, y: lr.top + lr.height / 2 } : caret ?? pointer
    inst.leanTarget = lr && inst.fx ? milliLeanAngle(lr.left + lr.width / 2 - ex, r.width) : 0
    if (inst.track) applyGaze(inst, target ? milliGaze(target.x - ex, target.y - ey, r.width) : inst.glance ?? { x: 0, y: 0 })
    if (inst.leanCur !== inst.leanTarget) {
      if (now >= inst.leanAt) {
        inst.leanCur = milliLeanStep(inst.leanCur, inst.leanTarget)
        inst.leanAt = now + 80
        setT(inst.lean, inst.leanCur ? `rotate(${inst.leanCur} ${MILLI_CX} ${MILLI_GROUND})` : '')
      }
      if (inst.leanCur !== inst.leanTarget) more = true
    }
  }
  clearTimeout(leanT)
  if (more) leanT = setTimeout(queue, 80)
}

function blink(inst: Inst, double: boolean) {
  const cl = inst.svg.classList
  cl.remove('mm-blink-a', 'mm-blink-b', 'mm-blink2-a', 'mm-blink2-b')
  inst.flip = !inst.flip
  cl.add('mm-blink' + (double ? '2' : '') + (inst.flip ? '-a' : '-b'))
}

function schedule() {
  clearTimeout(schedT)
  let next = Infinity
  for (const i of insts) next = Math.min(next, i.nextBlink, i.nextGlance, i.nextFidget)
  if (Number.isFinite(next)) schedT = setTimeout(fire, Math.max(30, next - Date.now()))
}

function fire() {
  const now = Date.now()
  let look = false
  for (const inst of insts) {
    const off = !inst.visible || hidden()
    if (inst.nextBlink <= now) {
      const plan = milliBlinkPlan(Math.random(), Math.random())
      if (!off) blink(inst, plan.double)
      inst.nextBlink = now + plan.wait + (plan.double ? 480 : 0)
    }
    if (inst.nextGlance <= now) {
      // Курсор давно не двигался — сама поглядывает по сторонам.
      const idle = !(ptr.t && now - ptr.t < MILLI_GAZE_FRESH) && !(now - typedAt < MILLI_GAZE_FRESH)
      inst.glance = idle && !inst.glance && !off ? { x: Math.round(rnd(-2, 2)), y: Math.round(rnd(-1.4, 1)) } : null
      inst.nextGlance = now + (inst.glance ? rnd(700, 1800) : rnd(2500, 6500))
      look = true
    }
    if (inst.nextFidget <= now) {
      // Игрок давно ничего не трогает — мелочь: огляделась, потянулась, притопнула, зевнула.
      const f = milliFidget(now - lastActive, Math.random())
      if (f && !off && inst.fx && inst.state() === 'idle') inst.play(f)
      inst.nextFidget = now + rnd(9000, 20000)
    }
  }
  schedule()
  if (look) queue()
}

function setPaused(inst: Inst) {
  inst.svg.classList.toggle('is-paused', !inst.visible || hidden())
}

function armSleep() {
  if (sleepT !== undefined) return
  sleepT = setTimeout(() => {
    sleepT = undefined
    const left = MILLI_SLEEP_AFTER - (Date.now() - lastActive)
    if (left > 50) return armSleep()
    asleep = true
    for (const i of insts) if (i.sleepy && !i.asleep) i.setAsleep(true)
  }, Math.max(50, MILLI_SLEEP_AFTER - (Date.now() - lastActive)))
}

function activity() {
  lastActive = Date.now()
  if (asleep) {
    asleep = false
    for (const i of insts) {
      if (!i.asleep) continue
      const wasSleeping = i.state() === 'sleep'
      i.setAsleep(false)
      if (wasSleeping && i.visible) i.play('wake')
    }
  }
  armSleep()
}

function onMove(e: PointerEvent) {
  ptr.x = e.clientX
  ptr.y = e.clientY
  ptr.t = Date.now()
  activity()
  queue()
}
function onOver(e: PointerEvent) {
  const t = e.target as Element | null
  const el = t && typeof t.closest === 'function' ? t.closest('[data-milli-lean]') : null
  if (el !== hoverLean) {
    hoverLean = el
    queue()
  }
}
let typeT: ReturnType<typeof setTimeout> | undefined
const keyTimes: number[] = []
/** Скорость печати → класс на svg: mm-type-1 — кивает в такт, mm-type-2 — быстро, глаза горят. */
function typingLevel(now: number) {
  keyTimes.push(now)
  if (keyTimes.length > 12) keyTimes.shift()
  const lv = milliTypingLevel(keyTimes, now)
  for (const i of insts) {
    if (!i.fx) continue
    const cl = i.svg.classList
    cl.toggle('mm-type-1', lv === 1)
    cl.toggle('mm-type-2', lv === 2)
  }
  clearTimeout(typeT)
  typeT = setTimeout(() => {
    for (const i of insts) i.svg.classList.remove('mm-type-1', 'mm-type-2')
  }, 900)
}
function onKey(e: Event) {
  activity()
  const t = e.target as Element | null
  if (isField(t) || (t instanceof HTMLElement && t.isContentEditable)) {
    typedAt = Date.now()
    if (e.type === 'keydown') typingLevel(typedAt)
    queue()
  }
}
function onVisibility() {
  for (const i of insts) setPaused(i)
  if (!hidden()) queue()
}

const listeners: [string, EventListener][] = [
  ['pointermove', onMove as EventListener],
  ['pointerover', onOver as EventListener],
  ['pointerdown', activity],
  ['wheel', activity],
  ['keydown', onKey],
  ['input', onKey],
  ['focusin', onKey],
]

function attach() {
  for (const [n, f] of listeners) document.addEventListener(n, f, { passive: true, capture: true })
  document.addEventListener('visibilitychange', onVisibility)
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const inst = byEl.get(e.target)
          if (!inst) continue
          inst.visible = e.isIntersecting
          setPaused(inst)
        }
        queue()
      },
      { rootMargin: '48px' },
    )
  }
  lastActive = Date.now()
  armSleep()
}

function detach() {
  for (const [n, f] of listeners) document.removeEventListener(n, f, { capture: true })
  document.removeEventListener('visibilitychange', onVisibility)
  io?.disconnect()
  io = null
  clearTimeout(schedT)
  clearTimeout(sleepT)
  clearTimeout(leanT)
  clearTimeout(typeT)
  sleepT = undefined
  if (raf) cancelAnimationFrame(raf)
  raf = 0
}

function register(inst: Inst): () => void {
  if (!insts.size) attach()
  insts.add(inst)
  byEl.set(inst.root, inst)
  if (io) io.observe(inst.root)
  else inst.visible = true
  if (asleep && inst.sleepy) inst.setAsleep(true)
  schedule()
  queue()
  return () => {
    insts.delete(inst)
    byEl.delete(inst.root)
    io?.unobserve(inst.root)
    if (!insts.size) detach()
    else schedule()
  }
}

/**
 * Разовая реакция всем видимым Милли от 32 px: `milliCue('hop')` — на отправку,
 * `milliCue('spin')` — сборка готова. `within` — только маскоты внутри элемента.
 */
export function milliCue(kind: MilliCue, within?: Element | null): void {
  if (within === null) return
  for (const i of insts) {
    if (!i.fx || !i.visible || (within && !within.contains(i.root))) continue
    i.play(kind)
  }
}

/**
 * Потянуться и посмотреть на элемент (null — отпустить). Проще — атрибут
 * `data-milli-lean` на элементе: наклон включается сам при наведении.
 */
export function milliLean(el: Element | null): void {
  manualLean = el
  queue()
}

/* ── Компонент ─────────────────────────────────────────────────────────── */

const BASE_MODES = new Set(['idle', 'talk', 'think', 'happy', 'wave', 'dance', 'hop', 'spin', 'sleep'])
/** Режим из стора может прийти чужим именем ('scan', 'work'…) — переводим; неизвестное — покой. */
function resolveMode(m: string): MilliMode {
  if (BASE_MODES.has(m) || (MILLI_EMOTIONS as readonly string[]).includes(m)) return m as MilliMode
  return milliEmotionName(m) ?? 'idle'
}
const playMs = (k: Play) => (k in MILLI_CUE_MS ? MILLI_CUE_MS[k as MilliCue] : MILLI_EMOTE[k as MilliEmoteState].ms)

export const Milli = memo(function Milli({ mode = 'idle', size = 60, className = '', track, poke = true, shadow = false, cue, onPoke, crown = null }: MilliProps) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const [playing, setPlaying] = useState<Play | null>(null)
  const [sleeping, setSleeping] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cur = useRef(0)
  const pokes = useRef(0)
  const fx = size >= 32
  const m0 = resolveMode(mode)
  const state: Play | MilliState = playing ?? milliState(m0, null, sleeping)
  const stateRef = useRef(state)
  stateRef.current = state

  /** Играть `k` `ms` мс (Infinity — до release(token)). */
  const play = useCallback((k: Play, ms?: number, token = 0) => {
    clearTimeout(timer.current)
    cur.current = token
    setPlaying(k)
    const len = ms ?? playMs(k)
    if (Number.isFinite(len)) timer.current = setTimeout(() => setPlaying(null), len)
  }, [])
  const release = useCallback((token: number) => {
    if (!token || cur.current !== token) return
    clearTimeout(timer.current)
    cur.current = 0
    setPlaying(null)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  useEffect(() => {
    if (cue) play(cue)
  }, [cue, play])

  // milliEmote(...) из любого места.
  useEffect(() => {
    if (!fx) return
    return milliEmoteSubscribe((name, ms, within, token) => {
      const root = rootRef.current
      if (!root || (within && !within.contains(root)) || !root.getBoundingClientRect().width) return
      play(name, ms, token)
    }, release)
  }, [fx, play, release])

  const tracking = track ?? size >= 28
  useEffect(() => {
    const root = rootRef.current
    const svg = root?.querySelector('svg')
    if (!root || !svg || reducedMotion()) return
    const now = Date.now()
    return register({
      root,
      svg,
      pupils: Array.from(svg.querySelectorAll<SVGGElement>('.mm-pupil')),
      irises: Array.from(svg.querySelectorAll<SVGGElement>('.mm-iris')),
      face: svg.querySelector<SVGGElement>('.mm-face'),
      lean: svg.querySelector<SVGGElement>('.mm-lean'),
      track: tracking,
      sleepy: fx,
      fx,
      visible: false,
      asleep: false,
      gazeKey: '0,0',
      glance: null,
      leanCur: 0,
      leanTarget: 0,
      leanAt: 0,
      nextBlink: now + rnd(1200, 4800),
      nextGlance: now + rnd(2000, 6000),
      nextFidget: now + rnd(9000, 16000),
      flip: false,
      state: () => stateRef.current,
      play: (k) => play(k),
      setAsleep(v) {
        this.asleep = v
        setSleeping(v)
      },
    })
  }, [tracking, fx, play])

  /* ── Взаимодействия (от 32 px): тыки-комбо, «пять!», перетаскивание,
     поглаживание, двойной клик — разворот, долгое наведение — машет. ── */
  const ix = useRef({ down: null as null | { x: number; y: number; id: number }, dragged: false, combo: 0, last: 0, px: 0, dir: 0, path: 0, turns: 0, at: 0, hover: false })
  const hoverT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(hoverT.current), [])
  const live = poke && fx

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    ix.current.down = { x: e.clientX, y: e.clientY, id: e.pointerId }
    ix.current.dragged = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const r = ix.current
    const root = rootRef.current
    if (!root) return
    if (r.down) {
      const dx = e.clientX - r.down.x
      const dy = e.clientY - r.down.y
      if (!r.dragged && Math.hypot(dx, dy) > 5) {
        r.dragged = true
        try {
          root.setPointerCapture(r.down.id)
        } catch {}
        root.style.transition = ''
        play('drag', Infinity)
      }
      if (r.dragged) root.style.transform = `translate(${milliDragOffset(dx)}px, ${milliDragOffset(dy)}px)`
      return
    }
    const now = Date.now()
    if (now - r.at > 900) {
      r.path = 0
      r.turns = 0
      r.dir = 0
      r.px = e.clientX
    }
    r.at = now
    const mx = e.clientX - r.px
    r.px = e.clientX
    if (Math.abs(mx) < 1) return
    const dir = Math.sign(mx)
    if (r.dir && dir !== r.dir) r.turns++
    r.dir = dir
    r.path += Math.abs(mx)
    if (milliIsStroke(r.path, r.turns, size)) play('purr', 900)
  }
  const onPointerUp = () => {
    const r = ix.current
    r.down = null
    const root = rootRef.current
    if (!r.dragged || !root) return
    root.style.transition = 'transform 0.32s cubic-bezier(.22,1,.36,1)'
    root.style.transform = ''
    play('wobble')
  }
  const onPointerEnter = (e: React.PointerEvent) => {
    ix.current.hover = true
    ix.current.px = e.clientX
    clearTimeout(hoverT.current)
    hoverT.current = setTimeout(() => {
      if (ix.current.hover && !ix.current.down && stateRef.current === 'idle') play('hi')
    }, 1400)
  }
  const onPointerLeave = () => {
    ix.current.hover = false
    clearTimeout(hoverT.current)
  }

  const onClick = poke
    ? (e: React.MouseEvent) => {
        const r = ix.current
        if (r.dragged) {
          r.dragged = false
          return
        }
        if (live) {
          const now = Date.now()
          r.combo = now - r.last < MILLI_COMBO_GAP ? r.combo + 1 : 1
          r.last = now
          const t = e.target as Element | null
          if (t && typeof t.closest === 'function' && t.closest('.mm-hand')) {
            play('five')
            return
          }
          const c = milliComboReaction(r.combo)
          if (c === 'dizzy') {
            r.combo = 0
            play('dizzy')
            return
          }
          if (c === 'grumpy') {
            play('grumpy', 1200)
            return
          }
        }
        const k = milliPoke(pokes.current++)
        play(k)
        onPoke?.(k)
      }
    : undefined

  const m = m0 === 'dance' ? 'happy' : m0
  return (
    <span
      ref={rootRef}
      className={'milli milli-' + m + ' mm-s-' + state + (flipped ? ' mm-flipped' : '') + (className ? ' ' + className : '')}
      style={{ width: size, height: size }}
      aria-hidden="true"
      onClick={onClick}
      onDoubleClick={
        live
          ? () => {
              setFlipped((f) => !f)
              play('flip')
            }
          : undefined
      }
      onPointerDown={live ? onPointerDown : undefined}
      onPointerMove={live ? onPointerMove : undefined}
      onPointerUp={live ? onPointerUp : undefined}
      onPointerCancel={live ? onPointerUp : undefined}
      onPointerEnter={live ? onPointerEnter : undefined}
      onPointerLeave={live ? onPointerLeave : undefined}
    >
      <svg width={size} height={size} viewBox={VIEW_BOX} shapeRendering="crispEdges" focusable="false">
        {shadow ? SHADOW : null}
        {fx || crown ? spriteFor(state, crown) : SPRITE}
        {fx ? fxFor(state).map((n, i) => <g key={state + i}>{n}</g>) : state === 'think' ? FX_DOTS : null}
      </svg>
    </span>
  )
})
