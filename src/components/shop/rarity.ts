import type { CSSProperties } from 'react'
import type { Rarity } from '../../lib/rubies'
import { t } from '../../i18n'
import { plural } from '../../lib/format'

/**
 * Единая система редкости (модель предметов v3, 24.09.2026). Цвет, плашка и
 * эффект одни на весь лаунчер: карточка витрины, плитка гардероба, карта
 * сундука, награда. Стили — src/styles/pixel/rarity.css по атрибуту data-rar.
 * Ранг — у расцветки: карточка красится по выбранной расцветке.
 *
 *   обычная      серый       только грань
 *   необычная    зелёный     только грань
 *   редкая       синий       + тон подложки
 *   эпическая    фиолетовый  + искры (статично)
 *   легендарная  золотой     + плашка заливкой, искры (статично)
 *   мифическая   красный     АНИМАЦИЯ: красный блик жёсткими стопами
  *   невозможная  чёрный      АНИМАЦИЯ: чёрная подложка, радужная рамка ступенями
 */
export const RARITY_TONE: Record<Rarity, string> = {
  COMMON: 'var(--m-rarity-common)',
  UNCOMMON: 'var(--m-rarity-uncommon)',
  RARE: 'var(--m-rarity-rare)',
  EPIC: 'var(--m-rarity-epic)',
  LEGENDARY: 'var(--m-rarity-legendary)',
  MYTHIC: 'var(--m-rarity-mythic)',
  RELIC: 'var(--m-rarity-relic)',
}

export const RARITY_ORDER: Rarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'RELIC']

/** Короткое имя для плашки: влезает в карточку шириной 120 px. */
export const RARITY_SHORT: Record<Rarity, string> = {
  get COMMON() { return t('Обычная') },
  get UNCOMMON() { return t('Необычная') },
  get RARE() { return t('Редкая') },
  get EPIC() { return t('Эпическая') },
  get LEGENDARY() { return t('Легенда') },
  get MYTHIC() { return t('Миф') },
  get RELIC() { return t('Невозможная') },
}

/** Полное имя ранга для подписей (без сокращений плашки). */
export const RARITY_NAME_SHORT: Record<Rarity, string> = {
  get COMMON() { return t('Обычная') },
  get UNCOMMON() { return t('Необычная') },
  get RARE() { return t('Редкая') },
  get EPIC() { return t('Эпическая') },
  get LEGENDARY() { return t('Легендарная') },
  get MYTHIC() { return t('Мифическая') },
  get RELIC() { return t('Невозможная') },
}

export const RARITY_NAME_PLURAL: Record<Rarity, string> = {
  get COMMON() { return t('обычные') },
  get UNCOMMON() { return t('необычные') },
  get RARE() { return t('редкие') },
  get EPIC() { return t('эпические') },
  get LEGENDARY() { return t('легендарные') },
  get MYTHIC() { return t('мифические') },
  get RELIC() { return t('невозможные') },
}

/** Строка каталога → редкость. Незнакомое слово — undefined: выдуманная редкость хуже никакой. */
export function normRarity(value?: string | null): Rarity | undefined {
  const r = (value || '').trim().toUpperCase()
  return (RARITY_ORDER as string[]).includes(r) ? (r as Rarity) : undefined
}

export const rarityRank = (r?: Rarity) => (r ? RARITY_ORDER.indexOf(r) : -1)

/** Эпическая и выше — искры и тизер при открытии. */
export const isShiny = (r?: Rarity) => rarityRank(r) >= rarityRank('EPIC')

/** Анимация — только у мифической и реликвии. */
export const isAnimated = (r?: Rarity) => r === 'MYTHIC' || r === 'RELIC'

/** Цвет расцветки «RRGGBB» из каталога → CSS; пусто — нейтральный серый. */
export const swatch = (color?: string | null) => {
  const c = (color || '').replace(/^#/, '')
  return /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c) ? '#' + c : '#888888'
}

/**
 * Атрибуты корня карточки: data-rar (эффекты в rarity.css) и цвет в трёх
 * переменных, которые уже читают магазин (--sh-tone), гардероб (--ch-rarity)
 * и сундук (--co-it).
 */
export function rarityProps(value?: string | null): { 'data-rar'?: string; style?: CSSProperties } {
  const r = normRarity(value)
  if (!r) return {}
  const tone = RARITY_TONE[r]
  return {
    'data-rar': r,
    style: { ['--sh-tone' as string]: tone, ['--ch-rarity' as string]: tone, ['--co-it' as string]: tone, ['--rar' as string]: tone },
  }
}

/** Слово «рубин» в нужном падеже: число без слова читается как код. */
export function word(count: number): string {
  return plural(Math.abs(count), t('рубин'), t('рубина'), t('рубинов'))
}

/** «фрагмент / фрагмента / фрагментов». */
export function fragmentWord(count: number): string {
  return plural(Math.abs(count), t('фрагмент'), t('фрагмента'), t('фрагментов'))
}

/** «осколок / осколка / осколков». */
export function shardWord(count: number): string {
  return plural(Math.abs(count), t('осколок'), t('осколка'), t('осколков'))
}

/**
 * Редкость по каталожной цене. Цена в каталоге = RARITY_PRICE × множитель слота
 * (500/900/1600/2800/4500/7000 × 0,6…1,6), пороги подобраны так, чтобы число
 * эпических и легендарных совпало с разбором каталога (83 и 53).
 */
/* Каталог косметики поля rarity не отдаёт — до него редкость восстанавливаем так. */
export function rarityOfPrice(price: number): Rarity {
  // Мифическую по цене не угадать (легендарные крылья 7 200 дороже мифического
  // значка 4 200) — она приходит только полем rarity.
  if (price > 4_480) return 'LEGENDARY'
  if (price > 2_560) return 'EPIC'
  if (price > 1_440) return 'RARE'
  if (price > 800) return 'UNCOMMON'
  return 'COMMON'
}

