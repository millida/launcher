import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { Chest3D } from '../daily/Chest3D'
import { Burst, Confetti, Rays } from '../reward/RewardReveal'
import type { CaseOpenView, CaseReward, ChestTier, ItemRef, Rarity } from '../../lib/rubies'
import { playCase } from './caseSound'
import { Shard } from '../shop/parts'
import { FragBar, RarityChip } from '../shop/rarityUi'
import { PxThumb } from '../shop/Sets'
import { RARITY_NAME_SHORT, RARITY_TONE, rarityRank, shardWord, word } from '../shop/rarity'
import { dealOrder, finalRarity, ladderAt, openOfRewards, revealLadder } from './revealLadder'
import '../../styles/pixel/reveal.css'

/**
 * Открытие сундука (06.10.2026, «как в Brawl Stars»), общее для всех ящиков
 * и сундуков. Никакой ленты/рулетки — только сундук и награды по одной:
 *  1. hit   — огромный сундук посреди экрана с лучами его цвета, дышит;
 *             «Жми!». Каждый удар — сплющивание, стоп-кадр, искры, звук,
 *             новые трещины света, из щелей всё ярче;
 *  2. burst — вспышка, взрыв частиц, крышка открыта, сундук уезжает вниз;
 *  3. card  — награды выходят из сундука по одной: каждое нажатие —
 *             следующая (свой звук и искры). Вещь — слово редкости крупно,
 *             валюта — большая сумма. На сундуке — сколько осталось;
 *  4. sum   — итог всех наград: «Надеть» / «Ещё раз».
 * Ящики магазина (08-гарант-x10-флоу.md):
 *  • `floor` — свечение сундука стартует с цвета гарантии и на ударах
 *    поднимается ступенями до редкости, которую уже решил сервер (как
 *    Starr Drops); выше итога не бывает, вниз не откатывается;
 *  • `deal` (×10) — сундук крупнее и трещин больше, после взрыва 10 карт
 *    рубашкой вверх: нажатие переворачивает следующую, «Открыть все» — все,
 *    лучшая — последней с фанфарами; итог — та же сетка с «Надеть».
 * Звуки — общие звуки лаунчера (Minecraft из ассетов Mojang), громкость и
 * «выключено» — из настроек. Без анимаций (reduced motion) — сразу награды.
 */

type Phase = 'hit' | 'burst' | 'card' | 'deal' | 'sum'

/** Ответ открытия: награды одного сундука (старое) или ящики по одному (×10). */
export type RevealData = CaseReward[] | { opens: CaseOpenView[] }
const opensOfData = (d: RevealData): CaseOpenView[] => (Array.isArray(d) ? [openOfRewards(d)] : d.opens)

const HITS = 3
const BURST_MS = 650

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const rewardTone = (r: CaseReward) =>
  r.item ? RARITY_TONE[r.item.rarity] : r.kind === 'rubies' ? 'var(--m-ruby, #e8364f)' : 'var(--m-rarity-rare)'
const rewardRank = (r: CaseReward) => (r.item ? rarityRank(r.item.rarity) : 0)

/** Звук награды (caseSound.ts): валюта звенит, вещь — по редкости. */
const sting = (r: CaseReward) => playCase({ t: 'reveal', kind: r.kind, rarity: r.item?.rarity })

/**
 * Трещины света на сундуке: от щели крышки в стороны, ломаными по пиксельной
 * сетке. Удар i открывает трещины группы i (последняя группа — самая длинная).
 */
const CRACKS: string[][] = [
  ['50,50 44,44 46,38 40,32', '50,50 58,46 62,48'],
  ['50,50 36,52 30,48 22,52', '50,50 60,56 66,54 74,60', '50,50 52,40 58,34'],
  ['50,50 40,62 42,70 34,78', '50,50 64,40 72,42 80,34', '50,50 26,40 18,42 10,36', '50,50 56,66 62,74 60,84'],
]

/** Ещё трещины для ×10: длинные, до краёв сундука. */
const CRACKS_MORE: string[][] = [
  ['50,50 30,30 34,22 26,12', '50,50 70,30 66,20 76,10', '50,50 22,62 14,60 6,70', '50,50 78,64 88,62 96,72', '50,50 46,74 50,84 44,96'],
]

