import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { RARITY_TONE } from '../shop/rarity'
import type { CaseReward, ChestDrop, ChestTier, ItemRef, PendingChest } from '../../lib/rubies'
import { playSound } from '../../lib/sound'
import { useDaily, type ChestOpenAnswer } from '../../state/daily'
import { showToast } from '../../state/ui'
import { CHEST_DROPS, TIER_ORDER, viewOf } from './chestDrops'
import { CHEST_NAME } from './rewards'
import { CaseReveal } from '../chest/CaseReveal'
import '../../styles/pixel/chestopen.css'
import { topUpFragments } from '../shop/topUp'
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
 * уже есть.
 */


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

/** Выпадение сундука → награда общего открытия (CaseReveal). */
export function dropReward(d: ChestDrop): CaseReward {
  if (d.kind === 'SHARDS') return { kind: 'shards', amount: d.amount }
  if (d.kind === 'RUBIES') return { kind: 'rubies', amount: d.amount }
  const v = d.variant
  const item: ItemRef | undefined = d.item
    ? {
        code: d.item.code + (v?.name ? '~' + v.name : ''),
        name: d.item.name,
        slot: d.item.slot,
        rarity: d.rarity,
        preview: d.item.previewUrl,
        ...(v?.from ? { tintFrom: v.from.replace('#', ''), color: v.color.replace('#', ''), variant: v.name } : v ? { variant: v.name } : {}),
      }
    : undefined
  if (d.kind === 'FRAGMENTS') {
    // Все вещи редкости уже есть — фрагменты ушли осколками.
    if (!item) return { kind: 'shards', amount: d.shards }
    return { kind: 'fragments', item, amount: d.amount, frag: { have: d.have, need: d.need } }
  }
  if (!item) return { kind: 'shards', amount: d.shards }
  return d.duplicate ? { kind: 'item', item, dup: true, amount: d.rubies || d.shards } : { kind: 'item', item }
}

/** Цвет сундука до ударов — его уровень. */
const TIER_TONE: Record<ChestTier, string> = {
  COMMON: '#ffcf52',
  RARE: RARITY_TONE.RARE,
  EPIC: RARITY_TONE.EPIC,
  LEGEND: RARITY_TONE.LEGENDARY,
}

/**
 * Одно открытие сундука бонуса, пропуска, за игру и т.п. — тем же общим
 * открытием, что ящики магазина (CaseReveal): огромный 3D-сундук, удары,
 * взрыв, награды по одной, итог. Фрагменты в итоге можно докупить.
 */
function Opening({ chest, left, onDone, onNext }: { chest: PendingChest; left: number; onDone: () => void; onNext: () => void }) {
  const tier = chest.tier
  const [drops, setDrops] = useState<ChestDrop[]>([])
  const [bought, setBought] = useState<Set<number>>(() => new Set())
  const [buying, setBuying] = useState(-1)
  const [need, setNeed] = useState(CHEST_DROPS[tier].hits)
  const request = () =>
    openOnce(chest.id).then((a) => {
      if (!('ok' in a)) throw new Error(a.error)
      const view = viewOf(a.ok)
      setDrops(view.drops)
      setNeed(view.hits)
      return view.drops.map(dropReward)
    })
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
  return (
    <CaseReveal
      title={CHEST_NAME[tier] + ' сундук'}
      tier={tier}
      color={TIER_TONE[tier]}
      hits={need}
      request={request}
      onFail={(e) => {
        playSound('error')
        showToast(e instanceof Error ? e.message : 'Сундук не открылся, попробуй позже', 'error')
        onDone()
      }}
      onDone={() => undefined}
      onClose={onDone}
      onWear={() => wear()}
      again={left > 0 ? { primary: true, onClick: onNext, node: <>Следующий · ещё {left}</> } : undefined}
      extra={(_r, i) => {
        const d = drops[i]
        const topUp = d && d.kind === 'FRAGMENTS' && d.item && !d.completed && d.topUp ? d.topUp : 0
        if (!d || d.kind !== 'FRAGMENTS' || !topUp) return null
        return bought.has(i) ? (
          <span className="co-topup-done">
            <Icon id="i-check" /> Твоя
          </span>
        ) : (
          <button
            type="button"
            className="btn sm secondary co-topup"
            disabled={buying === i}
            data-track="chest_topup"
            onClick={async () => {
              setBuying(i)
              const res = await topUpFragments(dropReward(d).item!, topUp)
              setBuying(-1)
              if (res) setBought((was) => new Set(was).add(i))
            }}
          >
            Докупить <Ruby size={14} /> {topUp.toLocaleString('ru-RU')}
          </button>
        )
      }}
    />
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
