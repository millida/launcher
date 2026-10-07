import { useState } from 'react'
import { Icon } from '../Icon'
import { cosmeticSlotIcon } from '../../lib/cosmeticSlots'
import { useVariantPreview } from '../../lib/variantArt'
import type { ItemRef, SetColorwayView, SetTheme, SetView } from '../../lib/rubies'
import { rarityRank, swatch } from './rarity'

/**
 * Наборы (02.10.2026): готовый образ из вещей одной темы со скидкой. Общие
 * куски: цвета тем, превью вещи, кружки расцветок, метка дня. Экран наборов
 * и сцена «на тебе» — SetsV2.tsx (магазин v2, 06.10.2026).
 */

export const THEME_TITLE: Record<SetTheme, string> = { flame: 'Пламя', dark: 'Тьма', future: 'Будущее', cozy: 'Уют' }
export const THEME_ORDER: SetTheme[] = ['flame', 'dark', 'future', 'cozy']
/** Цвет темы: токены редкости, без своих оттенков. */
export const THEME_TONE: Record<SetTheme, string> = {
  flame: 'var(--m-rarity-mythic)',
  dark: 'var(--m-rarity-epic)',
  future: 'var(--m-rarity-rare)',
  cozy: 'var(--m-rarity-uncommon)',
}

/** Превью вещи без подложки: перекрашено в свою расцветку, без картинки — значок слота. */
export function PxThumb({ item, className = '' }: { item: ItemRef; className?: string }) {
  const [broken, setBroken] = useState(false)
  const src = useVariantPreview(item.preview, item.tintFrom, item.tintFrom ? item.color : null)
  return (
    <span className={'px-thumb ' + className}>
      {item.preview && !src && !broken ? null : src && !broken ? (
        <img src={src} alt="" draggable={false} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <Icon id={cosmeticSlotIcon(item.slot)} />
      )}
    </span>
  )
}

/** Расцветка, которую показываем сразу: где у игрока больше всего вещей, иначе первая. */
export const defaultWay = (set: SetView): SetColorwayView =>
  set.colorways.reduce((best, way) => (way.have > best.have ? way : best), set.colorways[0]!)

/** Самые дорогие вещи расцветки: их показывает коллаж. */
export const topItems = (way: SetColorwayView, n: number) =>
  [...way.items].sort((a, b) => b.price - a.price || rarityRank(b.item.rarity) - rarityRank(a.item.rarity)).slice(0, n).map((x) => x.item)

export const thingWord = (n: number): string => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'вещь'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'вещи'
  return 'вещей'
}

/** Кружки расцветок: переключают превью и цену. */
export function Dots({ set, way, onPick, size = 'md' }: { set: SetView; way: SetColorwayView; onPick: (name: string) => void; size?: 'md' | 'lg' }) {
  if (set.colorways.length < 2) return null
  return (
    <span className={'st-dots ' + size} role="radiogroup" aria-label="Расцветка">
      {set.colorways.map((c) => (
        <button
          key={c.name}
          role="radio"
          aria-checked={c.name === way.name}
          aria-label={c.name}
          className={'st-dot' + (c.name === way.name ? ' on' : '')}
          style={{ ['--dot' as string]: swatch(c.color) }}
          data-track="set_colorway"
          onClick={(e) => {
            e.stopPropagation()
            onPick(c.name)
          }}
        />
      ))}
    </span>
  )
}

export function DayTag({ pct }: { pct: number }) {
  return <span className="st-day">Набор дня −{pct}%</span>
}

export interface SetActions {
  balance: number
  busy: string
  onBuy: (set: SetView, way: SetColorwayView) => void
  onTry: (set: SetView, way: SetColorwayView) => void
  onWear: (set: SetView, way: SetColorwayView) => void
}