function Cracks({ hits, need, more }: { hits: number; need: number; more?: boolean }) {
  const groups = more ? [...CRACKS, ...CRACKS_MORE] : CRACKS
  // Групп три (у ×10 — четыре); при другом числе ударов растягиваем на них.
  const open = need > 0 ? Math.ceil((hits / need) * groups.length) : 0
  return (
    <svg className="rv2-cracks" viewBox="0 0 100 100" aria-hidden="true" shapeRendering="crispEdges">
      {groups.flatMap((g, gi) =>
        g.map((pts, i) => <polyline key={gi + '-' + i} points={pts} className={gi < open ? 'on' : ''} />),
      )}
    </svg>
  )
}

/** Награда на сцене: вещь — карточка и слово редкости, валюта — большая сумма. */
function BigReward({ r }: { r: CaseReward }) {
  if (r.item) {
    return (
      <>
        <b className="rv2-rar">{RARITY_NAME_SHORT[r.item.rarity]}</b>
        <RewardCard r={r} big />
      </>
    )
  }
  const n = r.amount ?? 0
  return (
    <div className="rv2-cash" style={{ ['--sh-tone' as string]: rewardTone(r) } as CSSProperties}>
      <span className="rv2-cash-pic">{r.kind === 'rubies' ? <Ruby size={150} /> : <Shard size={150} />}</span>
      <b className="rv2-cash-n">+{n.toLocaleString('ru-RU')}</b>
      <span className="rv2-cash-w">{r.kind === 'rubies' ? word(n) : shardWord(n)}</span>
    </div>
  )
}

/** Карточка награды: картинка на плашке, слово редкости, имя или сумма. */
export function RewardCard({ r, big }: { r: CaseReward; big?: boolean }) {
  const tone = rewardTone(r)
  return (
    <div className={'rv2-card' + (big ? ' is-big' : '')} style={{ ['--sh-tone' as string]: tone } as CSSProperties} data-rar={r.item?.rarity}>
      <span className="rv2-pic">
        {r.item ? (
          // PxThumb: расцветка перекрашивается как в магазине, а не загрузилась картинка —
          // значок места на теле вместо значка «битая картинка».
          <PxThumb item={r.item} />
        ) : r.kind === 'rubies' ? (
          <Ruby size={big ? 120 : 64} />
        ) : (
          <Shard size={big ? 120 : 64} />
        )}
        {/* В большой карточке редкость уже написана крупно над ней — плашку не повторяем. */}
        {r.item && !big ? <RarityChip rarity={r.item.rarity} /> : null}
      </span>
      <b className="rv2-name">
        {r.item
          ? r.item.name
          : '+' + (r.amount ?? 0).toLocaleString('ru-RU') + ' ' + (r.kind === 'rubies' ? word(r.amount ?? 0) : shardWord(r.amount ?? 0))}
      </b>
      {r.item && r.kind === 'cheap' && r.amount ? <span className="rv2-plus">+{r.amount.toLocaleString('ru-RU')}</span> : null}
      {r.kind === 'fragments' && r.frag ? (
        <span className="rv2-frag">
          <FragBar have={r.frag.have} need={r.frag.need} rarity={r.item?.rarity} gain={r.amount} />
        </span>
      ) : null}
      {r.dup ? <span className="rv2-dup">повтор</span> : null}
    </div>
  )
}

