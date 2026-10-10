import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { create } from 'zustand'
import { Milli } from './Milli'
import { PxArt } from './px'
import { PxIcon } from '../PxIcon'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { seasonCell, TRACK_DAYS } from '../daily/track'
import type { Reward } from '../../lib/rubies'
import { useDaily } from '../../state/daily'
import { closeMilli, useMilli } from '../../state/milli'
import { useUi } from '../../state/ui'
import { milliLook, milliPlanNumbers } from '../../lib/milli'
import { loadCosmeticCatalog, type PlusTier } from '../../lib/gameProfile'
import '../../styles/pixel/plus.css'
import '../../styles/pixel/milli-plus.css'

/*
 * PLUS прямо в чате Милли (владелец 05.10.2026). Своего «стиля» нет: те же детали, что на экране
 * PLUS и в магазине — полосы «Без PLUS / PLUS» (lp-bars, lp-kinds), карточки наград sh-perk-card
 * (рубины, сундук), золото --m-rarity-legendary, переключатель segs и кнопки лаунчера.
 * Милли в короне — тот же спрайт (crown). Цифры живые: лимиты /catalog/milli/limits,
 * рубины и сундук — дорожка PLUS за 28 дней (как Plus.tsx).
 */

export const useMilliPlusSheet = create<{ open: boolean; src: string }>(() => ({ open: false, src: '' }))

export function openPlusSheet(src: string) {
  useMilliPlusSheet.setState({ open: true, src })
}

const closeSheet = () => useMilliPlusSheet.setState({ open: false })

/** Награды дорожки PLUS за 28 дней — тот же источник, что у экрана PLUS (Plus.tsx totals). */
const PASS = (() => {
  const t = { rubies: 0, chests: 0, legend: 0 }
  for (let i = 1; i <= TRACK_DAYS; i++)
    for (const r of seasonCell(i).plus as Reward[]) {
      if (r.kind === 'RUBIES') t.rubies += r.amount
      else if (r.kind === 'CHEST') {
        t.chests += 1
        if (r.tier === 'LEGEND') t.legend += 1
      }
    }
  return t
})()

const fmt = (v: number) => v.toLocaleString('ru-RU')

