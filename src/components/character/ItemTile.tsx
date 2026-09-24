import { useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { loadWorkshop } from '../../lib/rubies'
import { normRarity, rarityOfPrice, RARITY_TONE } from '../shop/rarity'
import { FragBar, RarityFx } from '../shop/rarityUi'

/**
 * Карточка вещи в гардеробе. Одна на всё: скин, плащ, украшение, закрытая
 * вещь каталога, образ. Крупная картинка, название и ОДНА строка статуса —
 * надето / цена / как получить (Roblox и Essential: статус живёт на карточке,
 * а не значками по углам, docs/research — 2026-09-23_wardrobe-research.md).
 */

/** Цвет редкости — из единой системы (shop/rarity.ts). Неизвестное слово не красим. */
export const rarityTone = (rarity?: string): string | undefined => {
  const r = normRarity(rarity)
  return r ? RARITY_TONE[r] : undefined
}

/*
 * Начатые вещи (модель предметов v2): фрагменты из сундуков по коду вещи.
 * Один запрос на всё окно гардероба, общий для всех плиток; нет входа или
 * старая служба — пусто, плитка показывает цену как раньше.
 */
type Frags = Map<string, { have: number; need: number }>
let frags: Frags = new Map()
let fragsAsked = false
const fragsSubs = new Set<() => void>()
function subscribeFrags(fn: () => void) {
  fragsSubs.add(fn)
  if (!fragsAsked) {
    fragsAsked = true
    void loadWorkshop()
      .then((w) => {
        frags = new Map((w.fragments || []).map((f) => [f.item.code, { have: f.have, need: f.need }]))
        fragsSubs.forEach((l) => l())
      })
      .catch(() => undefined)
  }
  return () => fragsSubs.delete(fn)
}
const useFrags = () => useSyncExternalStore(subscribeFrags, () => frags)

export interface ItemTileProps {
  art: ReactNode
  name: string
  /** Строка статуса, когда вещь не надета и не продаётся: «Тонкие руки», условие задания. */
  note?: string
  rarity?: string
  /** Вещь закрыта: в статусе цена, PLUS или условие. */
  locked?: boolean
  priceRubies?: number
  /** Вещь открывает подписка, а не рубины. */
  plus?: boolean
  /** Надето на игроке. */
  on?: boolean
  /** Примеряется прямо сейчас. */
  trying?: boolean
  /** Модель вещи ещё едет — на фигуре её пока нет. */
  loading?: boolean
  /** Статус целиком своими словами — перекрывает расчёт по полям выше. */
  status?: ReactNode
  onClick?: () => void
  onRemove?: () => void
  star?: { on: boolean; toggle: () => void }
  /** Значок в углу: активный аккаунт. */
  mark?: ReactNode
  /** Внутренние кнопки в углу (переименовать, удалить образ). */
  tools?: ReactNode
  /** Начатая вещь: «7/20 фрагментов». Не задано — плитка сама найдёт по itemId. */
  fragments?: { have: number; need: number }
  /** Плитка-действие: «Загрузить», «Сохранить образ». */
  action?: boolean
  /**
   * Аналитика: имя нажатия, тип и стабильный id вещи. Плитка всегда
   * data-private — на ней бывают ники и свои названия, текст не собираем.
   */
  track?: string
  kind?: string
  itemId?: string
}

function statusOf(p: ItemTileProps): { text: ReactNode; tone: string } | null {
  if (p.status !== undefined) return p.status === null ? null : { text: p.status, tone: p.on ? 'on' : '' }
  if (p.on) return { text: 'Надето', tone: 'on' }
  if (p.trying) return { text: p.loading ? 'Надеваем…' : 'Примерка', tone: 'try' }
  // PLUS вещей не даёт (решение владельца 24.09.2026, 18:22): бывшая вещь набора — в магазине.
  if (p.locked && p.plus) return { text: 'В магазине', tone: 'lock' }
  if (p.locked && p.priceRubies !== undefined)
    return {
      text: (
        <>
          <Ruby size={12} />
          {p.priceRubies}
        </>
      ),
      tone: 'price',
    }
  if (p.note) return { text: p.note, tone: p.locked ? 'lock' : '' }
  return null
}

export function ItemTile(p: ItemTileProps) {
  // Каталог не всегда отдаёт rarity — тогда редкость по цене (как в магазине).
  const rarity = normRarity(p.rarity) ?? (p.priceRubies ? rarityOfPrice(p.priceRubies) : undefined)
  const tone = rarity ? RARITY_TONE[rarity] : undefined
  const all = useFrags()
  const fr = p.locked && !p.plus ? p.fragments ?? (p.itemId ? all.get(p.itemId) : undefined) : undefined
  const status = statusOf(p)
  return (
    <div
      className={
        'ch-tile' +
        (p.on ? ' on' : '') +
        (p.trying ? ' trying' : '') +
        (p.locked ? ' locked' : '') +
        (p.action ? ' action' : '') +
        (fr ? ' has-frag' : '')
      }
      style={tone ? ({ '--ch-rarity': tone, '--rar': tone } as CSSProperties) : undefined}
      data-rar={rarity}
      data-private
      data-kind={p.kind}
      data-id={p.itemId}
    >
      {rarity ? <RarityFx /> : null}
      <button className="ch-tile-hit" data-track={p.track || (p.action ? 'tile_action' : 'tile')} onClick={p.onClick}>
        <span className="ch-tile-art">
          {p.art}
          {p.loading ? <span className="ch-tile-load" aria-label="Надеваем"></span> : null}
          {p.locked ? (
            <span className="ch-tile-lock" aria-hidden="true">
              <Icon id="i-lock" />
            </span>
          ) : null}
        </span>
        <span className="ch-tile-name">{p.name}</span>
        <span className={'ch-tile-status' + (status ? ' ' + status.tone : '')}>{status ? status.text : null}</span>
        {fr ? (
          <span className="ch-tile-frag">
            <FragBar have={fr.have} need={fr.need} rarity={rarity} />
          </span>
        ) : null}
      </button>
      {p.mark ? <span className="ch-tile-mark">{p.mark}</span> : null}
      {p.star ? (
        <button
          className={'ch-tile-star' + (p.star.on ? ' on' : '')}
          aria-label={p.star.on ? 'Убрать из избранного' : 'В избранное'}
          data-track={p.star.on ? 'star_off' : 'star_on'}
          onClick={p.star.toggle}
        >
          <Icon id="i-star" />
        </button>
      ) : null}
      {p.tools ? <span className="ch-tile-tools">{p.tools}</span> : null}
      {p.onRemove ? (
        <button className="ch-tile-del" aria-label="Удалить" data-track="remove" onClick={p.onRemove}>
          <Icon id="i-trash" />
        </button>
      ) : null}
    </div>
  )
}

export function ItemGrid({ children }: { children: ReactNode }) {
  return <div className="ch-grid-items">{children}</div>
}
