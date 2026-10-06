/**
 * Все пиксельные предметы Милли в одной таблице. Рисунки лежат по группам,
 * формат и правила — pxTypes.ts, отрисовка — PxArt.tsx.
 */
import { PX_BENCH } from './pxBench'
import { PX_CHIPS } from './pxChips'
import { PX_CHIPS_B } from './pxChipsB'
import { PX_FX } from './pxFx'
import { PX_MENU } from './pxMenu'
import { PX_PACK } from './pxPack'
import { PX_SIZE } from './pxSize'
import { PX_EMPTY, PX_GRID, type PxSprite } from './pxTypes'
import { PX_UI } from './pxUi'

export { PX_GLYPHS } from './pxFx'

export const PX_ART = {
  ...PX_CHIPS,
  ...PX_CHIPS_B,
  ...PX_UI,
  ...PX_MENU,
  ...PX_PACK,
  ...PX_FX,
  ...PX_BENCH,
  ...PX_SIZE,
} satisfies Record<string, PxSprite>

export type PxName = keyof typeof PX_ART
export const PX_NAMES = Object.keys(PX_ART) as PxName[]

/** Стартовые подсказки чата — в порядке хотбара. */
export const PX_CHIP_ORDER = [
  'steve_glow',
  'zombie_bandage',
  'create_cog',
  'rpg_sword_shield',
  'fps_torch',
  'grass_dandelion',
  'spellbook',
  'friends_heads',
] as const satisfies readonly PxName[]

/** Рисунок цел: 16 строк по 16 символов, все символы — из палитры или `.`. */
export function pxValid(s: PxSprite): boolean {
  return (
    s.rows.length === PX_GRID &&
    s.rows.every((r) => r.length === PX_GRID && [...r].every((c) => c === PX_EMPTY || c in s.pal))
  )
}

/** Проверка один раз при загрузке модуля: битый рисунок не рисуется (и не роняет панель). */
const BROKEN = new Set(PX_NAMES.filter((n) => !pxValid(PX_ART[n])))
if (BROKEN.size && import.meta.env?.DEV) console.warn('[PxArt] битые рисунки:', [...BROKEN].join(', '))

/** Рисунок по имени или null (неизвестное имя или битые данные). */
export function pxSprite(name: string): PxSprite | null {
  if (!Object.prototype.hasOwnProperty.call(PX_ART, name) || BROKEN.has(name as PxName)) return null
  return PX_ART[name as PxName]
}