/** Вещи для витрины: те же, что на экране PLUS (Plus.tsx LOOT), добор — самые редкие из магазина с картинкой. */
const LOOT = ['FIRE_WINGS_REMASTER', 'AXOLOTL', 'CHERRY_BLOSSOM_PARTICLES', 'NITRO_GEM', 'ANGEL_WINGS', 'CAPYBARA']
const RANK: Record<string, number> = { LEGENDARY: 0, EPIC: 1, RARE: 2, UNCOMMON: 3, COMMON: 4 }
const POOL = 12
type Loot = { id: string; name: string; preview: string; rarity: string }
let lootCache: Loot[] | null = null
function useLoot(): Loot[] {
  const [loot, setLoot] = useState<Loot[]>(lootCache ?? [])
  useEffect(() => {
    if (lootCache) return
    let alive = true
    loadCosmeticCatalog()
      .then((c) => {
        const shop = c.items.filter((i) => i.channel === 'SHOP' && !i.staffOnly && i.preview && !i.name.startsWith('('))
        const by = new Map(shop.map((i) => [((i as { baseId?: string }).baseId || i.id) as string, i]))
        const picked = LOOT.map((id) => by.get(id)).filter((i): i is NonNullable<typeof i> => !!i)
        const rest = shop.filter((i) => !picked.includes(i)).sort((a, b) => (RANK[(a.rarity || '').toUpperCase()] ?? 5) - (RANK[(b.rarity || '').toUpperCase()] ?? 5))
        for (const i of rest) if (picked.length < POOL && !picked.some((x) => x.preview === i.preview)) picked.push(i)
        lootCache = picked.map((i) => ({ id: i.id, name: i.name, preview: i.preview!, rarity: (i.rarity || '').toLowerCase() }))
        if (alive) setLoot(lootCache)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return loot
}

/**
 * Витрина «Косметика в лаунчере»: 4 ячейки, каждые ~2 с одна вещь сменяется
 * следующей из пула (по кругу, без повторов на экране) — видно, сколько всего
 * можно выбить. Без движения (reduced motion) — стоят первые четыре.
 */
function useShowcase(loot: Loot[]): (Loot | null)[] {
  const [slots, setSlots] = useState<number[]>([0, 1, 2, 3])
  const next = useRef(4)
  const tick = useRef(0)
  useEffect(() => {
    if (loot.length <= 4) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = window.setInterval(() => {
      setSlots((cur) => {
        const out = [...cur]
        let n = next.current % loot.length
        for (let g = 0; g < loot.length && out.includes(n); g++) n = (n + 1) % loot.length
        out[[0, 2, 1, 3][tick.current++ % 4]!] = n
        next.current = n + 1
        return out
      })
    }, 2100)
    return () => window.clearInterval(t)
  }, [loot.length])
  return slots.map((i) => loot[i] ?? null)
}

const KINDS = [
  { icon: 'sun', label: 'Шейдеры' },
  { icon: 'image', label: 'Ресурс-паки' },
  { icon: 'map', label: 'Карты' },
  { icon: 'server', label: 'Сервер в 1 клик' },
]

export function MilliPlusSheet() {
  const open = useMilliPlusSheet((s) => s.open)
  const src = useMilliPlusSheet((s) => s.src)
  const plans = useMilli((s) => s.plans)
  const busy = useDaily((s) => s.busy === 'plus')
  // Уже с PLUS — сразу вкладка Diamond: PLUS ему продавать незачем.
  const [dia, setDia] = useState(false)
  useEffect(() => {
    if (open) setDia(src === 'head_diamond' || milliLook(useMilli.getState().status) === 'plus')
  }, [open, src])
  const loot = useLoot()
  const shown = useShowcase(loot)
  if (!open) return null
  const n = milliPlanNumbers(plans)
  const per = dia ? n.diamond : n.plus
  const buy = () => void useDaily.getState().startPlus((dia ? 'DIAMOND' : 'PLUS') as PlusTier)
  return (
    <div className={'mps lp' + (dia ? ' is-diamond' : '')} role="dialog" aria-label="Милли с PLUS" data-src={src}>
      <button type="button" className="mps-x" aria-label="Закрыть" onClick={closeSheet}>
        <PxIcon name="x" size={12} />
      </button>

      {/* Главное — сам Милли: в короне, танцует (владелец 05.10.2026) */}
      <div className="mps-hero">
        <span className="mps-rays" aria-hidden="true" />
        <Milli size={96} mode="dance" poke={false} track={false} crown={dia ? 'diamond' : 'gold'} />
      </div>
      <h3 className="mps-title">
        Милли с <em>{dia ? 'PLUS Diamond' : 'PLUS'}</em>
      </h3>

      <div className="segs mps-segs" role="tablist" aria-label="Тариф">
        <button type="button" role="tab" aria-selected={!dia} className={'seg' + (!dia ? ' on' : '')} onClick={() => setDia(false)}>
          <Icon id="i-crown" />
          PLUS · 299 ₽
        </button>
        <button type="button" role="tab" aria-selected={dia} className={'seg' + (dia ? ' on' : '')} onClick={() => setDia(true)}>
          <PxArt name="diamond" size={14} className="mci" />
          Diamond · 539 ₽
        </button>
      </div>

      {dia ? (
        <div className="mps-all">
          <PxArt name="diamond" size={22} className="mci" />
          <span>
            <b>Все награды пропуска — сразу</b>
            <small>Не ждать 28 дней: рубины, сундуки и вещи в день покупки</small>
          </span>
        </div>
      ) : null}

      {/* Косметика — главное в PLUS (владелец 05.10.2026): вещи в лаунчере, носишь в игре */}
      <div className="mps-cos">
        <div className="mps-cos-head">
          <b>Косметика в лаунчере</b>
          <span>Крылья, питомцы и эффекты из сундуков PLUS — носишь прямо в игре</span>
        </div>
        <div className="mps-cos-row">
          {shown.map((l, k) => (
            <span key={k} className={'mps-cos-item' + (l ? '' : ' is-empty')} data-r={l?.rarity || undefined} style={{ '--k': k } as CSSProperties} title={l?.name}>
              {l ? <img key={l.id} src={l.preview} alt={l.name} draggable={false} /> : null}
            </span>
          ))}
        </div>
        <div className="mps-cos-facts">
          <span>
            <PxArt name="chest" size={22} className="mci mps-shake" />
            <b>{PASS.chests}</b>
            <small>сундуков</small>
          </span>
          <span>
            <PxArt name="nether_star" size={22} className="mci" />
            <b>6–12%</b>
            <small>шанс вещи</small>
          </span>
          <span>
            <Ruby size={20} />
            <b>{fmt(PASS.rubies)}</b>
            <small>рубинов</small>
          </span>
        </div>
      </div>

      {/* Милли: сколько сообщений и что она соберёт — сравнение полосами и 4 плитки */}
      <div className="mps-ai" key={dia ? 'dia' : 'plus'}>
        <div className="mps-ai-head">
          <b>Сообщений Милли в день</b>
          <span className="mps-ai-x">×{Math.round(per / Math.max(1, n.free))}</span>
        </div>
        <div className="mps-ai-cmp">
          <div className="mps-ai-row">
            <span>Без PLUS</span>
            <i>
              <s style={{ '--w': Math.max(6, (n.free / per) * 100) + '%' } as CSSProperties} />
            </i>
            <em>{n.free}</em>
          </div>
          <div className="mps-ai-row is-on">
            <span>{dia ? 'Diamond' : 'PLUS'}</span>
            <i>
              <s style={{ '--w': '100%' } as CSSProperties} />
            </i>
            <em>{per}</em>
          </div>
        </div>
        <div className="mps-ai-kinds">
          {KINDS.map((k) => (
            <span key={k.icon}>
              <PxIcon name={k.icon} size={16} />
              {k.label}
            </span>
          ))}
        </div>
      </div>

      <button type="button" className="btn lg primary mps-buy" data-track="milli_plus_buy" data-src={src} data-tier={dia ? 'diamond' : 'plus'} disabled={busy} aria-busy={busy || undefined} onClick={buy}>
        Оформить {dia ? 'Diamond · 539 ₽' : 'PLUS · 299 ₽'}
      </button>
      <button
        type="button"
        className="btn md secondary mps-more"
        data-track="milli_plus_more"
        onClick={() => {
          closeSheet()
          closeMilli()
          useUi.getState().setScreen('plus')
        }}
      >
        Что ещё даёт PLUS · отмена в любой день
      </button>
    </div>
  )
}
