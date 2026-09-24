import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../Icon'
import { Burst, Confetti, Rays } from '../reward/RewardReveal'
import { Shard } from '../shop/parts'
import { Ruby } from '../Ruby'
import { useVariantPreview } from '../../lib/variantArt'
import { fragmentWord, RARITY_TONE, rarityProps, shardWord, word } from '../shop/rarity'
import { FragBar, FragmentIcon, RarityFx, RarityPlate } from '../shop/rarityUi'
import { loadRules, type ChestDrop, type ChestTier, type PendingChest, type Rarity, type Rules } from '../../lib/rubies'
import { playSound } from '../../lib/sound'
import { useDaily, type ChestOpenAnswer } from '../../state/daily'
import { CHEST_DROPS, CHEST_ODDS, bpOf, hasRarity, pctOfBp, PITY_AFTER, PITY_LEGEND_AFTER, RARITY_NAME, RARITY_ORDER, TIER_ORDER, viewOf, type OpenedView } from './chestDrops'
import { burstSound, cardSound, hitSound, teaseSound } from './chestSound'
import { chestSprite, CRACK_STEPS, SPRITE_H, SPRITE_W } from './chestSprite'
import { CHEST_NAME } from './rewards'
import '../../styles/pixel/chestopen.css'
import { wearNow } from '../../state/wearIntent'

/*
 * Открытие сундука как в Brawl Stars (жалоба владельца 24.09.2026, 16:48:
 * «открытие как в Brawl Stars — нажимать много раз»).
 *
 *   удары   сундук крупно по центру; каждое нажатие — тряска, трещина со
 *           светом, нота на ступень выше; свет в щелях разгорается до цвета
 *           лучшей вещи внутри (тизер, как у Starr Drop). Ударов 3–5 по уровню.
 *   взрыв   на последнем — вспышка, лучи, крышка вверх, аккорд.
 *   карты   награды по одной: осколки, потом вещи. Эпическая и легендарная
 *           сначала показывают рубашку своего цвета и дрожат (пауза-тизер),
 *           потом раскрываются с конфетти. «Дальше» — клик в любом месте.
 *   итог    всё выпавшее сеткой; «Надеть», если пришло новое; следующий
 *           сундук, если открывали несколько.
 *
 * Запрос к службе уходит сразу при открытии окна — к последнему удару ответ
 * уже есть. Шансы на витрине не печатаются (решение владельца), только «i»
 * внутри открытия.
 */

type Stage = 'hit' | 'burst' | 'card' | 'sum' | 'error'

interface Flow {
  queue: PendingChest[]
  /** Смонтированные окна (бонус в магазине и окно бонуса): рисует последнее. */
  hosts: number[]
  start: (list: PendingChest[]) => void
  next: () => void
  close: () => void
}

/** Очередь сундуков на открытие: один за другим, окно одно. */
export const useChestOpen = create<Flow>((set, get) => ({
  queue: [],
  hosts: [],
  start: (list) => {
    if (!list.length || get().queue.length) return
    set({ queue: list.slice() })
  },
  next: () => set({ queue: get().queue.slice(1) }),
  close: () => set({ queue: [] }),
}))

export const openChestFlow = (list: PendingChest[]) => useChestOpen.getState().start(list)