export function CaseReveal({
  title,
  tier,
  tint,
  color,
  hits: base = HITS,
  floor,
  deal = false,
  early = false,
  again,
  extra,
  request,
  onFail,
  onDone,
  onClose,
  onWear,
}: {
  title: string
  tier: ChestTier
  tint?: string
  /** Цвет ящика: фон, лучи. */
  color: string
  /** Сколько ударов до взрыва. */
  hits?: number
  /** Гарантия ящика: с её цвета стартует свечение и растёт до итога. Без неё — цвет ящика. */
  floor?: Rarity
  /** ×10: десять карт после взрыва. */
  deal?: boolean
  /** Запрос сразу при показе (покупка уже подтверждена): итог известен до первого удара. */
  early?: boolean
  /** Кнопка в итоге: «Ещё раз ◆690», «Следующий»… */
  again?: { node: ReactNode; primary: boolean; onClick: () => void }
  /** Своё под карточкой награды в итоге (например «Докупить» фрагменты). */
  extra?: (r: CaseReward, i: number) => ReactNode
  /** Запрос открытия: уходит при первом ударе (или сразу, `early`), ответ ждёт конец ударов. */
  request: () => Promise<RevealData>
  onFail: (e: unknown) => void
  onDone: () => void
  onClose: () => void
  onWear: (item: ItemRef) => void
}) {
  const calm = reduced()
  const need = deal ? Math.max(base, 4) : base
  const [phase, setPhase] = useState<Phase>('hit')
  const [hits, setHits] = useState(0)
  const [kick, setKick] = useState(0)
  const chest$ = useRef<HTMLSpanElement>(null)
  const root$ = useRef<HTMLDivElement>(null)
  const [opens, setOpens] = useState<CaseOpenView[] | null>(null)
  const [shown, setShown] = useState(0)
  /** ×10: сколько карт уже перевёрнуто (по порядку `order`). */
  const [flipped, setFlipped] = useState(0)
  const asked = useRef<Promise<RevealData> | null>(null)
  const alive = useRef(true)
  const finished = useRef(false)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
  const rewards = opens ? opens[0]!.rewards : null

  const begin = () => {
    if (asked.current) return
    asked.current = request()
    asked.current.then(
      (d) => {
        const list = opensOfData(d)
        // Картинки наград грузятся, пока игрок добивает сундук: на выходе — сразу видны.
        for (const o of list) for (const x of o.rewards) if (x.item?.preview) new Image().src = x.item.preview
        if (alive.current) setOpens(list)
      },
      (e) => alive.current && onFail(e),
    )
  }

  useEffect(() => {
    alive.current = true
    if (early) begin()
    // Сундук появился и трясётся — низкий стук дерева.
    if (!reduced()) later(() => alive.current && playCase({ t: 'rumble' }, timers.current), 260)
    return () => {
      alive.current = false
      timers.current.forEach((t) => window.clearTimeout(t))
      // Закрыли до итога, а покупка уже прошла — список ящиков всё равно обновить.
      if (asked.current && !finished.current) onDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ── Рост редкости: ступени от пола до итога ── */
  const ladder = useMemo(() => (floor ? revealLadder(floor, opens ? finalRarity(opens) : undefined) : []), [floor, opens])
  const step = ladder.length ? ladderAt(ladder, opens ? hits : Math.min(hits, 0), need) : 0
  const lvl = ladder.length ? ladder[step]! : undefined
  const lvlTone = lvl ? RARITY_TONE[lvl] : color
  const prevStep = useRef(0)
  const [ups, setUps] = useState(0)
  useEffect(() => {
    if (step > prevStep.current && phase === 'hit') {
      setUps((n) => n + 1)
      playCase({ t: 'up', rarity: ladder[step]! }, timers.current)
    }
    prevStep.current = step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ×10: порядок карт, лучшая — последней.
  const order = useMemo(() => (opens && deal ? dealOrder(opens) : []), [opens, deal])

  // Ответ пришёл, удары кончились — вспышка, потом первая награда из сундука (или карты ×10).
  const bursting = useRef(false)
  useEffect(() => {
    if (!opens || hits < need || phase !== 'hit' || bursting.current) return
    if (!opens.length || !opens[0]!.rewards.length) return onFail('empty')
    bursting.current = true
    // Последний удар поднял редкость — дать увидеть итоговую ступень, потом взрыв.
    const hold = !calm && ladder.length > 1 ? 560 : 0
    later(() => {
      if (!alive.current) return
      setPhase('burst')
      playCase({ t: 'burst' }, timers.current)
    }, hold)
    later(() => {
      if (!alive.current) return
      if (deal) {
        setPhase('deal')
        if (calm) setFlipped(opens.length)
      } else {
        setPhase('card')
        sting(opens[0]!.rewards[0]!)
      }
    }, calm ? 0 : hold + BURST_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opens, hits, phase])

  const dealDone = deal && !!opens && flipped >= opens.length
  useEffect(() => {
    if (phase === 'sum' || dealDone) {
      finished.current = true
      onDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, dealDone])

  const hit = () => {
    if (phase !== 'hit' || hits >= need) return
    begin()
    const last = hits + 1 >= need
    setHits((n) => n + 1)
    setKick((n) => n + 1)
    playCase({ t: 'hit', i: Math.min(hits, 2), last }, timers.current)
    // Удар — анимацией самого элемента: перемонтаж (key) гасил 3D-сундук на кадр.
    // Первые 16% — стоп-кадр в сплющенной позе (hit-stop).
    chest$.current?.animate?.(
      [
        { transform: 'translateY(14px) scale(1.12, 0.84)' },
        { transform: 'translateY(14px) scale(1.12, 0.84)', offset: 0.18 },
        { transform: 'translateY(-24px) scale(0.94, 1.1) rotate(' + (hits % 2 ? 3 : -3) + 'deg)', offset: 0.48 },
        { transform: 'translateY(0) scale(1.02, 0.98) rotate(' + (hits % 2 ? -1 : 1) + 'deg)', offset: 0.74 },
        { transform: 'none' },
      ],
      { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
    // Тряска всей сцены, на последнем ударе — сильнее.
    const a = last ? 12 : 4 + hits * 2
    root$.current?.animate?.(
      [{ transform: 'none' }, { transform: `translate(${a}px, ${-a / 2}px)` }, { transform: `translate(${-a}px, ${a / 2}px)` }, { transform: 'none' }],
      { duration: 180, delay: 60, easing: 'steps(4, end)' },
    )
  }

  /** Нажатие на открытой награде — следующая из сундука, после последней — итог. */
  const next = () => {
    if (phase !== 'card' || !rewards) return
    if (shown + 1 < rewards.length) {
      setShown((n) => n + 1)
      sting(rewards[shown + 1]!)
    } else setPhase('sum')
  }

  /** ×10: перевернуть следующую карту; лучшая (последняя) — с фанфарами. */
  const flipNext = () => {
    if (phase !== 'deal' || !opens || flipped >= opens.length) return
    const o = opens[order[flipped]!]!
    const isBest = flipped === opens.length - 1
    const r = o.rarity ?? o.rewards[0]?.item?.rarity
    playCase(isBest && rarityRank(r) >= rarityRank('RARE') ? { t: 'best', rarity: r } : { t: 'flip', rarity: o.kind === 'item' ? r : undefined }, timers.current)
    setFlipped((n) => n + 1)
  }
  /** «Открыть все»: остальные карты по очереди, лучшая — после паузы. */
  const flipAll = () => {
    if (phase !== 'deal' || !opens) return
    timers.current.forEach((t) => window.clearTimeout(t))
    const total = opens.length
    for (let i = flipped; i < total - 1; i++) later(() => alive.current && setFlipped((n) => Math.max(n, i + 1)), (i - flipped) * 110)
    if (flipped < total) {
      later(() => {
        if (!alive.current) return
        const o = opens[order[total - 1]!]!
        const r = o.rarity ?? o.rewards[0]?.item?.rarity
        playCase(rarityRank(r) >= rarityRank('RARE') ? { t: 'best', rarity: r } : { t: 'flip' }, timers.current)
        setFlipped(total)
      }, Math.max(0, total - 1 - flipped) * 110 + 520)
    }
    playCase({ t: 'flip' }, timers.current)
  }

  const skip = () => {
    if (!opens) return
    timers.current.forEach((t) => window.clearTimeout(t))
    bursting.current = true
    setHits(need)
    if (deal) {
      setPhase('deal')
      setFlipped(opens.length)
    } else setPhase('sum')
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (phase === 'sum' || dealDone || (phase === 'hit' && !asked.current)) onClose()
        else skip()
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (phase === 'hit') hit()
        else if (phase === 'card') next()
        else if (phase === 'deal') flipNext()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  // Без анимаций: удары не нужны, сразу ответ и награды.
  useEffect(() => {
    if (!calm) return
    begin()
    setHits(need)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const main = rewards?.[0]
  const cur = rewards?.[shown]
  // Лучи и вспышка — цвета той награды, что сейчас на экране; на ударах — цвета ступени редкости.
  const flashTone = phase === 'card' && cur ? rewardTone(cur) : phase === 'hit' || phase === 'burst' ? lvlTone : main ? rewardTone(main) : color
  const top = rewards ? Math.max(...rewards.map(rewardRank)) : 0
  const items = (rewards ?? []).filter((r) => r.item && r.kind === 'item').map((r) => r.item!)
  const left = rewards ? rewards.length - shown - 1 : 0
  const glow = useMemo(() => Math.min(1, hits / need), [hits, need])
  const showChest = phase === 'hit' || phase === 'burst' || phase === 'card'

  return createPortal(
    <div
      ref={root$}
      className={'rv2 rv2-ph-' + phase + (deal ? ' is-multi' : '') + (lvl ? ' has-lvl' : '')}
      role="dialog"
      aria-label={'Открытие: ' + title}
      style={{ ['--box' as string]: color, ['--rw-tone' as string]: color, ['--glow' as string]: glow, ['--flash' as string]: flashTone, ['--lvl' as string]: lvlTone } as CSSProperties}
      onClick={phase === 'hit' ? hit : phase === 'card' ? next : phase === 'deal' && !dealDone ? flipNext : undefined}
    >
      <Rays className="rv2-rays on" />
      {phase === 'sum' || dealDone ? (
        <button className="btn sm ghost rv2-skip" aria-label="Закрыть" data-track="case_close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
      ) : phase === 'deal' ? (
        <button className="btn sm primary rv2-skip" data-track="case_flip_all" onClick={(e) => (e.stopPropagation(), flipAll())}>
          Открыть все
        </button>
      ) : (
        <button className="btn sm secondary rv2-skip" data-track="case_skip" onClick={(e) => (e.stopPropagation(), skip())} disabled={!opens}>
          Пропустить
        </button>
      )}

      {showChest ? (
        // Один и тот же сундук на всех шагах: 3D не перемонтируется, в наградах он уезжает вниз.
        <div className={'rv2-stage' + (phase === 'card' ? ' is-low' : '')}>
          <span className="rv2-halo" aria-hidden="true" />
          <span className={'rv2-chest' + (phase === 'burst' ? ' pop' : '')}>
            <span ref={chest$} className="rv2-hitbox">
              <Chest3D tier={tier} tint={tint} mode={phase === 'hit' ? (hits ? 'shake' : 'ready') : 'open'} framing="hero" look="model" flatSize={300} noFlat />
            </span>
            {/* Свет из щелей и трещины — сильнее с каждым ударом. */}
            <i className="rv2-leak" aria-hidden="true" />
            {phase === 'hit' ? <Cracks hits={hits} need={need} more={deal} /> : null}
          </span>
          {ups && phase === 'hit' ? <i key={'u' + ups} className="rv2-flash rv2-up-flash" aria-hidden="true" /> : null}
          {kick && phase === 'hit' ? <Burst key={'b' + kick} n={12 + hits * 6 + step * 10} spread={160 + hits * 40 + step * 30} seed={kick} /> : null}
          {phase === 'hit' ? (
            <>
              {lvl && lvl !== 'COMMON' ? (
                <b key={'l' + step} className={'rv2-lvl' + (step ? ' is-up' : '')} data-rar={lvl}>
                  {RARITY_NAME_SHORT[lvl] + (step === 0 && hits < need ? '+' : '')}
                </b>
              ) : null}
              <span className="rv2-pips" aria-label={'Ударов: ' + hits + ' из ' + need}>
                {Array.from({ length: need }, (_, i) => (
                  <i key={i} className={i < hits ? 'on' : ''} />
                ))}
              </span>
              <b key={'t' + kick} className="rv2-tap">
                Жми!
              </b>
            </>
          ) : phase === 'burst' ? (
            <>
              <i className="rv2-flash" aria-hidden="true" />
              <Burst n={deal ? 72 : 48} spread={deal ? 640 : 520} seed={99} />
            </>
          ) : left > 0 ? (
            <span className="rv2-left" aria-label={'Осталось наград: ' + left}>
              {left}
            </span>
          ) : null}
        </div>
      ) : null}

      {phase === 'card' && cur ? (
        <div className="rv2-one">
          {rewardRank(cur) >= rarityRank('EPIC') ? <Confetti key={'c' + shown} /> : null}
          <i className="rv2-flash" aria-hidden="true" key={'f' + shown} />
          <Burst key={'p' + shown} n={18 + rewardRank(cur) * 6} spread={240 + rewardRank(cur) * 30} seed={shown + 7} />
          <div key={shown} className="rv2-slam">
            <BigReward r={cur} />
          </div>
          <b className="rv2-tap is-small">Жми</b>
        </div>
      ) : null}

      {phase === 'deal' && opens ? (
        <Deal opens={opens} order={order} flipped={flipped} done={dealDone} title={title} again={again} onClose={onClose} onWear={onWear} />
      ) : null}

      {phase === 'sum' && rewards ? (
        <div className="rv2-sum" onClick={(e) => e.stopPropagation()}>
          {top >= rarityRank('EPIC') ? <Confetti /> : null}
          <b className="rv2-sum-title">{title}</b>
          <div className="rv2-grid">
            {rewards.map((r, i) => (
              <div key={i} className="rv2-sum-cell" style={{ ['--i' as string]: i } as CSSProperties}>
                <RewardCard r={r} />
                {extra ? extra(r, i) : null}
              </div>
            ))}
          </div>
          <span className="rv2-acts">
            {items.length ? (
              <button className="btn lg primary" data-track="case_wear" onClick={() => onWear(items[0]!)}>
                Надеть
              </button>
            ) : null}
            {again ? (
              <button className={'btn lg ' + (again.primary ? 'primary' : 'secondary')} data-track="case_again" onClick={again.onClick}>
                {again.node}
              </button>
            ) : (
              <button className="btn lg secondary" data-track="case_done" onClick={onClose}>
                Готово
              </button>
            )}
          </span>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}

/** Главная награда ящика для карты ×10: вещь (или дешёвая вещь промаха), иначе первая сумма. */
const mainOf = (o: CaseOpenView): CaseReward => o.rewards.find((r) => r.item) ?? o.rewards[0]!

/**
 * ×10: десять карт рубашкой вверх, переворачиваются по одной. Лучшая — последней,
 * с лучами и конфетти. Когда открыты все — та же сетка становится итогом:
 * «Надеть» под вещами, сумма валюты одной строкой, «Ещё ×10».
 */
function Deal({
  opens,
  order,
  flipped,
  done,
  title,
  again,
  onClose,
  onWear,
}: {
  opens: CaseOpenView[]
  order: number[]
  flipped: number
  done: boolean
  title: string
  again?: { node: ReactNode; primary: boolean; onClick: () => void }
  onClose: () => void
  onWear: (item: ItemRef) => void
}) {
  const bestAt = order[order.length - 1]!
  const best = opens[bestAt]!
  const bestRank = best.kind === 'item' ? rarityRank(best.rarity ?? best.rewards[0]?.item?.rarity) : -1
  // Валюта всех ящиков одной строкой: утешение и бонусы.
  let rubies = 0
  let shards = 0
  for (const o of opens) for (const r of o.rewards) if (r.kind === 'rubies') rubies += r.amount ?? 0
  else if (r.kind === 'shards') shards += r.amount ?? 0
  return (
    <div className={'rv3-deal' + (done ? ' is-done' : '')} onClick={done ? (e) => e.stopPropagation() : undefined}>
      {done && bestRank >= rarityRank('EPIC') ? <Confetti n={70} /> : null}
      {done ? <b className="rv2-sum-title">{title + ' ×' + opens.length}</b> : null}
      <div className="rv3-grid">
        {order.map((oi, at) => {
          const o = opens[oi]!
          const r = mainOf(o)
          const on = at < flipped
          const isBest = at === order.length - 1
          const rar = o.rarity ?? r.item?.rarity
          const hot = o.kind === 'item' && rarityRank(rar) >= rarityRank('EPIC')
          return (
            <div
              key={oi}
              className={'rv3-cell' + (on ? ' on' : '') + (isBest && on ? ' is-best' : '') + (hot ? ' is-hot' : '')}
              style={{ ['--i' as string]: at, ['--sh-tone' as string]: rewardTone(r) } as CSSProperties}
            >
              {isBest && on && bestRank >= rarityRank('RARE') ? (
                <>
                  <Rays className="rv3-best-rays on" />
                  <i className="rv2-flash" aria-hidden="true" />
                  <Burst n={40} spread={300} seed={41} />
                </>
              ) : null}
              <div className="rv3-flip">
                <span className="rv3-back" aria-hidden="true">
                  <Icon id="i-chest" />
                </span>
                <span className="rv3-face">
                  <RewardCard r={r} />
                </span>
              </div>
              {done && r.item && (r.kind === 'item' || r.kind === 'cheap') ? (
                <button className="btn sm secondary rv3-wear" data-track="case_wear" onClick={() => onWear(r.item!)}>
                  Надеть
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
      {done ? (
        <>
          {rubies || shards ? (
            <span className="rv3-cash">
              {rubies ? (
                <span>
                  <Ruby size={20} />+{rubies.toLocaleString('ru-RU')}
                </span>
              ) : null}
              {shards ? (
                <span>
                  <Shard size={20} />+{shards.toLocaleString('ru-RU')}
                </span>
              ) : null}
            </span>
          ) : null}
          <span className="rv2-acts">
            {again ? (
              <button className={'btn lg ' + (again.primary ? 'primary' : 'secondary')} data-track="case_again_x10" onClick={again.onClick}>
                {again.node}
              </button>
            ) : null}
            <button className="btn lg secondary" data-track="case_done" onClick={onClose}>
              Готово
            </button>
          </span>
        </>
      ) : (
        <b className="rv2-tap is-small">Жми</b>
      )}
    </div>
  )
}
