import { t } from '../i18n'
export type AppIconId = 'default' | 'spark' | 'flame' | 'amethyst' | 'legend' | 'gold' | 'diamond'
export type IconRule = 'free' | 'friends' | 'plus' | 'diamond'

export interface AppIconDef {
  id: AppIconId
  name: string
  src: string
  rule: IconRule
  /** Как открыть — подпись на закрытой плитке. */
  need: string
  /** Сколько друзей нужно (лестница приглашений). */
  friends?: number
}

export const APP_ICONS: readonly AppIconDef[] = [
  { id: 'default', name: 'Millida', src: '/app-icons/default.png', rule: 'free', need: '' },
  { id: 'spark', get name() { return t('Искра') }, src: '/app-icons/spark.png', rule: 'friends', friends: 5, get need() { return t('Пригласи 5 друзей') } },
  { id: 'flame', get name() { return t('Пламя') }, src: '/app-icons/flame.png', rule: 'friends', friends: 10, get need() { return t('Пригласи 10 друзей') } },
  { id: 'amethyst', get name() { return t('Аметист') }, src: '/app-icons/amethyst.png', rule: 'friends', friends: 25, get need() { return t('Пригласи 25 друзей') } },
  { id: 'legend', get name() { return t('Легенда') }, src: '/app-icons/legend.png', rule: 'friends', friends: 50, get need() { return t('Пригласи 50 друзей') } },
  { id: 'gold', get name() { return t('Золото') }, src: '/app-icons/gold.png', rule: 'plus', get need() { return t('Только с PLUS') } },
  { id: 'diamond', get name() { return t('Алмаз') }, src: '/app-icons/diamond.png', rule: 'diamond', get need() { return t('Только с Diamond') } },
]

export interface IconAccess {
  plus: boolean
  diamond: boolean
  /** id наград с сервера (`icon-spark`, `icon-diamond`…). */
  perks: readonly string[]
}

// Награды лестницы друзей. `icon-diamond` — старая награда за 25 друзей
// (до 06.10.2026): у кого она уже есть, «Алмаз» остаётся открытым.
const PERK_OF: Partial<Record<AppIconId, string>> = {
  spark: 'icon-spark',
  flame: 'icon-flame',
  amethyst: 'icon-amethyst',
  legend: 'icon-legend',
  diamond: 'icon-diamond',
}

export function iconUnlocked(id: AppIconId, a: IconAccess): boolean {
  const perk = PERK_OF[id]
  if (perk && a.perks.includes(perk)) return true
  if (id === 'default') return true
  if (id === 'gold') return a.plus || a.diamond
  if (id === 'diamond') return a.diamond
  return false
}

export const isIconId = (v: unknown): v is AppIconId => APP_ICONS.some((i) => i.id === v)

/// Выбор хранится, пока иконку не отобрали (кончился PLUS): тогда показываем
/// штатную, а сам выбор не стираем — вернётся с подпиской.
export const effectiveIcon = (chosen: AppIconId, a: IconAccess): AppIconId => (iconUnlocked(chosen, a) ? chosen : 'default')