/** Один запрос на сундук, даже если окно смонтируется дважды. */
const inflight = new Map<string, Promise<ChestOpenAnswer>>()
function openOnce(id: string): Promise<ChestOpenAnswer> {
  let p = inflight.get(id)
  if (!p) {
    p = useDaily.getState().openOne(id)
    inflight.set(id, p)
    // Ошибку можно повторить при следующем открытии окна.
    void p.then((a) => 'error' in a && inflight.delete(id))
  }
  return p
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const rank = (r: Rarity) => RARITY_ORDER.indexOf(r)
const tone = (r: Rarity) => RARITY_TONE[r]
/** Цвет сундука до ударов — его уровень. */
const TIER_TONE: Record<ChestTier, string> = {
  COMMON: '#ffcf52',
  RARE: RARITY_TONE.RARE,
  EPIC: RARITY_TONE.EPIC,
  LEGEND: RARITY_TONE.LEGENDARY,
}

/** Карточка награды. `tease` — рубашка цвета редкости до раскрытия. */
function DropCard({ d, tease, small, tier = 'COMMON' }: { d: ChestDrop; tease?: boolean; small?: boolean; tier?: ChestTier }) {
  const [broken, setBroken] = useState(false)
  // Вещь-расцветка (v3.1): превью в свою расцветку.
  const v = hasRarity(d) ? d.variant : null
  const tinted = useVariantPreview(hasRarity(d) ? d.item?.previewUrl : null, v?.from, v?.from ? v.color : null)
  const size = small ? 64 : 148
  let art
  let title: string
  let sub: string | null = null
  let foot = null
  if (d.kind === 'SHARDS') {
    art = <Shard size={small ? 44 : 96} />
    title = '+' + d.amount.toLocaleString('ru-RU')
    sub = shardWord(d.amount)
  } else if (d.kind === 'RUBIES') {
    art = <Ruby size={small ? 40 : 88} />
    title = '+' + d.amount.toLocaleString('ru-RU')
    sub = word(d.amount)
  } else {
    const src = tinted
    const pic =
      src && !broken ? (
        <img src={src} alt="" width={size} height={size} draggable={false} onError={() => setBroken(true)} />
      ) : (
        <Icon id="i-gift" style={{ width: small ? 36 : 72, height: small ? 36 : 72 }} />
      )
    if (d.kind === 'FRAGMENTS') {
      // Фрагменты вещи (модель v2): картинка вещи, в углу — кусочек пазла и «+6».
      art = (
        <>
          {d.item ? pic : <Shard size={small ? 44 : 96} />}
          {d.item ? (
            <span className="co-frag-gain">
              <FragmentIcon rarity={d.rarity} size={small ? 14 : 22} />+{d.amount}
            </span>
          ) : null}
        </>
      )
      title = d.item?.name || RARITY_NAME[d.rarity] + ' вещь'
      if (!d.item) {
        // Все вещи редкости уже есть — фрагменты ушли осколками.
        title = '+' + d.shards + ' ' + shardWord(d.shards)
        sub = d.amount + ' ' + fragmentWord(d.amount) + ' → осколки'
      } else if (d.completed) {
        sub = 'Собрано!'
      } else {
        foot = <FragBar have={d.have} need={d.need} rarity={d.rarity} gain={d.amount} />
      }
    } else {
      art = pic
      title = d.item?.name || RARITY_NAME[d.rarity] + ' вещь'
      sub = d.duplicate
        ? d.rubies
          ? 'Повтор: +' + d.rubies + ' ' + word(d.rubies)
          : 'Повтор: +' + d.shards + ' ' + shardWord(d.shards)
        : RARITY_NAME[d.rarity]
    }
  }
  const rp = !hasRarity(d)
    ? { style: { ['--co-it' as string]: d.kind === 'RUBIES' ? RARITY_TONE.MYTHIC : RARITY_TONE.RARE } as CSSProperties }
    : rarityProps(d.rarity)
  const dup = (d.kind === 'ITEM' && d.duplicate) || (d.kind === 'FRAGMENTS' && !d.item)
  const done = d.kind === 'FRAGMENTS' && d.completed
  return (
    <span
      className={'co-card' + (small ? ' sm' : '') + (tease ? ' tease' : '') + (dup ? ' dup' : '') + (done ? ' done' : '')}
      {...rp}
    >
      <span className="co-card-plate">
        <i className="co-edge-t" />
        <i className="co-edge-b" />
        {tease ? (
          <span className="co-back" aria-hidden="true">
            <img src={chestSprite(tier, { open: true })} alt="" width={SPRITE_W * 3} height={SPRITE_H * 3} />
          </span>
        ) : (
          <>
            <span className="co-art">{art}</span>
            {hasRarity(d) && !small ? <RarityPlate rarity={d.rarity} small /> : null}
            <b className="co-name">{title}</b>
            {sub ? <span className="co-sub">{sub}</span> : null}
            {foot ? <span className="co-foot">{foot}</span> : null}
          </>
        )}
      </span>
      {!tease && hasRarity(d) ? <RarityFx /> : null}
    </span>
  )
}

/** Панель «i»: что внутри и шансы этого уровня. Только тут, не на витрине. */
function Odds({ tier, rules, onClose }: { tier: ChestTier; rules: Rules | null; onClose: () => void }) {
  const row = rules?.chests.items.find((i) => i.tier === tier)
  const def = CHEST_DROPS[tier]
  const items = row?.items ?? def.items
  const sh = row?.shards ? [row.shards.min, row.shards.max] : def.shards
  const chances = RARITY_ORDER.map((r) => ({
    r,
    p: (() => {
      const c = row?.chances.find((x) => x.rarity === r)
      return c ? bpOf(c) : CHEST_ODDS[tier][r]
    })(),
  })).filter((c) => c.p > 0)
  const pity = rules?.chests.pityAfter ?? PITY_AFTER
  return (
    <div className="co-odds" role="dialog" aria-label="Что внутри" onClick={(e) => e.stopPropagation()}>
      <div className="co-odds-head">
        <b>{CHEST_NAME[tier]} сундук</b>
        <button type="button" className="co-x" aria-label="Закрыть" onClick={onClose}>
          <Icon id="i-x" />
        </button>
      </div>
      <p className="co-odds-line">
        <Shard size={16} /> {sh[0]}–{sh[1]} {shardWord(sh[1])} · вещей: {items}
      </p>
      {def.rubies ? (
        <p className="co-odds-line">
          <Ruby size={16} /> {def.rubies.amount[0]}–{def.rubies.amount[1]} · {def.rubies.pct} %
        </p>
      ) : null}
      <ul className="co-odds-list">
        {chances.map(({ r, p }) => (
          <li key={r} style={{ '--co-it': tone(r) } as CSSProperties}>
            <i />
            <span>{RARITY_NAME[r]}</span>
            <b>{pctOfBp(p)}</b>
          </li>
        ))}
      </ul>
      <p className="co-odds-foot">Эпическая и выше — раз в {pity}, легендарная и выше — раз в {rules?.chests.pityLegendAfter ?? PITY_LEGEND_AFTER} сундуков. Целая вещь — {pctOfBp(def.wholeBp)}, иначе фрагменты.</p>
    </div>
  )
}

/** Одно открытие: удары → взрыв → карточки → итог. */
function Opening({ chest, left, onDone, onNext }: { chest: PendingChest; left: number; onDone: () => void; onNext: () => void }) {
  const reduced = useMemo(reducedMotion, [])
  const tier = chest.tier
  const [view, setView] = useState<OpenedView | null>(null)
  const [error, setError] = useState<{ text: string; outdated?: boolean } | null>(null)
  const [stage, setStage] = useState<Stage>('hit')
  const [hits, setHits] = useState(0)
  const [kick, setKick] = useState(0)
  const [card, setCard] = useState(0)
  const [teasing, setTeasing] = useState(false)
  const [info, setInfo] = useState(false)
  const [rules, setRules] = useState<Rules | null>(null)
  const waitRef = useRef(false)
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms))
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  // Запрос — сразу: к последнему удару ответ уже на руках.
  useEffect(() => {
    let alive = true
    void openOnce(chest.id).then((a) => {
        if (!alive) return
        if ('ok' in a) setView(viewOf(a.ok))
        else {
          setError({ text: a.error, outdated: a.outdated })
          setStage('error')
          playSound('error')
        }
      })
    return () => {
      alive = false
    }
  }, [chest.id])

  const need = view?.hits ?? CHEST_DROPS[tier].hits
  const drops = view?.drops ?? []
  const top = view?.top ?? 'COMMON'

  /* Свет в щелях: от цвета уровня к цвету лучшей вещи, ступенями по ударам. */
  // Эскалация ранга как у Starr Drop: каждый удар может поднять цвет на ступень вверх, до лучшей вещи.
  const climb = useMemo<Rarity | null>(() => {
    if (!hits || !view) return null
    const steps = RARITY_ORDER.slice(0, rank(top) + 1)
    const k = Math.min(steps.length - 1, Math.floor((hits / need) * (steps.length - 1) + 0.0001))
    return steps[Math.max(0, k)]!
  }, [hits, need, top, view])
  const glow = climb ? tone(climb) : TIER_TONE[tier]

  const burst = useCallback(() => {
    setStage('burst')
    burstSound()
    playSound('success')
    later(() => {
      setStage('card')
      setCard(0)
    }, reduced ? 200 : 900)
  }, [reduced])

  // Последний удар пришёлся раньше ответа службы: раскрываемся, как только он придёт.
  useEffect(() => {
    if (waitRef.current && view && stage === 'hit' && hits >= need) {
      waitRef.current = false
      burst()
    }
  }, [view, stage, hits, need, burst])

  const hit = () => {
    if (stage !== 'hit' || hits >= need) return
    const n = hits + 1
    setHits(n)
    setKick((k) => k + 1)
    hitSound(n - 1)
    if (n >= need) {
      if (view) later(burst, reduced ? 0 : 260)
      else waitRef.current = true
    }
  }

  const cur = drops[card]
  // Эпическая и выше — пауза-тизер; собранная вещь — тоже большой момент.
  const isBig = !!cur && hasRarity(cur) && (rank(cur.rarity) >= rank('EPIC') || (cur.kind === 'FRAGMENTS' && cur.completed))

  // Каждая карточка: звук, а эпическая и выше — пауза-тизер рубашкой.
  useEffect(() => {
    if (stage !== 'card' || !cur) return
    if (isBig && !reduced) {
      setTeasing(true)
      teaseSound()
      later(() => {
        setTeasing(false)
        cardSound(rank((cur as { rarity: Rarity }).rarity))
        playSound('achievement')
      }, 1100)
    } else {
      setTeasing(false)
      cardSound(hasRarity(cur) ? rank(cur.rarity) : 1)
    }
  }, [stage, card])

  const advance = () => {
    if (stage === 'hit') return hit()
    if (stage !== 'card' || teasing) return
    if (card + 1 < drops.length) setCard(card + 1)
    else setStage('sum')
  }

  const fresh = drops.some((d) => (d.kind === 'ITEM' && !d.duplicate && d.item) || (d.kind === 'FRAGMENTS' && d.completed))
  const wear = () => {
    onDone()
    useDaily.getState().setModal(false)
    wearNow(
      drops.flatMap((d) =>
        (d.kind === 'ITEM' && !d.duplicate && d.item) || (d.kind === 'FRAGMENTS' && d.completed && d.item)
          ? [{ code: d.item!.code, variant: d.variant?.name }]
          : [],
      ),
    )
  }

  const openInfo = (e: React.MouseEvent) => {
    e.stopPropagation()
    setInfo((v) => !v)
    if (!rules) void loadRules().then(setRules).catch(() => undefined)
  }

  // Клавиатура: пробел/Enter — удар и «Дальше», Esc — закрыть после итога.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (stage === 'sum' || stage === 'error')) onDone()
      else if ((e.key === ' ' || e.key === 'Enter') && (stage === 'hit' || stage === 'card')) {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const crack = Math.min(CRACK_STEPS, Math.round((hits / need) * CRACK_STEPS))
  const sprite = chestSprite(tier, stage === 'burst' || stage === 'card' || stage === 'sum' ? { open: true } : { crack, gray: stage === 'error' })
  const sceneTone = stage === 'card' && cur && hasRarity(cur) ? tone(cur.rarity) : glow
  const k = hits / need

  return (
    <div
      className={'co stage-' + stage + (teasing ? ' teasing' : '') + (isBig && stage === 'card' ? ' big' : '')}
      style={{ '--rw-tone': sceneTone, '--co-glow': glow, '--co-k': String(k) } as CSSProperties}
      onClick={advance}
      role="dialog"
      aria-modal="true"
      aria-label={CHEST_NAME[tier] + ' сундук'}
    >
      <div className="co-head" onClick={(e) => e.stopPropagation()}>
        <b className="co-title">{CHEST_NAME[tier]} сундук</b>
        {left > 0 ? <span className="co-left">ещё {left}</span> : null}
        <button type="button" className="co-i" aria-label="Что внутри" data-track="chest_odds" onClick={openInfo}>
          i
        </button>
        {stage === 'sum' || stage === 'error' ? (
          <button type="button" className="co-x" aria-label="Закрыть" onClick={onDone}>
            <Icon id="i-x" />
          </button>
        ) : null}
      </div>
      {info ? <Odds tier={tier} rules={rules} onClose={() => setInfo(false)} /> : null}

      {stage === 'hit' || stage === 'burst' || stage === 'error' ? (
        <div className="co-stage">
          <Rays className={'co-rays' + (hits || stage === 'burst' ? ' on' : '')} />
          <span className="co-halo" aria-hidden="true" />
          <span key={kick} className={'co-chest tier-' + tier.toLowerCase() + (kick ? ' kick' : '') + (stage === 'burst' ? ' pop' : '')}>
            <img src={sprite} alt="" width={SPRITE_W * 7} height={SPRITE_H * 7} draggable={false} />
          </span>
          {kick && stage === 'hit' ? <Burst key={'b' + kick} n={10 + hits * 4} spread={120 + hits * 30} seed={kick} /> : null}
          {stage === 'burst' ? (
            <>
              <span className="co-flash" aria-hidden="true" />
              <Burst n={40} spread={420} seed={99} />
            </>
          ) : null}
          {stage === 'hit' ? (
            <div className="co-pips" aria-label={'Ударов: ' + hits + ' из ' + need}>
              {Array.from({ length: need }, (_, i) => (
                <i key={i} className={i < hits ? 'on' : ''} />
              ))}
            </div>
          ) : null}
          {stage === 'hit' ? <b className="co-tap">{hits ? 'Ещё!' : 'Жми'}</b> : null}
          {stage === 'error' && error ? (
            <div className="co-err" onClick={(e) => e.stopPropagation()}>
              <b>{error.text}</b>
              <button type="button" className="btn md secondary" onClick={onDone}>
                Закрыть
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {stage === 'hit' && climb ? (
        <b key={climb} className="co-climb" data-rar={climb} style={{ '--co-it': tone(climb) } as CSSProperties}>
          {RARITY_NAME[climb]}
        </b>
      ) : null}

      {stage === 'card' && cur ? (
        <div className="co-stage">
          <Rays className="co-rays on" />
          {!teasing ? <Burst key={'c' + card} n={isBig ? 44 : 22} spread={isBig ? 380 : 240} seed={card + 3} /> : null}
          {isBig && !teasing ? <Confetti key={'f' + card} n={cur.kind === 'FRAGMENTS' && cur.completed ? 70 : 46} seed={card} /> : null}
          <span key={card + (teasing ? 't' : 'r')} className={'co-fly' + (teasing ? ' tease' : '')}>
            <DropCard d={cur} tease={teasing} tier={tier} />
          </span>
          <div className="co-count">
            {card + 1} / {drops.length}
          </div>
          <button
            type="button"
            className="btn lg primary co-next"
            disabled={teasing}
            data-track="chest_next_drop"
            onClick={(e) => {
              e.stopPropagation()
              advance()
            }}
          >
            Дальше
          </button>
        </div>
      ) : null}

      {stage === 'sum' ? (
        <div className="co-sum" onClick={(e) => e.stopPropagation()}>
          <div className="co-grid">
            {drops.map((d, i) => (
              <span key={i} className="co-sum-cell" style={{ '--i': i } as CSSProperties}>
                <DropCard d={d} small />
              </span>
            ))}
          </div>
          {view?.pityLeft ? (
            <p className="co-pity">
              До эпической <b>{view.pityLeft.epic}</b> · до легендарной <b>{view.pityLeft.legend}</b>
            </p>
          ) : null}
          <div className="co-acts">
            {fresh ? (
              <button type="button" className="btn lg secondary" data-track="chest_wear" onClick={wear}>
                Надеть
              </button>
            ) : null}
            {left > 0 ? (
              <button type="button" className="btn lg primary" data-track="chest_next" onClick={onNext}>
                Следующий
              </button>
            ) : (
              <button type="button" className="btn lg primary" data-track="chest_done" onClick={onDone}>
                Готово
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Окно открытия поверх всего: живёт, пока в очереди есть сундуки. */
let hostSeq = 0

export function ChestOpenHost() {
  const [me] = useState(() => ++hostSeq)
  const queue = useChestOpen((s) => s.queue)
  const last = useChestOpen((s) => s.hosts[s.hosts.length - 1])
  useEffect(() => {
    useChestOpen.setState((s) => ({ hosts: [...s.hosts, me] }))
    return () => useChestOpen.setState((s) => ({ hosts: s.hosts.filter((h) => h !== me) }))
  }, [me])
  const chest = last === me ? queue[0] : undefined
  useEffect(() => {
    if (!chest) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [!!chest])
  if (!chest) return null
  return createPortal(
    <Opening
      key={chest.id}
      chest={chest}
      left={queue.length - 1}
      onDone={() => useChestOpen.getState().close()}
      onNext={() => useChestOpen.getState().next()}
    />,
    document.body,
  )
}

export { TIER_ORDER }
